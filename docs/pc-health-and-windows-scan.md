# PC health recorder and Windows image diagnostic

## Roadmap

1. Build a normal-user .NET 10 recorder for disk space, available memory, uptime,
   and Workbridge readiness. Keep one current report and two bounded transition logs.
2. Register it with the existing limited-privilege helper task manager at sign-in;
   start it now and verify fresh reports from its independent process.
3. Build a separate, fixed administrator action that runs Windows component-store
   ScanHealth. Review its inputs, protected report storage, cancellation, and replay
   controls before requesting UAC.
4. Run the diagnostic after the person at the PC confirms readiness for UAC. Verify
   its reported image state and normal-user read-only access to the result.
5. Verify access from normal ChatGPT Chat mode through the existing Workbridge
   connection. Retain the useful recorder, document stop/removal commands, and
   distinguish a configured sign-in trigger from an actual reboot test.

## Scope

The recorder runs only while this user is signed in. It makes no external network
requests: its only HTTP target is Workbridge's validated loopback health address.
It does not record credentials, browser activity, process lists, or document contents.

The administrator executable accepts only `scan <32-lowercase-hex-id>` or
`cleanup <32-lowercase-hex-id>`. Each invocation requires Windows UAC. It runs the
installed DISM PowerShell module's `Repair-WindowsImage -Online -ScanHealth
-NoRestart`, never RestoreHealth, component cleanup, or reboot. Windows writes its
own diagnostic logs as part of the scan.

Reports go only to `%ProgramData%\WorkbridgePcHealth`. Storage is owned by the
Administrators group, with full control for Administrators/System and read access
for authenticated users. The executable checks ownership and permissions on the
storage it accesses, rejects reparse points, and requires its exact storage marker.
Cleanup also refuses unexpected entries in the selected scan directory. The
normal-user receipt is operational status, not an administrator-authenticated
attestation.

`cleanup` removes only the named scan's known report files after checking their
ownership and permissions. It refuses unexpected entries. It retains the small
protected storage root and marker. It does not remove Windows DISM logs or undo
Windows servicing history. ScanHealth performs diagnosis, not image repair.

This is a consenting local-user workflow, not a sandbox against malicious code
already running as that same user. There is no permanently elevated service,
general administrator command endpoint, or unattended UAC approval.

## Validation status

The .NET 10 applications build without warnings. The recorder is installed at
`C:\work\Workbridge Health`, with task `Workbridge Helper pc-health` set to
Limited/Interactive and an explicit sign-in trigger. It samples every 30 seconds.
No actual reboot/sign-out recovery test has been performed.

The recorder integration test covers normal privilege, advancing samples, an
exclusive instance lock, invalid endpoint rejection, bounded log rotation, warning
deduplication, and administrator payload drift rejection before UAC. The policy
test covers 14 accepted/rejected ACL variants, including a user-owned descriptor
that would otherwise permit the owner's permission changes.

Reports are operational evidence, not a complete PC health/security assessment.
Live ScanHealth acceptance completed October 18, 2026:

- Scan ID: `50e9b605c0864ad6a8b1b916996435e0`.
- Started `20:46:53Z`, completed `20:48:55Z`; child and DISM exit codes both 0.
- Image health `Healthy`, restart needed false, repair requested false.
- All eight real storage paths passed exact owner/ACL checks. Sixteen handle-open
  attempts confirmed normal-user denial of data writes and DACL changes, without
  changing any data or permissions.
- Replaying the operation was rejected without a second UAC prompt; its receipt
  remained byte-identical. The completed administrator launcher task was removed.
- Normal Chrome ChatGPT **Chat** mode ran both real Workbridge Status jobs:
  `browser-pc-health-status-20261018-01` and
  `browser-windows-scan-status-20261018-01`; both passed with exit 0 and empty stderr.
  ChatGPT observed the same recorder instance advancing from sample 5 to 12 and
  independently read its saved completed-scan summary.

Evidence: `C:\work\Workbridge Health\phase-acceptance.json`,
`C:\work\Workbridge Health\tests\acceptance.json`, the protected scan report,
and `C:\work\workbridge-mcp\.local\verification\pc-health-chatgpt.png`.

The updated task manager rejects altered triggers and relevant execution settings,
including automatic retry. Its lifecycle suite passed again with trigger drift
coverage. A ten-minute-old report was correctly marked stale in both PowerShell
5.1 and 7. Testing also fixed invalid-endpoint exception handling in the recorder.

Live administrator report cleanup subsequently passed; see
[recovery and cleanup](pc-health-recovery-and-cleanup.md) for retained audit evidence
and the successful real sign-in test. The protected scan report and latest pointer were
removed, so the recorder now reports `latestScan: null`. The phase acceptance file
above is retained as historical evidence of the earlier scan. Actual sign-out and
sign-in recovery subsequently passed. The separate
[full reboot test](pc-health-full-reboot-test.md) also passed after an approved
orderly restart and sign-in. Unexpected-power-loss recovery remains untested.

## Recorder operation

Run these from a normal PowerShell session. Use `-NoProfile -ExecutionPolicy
RemoteSigned -File` with the absolute script path when invoking Windows PowerShell
as a child process.

```powershell
$script = 'C:\work\workbridge-mcp\scripts\Manage-PcHealth.ps1'
$install = 'C:\work\Workbridge Health'
& $script -Action Status -InstallDirectory $install
& $script -Action Stop -InstallDirectory $install
& $script -Action Start -InstallDirectory $install
```

To stop the helper and remove its sign-in task:

```powershell
& $script -Action Remove -InstallDirectory $install
```

Application files and reports are retained. Re-register the same prepared bundle
with `-Action Install -IntervalSeconds 30`. Use `Prepare-PcHealthTools.ps1` with a
new absolute installation directory to build a fresh bundle; preparation never
requests UAC or overwrites an existing installation.

Normal ChatGPT can read `C:\work\Workbridge Health\data\status.json` through
Workbridge, or invoke the Status command. `stale: true` means the report needs
investigation even if Task Scheduler still says Running. The recorder does not
automatically restart after an application failure; Start or the next sign-in
starts it again. Windows sleep/offline periods interrupt observation.

## Administrator operation

Preparation registers an on-demand Limited launcher. Start requests one UAC prompt;
there is no sign-in trigger for administrator actions. Pick a fresh GUID and
operation ID deliberately, retain them, then inspect Status if a response is lost:

```powershell
$request = 'C:\work\workbridge-mcp\scripts\Request-WindowsHealthScan.ps1'
$scan = [guid]::NewGuid().ToString('N')
$operation = 'scan-' + $scan
$parameters = @{InstallDirectory=$install; AdminAction='scan';
    ScanId=$scan; OperationId=$operation}
