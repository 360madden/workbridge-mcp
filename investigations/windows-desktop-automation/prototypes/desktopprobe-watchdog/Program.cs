using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Workbridge;

namespace Workbridge.Investigations.DesktopProbeWatchdog;

internal static class Program
{
    // Research helper only. It must be published to the one documented temp folder.
    private const int MaxDesktopDeadlineMs = 110_000; // from watchdog entry, not from child launch
    private const int SyntheticDeadlineMs = 1_600;
    private const int CleanupWaitMs = 5_000;
    private const string ProbeTitle = "Workbridge GUI-004 Native Input Probe";
    private static readonly Stopwatch Lifetime = Stopwatch.StartNew();
    private static readonly Regex SafeId = new("^[a-z0-9][a-z0-9-]{6,38}[a-z0-9]$", RegexOptions.CultureInvariant);
    private static readonly string Repo = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
    private static readonly string Temp = Path.Combine(Repo, "investigations", "windows-desktop-automation", "temp");
    private static readonly string ExpectedPublish = Path.Combine(Temp, "desktopprobe-watchdog-publish");

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(IntPtr processHandle, IntPtr jobHandle, out bool assigned);

    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder buffer, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder buffer, int maxCount);

    private static int Main(string[] args)
    {
        try
        {
            if (!PathEquals(AppContext.BaseDirectory, ExpectedPublish))
                throw new InvalidOperationException("WATCHDOG_NOT_IN_PINNED_PUBLISH");
            return args switch
            {
                ["--synthetic-child", var marker] => SyntheticChild(marker),
                ["--synthetic", var runId] => RunSynthetic(runId, false),
                ["--synthetic-uncertain", var runId] => RunSynthetic(runId, true),
                ["--synthetic-abandon-dual", var runId] => RunSyntheticAbandon(runId, true),
                ["--synthetic-abandon-admission", var runId] => RunSyntheticAbandon(runId, false),
                ["--desktopprobe", var runId, var exeSha, var dllSha] => RunDesktopProbe(runId, exeSha, dllSha),
                _ => throw new ArgumentException("INVALID_ARGUMENTS"),
            };
        }
        catch (Exception error)
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                schemaVersion = 1, result = "blocked_or_unknown", reasonCode = error.Message,
                runtimeMs = Lifetime.ElapsedMilliseconds,
            }));
            return 3;
        }
    }

    // Research-only abrupt-exit fault injection: no child, Job or GUI target.
    // Actual DesktopTurnLease/AdmissionLease writes survive process exit.
    private static int RunSyntheticAbandon(string runId, bool includeGuiGuard)
    {
        AssertSafeId(runId);
        var self = Environment.ProcessPath ?? throw new InvalidOperationException("SELF_PATH_MISSING");
        if (!PathEquals(self, Path.Combine(ExpectedPublish, "DesktopProbeWatchdog.exe")))
            throw new InvalidOperationException("SELF_PATH_MISMATCH");
        var dir = Path.Combine(Temp, "desktopprobe-watchdog-abandon-" + runId);
        Directory.CreateDirectory(dir);
        var guiPath = Path.Combine(dir, "desktop-input-turn.mock.lock");
        if (includeGuiGuard)
        {
            _ = DesktopTurnLease.Acquire(guiPath, runId, Environment.ProcessId,
                Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture),
                Process.GetCurrentProcess().SessionId, true);
        }
        else
        {
            _ = DesktopAdmissionLease.Acquire(guiPath, runId, Environment.ProcessId, true);
        }
        Environment.Exit(includeGuiGuard ? 71 : 72);
        return 3;
    }

    private static int RunSynthetic(string runId, bool forceQuarantine)
    {
        AssertSafeId(runId);
        var evidence = Path.Combine(Temp, "desktopprobe-watchdog-smoke-" + runId);
        Directory.CreateDirectory(evidence);
        var target = Environment.ProcessPath ?? throw new InvalidOperationException("SELF_PATH_MISSING");
        if (!PathEquals(target, Path.Combine(ExpectedPublish, "DesktopProbeWatchdog.exe")))
            throw new InvalidOperationException("SELF_PATH_MISMATCH");
        var marker = Path.Combine(evidence, "started-" + runId + ".marker");
        var mockLease = Path.Combine(evidence, "desktop-input-turn.mock.lock");
        return Supervise(target, ["--synthetic-child", marker], evidence, runId,
            SyntheticDeadlineMs, true, null, null, mockLease, forceQuarantine);
    }

    private static int SyntheticChild(string marker)
    {
        var full = Path.GetFullPath(marker);
        if (!IsWithin(full, Temp) || !Path.GetFileName(full).StartsWith("started-", StringComparison.Ordinal))
            throw new InvalidOperationException("SYNTHETIC_MARKER_OUTSIDE_TEMP");
        using (var file = new FileStream(full, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
        {
            byte[] bytes = Encoding.UTF8.GetBytes("synthetic-child-started\n");
            file.Write(bytes);
            file.Flush(true);
        }
        Thread.Sleep(30_000); // Intentionally exceeds the independent watchdog deadline.
        return 0;
    }

    private static int RunDesktopProbe(string runId, string exeSha, string dllSha)
    {
        AssertSafeId(runId);
        if (!Environment.UserInteractive || Process.GetCurrentProcess().SessionId == 0)
            throw new InvalidOperationException("INTERACTIVE_SESSION_REQUIRED");
        var sharedLease = Path.Combine(Repo, ".tools", "desktop-evidence", "desktop-input-turn.lock");
        if (File.Exists(sharedLease))
            throw new InvalidOperationException("DESKTOP_INPUT_TURN_LOCK_PRESENT");
        var sharedLeaseDir = Path.GetDirectoryName(sharedLease)!;
        if (!Directory.Exists(sharedLeaseDir))
            throw new InvalidOperationException("DESKTOP_INPUT_TURN_DIRECTORY_MISSING");
        if (Directory.EnumerateFiles(sharedLeaseDir, "desktop-turn-quarantine-*.json",
                SearchOption.TopDirectoryOnly).Take(1).Any())
            throw new InvalidOperationException("DESKTOP_INPUT_TURN_ORPHAN_QUARANTINE");
        var runDir = Path.Combine(Temp, "desktopprobe-" + runId);
        var target = Path.Combine(runDir, "publish", "DesktopProbe.exe");
        var managed = Path.Combine(runDir, "publish", "DesktopProbe.dll");
        AssertHash(target, exeSha);
        AssertHash(managed, dllSha);
        var evidence = Path.Combine(runDir, "evidence");
        if (!Directory.Exists(evidence))
            throw new InvalidOperationException("EVIDENCE_DIRECTORY_MISSING");
        if (Lifetime.ElapsedMilliseconds >= MaxDesktopDeadlineMs)
            throw new InvalidOperationException("WATCHDOG_PRELAUNCH_DEADLINE");
        // The only launch target in real mode is this source-verified, hash-pinned DesktopProbe.
        return Supervise(target, [evidence], evidence, runId,
            MaxDesktopDeadlineMs, false, exeSha, dllSha, sharedLease, false);
    }

    private static int Supervise(
        string executable, string[] arguments, string evidence, string runId,
        int deadlineMs, bool synthetic, string? exeSha, string? managedSha,
        string leasePath, bool forceQuarantine)
    {
        Directory.CreateDirectory(evidence);
        var journal = Path.Combine(evidence, "watchdog-" + runId + ".jsonl");
        using var output = new FileStream(journal, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        using var writer = new StreamWriter(output, new UTF8Encoding(false)) { AutoFlush = true };
        void Record(object entry)
        {
            writer.WriteLine(JsonSerializer.Serialize(entry));
            writer.Flush();
            output.Flush(true);
        }

        Record(new
        {
            schemaVersion = 1, stage = "intent", runId, synthetic, utc = DateTimeOffset.UtcNow,
            watchdogPid = Environment.ProcessId, watchdogSession = Process.GetCurrentProcess().SessionId,
            deadlineMs, elapsedMs = Lifetime.ElapsedMilliseconds, exeSha, managedSha,
            executable = synthetic ? "self-child" : "DesktopProbe.exe",
        });

        var watchdogStartedAtUtcTicks = Process.GetCurrentProcess().StartTime.ToUniversalTime()
            .Ticks.ToString(CultureInfo.InvariantCulture);
        var ownerSid = WindowsIdentity.GetCurrent().User?.Value
            ?? throw new InvalidOperationException("WATCHDOG_OWNER_SID_UNAVAILABLE");
        using var lease = DesktopTurnLease.Acquire(leasePath, runId, Environment.ProcessId,
            watchdogStartedAtUtcTicks, Process.GetCurrentProcess().SessionId, synthetic);
        bool collisionBlocked = false;
        if (synthetic)
        {
            // A second writer may NEVER win while the watchdog owns a GUI turn.
            try
            {
                using var unexpected = DesktopTurnLease.Acquire(leasePath, runId, Environment.ProcessId,
                    watchdogStartedAtUtcTicks, Process.GetCurrentProcess().SessionId, true);
                throw new InvalidOperationException("MOCK_LEASE_COLLISION_NOT_BLOCKED");
            }
            catch (InvalidOperationException error) when (error.Message == "UI_TURN_BUSY")
            {
                collisionBlocked = true;
            }
        }
        Record(new { schemaVersion = 1, stage = "turn-acquired",
            runId, leaseId = lease.LeaseId, leaseStampSha256 = lease.StampSha256,
            collisionBlocked, synthetic, utc = DateTimeOffset.UtcNow });

        // Attach the watchdog itself first; its only lifetime Job handle is non-inherited.
        // The child inherits membership automatically, so no post-start assignment race.
        DesktopJobLifetime.Attach();
        if (DesktopJobLifetime.ActiveProcesses() != 1)
            throw new InvalidOperationException("JOB_OWNER_MEMBERSHIP_MISMATCH");

        var info = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(executable)!,
            CreateNoWindow = synthetic,
        };
        foreach (var argument in arguments) info.ArgumentList.Add(argument);
        using var child = new Process { StartInfo = info };
        if (!child.Start()) throw new InvalidOperationException("CHILD_START_FALSE");

        var childPid = child.Id;
        DateTime childStartedUtc = child.StartTime.ToUniversalTime();
        int childSession = child.SessionId;
        if (!IsProcessInJob(child.Handle, IntPtr.Zero, out bool childInAnyJob) || !childInAnyJob)
            throw new InvalidOperationException("CHILD_NOT_IN_WINDOWS_JOB");
        if (childSession != Process.GetCurrentProcess().SessionId)
            throw new InvalidOperationException("CHILD_SESSION_MISMATCH");
        var activeAfterSpawn = DesktopJobLifetime.ActiveProcesses();
        if (activeAfterSpawn != 2)
        {
            // Never assume membership was immediate. A short bounded diagnostic
            // distinguishes an early child crash from a process outside our Job.
            var membershipDeadline = Stopwatch.StartNew();
            while (activeAfterSpawn != 2 && !child.HasExited && membershipDeadline.ElapsedMilliseconds < 250)
            {
                Thread.Sleep(10);
                activeAfterSpawn = DesktopJobLifetime.ActiveProcesses();
            }
            if (activeAfterSpawn != 2)
            {
                bool alreadyExited = child.HasExited;
                int? earlyExitCode = alreadyExited ? child.ExitCode : null;
                Record(new { schemaVersion = 1, stage = "membership-rejected", childPid,
                    childInAnyJob, activeAfterSpawn, alreadyExited, earlyExitCode, elapsedMs = Lifetime.ElapsedMilliseconds });
                if (!alreadyExited) { child.Kill(); child.WaitForExit(CleanupWaitMs); }
                throw new InvalidOperationException("JOB_CHILD_MEMBERSHIP_MISMATCH");
            }
        }

        Record(new
        {
            schemaVersion = 1, stage = "child-started", utc = DateTimeOffset.UtcNow,
            childPid, childStartedUtc, childSession, activeAfterSpawn, childInAnyJob,
            elapsedMs = Lifetime.ElapsedMilliseconds,
        });

        bool manifestWritten = false;
        if (!synthetic)
        {
            manifestWritten = TryWriteTargetManifest(child, executable, evidence, runId,
                lease.LeaseId, watchdogStartedAtUtcTicks, ownerSid, exeSha!,
                activeAfterSpawn, deadlineMs);
            Record(new { schemaVersion = 1, stage = manifestWritten ? "target-proven" : "target-unproven",
                childPid, manifestWritten, elapsedMs = Lifetime.ElapsedMilliseconds });
        }

        bool timeout = false;
        bool killIssued = false;
        bool childExited = false;
        int? childExitCode = null;
        try
        {
            int remaining = Math.Max(0, deadlineMs - checked((int)Lifetime.ElapsedMilliseconds));
            childExited = child.WaitForExit(remaining);
            if (!childExited)
            {
                timeout = true;
                if (!child.HasExited)
                {
                    // Kill the exact Process handle returned by Start(), not a PID rediscovered later.
                    child.Kill();
                    killIssued = true;
                }
                childExited = child.WaitForExit(CleanupWaitMs);
            }
            if (childExited) childExitCode = child.ExitCode;
        }
        finally
        {
            if (!childExited)
            {
                try
                {
                    if (!child.HasExited)
                    {
                        child.Kill();
                        killIssued = true;
                    }
                    childExited = child.WaitForExit(CleanupWaitMs);
                    if (childExited) childExitCode = child.ExitCode;
                }
                catch
                {
                    // The private Job closes on watchdog exit, killing remaining descendants.
                    // Journal the uncertain settlement rather than claiming success.
                }
            }
        }

        uint activeAfter = 0;
        var settle = Stopwatch.StartNew();
        while (settle.ElapsedMilliseconds < 2_000)
        {
            activeAfter = DesktopJobLifetime.ActiveProcesses();
            if (activeAfter == 1) break;
            Thread.Sleep(25);
        }
        var settled = childExited && activeAfter == 1;
        bool markerSeen = !synthetic || File.Exists(Path.Combine(evidence, "started-" + runId + ".marker"));
        bool leaseReleased = lease.Complete(settled && !forceQuarantine);
        bool leaseRetained = File.Exists(leasePath);
        var processTreeSettled = settled && (forceQuarantine
            ? (!leaseReleased && leaseRetained) : (leaseReleased && !leaseRetained));
        var scenarioPassed = processTreeSettled &&
            (synthetic ? (timeout && killIssued && markerSeen && collisionBlocked) : manifestWritten);
        var operationOutcome = forceQuarantine || !scenarioPassed ? "unknown_outcome" : "verified_child_settled";
        // Child settlement is independent of the GUI postcondition. Never claim
        // desktop readiness if a shown HWND/native receipt was not proven.
        var result = !synthetic && !manifestWritten ? "no_gui_manifest"
            : scenarioPassed
                ? forceQuarantine ? "synthetic_unknown_retained_proven"
                    : synthetic ? "synthetic_watchdog_passed"
                    : timeout ? "desktopprobe_deadline_enforced" : "desktopprobe_exited"
                : "unknown_outcome";
        Record(new
        {
            schemaVersion = 1, stage = "final", utc = DateTimeOffset.UtcNow,
            runId, synthetic, watchdogPid = Environment.ProcessId,
            childPid, childStartedUtc, childSession, activeAfterSpawn, activeAfter,
            childExited, childExitCode, timeout, killIssued, markerSeen, settled,
            collisionBlocked, leaseId = lease.LeaseId, leaseReleased, leaseRetained,
            manifestWritten, forceQuarantine, operationOutcome, result,
            elapsedMs = Lifetime.ElapsedMilliseconds,
        });
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = 1, runId, synthetic,
            result, operationOutcome, collisionBlocked, leaseId = lease.LeaseId,
            leaseReleased, leaseRetained, manifestWritten, forceQuarantine,
            watchdogPid = Environment.ProcessId, childPid, childStartedUtc, childSession,
            activeAfterSpawn, activeAfter, childExited, childExitCode, timeout, killIssued, markerSeen, settled,
            elapsedMs = Lifetime.ElapsedMilliseconds, journal,
        }));
        return scenarioPassed ? 0 : 4;
    }

    private static bool TryWriteTargetManifest(
        Process child, string executable, string evidence, string runId,
        string leaseId, string watchdogStartTicks, string ownerSid, string exeSha,
        uint jobActiveAfterSpawn, int deadlineMs)
    {
        // The child itself writes a native shown-HWND receipt. We independently
        // bind it to its PID/session, live Win32 window and exact launch handle.
        // No guessed title lookup, UIA calls, focus or input.
        var nativeJournal = Path.Combine(evidence, "native-probe-" + child.Id + ".jsonl");
        var proofDeadline = Stopwatch.StartNew();
        while (proofDeadline.ElapsedMilliseconds < 5_000 &&
               Lifetime.ElapsedMilliseconds < deadlineMs - 1_000 && !child.HasExited)
        {
            try
            {
                if (File.Exists(nativeJournal))
                {
                    foreach (var line in File.ReadAllLines(nativeJournal))
                    {
                        using var json = JsonDocument.Parse(line);
                        var root = json.RootElement;
                        if (!root.TryGetProperty("stage", out var stage) ||
                            stage.GetString() != "shown") continue;
                        if (root.GetProperty("schemaVersion").GetInt32() != 1 ||
                            root.GetProperty("pid").GetInt32() != child.Id ||
                            root.GetProperty("sessionId").GetInt32() != child.SessionId ||
                            root.GetProperty("counter").GetInt32() != 0 ||
                            root.GetProperty("title").GetString() != ProbeTitle)
                            return false;
                        long value = root.GetProperty("hwnd").GetInt64();
                        if (value <= 0) return false;
                        var hwnd = new IntPtr(value);
                        if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd) ||
                            GetAncestor(hwnd, 2) != hwnd || GetWindow(hwnd, 4) != IntPtr.Zero ||
                            GetWindowThreadProcessId(hwnd, out uint ownerPid) == 0 ||
                            ownerPid != (uint)child.Id) return false;
                        var cls = new StringBuilder(256);
                        var title = new StringBuilder(256);
                        if (GetClassName(hwnd, cls, cls.Capacity) <= 0 ||
                            GetWindowText(hwnd, title, title.Capacity) <= 0 ||
                            title.ToString() != ProbeTitle) return false;
                        var foreground = GetForegroundWindow();
                        if (foreground == IntPtr.Zero) return false;
                        var observedAtUtc = DateTimeOffset.UtcNow;
                        var deadlineUtc = observedAtUtc.AddMilliseconds(
                            Math.Max(0, deadlineMs - Lifetime.ElapsedMilliseconds));
                        var manifest = new
                        {
                            schemaVersion = 1, runId, requestId = runId, leaseId,
                            ownerSid, watchdogPid = Environment.ProcessId,
                            watchdogStartedAtUtcTicks = watchdogStartTicks,
                            pid = child.Id,
                            startedAtUtcTicks = child.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture),
                            sessionId = child.SessionId,
                            hwnd = value.ToString(CultureInfo.InvariantCulture),
                            className = cls.ToString(), title = ProbeTitle,
                            exePath = Path.GetFullPath(executable), exeSha256 = exeSha,
                            foregroundHwnd = foreground.ToInt64().ToString(CultureInfo.InvariantCulture),
                            evidenceDir = Path.GetFullPath(evidence), observedAtUtc, deadlineUtc,
                            jobActiveAfterSpawn,
                            watchdog = new
                            {
                                pid = Environment.ProcessId, startedAtUtcTicks = watchdogStartTicks,
                                deadlineUtc, privateJobOwner = true, jobActiveAfterSpawn,
                            },
                        };
                        var manifestPath = Path.Combine(evidence, "target-manifest.json");
                        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(manifest) + "\n");
                        using var output = new FileStream(manifestPath, FileMode.CreateNew,
                            FileAccess.Write, FileShare.Read);
                        output.Write(bytes);
                        output.Flush(true);
                        return true;
                    }
                }
            }
            catch (IOException) { /* Child may be appending its shown receipt. */ }
            catch (JsonException) { /* Native event write may be in progress. */ }
            Thread.Sleep(25);
        }
        return false;
    }

    private static void AssertSafeId(string value)
    {
        if (!SafeId.IsMatch(value)) throw new ArgumentException("INVALID_RUN_ID");
    }

    private static void AssertHash(string file, string expected)
    {
        if (!Regex.IsMatch(expected, "^[a-fA-F0-9]{64}$", RegexOptions.CultureInvariant))
            throw new ArgumentException("INVALID_PIN_DIGEST");
        if (!File.Exists(file) || (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("PINNED_FILE_NOT_REGULAR");
        var observed = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)));
        if (!observed.Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("PINNED_FILE_HASH_MISMATCH");
    }

    private static bool PathEquals(string left, string right) =>
        Path.TrimEndingDirectorySeparator(Path.GetFullPath(left))
            .Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(right)), StringComparison.OrdinalIgnoreCase);

    private static bool IsWithin(string file, string directory)
    {
        var baseDir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory)) + Path.DirectorySeparatorChar;
        return Path.GetFullPath(file).StartsWith(baseDir, StringComparison.OrdinalIgnoreCase);
    }
}