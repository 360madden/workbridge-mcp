# Tri-state, non-launching process receipt regression

The one disposable WGC pilot generated a valid PNG with child PASS stdout,
but its temporary PowerShell Start-Process -PassThru wrapper saw a blank/null
ExitCode after WaitForExit returned True. A conditional treating that null
as "not zero" incorrectly reported wrapper failure, although the child's
actual numeric exit code was not observed.

The actual child exit code remains **unknown**. Independently verified PNG
evidence is distinct from a successfully classified process exit.

## Fix

ProcessReceipt.psm1 provides two exported functions:

- Resolve-PilotExitReceipt: pure classification from observations.
- Get-PilotProcessExitReceipt: adapts an *already-owned* process object.
  It calls Refresh(), then checks HasExited and reads ExitCode only after
  the bounded wait finished and process exit was observed.

It neither launches nor terminates any process, invokes GUI APIs, operates
WinApp or RIFT, nor performs capture/input/focus operations.

| Classification | Observations required | Wrapper exit code |
| --- | --- | --- |
| success | Wait finished, HasExited=true, integer ExitCode=0 | 0 |
| failure | Wait finished, HasExited=true, integer nonzero ExitCode | 1 |
| unknown | Timeout, missing/stale process, refresh/read errors, null or invalid ExitCode | 3 |

Unknown is **not** treated as child failure or success. Child stdout/PNG
integrity is reported independently.

## Offline regression

From Windows PowerShell in this prototype directory:

~~~powershell
powershell.exe -NoProfile -NonInteractive -File .\ProcessReceipt.test.ps1
~~~

The test creates only in-memory fake objects supplying Refresh, HasExited,
and ExitCode. It launches no child process, GUI, WinApp or screenshot capture.
24 assertions cover observed exit0, nonzero37, null, timeout, contradictory
finished/running, refresh error, missing process, noninteger code, unknown
HasExited, and the dedicated wrapper exit-code categories.

Verified Workbridge job: wgc_receipt_offline_ps_test_20261105_01,
exit0: "PASS ProcessReceipt synthetic tri-state checks 24".

Future callers must handle process creation/watchdogs in their separately
approved workflow and pass the exact child Process object to this
read-only classifier. Do not replay the disposable capture as part of receipt
testing. The existing 4255-byte PNG and its SHA are preserved.