& $request -Action Prepare @parameters
# Only after the operator is ready to approve/cancel Windows UAC:
& $request -Action Start @parameters
& $request -Action Status @parameters
```

The operation reservation prevents automatic UAC replay. Do not stop a running
scan's launcher or Windows servicing process. The launcher waits outside bridge
job ownership. Its receipt retains `awaiting_windows_uac` while the child runs;
this label alone does not distinguish a pending prompt from an active scan.
Read `report.status` and `imageHealthState` after completion: exit zero means the
diagnosis completed, not necessarily that Windows is healthy.

After completion/cancellation, remove only the launcher registration:

```powershell
& $request -Action Remove @parameters
```

To remove that scan's reports later, prepare a **new** operation ID using
`AdminAction='cleanup'` and the original ScanId, then Start it when ready for UAC.
Cleanup is a separate privileged action and has not been implicitly approved by
approval of the diagnostic. It retains the protected root, marker, and lock file.
The independent normal-user health recorder continues running.

## References

- [Microsoft DISM PowerShell diagnostic options](https://learn.microsoft.com/en-us/powershell/module/dism/repair-windowsimage?view=windowsserver2025-ps)
- [Microsoft file and directory creation with access control](https://learn.microsoft.com/en-us/dotnet/api/system.io.filesystemaclextensions.create?view=net-10.0)
