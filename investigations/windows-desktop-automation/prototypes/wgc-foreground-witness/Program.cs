namespace WgcForegroundWitness;

internal static class Program
{
    private static int _assertions;

    // This CLI intentionally exposes NO native hook, GUI, screenshot or
    // target-window operation. The only runnable mode is pure fake events.
    private static int Main(string[] args)
    {
        if (args.Length != 1 || args[0] != "--self-test")
        {
            Console.Error.WriteLine("Only --self-test exists; no native hook can be launched.");
            return 2;
        }

        try
        {
            RunSyntheticTests();
            Console.WriteLine($"PASS WGC foreground witness synthetic checks {_assertions}");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"FAIL synthetic witness: {error}");
            return 1;
        }
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
        _assertions++;
    }

    private static void AssertThrows(Action action, string message)
    {
        try { action(); }
        catch (InvalidOperationException) { _assertions++; return; }
        throw new InvalidOperationException($"Expected failure: {message}");
    }

    private static ForegroundAudit Healthy(bool stop = true, bool drain = true, bool unhook = true)
    {
        var audit = new ForegroundAudit();
        audit.MarkHookReady();
        audit.BeginInterval(0x1111);
        audit.MarkPumpSample();
        if (stop)
        {
            audit.EndInterval(0x1111);
            audit.MarkPumpSample();
            if (drain) audit.MarkPostStopDrain();
            if (unhook) audit.MarkUnhooked();
        }
        return audit;
    }

    private static void RunSyntheticTests()
    {
        var healthy = Healthy();
        var receipt = healthy.Snapshot();
        Assert(receipt.Verdict == WitnessVerdict.CandidateUnchanged, "complete fake sequence should be only a candidate");
        Assert(!receipt.ProvesNoTransientFocus, "cannot prove absence of async lost events");
        Assert(receipt.HookReady && receipt.DrainAcknowledged && receipt.Unhooked, "synthetic state flags");
        Assert(receipt.PumpSamplesDuring == 1 && receipt.PumpSamplesAfter == 1, "both pump phases observed");
        Assert(receipt.ForegroundEvents == 0 && receipt.LateEvents == 0, "no fake event delivered");

        var noHook = new ForegroundAudit();
        Assert(noHook.Snapshot().Verdict == WitnessVerdict.Insufficient, "no hook is incomplete");
        AssertThrows(() => noHook.BeginInterval(0x1111), "must install before interval");
        AssertThrows(() => noHook.MarkPostStopDrain(), "cannot drain before stop");
        AssertThrows(() => noHook.MarkUnhooked(), "cannot unhook before hook");
        noHook.MarkPumpSample();
        Assert(noHook.Snapshot().Faulted, "pump before install faults");

        var readyOnly = new ForegroundAudit();
        readyOnly.MarkHookReady();
        Assert(readyOnly.Snapshot().Verdict == WitnessVerdict.Insufficient, "installed alone incomplete");
        AssertThrows(() => readyOnly.MarkHookReady(), "cannot double install");
        AssertThrows(() => readyOnly.BeginInterval(0), "nonzero baseline required");
        readyOnly.BeginInterval(0x1111);
        AssertThrows(() => readyOnly.BeginInterval(0x1111), "cannot double start");
        Assert(readyOnly.Snapshot().Verdict == WitnessVerdict.Insufficient, "capture still ongoing");

        var missingPump = new ForegroundAudit();
        missingPump.MarkHookReady();
        missingPump.BeginInterval(0x1111);
        missingPump.EndInterval(0x1111);
        missingPump.MarkUnhooked();
        Assert(missingPump.Snapshot().Verdict == WitnessVerdict.Insufficient, "without pump/drain never candidate");

        var noDrain = Healthy(drain: false, unhook: false);
        Assert(noDrain.Snapshot().Verdict == WitnessVerdict.Insufficient, "no drain incomplete");
        noDrain.MarkUnhooked();
        Assert(noDrain.Snapshot().Faulted, "unhook without drain flags fault");
        Assert(noDrain.Snapshot().Verdict == WitnessVerdict.Insufficient, "faulted no-drain still incomplete");

        var noStop = Healthy(stop: false);
        Assert(noStop.Snapshot().Verdict == WitnessVerdict.Insufficient, "no stop incomplete");
        AssertThrows(() => noStop.MarkPostStopDrain(), "cannot drain during interval");

        var mismatch = new ForegroundAudit();
        mismatch.MarkHookReady();
        mismatch.BeginInterval(0x1111);
        mismatch.MarkPumpSample();
        mismatch.EndInterval(0x2222);
        mismatch.MarkPumpSample();
        mismatch.MarkPostStopDrain();
        mismatch.MarkUnhooked();
        Assert(mismatch.Snapshot().Verdict == WitnessVerdict.Changed, "endpoint mismatch disqualified");
        Assert(!mismatch.Snapshot().EndpointSame, "mismatch recorded");

        var oneEvent = Healthy();
        oneEvent.ObserveForegroundEvent(0x2222, 100);
        Assert(oneEvent.Snapshot().Verdict == WitnessVerdict.Changed, "any foreground event invalidates candidate");
        Assert(oneEvent.Snapshot().LateEvents == 1, "event after unhook is late");

        var sameEvent = new ForegroundAudit();
        sameEvent.MarkHookReady();
        sameEvent.BeginInterval(0x1111);
        sameEvent.MarkPumpSample();
        sameEvent.ObserveForegroundEvent(0x1111, 123);
        sameEvent.EndInterval(0x1111);
        sameEvent.MarkPumpSample();
        sameEvent.MarkPostStopDrain();
        sameEvent.MarkUnhooked();
        Assert(sameEvent.Snapshot().Verdict == WitnessVerdict.Changed, "same-HWND event disqualified");
        Assert(sameEvent.Snapshot().ForegroundEvents == 1, "same-HWND still counted");

        var returned = new ForegroundAudit();
        returned.MarkHookReady();
        returned.BeginInterval(0x1111);
        returned.MarkPumpSample();
        returned.ObserveForegroundEvent(0x2222, 10);
        returned.ObserveForegroundEvent(0x1111, 20);
        returned.EndInterval(0x1111);
        returned.MarkPumpSample();
        returned.MarkPostStopDrain();
        returned.MarkUnhooked();
        Assert(returned.Snapshot().Verdict == WitnessVerdict.Changed, "switch-and-return disqualified");
        Assert(returned.Snapshot().EndpointSame, "endpoints alone would miss switch-and-return");
        Assert(returned.Snapshot().ForegroundEvents == 2, "two queued callbacks counted");

        var late = new ForegroundAudit();
        late.MarkHookReady();
        late.BeginInterval(0x1111);
        late.MarkPumpSample();
        late.EndInterval(0x1111);
        late.ObserveForegroundEvent(0x2222, 20);
        late.MarkPumpSample();
        late.MarkPostStopDrain();
        late.MarkUnhooked();
        Assert(late.Snapshot().LateEvents == 1, "post-interval callback counted as late");
        Assert(late.Snapshot().Verdict == WitnessVerdict.Changed, "late callback disqualifies");

        var fault = Healthy();
        fault.MarkFault("synthetic message-pump gap");
        Assert(fault.Snapshot().Verdict == WitnessVerdict.Insufficient, "hook loss/gap cannot be clean");
        Assert(fault.Snapshot().Faulted, "fault is sticky");
        AssertThrows(() => fault.EndInterval(0x1111), "double stop rejected");
        AssertThrows(() => fault.MarkUnhooked(), "double unhook rejected");
        fault.MarkPumpSample();
        Assert(fault.Snapshot().Faulted, "pumping after unhook leaves fault");
    }
}
