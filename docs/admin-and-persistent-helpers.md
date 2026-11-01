# Administrator/UAC and persistent helpers

Phase started October 18, 2026. This extends the verified local-PC workflow
using existing Workbridge terminal jobs and Windows Task Scheduler. No MCP
catalog change, tunnel restart, service-account change, or new listener is needed.

## Roadmap

| Milestone                           | Implementation and acceptance                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect the Windows context         | Existing bridge/update tasks are Limited/Interactive; current token is not elevated                                                       |
| Manage persistent user helpers      | `Manage-HelperTask.ps1`: Register, Start, Status, Stop, Remove; optional AtLogon                                                          |
| Prove the lifetime boundary         | A .NET heartbeat continues after its original Workbridge command times out; inspect from another job/chat and clean up                    |
| Prepare a UAC diagnostic            | Single-file .NET 10 executable, requireAdministrator manifest, fixed token check with no command/path input or system writes              |
| Request and record UAC              | Normal-token on-demand task invokes ShellExecute RunAs; a person approves/cancels in Windows; unprivileged launcher records the exit code |
| Extend to a real elevated operation | Specify the exact operation, required rights, system changes, recovery and verification before adding a new reviewed action               |

## Persistent user helpers

`scripts/Manage-HelperTask.ps1` registers an explicitly selected native executable
and literal argument array. It uses the current user's **Limited / Interactive**
principal, no password, unlimited task execution time, and IgnoreNew instance
policy. By default there is no trigger: the task starts only on request.
`-AtLogon` explicitly opts into sign-in startup. It does not provide execution
before sign-in or after sign-out, or prove reboot recovery.

Registration receipts live in `.local/helpers/<id>/registration.json`. The
manager checks the task name/path, action, working directory, registration
description and normalized principal SID/run level/logon type before control.
It refuses foreign same-name tasks and conflicting re-registration. Removing
an owned task stops it first, unregisters it, and retains source, outputs and
registration receipts. It does not recursively delete helper directories.

Task state and `LastTaskResult` are scheduler signals, not application health.
For example, 267009 (0x41301) means the task is running, not an application exit
code. The demo's atomically updated heartbeat has an instance ID, PID, sequence,
timestamp, session and elevation flag. A stale heartbeat is not a live helper.
Helper crashes and retries require the application's intended recovery policy;
the generic manager does not automatically replay arbitrary work after failure.

Example from PowerShell (an explicit interpreter supports .ps1 helpers too):

```powershell
.\scripts\Manage-HelperTask.ps1 -Action Register -HelperId my-helper `
  -Executable 'C:\absolute\helper.exe' -Argument @('argument with spaces') `
  -WorkingDirectory 'C:\work\my-helper'
.\scripts\Manage-HelperTask.ps1 -Action Start -HelperId my-helper
.\scripts\Manage-HelperTask.ps1 -Action Status -HelperId my-helper
.\scripts\Manage-HelperTask.ps1 -Action Stop -HelperId my-helper
.\scripts\Manage-HelperTask.ps1 -Action Remove -HelperId my-helper
```

Use `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy
RemoteSigned -File ...` through `terminal_run` for these local scripts, consistent
with existing Workbridge scheduled launchers. This sets the execution policy
only for that process. No machine/user policy setting is changed. Registering
array arguments is easiest from a saved PowerShell script, rather than trying
to pass a PowerShell array through native `-File` argument parsing.

## Administrator/UAC diagnostic

The source is `scripts/helpers/AdminProbe/Program.cs`. It accepts **no arguments**
and only queries the current Windows token. Exit 0 means elevated administrator,
5 means a normal token, and 2 means unexpected arguments. It has no shell,
request-file parser, network listener, plugin loader, or system-changing action.
Its requireAdministrator manifest causes Windows to request consent/credentials.

`Prepare-HelperPrototypes.ps1 -OutputDirectory <new-absolute-directory>` publishes
the heartbeat and a framework-dependent **single-file** AdminProbe for Windows
x64 with the machine-installed .NET 10 runtime. Application DLLs and runtime
configuration are bundled. It retains sources/build artifacts and hashes. The
unsigned development executable may appear as an unknown publisher in UAC.

`Request-AdminProbe.ps1 -Action Prepare` registers a **Limited**, on-demand task
for the local launcher. Preparing does not request UAC. Start dispatches it
independently of the Workbridge command process. The launcher:

1. Requires a normal token and reserves a unique operation ID; repeats cannot
   silently request another UAC prompt.
2. Opens the fixed executable without write/delete sharing, verifies its reviewed
   SHA256, and holds that handle through UAC and execution. Payload drift fails
   before requesting elevation.
3. Removes inherited CLR startup/profiler overrides in its own process and selects
   the machine-installed runtime. It does not change persistent environment settings.
4. Uses `.NET Process.Start` with `UseShellExecute=true`, the `runas` verb,
   hidden window style and **no arguments**. It waits for the fixed executable.
   Windows displays the UAC prompt. The direct API preserves native cancellation
   code 1223, which Windows PowerShell's Start-Process cmdlet obscured in testing.
