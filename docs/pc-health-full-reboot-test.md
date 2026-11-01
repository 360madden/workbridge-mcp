# Full reboot recovery test

## Plan and scope

1. Keep the successful sign-in test unchanged. Check the currently installed
   recorder binary against its preparation hash and validate its Limited,
   Interactive, current-user sign-in task through the helper manager.
2. Save a separate immutable `reboot-20261018-01` checkpoint with
   `expectedTransition: Reboot`, boot time, logon identity, recorder instance,
   sequence, and timestamp. Save current task definitions and readiness evidence.
3. Verify before reboot. The expected result is `awaiting_full_reboot`; neither
   a new login alone nor manually restarting the helper can satisfy this test.
4. Ask the user to save work and approve a restart. No restart is scheduled or
   performed as part of preparation. Do not force-close applications or install
   updates as a separate action. Windows may apply already pending updates during
   a normal restart; this test does not change Windows Update settings.
5. After the PC restarts, the user signs in normally and opens this chat. Do not
   manually start the health recorder or Workbridge. These are user-session tasks:
   recovery is expected after sign-in, not before Windows sign-in.
6. Run read-only Verify. Require a boot time later than the checkpoint, the same
   user, a new normal-user recorder instance started after both checkpoint and
   current boot, its validated sign-in task, fresh reports, and advancing samples.
   Check Workbridge readiness separately, then make a live connected file read.
7. Preserve pass/fail evidence. If recovery fails, inspect status and logs before
   attempting a manual Start, so the original recovery evidence is retained.

This test covers an orderly Windows restart followed by sign-in. It does not
certify power-loss recovery, startup without sign-in, or automatic chat resumption.
No additional startup tasks, elevated services, unattended approvals, or recurring
automation are added. Existing sign-in and scan/cleanup evidence remains intact.

If explicitly approved, request a normal restart with `shutdown.exe /r /t 0`,
without `/f` or automatic application relaunch options. A positive timeout implies
forced application closure, so it is deliberately not used. If Windows blocks the
request, report that outcome rather than escalating or forcing the restart.
[Microsoft shutdown command](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/shutdown)

## Continuation after restart

Tell this chat: **I'm back after the reboot. I have not manually started the health
recorder or Workbridge. Verify reboot-20261018-01.**

The verification command, which never starts the helper:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File C:\work\workbridge-mcp\scripts\Test-PcHealthRecovery.ps1 -Action Verify -InstallDirectory 'C:\work\Workbridge Health' -TestId reboot-20261018-01
```

The expected transition is taken from the saved checkpoint; it cannot be
downgraded by supplying a different transition to Verify. The accepted policy
candidate must still pass a live advancement check before a result says `passed`.

## Evidence

Files live in `C:\work\Workbridge Health\recovery\reboot-20261018-01`:

- `checkpoint.json`: immutable pre-reboot baseline.
- `result.json`: current verification outcome; successful results are retained.
- `preflight.json` and task XML: preparation checks and task definitions.
- `policy-tests-ps5.json` and `policy-tests-ps7.json`: acceptance gate tests using
  synthetic cases; these do not certify an actual reboot.

Preparation passed October 18, 2026, at 7:45 p.m. EDT:

- The checkpoint is armed with `expectedTransition: Reboot`.
- Both PowerShell 5.1 and 7 correctly report `awaiting_full_reboot` before restart.
- Sixteen acceptance policy tests passed in each shell, including rejection of
  changed login without a new boot, stale reports, elevated helpers, missing
  reports/triggers, the previous instance, the wrong user, and invalid timestamps.
- Checkpoint overwrite and transition downgrade attempts were blocked. The prior
  successful sign-in result was retained unchanged.
- The installed recorder binary hash matches preparation. Recorder and Workbridge
  tasks are running as Limited/Interactive with enabled sign-in triggers. The
  recorder is fresh and Workbridge reports ready. Neither task was restarted.
- A live connected Workbridge file read retrieved the saved preflight receipt.
- No restart was requested during preparation. The user subsequently approved the
  normal restart, which was requested at 7:47 p.m. EDT without forced closure.

## Actual reboot result

**Passed October 18, 2026, at 7:50 p.m. EDT.** The user confirmed returning after
reboot without manually starting either the recorder or Workbridge.

- Windows boot time changed to 7:47:56 p.m. EDT, later than the saved checkpoint;
  the same Windows user had a new logon session.
- A new recorder instance, `08628790714847608fc5811192760280`, started at
  7:48:16 p.m. EDT after boot and checkpoint. Read-only Verify observed fresh
  samples advancing from 4 to 5 with normal-user privileges.
- Both recorder and Workbridge tasks were running as Limited/Interactive, with
  their most recent starts after the new boot. Workbridge reported ready, version
  0.6.1, with zero consecutive polling failures. A live connected Workbridge file
  read independently retrieved the current health report.
- The checkpoint and recorder payload hashes still matched preparation. Neither
  app was manually started or restarted during verification.
- `result.json` records `status: passed`, `expectedTransition: Reboot`,
  `newBoot: true`, and `newLogon: true`. `phase-acceptance.json` records the combined
  outcome; post-reboot task XML files are retained beside the preflight exports.

This certifies the tested orderly reboot followed by sign-in. Recovery without
signing in and unexpected-power-loss recovery remain untested.
