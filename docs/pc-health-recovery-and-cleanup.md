# Sign-in recovery and administrator report cleanup

## Plan

1. Archive the completed ScanHealth report with hashes, then prepare the existing
   fixed `cleanup` administrator action for that exact scan ID.
2. Request a separate Windows UAC approval. Verify the selected report directory
   and its latest pointer disappear, unrelated storage remains, audit copies match
   their original hashes, the recorder continues, and a replay cannot prompt again.
3. Rehearse a normal-user Stop/Start. Verify writes stop, a new instance starts,
   and its samples advance. This rehearsal does not certify sign-in recovery.
4. Save an immutable checkpoint containing user SID, Windows token authentication
   session ID, boot time, helper instance, and timestamps. Run Verify before any
   sign-out to confirm it reports `awaiting_real_signin`.
5. Only after explicit user approval, perform a real sign-out/sign-in. Prefer this
   over restarting the whole PC for the first test. Save other work first; never
   force-close applications. The user can instead choose a later natural sign-in.
6. After signing in, open this chat and run read-only Verify before manually
   starting any helper. Require a new logon session or boot, a new helper instance
   started after the checkpoint, a validated Limited sign-in task, fresh advancing
   samples, and the same user. Check Workbridge readiness separately.

No sign-out, reboot, UAC approval, or administrator action is automatic. No new
elevated service, sign-in verifier task, or recurring automation is installed.
Chat execution may disconnect during sign-out; saved files are the continuation
point. This workflow does not promise the current chat resumes by itself.

## Commands

Run with a normal user token. The rehearsal restarts **only the recorder**.

```powershell
$test = 'C:\work\workbridge-mcp\scripts\Test-PcHealthRecovery.ps1'
$parameters = @{InstallDirectory='C:\work\Workbridge Health';
    TestId='signin-20261018-01'}
& $test -Action Rehearse @parameters
& $test -Action Arm @parameters
& $test -Action Verify @parameters
& $test -Action Status @parameters
```

Use `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File` with the full
script path to invoke it as a child process. Arm never overwrites a checkpoint.
Rehearse refuses an armed test ID; a successful Verify result is retained.

Evidence lives under `C:\work\Workbridge Health\recovery\signin-20261018-01`.
The verifier never starts the helper. A successful result assumes the operator did
not manually start the recorder after signing in. It is operational recovery
evidence, not tamper-proof proof of which Windows event started the process.

## Cleanup scope

Target scan: `50e9b605c0864ad6a8b1b916996435e0`.
Operation: `cleanup-20261018-01`.
Audit archive: `C:\work\Workbridge Health\cleanup-evidence-20261018-01`.

Cleanup removes the scan's three known report files, its empty directory, and
`latest.json` only if it references that scan. It retains `owner.txt`, `scan.lock`,
and the protected root. Windows DISM logs and the normal-user audit archive remain.
The historical phase acceptance record describes the earlier scan and is retained.

After cleanup the recorder's `latestScan` becomes null on its next sample; this
means the current protected scan report was removed, not that the prior diagnostic
failed. No new diagnostic is run to repopulate it.

## Results

- October 18, 2026: administrator cleanup completed with child exit 0. Selected
  reports and latest pointer were removed; other root entries and marker hash were
  preserved. Audit hashes matched, retained storage remained protected, and a
  normal-user write attempt was denied. Replay was blocked without another UAC
  prompt, and the cleanup launcher was removed.
- Manual recovery rehearsal passed: the original recorder stopped; new instance
  `592d348c87214b4ca2855515d3aada9c` started with normal privilege and advancing
  samples. The configured sign-in trigger remains enabled.
- Checkpoint `signin-20261018-01` was armed before sign-out. Windows PowerShell 5.1
  and PowerShell 7 agreed on the original logon identity and correctly reported
  `awaiting_real_signin` before the actual transition.
  Duplicate Arm and Rehearse after Arm were rejected without changing the checkpoint.
- Cleanup evidence: `cleanup-evidence-20261018-01\acceptance.json` under the install
  folder. Recovery evidence: `rehearsal.json`, `checkpoint.json`, `result.json`, and
  `preflight-tests.json` under `recovery\signin-20261018-01`.
- **Actual sign-in recovery passed October 18, 2026, at 5:42 p.m. EDT.** The user
  confirmed signing back in without manually starting the recorder. Read-only
  Verify observed a changed Windows authentication session, the same user, an
  unchanged boot time, and a new recorder instance started at 5:06:11 p.m. EDT.
  Instance `caf305422e81428289311e3154997f96` had fresh advancing samples (sample
  74 at acceptance), normal privilege, and a validated Limited sign-in task.
  Workbridge reported ready; a connected Workbridge file read independently
  retrieved the live report. No helper Start was issued during verification.
- `result.json` retains `status: passed`, `newLogon: true`, and `newBoot: false`.
  The actual sign-in test is complete; this result certifies that transition.
- The separate [full reboot test](pc-health-full-reboot-test.md) subsequently passed
  after the approved orderly restart and sign-in. Unexpected-power-loss recovery
  remains untested.

## Reference

The verifier reads the token's AuthenticationId to identify its Windows logon
session, rather than treating a changed process ID as a new sign-in.
[Microsoft TOKEN_STATISTICS](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_statistics)
