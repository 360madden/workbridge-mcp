using System.Diagnostics;
using System.Runtime.InteropServices;

namespace WgcForegroundWitness;

internal enum WitnessVerdict
{
    Insufficient,
    Changed,
    CandidateUnchanged
}

internal sealed record ForegroundReceipt(
    WitnessVerdict Verdict,
    bool HookReady,
    int PumpSamplesDuring,
    int PumpSamplesAfter,
    bool IntervalStopped,
    bool DrainAcknowledged,
    bool Unhooked,
    int ForegroundEvents,
    int LateEvents,
    bool EndpointSame,
    bool Faulted,
    bool ProvesNoTransientFocus)
{
    // This prototype cannot prove the absence of unreceived asynchronous events.
    // Even CandidateUnchanged needs separately validated native message-pump
    // coverage, callback timing and a target-specific live acceptance gate.
}

internal sealed class ForegroundAudit
{
    private readonly object _sync = new();
    private bool _hookReady;
    private bool _started;
    private bool _stopped;
    private bool _drained;
    private bool _unhooked;
    private bool _faulted;
    private nint _before;
    private nint _after;
    private long _beginTicks;
    private long _endTicks;
    private int _events;
    private int _lateEvents;
    private int _pumpDuring;
    private int _pumpAfter;

    internal void MarkHookReady()
    {
        lock (_sync)
        {
            if (_hookReady || _started || _unhooked)
                throw new InvalidOperationException("Hook-ready transition out of order.");
            _hookReady = true;
        }
    }

    internal void BeginInterval(nint beforeForeground)
    {
        lock (_sync)
        {
            if (!_hookReady || _started || _stopped || _unhooked || beforeForeground == 0)
                throw new InvalidOperationException("Witness interval requires live hook and nonzero baseline.");
            _before = beforeForeground;
            _beginTicks = Stopwatch.GetTimestamp();
            _started = true;
        }
    }

    // Called by the owner after it actually pumps the hook-registration thread.
    // One call is merely a liveness sample, NOT proof that no callbacks were lost.
    internal void MarkPumpSample()
    {
        lock (_sync)
        {
            if (!_started || _unhooked)
            {
                _faulted = true;
                return;
            }
            if (_stopped) _pumpAfter++;
            else _pumpDuring++;
        }
    }

    // A callback for ANY foreground event disqualifies 'no transition',
    // even if the reported HWND equals the baseline or later returns to it.
    internal void ObserveForegroundEvent(nint hwnd, uint windowsEventMilliseconds)
    {
        _ = hwnd;
        _ = windowsEventMilliseconds;
        lock (_sync)
        {
            if (_events < int.MaxValue) _events++;
            if (!_started || _stopped || _unhooked)
            {
                if (_lateEvents < int.MaxValue) _lateEvents++;
            }
        }
    }

    internal void MarkFault(string reason)
    {
        _ = reason;
        lock (_sync) _faulted = true;
    }

    internal void EndInterval(nint afterForeground)
    {
        lock (_sync)
        {
            if (!_started || _stopped || _unhooked)
                throw new InvalidOperationException("End must follow Begin exactly once.");
            _after = afterForeground;
            _endTicks = Stopwatch.GetTimestamp();
            if (_endTicks <= _beginTicks) _faulted = true;
            _stopped = true;
        }
    }

    internal void MarkPostStopDrain()
    {
        lock (_sync)
        {
            if (!_stopped || _unhooked || _pumpAfter == 0)
                throw new InvalidOperationException("Post-stop drain needs a pump sample.");
            _drained = true;
        }
    }

    internal void MarkUnhooked()
    {
        lock (_sync)
        {
            if (!_hookReady || _unhooked)
                throw new InvalidOperationException("Unhook transition invalid.");
            _unhooked = true;
            // Unhook before a post-stop drain never qualifies as candidate-clean.
            if (!_drained) _faulted = true;
        }
    }

    internal ForegroundReceipt Snapshot()
    {
        lock (_sync)
        {
            bool same = _before != 0 && _after == _before;
            bool completeSequence = _hookReady && _started && _stopped &&
                _drained && _unhooked && _pumpDuring > 0 && _pumpAfter > 0;
            var verdict = _events != 0 || (_stopped && !same)
                ? WitnessVerdict.Changed
                : completeSequence && !_faulted
                    ? WitnessVerdict.CandidateUnchanged
                    : WitnessVerdict.Insufficient;
            return new ForegroundReceipt(
                verdict, _hookReady, _pumpDuring, _pumpAfter, _stopped,
                _drained, _unhooked, _events, _lateEvents, same, _faulted,
                ProvesNoTransientFocus: false);
        }
    }
}