5. Records `elevated_probe_passed`, `uac_cancelled`, `probe_failed`, or `failed`
   in a receipt. While waiting it records `awaiting_windows_uac`.

The receipt is written by the normal-token launcher. It is user-owned diagnostic
evidence, not a security attestation or authorization for future elevated work.
Task Status and the receipt must be considered together if the launcher is
interrupted. Never replay an uncertain operation. Removal refuses an active
launcher; respond to Windows and inspect the terminal receipt first.

Actual prepared operation:

```powershell
$prototype = 'C:\work\workbridge-helper-lifecycle-20261018-01'
.\scripts\Request-AdminProbe.ps1 -Action Status `
  -PrototypeDirectory $prototype -OperationId diagnostic-20261018-01
```

Starting that operation requires the person's readiness for a Windows prompt:

```powershell
.\scripts\Request-AdminProbe.ps1 -Action Start `
  -PrototypeDirectory $prototype -OperationId diagnostic-20261018-01
```

The original bridge remains normal privilege. There is no elevated shell task,
stored administrator credential, disabled UAC setting, or always-on elevated
command endpoint. Secure-desktop consent/credentials are handled locally by
the person at the PC, not entered into chat or automated by browser controls.

## Trust boundary and next engineering gate

These helpers run in the already trusted local Windows account. Registration
receipts, scripts and prototype outputs remain writable by that account; this
is not a sandbox against hostile same-user software. Hash checks catch artifact
drift but do not authenticate a maliciously replaced preparation receipt or
launcher. The fixed read-only probe is not certification for a general privileged
agent. The security review traced the task and launcher inputs; there is no
parameter-controlled command in the elevated payload.

A machine-changing action needs its own narrow specification, reviewed payload,
local approval, verification and recovery. A persistent elevated service would
add protected installation/ACLs, authenticated and authorized IPC, and lifecycle
work; it is a separate decision for a demonstrated requirement. Use the existing
user task for normal background work. Interactive GUIs, sign-out/reboot tests,
and pre-login Windows services remain separate acceptance gates.

## Evidence

- Prototype: `C:\work\workbridge-helper-lifecycle-20261018-01`
- `preparation.json`: build metadata, source hashes, reviewed executable SHA256.
- `lifecycle-tests.json`: real Task Scheduler integration checks; test registrations removed.
- `persistence.json`: heartbeat advancement and later task cleanup.
- `AdminProbe/operations/<id>/receipt.json`: actual UAC result, when requested.
- [Normal ChatGPT verification chat](https://chatgpt.com/c/6ad5270d-cb88-83ea-94db-30cd76f51453).

The lifecycle suite passed registration replay, normal-token heartbeat, native
space/Unicode arguments, duplicate Start, changed-task rejection, Stop/restart,
foreign-name collision preservation, explicit sign-in trigger registration/removal,
the normal-token admin exit and unexpected-argument rejection, and payload-drift
rejection before UAC. Actual sign-out/reboot is not certified. Human-operated
UAC approval/cancellation was tested separately, as recorded below.

The original hosted command `helper-persistence-timeout-20261018-01` ended
`timed_out` at 20:26:19 UTC on October 18. Its independent heartbeat continued
with the same instance ID afterward. In ordinary ChatGPT Chat mode,
`browser-persistence-observe-20261018-01` verified the same instance
`792cbbb5a5ec4215963a15c0f5eb5540`, PID 18968, advancing from sequence 189 to 191
at normal privilege. `browser-persistence-cleanup-20261018-01` then removed its
task and verified that the heartbeat stopped. `persistence.json` retains both
the observation and cleanup result.

After explicit human readiness, `diagnostic-20261018-01` requested UAC and
recorded `elevated_probe_passed`, child exit 0. The executable's requireAdministrator
and uiAccess=false manifest entries were also checked in the published binary.
SHA256: `F88FB44FBFF09DFAFE1E0B60CBB4B4835C15B395A390EFDBD35D411830DC4F2A`.

The first cancellation was safely rejected by Windows but classified as a
generic failure by the original Start-Process wrapper. The retained original
receipt is `diagnostic-cancel-20261018-01`. The launcher was corrected to retain
the native .NET Win32Exception. A separately authorized cancellation retest,
`diagnostic-cancel-20261018-02`, recorded `uac_cancelled` with no child exit code.
Repeating Start for that operation was rejected before dispatch and left the
terminal receipt unchanged. `uac-acceptance.json` records these final checks.
All prototype task registrations were removed afterward. No sign-in startup
was left enabled. Source, binaries, heartbeat files and receipts remain.

## Microsoft references

The next implementation is documented in
[PC health recorder and Windows image diagnostic](pc-health-and-windows-scan.md).
That useful recorder intentionally retains its Limited sign-in task; the prototype
cleanup result above applies only to the earlier heartbeat and token probes.

- [Task Scheduler principals](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal)
- [Task security](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-security-hardening)
- [Task Scheduler result constants](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-error-and-success-constants)
- [Start-Process and RunAs](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process)
- [.NET ProcessStartInfo verbs](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.verb)
- [Native Win32 error codes](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.win32exception.nativeerrorcode)
- [How UAC works](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works)
- [.NET single-file deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview)
