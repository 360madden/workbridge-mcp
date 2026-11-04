# Sbroenne native Job membership and exit semantics — independent design review

Date: 2026-11-04. Scope: source-only investigation; **NO GUI/UIA/VM/RIFT/desktop input**, no daemon, no service, no shared GUI-turn lock mutation, no Windows helper execution in this review. This proposal is not runtime validation. Current provider pilot stays **RED/HOLD**.

## Bottom line

The reproduced five-member private Job is **not an escape proof**. The exact PID-list evidence identifies the intended native host, Node sampler, Node synthetic child **plus two `conhost.exe` members inside the same private Job**. Windows Console Host is a system console API service process; its appearance is plausible with two Node console-subsystem processes, but the observed names alone do not prove causal parentage or signed executable path. Changing host to `/target:winexe` still yielded five members; merely hiding the host console does not resolve it.

The stronger issue is separate: the native supervisor **assigns itself** to a private `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job. When its final handle closes during shutdown, the OS may terminate the supervisor itself before the intended `Main()` exit status becomes observable. This is a **plausible explanation**, not a proven root cause, for `HOST:UNKNOWN:JOB_CHILD_COUNT_NOT_THREE:ATTACHED:1` followed by Workbridge's generic `passed/exitCode=0`. The historical binary provenance and exact exit transition are not established, so do not claim causality. Either way, `passed/0` is only an OS-level wrapper result and **cannot override the explicit unknown semantic receipt**.

## Source and evidence

- `prototypes/Sbroenne-Provider-Host.cs:126–138`: `SbroenneJobLifetime.Attach()` assigns self to private Job before direct Node `Process.Start()` with `UseShellExecute=false`, redirected stdio and `CreateNoWindow=true`.
- `prototypes/Sbroenne-Provider-Host.cs:154–191`: after `READY:<serverPid>`, it enumerates private Job IDs, requires exact host+Node+server trio, rejects any extra members with `JOB_CHILD_COUNT_NOT_THREE` before sending `GO`. `HOST:SETTLED` is printed only after Node exits and Job accounting returns to one active process. Catch outputs `HOST:UNKNOWN` and attempts return3.
- `prototypes/Sbroenne-JobLifetime.cs:69–98`: creates an unnamed non-inheritable private Job, sets only KILL_ON_JOB_CLOSE, assigns the native host, verifies self membership and active count1. No breakaway option is set.
- `prototypes/Sbroenne-JobLifetime.cs:118–149`: queries `JobObjectBasicProcessIdList` into fixed4096-byte buffer and returns sorted IDs. **Future proof must require `NumberOfProcessIdsInList == NumberOfAssignedProcesses`**, not merely `count <= assigned` as current source, and handle buffer insufficiency with bounded retry. Current exact-three gate is too rigid for observed Windows console auxiliaries.
- `benchmarks/sbroenne-stdio-sampler-offline-2026-11-04.md:24–42`: final synthetic report `HOST:READY_ACTIVE:5`; PIDs host28380, Node63684, Node child71868, `conhost`31568 and71776. Windows-subsystem retest again had five IDs (34896,49164,51724,8532,20588), while one accounting sample was4. Both failed closed. No `HOST:SETTLED`; Workbridge returned `passed/0` despite semantic unknown.
- `reports/sbroenne-host-exit-classification-2026-11-04.md`: separate forensic review of earlier runs; current binaries not proof of old exact compiled revision.

Microsoft primary documentation:
1. [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects): child CreateProcess descendants inherit the job by default unless explicit breakaway policy; KILL_ON_JOB_CLOSE terminates *all associated processes* on final handle close; WMI `Win32_Process.Create` is a documented exception.
2. [Nested Jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs): nested jobs available Windows8+; a job hierarchy can contain only a subset of the parent Job, and normal children inherit their parent's job chain.
3. [JOBOBJECT_BASIC_PROCESS_ID_LIST](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list): variable PID list, including child jobs; if the returned list count is less than assigned count, **increase buffer**.
4. [Windows Console ecosystem](https://learn.microsoft.com/en-us/windows/console/ecosystem-roadmap): `conhost.exe` services console APIs. This supports plausibility, not process-specific attribution.

## Current design: fail-closed dynamic membership, not count == 3

A limited synthetic improvement could preserve self-attached private Job and change only admission/accounting:

1. Before `GO`, read both `JobObjectBasicAccountingInformation` and a **complete, nontruncated** `JobObjectBasicProcessIdList`. Resize buffer with strict limit (e.g. max64 IDs, <=8192 bytes) until `returnedCount == assignedCount == accounting.ActiveProcesses`, otherwise retry a bounded snapshot window (e.g. 500ms). Equality must hold for one coherent snapshot; fast exits can cause transients. Do not silently accept partial lists or assign extra members to arbitrary known roles.
2. Require mandatory exact PIDs **host + Node sampler + Node server**, each still alive, exact start-time/session identity, `IsProcessInJob(privateJob)==true`, and pins for executable/script/server as appropriate. Obtain process handle plus creation time to resist PID reuse. Verify Node/server are descendants through intended direct CreateProcess path; do not infer ownership solely from display name/title.
3. Account for **every additional** private-Job PID in a structured member list, including creation time, session, OS path/signature and role. For current synthetic, allow `conhost.exe` only after independently confirming exact Windows system image and same test session/start window, and no unrelated executable. Since conhost may be parented through Windows console infrastructure, parent PID alone is not a reliable proof. Any unexpected image/identity or unreadable member => `unknown_outcome`, no `GO`.
4. Treat additional contained Job members as part of the teardown obligation. After bounded `RESULT`, Node exit and server exit, **both** `ActiveProcesses()==1` and complete exact PID list `[hostPid]` must hold before `HOST:SETTLED`; otherwise report unknown and rely on kill-on-close, without claiming verified descendant settlement. Capture all member IDs/start timestamps in a private journal, not user-facing raw content.
5. An independent provider-aware normalizer must parse exact request/build identity, complete bounded stdout, terminal `RESULT`, terminal `HOST:SETTLED`, tree evidence and Workbridge OS exit. `HOST:UNKNOWN`, missing `HOST:SETTLED`, truncated output, wrong exact PIDs, or contradictory statuses => **unknown** regardless Workbridge `passed/0`. Both recorded five-member trials remain RED.

This is a valid **research-level containment refinement**, but it **does not fix self-kill exit reporting** and is not enough for GUI admission.

## Preferred design: host OUTSIDE its own private child Job

For a robust native supervisor, move the private Job ownership to a native host process which **does not itself join the private Job**:

```text
Workbridge outer Job
  └─ Native supervisor (not in its private Job)
       └─ private KILL_ON_JOB_CLOSE Job (held by supervisor)
            └─ Node sampler (created suspended, then assigned/resumed)
                 ├─ direct Sbroenne stdio server
                 └─ any observed console/runtime helpers
