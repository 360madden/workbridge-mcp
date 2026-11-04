# Sbroenne native host: semantic UNKNOWN despite Workbridge exit 0 (2026-11-04)

**Status:** Read-only forensic classification; **confirmed mismatch**, **cause inferred, not proven**. No rerun, GUI, desktop input, VM, lock, process termination, or production source edit was performed.

## Preserved observations

The following exact job IDs were queried through Workbridge `command_status` and `command_output(stream=combined)` on 2026-11-04. Both are `mode=terminal`, `project=workbridge-mcp`, `timeoutSeconds=55`, with no output truncation or recorded stderr. The command displayed by both receipts is the **native executable**, not `cmd.exe`, a PowerShell wrapper, or a shell launcher:

`C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\Sbroenne-Provider-Host.exe`

| Existing job ID | UTC start–end | Workbridge status | Complete stdout |
|---|---|---|---|
| `wda_sbroenne_native_job_synthetic_tree_20261104_m3p1` | 22:41:14.482–22:41:14.819 | **passed; exitCode=0** | `HOST:UNKNOWN:JOB_CHILD_COUNT_NOT_THREE:ATTACHED:1\r\n` |
| `wda_sbroenne_native_job_synthetic_count_v2_20261104_m3p1` | 22:44:07.736–22:44:08.111 | **passed; exitCode=0** | `HOST:READY_ACTIVE:5:NODE_PID:37868:CHILD_PID:11808\r\nHOST:UNKNOWN:JOB_CHILD_COUNT_NOT_THREE:ATTACHED:1\r\n` |

**What the evidence proves:** The private host reported a supervision failure, never emitted `HOST:SETTLED`, and the public Workbridge job record nevertheless reports successful OS exit 0. The second run observed **five** active members in its private Windows Job Object, where current source expects exactly three; the count discrepancy by itself does **not** establish escaped or orphaned processes, merely that the asserted topology did not hold at that checkpoint. No UIA correctness or descendant cleanup is demonstrated by these receipts.

## Static control flow and independent classification

- `investigations/windows-desktop-automation/prototypes/Sbroenne-Provider-Host.cs:129–132` records `HOST:READY_ACTIVE:<count>` then throws `JOB_CHILD_COUNT_NOT_THREE` unless count is exactly 3.
- Same file lines 147–155 writes `HOST:SETTLED` only after worker exit and verified `DesktopJobLifetime.ActiveProcesses()==1`; lines 157–165 print `HOST:UNKNOWN:<reason>:ATTACHED:1` and **return 3** on caught exceptions.
- `src/command-worker.ts:48–54` spawns the exact requested native executable with **`shell:false`**, inherits output, and sends the OS child `exit` event code to `serializeCommandResult`. Lines 21–32 durably write that code and exit with it.
- `src/jobs.ts:438–470` starts `command-host.exe`, then `command-worker.js`; lines 510–530 mark `passed` precisely when the persisted child `exitCode===0` and the command host completed without error. The command wrapper validates this evidence but **does not parse arbitrary child stdout for `HOST:UNKNOWN`**. Workbridge appears to have faithfully reported the observed OS exit status rather than applying semantic Sbroenne-protocol classification.
- `scripts/Command-Host.cs:18,41–48` attaches the outer Windows Job Object, waits on the worker, and propagates its `ExitCode`.
- `scripts/Desktop-JobLifetime.cs:65–98` attaches the **inner/private Job Object to its own supervisor process** and sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; closing the final job handle terminates all associated processes. If that includes a still-live supervisor during CLR shutdown, it could terminate before the `Main` return status is reliably observed. **This is a plausible mechanism for `HOST:UNKNOWN` plus Windows exit 0, not a proven mechanism in either recorded run.** A native launcher or a different compiled helper revision is another possibility.

Microsoft primary documentation: [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) confirms kill-on-close destroys all associated processes and nested children; [Process.ExitCode](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.exitcode) explains that the observed exit status is application/termination-convention dependent, not evidence that the application-level protocol succeeded.

**Historical-build limitation:** Current `Sbroenne-Provider-Host.cs` modified **22:47:06Z**, current `Sbroenne-JobLifetime.cs` **22:46:19Z**, and current `temp/Sbroenne-Provider-Host.exe` **22:47:20Z**—all after both suspect jobs. Their present contents/hashes do **not** prove the exact source/binary the earlier jobs executed. Current EXE SHA256 `15bebfcefb76a709841dbd996c3c0b0b9dba94225b22592983a115835af008d8`. Historical process output plus Workbridge job metadata are the direct run evidence.

## Recommended receipt contract (design only; no change)

1. Keep Workbridge's generic `passed/exitCode=0` **only as an OS-level job result**, not a provider success determination. For this Sbroenne harness classify both stored runs `provider_unknown`, and **block any retry or GUI pilot** pending separate process-settlement approval.
2. A provider-aware caller accepts success only if all are present and agree: exact request ID; expected pinned executable and source/build hash; a **terminal** well-formed `RESULT:{...}`; `HOST:SETTLED:1`; known child identity/session; job count/topology settled; Workbridge `passed/0`; and bounded no-truncation output. Missing/conflicting fields => `unknown_outcome`, never success.
3. Do not hard-code `ActiveProcesses==3` for every Windows session without controlled evidence: background `conhost.exe` or other inherited descendants may legitimately expand a Job. Instead bind exact PIDs/creation-time/session to the **private Job membership list**, include incidental processes in accounting, and prove termination/settlement before declaring success.
4. For a future separately approved synthetic run, pin executable hash **before and after** launch; capture command-result exit/status, stdout, child PID/creation times, Job membership snapshots, and a durable post-child final receipt. For reliable error propagation prefer a stable external supervisor outside the private kill-on-close Job—or a carefully designed owner handle lifetime—so the process reporting the exit code is not itself destroyed during cleanup. Demonstrate nonzero propagation and cleanup in a synthetic-only test **before** UIA use.
5. Preserve existing evidence and developer dirty changes. Never auto-rerun the UNKNOWN command or remove a Job/desktop quarantine lock from these observations.

## Verification boundary

No `.local` private result record was directly read; Workbridge `command_status`/`command_output` are the preserved public job receipts. Exact historical CLI arguments are not exposed in those two summaries, although source validates five native args and output matches the synthetic mode. This report makes no claim that a GUI window, VMware guest, OneDrive, or physical RIFT was touched.