// The native hook is deliberately unreachable from this prototype's CLI.
// A future separately approved capture adapter must supply an owner-thread
// message loop and its own timeout, identity, access and freshness gates.
// Do not invoke Install from --self-test.
internal sealed class PassiveForegroundHook : IDisposable
{
    private const uint EventSystemForeground = 0x0003;
    private const uint WinEventOutOfContext = 0;
    private readonly ForegroundAudit _audit;
    private readonly WinEventProc _callback;
    private GCHandle _callbackRoot;
    private readonly uint _ownerThread;
    private nint _hook;
    private bool _disposed;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void WinEventProc(
        nint hook, uint eventType, nint hwnd, int idObject, int idChild,
        uint eventThread, uint eventTime);

    [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
    private static extern nint SetWinEventHook(
        uint eventMin, uint eventMax, nint hmod, WinEventProc callback,
        uint processId, uint threadId, uint flags);

    [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWinEvent(nint hook);

    [DllImport("kernel32.dll", ExactSpelling = true)]
    private static extern uint GetCurrentThreadId();

    private PassiveForegroundHook(ForegroundAudit audit)
    {
        _audit = audit;
        _ownerThread = GetCurrentThreadId();
        _callback = HandleNativeEvent;
        // Microsoft documents retaining a GCHandle for managed callbacks.
        _callbackRoot = GCHandle.Alloc(_callback);
    }

    internal static PassiveForegroundHook Install(ForegroundAudit audit)
    {
        ArgumentNullException.ThrowIfNull(audit);
        var witness = new PassiveForegroundHook(audit);
        try
        {
            witness._hook = SetWinEventHook(
                EventSystemForeground, EventSystemForeground, 0,
                witness._callback, 0, 0, WinEventOutOfContext);
            if (witness._hook == 0)
                throw new InvalidOperationException(
                    "Passive foreground hook installation failed; no fallback.");
            witness._audit.MarkHookReady();
            return witness;
        }
        catch (Exception error)
        {
            witness._audit.MarkFault("Native hook installation failed: " +
                error.GetType().Name);
            if (witness._hook != 0)
            {
                // MarkHookReady can itself fail after native registration.
                // Release that partial hook on this same registering thread.
                // If native unhook fails, KEEP the callback rooted rather than
                // freeing a delegate still possibly reachable by Windows.
                bool removed;
                try { removed = UnhookWinEvent(witness._hook); }
                catch { removed = false; }
                if (!removed)
                    throw new InvalidOperationException(
                        "Partial hook cleanup failed; callback root retained.", error);
                witness._hook = 0;
            }
            if (witness._callbackRoot.IsAllocated)
                witness._callbackRoot.Free();
            throw;
        }
    }

    private void HandleNativeEvent(
        nint hook, uint eventType, nint hwnd, int idObject, int idChild,
        uint eventThread, uint eventTime)
    {
        _ = hook;
        _ = idObject;
        _ = idChild;
        _ = eventThread;
        try
        {
            if (eventType == EventSystemForeground)
                _audit.ObserveForegroundEvent(hwnd, eventTime);
            else
                _audit.MarkFault("Unexpected WinEvent callback type.");
        }
        catch
        {
            // Never throw across an unmanaged callback boundary.
            _audit.MarkFault("Exception during callback dispatch.");
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        if (GetCurrentThreadId() != _ownerThread)
        {
            _audit.MarkFault("Unhook attempted off owner thread.");
            throw new InvalidOperationException(
                "UnhookWinEvent must run on registering thread.");
        }
        if (_hook != 0)
        {
            if (!UnhookWinEvent(_hook))
            {
                _audit.MarkFault("UnhookWinEvent failed.");
                // Preserve delegate root until an authorized recovery; an
                // active hook must not reference a collected callback.
                throw new InvalidOperationException("UnhookWinEvent failed.");
            }
            _hook = 0;
        }
        _audit.MarkUnhooked();
        _callbackRoot.Free();
        _disposed = true;
    }
}