```

1. Host starts with `CreateJobObject` unnamed and non-inheritable; configures KILL_ON_JOB_CLOSE, no breakaway. Verify private Job is initially empty; host should **not** be a member.
2. Use `CreateProcessW` with `CREATE_SUSPENDED`, redirected anonymous stdin/stdout/stderr handles, no shell, explicit exact Node path/hash, and a bounded inherited-handle list. If practical request `CREATE_NO_WINDOW`/no-console startup; **do not assume** this eliminates `conhost` or other auxiliaries.
3. **Before `ResumeThread`**, call `AssignProcessToJobObject(privateJob, suspendedNodeHandle)`, verify membership and that the child has not executed, then resume. If assignment fails under Workbridge's outer Job/nesting restrictions, terminate the still-suspended exact handle, close private Job, label `blocked`; never proceed unsupervised.
4. Node's direct children inherit its private job under default CreateProcess semantics. Probe every runtime helper; any new process outside the private Job (e.g. console process created before assignment, WMI-spawned outside, or breakaway) is an unresolved escape and **HOLD**, even if an outer Workbridge Job happened to contain it. No generic daemon/auto-start/ShellExecute.
5. At readiness, enumerate the **entire** dynamic member list. Bind required PIDs and creation times; account for extra `conhost` members as above. Verify target GUI identity separately; this design is only containment.
6. On completion, keep host alive while waiting for private Job `ActiveProcesses()==0` **and** full PID list empty. Only then close private Job handle and write an owned, durable `SETTLED:0` receipt. The host remains alive **outside** private Job and can return an honest OS exit status.
7. On deadline or protocol uncertainty, host calls `TerminateJobObject` (or closes its last private Job handle) **while still alive**, then independently waits for zero membership and confirmed process handles signaled with matching birth identities. If confirmation fails, classify unknown and quarantine; never convert a forced stop to semantic success. A native host crash still closes its last private Job handle and kills descendants, with outer Workbridge Job as independent backstop.
8. External Workbridge/provider normalizer still validates `RESULT`, host settlement receipt and OS status; no `passed/0` alone. This also allows deliberate nonzero blocked/error synthetic tests to prove exit-code propagation without self-termination.

**Implementation feasibility:** Moderate investigation prototype; Windows suspended process and private redirected-pipe setup are lower-level Win32 than `ProcessStartInfo`. Reuse existing Job Object P/Invokes, identity oracle and result contract. Do not alter production Workbridge. A short, reviewed `CreateProcessW/STARTUPINFOEX` helper may be appropriate, but ensure child stdio works without wide handle inheritance. Build and test offline synthetic first. Windows console bootstrap may spawn a helper *before* Node thread resumes; verify that empirically, or use a small Windows-subsystem suspended bootstrap executable inside Job that spawns Node only after membership if necessary.

## Next minimally meaningful synthetic gates (new approval required)

| Gate | Proof required | If fails |
|---|---|---|
| A. Complete member listing | Stable list/count agreement and exact host/Node/server identities plus attributable conhosts | RED; no `GO` |
| B. Suspended child admission | Private Job initially 0, Node suspended, assigned, resumes, all descendants including console helpers accounted | RED; no `GO` |
| C. Clean exit | Terminal `RESULT:success`, private Job0, host exits0, independent normalizer pass | RED |
| D. Controlled negative | Deliberate protocol error, private Job0, host exits nonzero, normalizer blocked/unknown as appropriate | RED |
| E. Forced timeout/crash | Kill-on-close / TerminateJobObject actually tears down all exact members; independent handles and accounting confirm, no retries | RED |
| F. Real GUI pilot | **Only after A–E** plus shared RIFT-turn quarantine recovery, new approved disposable fixture, exact HWND/manifest, no focus/input | HOLD |

The least risky immediate action is to retain **RED/HOLD** for Sbroenne, keep Workbridge's existing operational desktop path unchanged, and prototype the **outside-owner suspended-child** supervisor in this investigation folder only. Do not reinterpret the historical five-member or exit0 logs as success.
