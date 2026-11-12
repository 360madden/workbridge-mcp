# LEGION runtime repair checkpoint — 2026-11-08/09

Recorded **00:19 EST on November 9** (America/New_York), **2026-11-09T05:19:24Z**. Status: **tool environment repaired; runtime release still blocked by Windows state-file publication failures**.
This supplements `LEGION-TOOLS-SETUP-2026-11-08.md`; installed-tool evidence remains valid.

## November 9, 01:53 EST — guarded Windows journal replacement milestone

- **Committed source checkpoint:** `d5faa5aefd1eb06e37fe3213e6a9280243469a78` on LEGION `main`; this does **not** constitute a validated release or live deployment.
- The new journal-specific helper rechecks predecessor SHA-256 and file identity before replacing existing workflow/patch JSON records. On Windows only, native rename `EPERM`/`EACCES`/`EBUSY` has at most nine bounded delays and ten attempts. Changed/newer records fail closed as `JOURNAL_SAVE_CONFLICT`; generic `atomicWrite` is unchanged.
- The Windows handle-sharing test reproduced native rename-over-existing `EPERM` using a disposable PowerShell file handle with delete sharing excluded. The exact process causing earlier fixture failures remains **unknown**.
- Isolated built source: `tsc --noEmit` and Prettier passed. New regression tests **4/4 passed**. Existing `patches.test.mjs` passed **25/25** on the third full attempt after two distinct intermittent failures. Direct workflow/catalog/patch recovery suite **47/48**, with one `PATCH_BLOCKED/EPERM` failure that passed **1/1** when rerun alone. These are **not** stable full-suite proof.
- The CLI workflow/settlement isolated harness initially lacked a service sidecar; after it was supplied, the CLI cases still timed out or failed in that synthetic harness and the run was cancelled. Do not infer passing CLI integration tests.
- No live `dist/server.js` rebuild, Workbridge owner restart, RIFT action, Windows restart, or Git push. The earlier 20-minute full validation approval was consumed; a new complete release run needs separate authorization.
- Continue with targeted Windows fixture stability and complete source-built release gating. Only after an all-green new release and an all-client quiet window consider the separate WB-001 deployment.

### November 9, 03:31 EST — isolated CLI harness and native tracing

- Identity was freshly verified with `hostname.exe` on **LEGION**, exit 0; active owner remains PID **23232**, instance `dca381aa-a8f1-4eda-9777-e6d4732610f7`.
- The isolated TSC-only build omitted `dist/command-host.exe` and its `command-host-build.json` receipt, although the normal repository build includes them. Copied the verified files **only into disposable `.tools/journal-verify-20261109-01/dist`** (EXE SHA-256 `b9754c9fe95ac252b8b24bf2304c10a83a3e20b75456da73b0724a5a845b0147`).
- One corrected-harness settlement smoke case **1/1 passed**. A first untraced, serial CLI run passed **14/16** (settlement **8/8**, workflow **6/8**; two `PATCH_BLOCKED/EPERM` cases). Those two cases then passed **2/2** in isolation.
- Committed optional test-only rename tracer `4e35da8c1bce272d9dee6c720c57d4f54dc77e97`. A deliberate Windows sharing-lock test emitted the expected `EPERM/rename/record.json` trace. With tracing enabled, serial CLI tests passed **16/16** (76.745 s), and direct workflow/catalog/patch recovery tests passed **48/48** (16.724 s), both zero skips.
- **Limit:** the intermittent under-load `EPERM` was not reproduced in traced suites; the post-repair failing destination and external lock holder remain unproven. The targeted tests do **not** constitute a complete release gate. Do not broaden generic writes or silently deploy.
- Next: capture path/syscall if contention recurs, obtain a **new** bounded full-validation authorization, and only after green gates plus a quiet window consider WB-001.

## Current machine and preservation

- Verified target: **LEGION**, repository `C:\work\workbridge-mcp`. Do not substitute AMD-DESKTOP or a VMware guest.
- Active Workbridge owner remains PID **23232**, instance `dca381aa-a8f1-4eda-9777-e6d4732610f7`; RIFT remains PID **21140**, process birth `2026-11-08T10:52:35.8105227Z`.
- Active `dist/server.js` remains SHA-256 `18dc464cc84e07e21dcbe9a33c9fe1a4a3ddab2159ff2ca531e514e1dd143207`.
- **No Apply, Workbridge restart, RIFT restart, Windows restart, game input, or push occurred.** Unrelated FreeBuff changes and `LEGION-COPY-MANIFEST.json` remain untouched.
- Final bridge inventory was complete: zero running/retained jobs, 36/36 slots available. A scoped process check found no command line matching the focused diagnostic directory; this is not whole-descendant-tree proof.

## Completed source milestones

- `c7a87c1671085b3c909d2a8e72fbc65bf5d0e83a`: explicit serial-files release profile and source-isolated bounded validation runner; original gates/assertions/deadlines preserved.
- `4b200a1ee1f598267826d1025b3f881dee61d635`: native release-gate module-path isolation and exact absent-value restoration, with regression tests and update guidance.
- The real PS7 → Node → Windows PowerShell 5.1 chain inherited incompatible PS7 modules, making `Get-FileHash` unavailable and causing all eight Git-audit failures.
- With `-RefreshUserEnvironment`, each gate resolves absolute Node and official npm CLI first, removes `PSModulePath` immediately at the native launch boundary, then restores its exact original state. Default dispatch is unchanged.
- A one-time clear before prerequisite checks was rejected because real command discovery repopulated the variable. A local `$LASTEXITCODE` shadow was caught before commit; the accepted helper uses the native global exit slot.
- `DOTNET_ROOT` absence-to-empty coercion on current PS7/.NET was reproduced and fixed with `[NullString]::Value`. User/machine PATH, DOTNET_ROOT and PSModulePath hashes were unchanged.

## Verification — keep full and focused results separate

| Check | Result |
|---|---|
| One approved complete serial suite, source c7a87c1 | **1,151 tests: 1,137 passed, 11 failed, 3 existing skips**; suite 914.856 s |
| Bounded wrapper / scheduled task | Failed normally in **973.017 s**; task exit 1, within 20-minute cap |
| Final native-gate/environment/profile tests | **7/7 passed**, zero skips; Windows PowerShell 5.1 and 7 executed |
| Real seven prerequisites + exact helper + unchanged Git-audit file | **8/8 passed**, zero skips; all three process environment values restored exactly |
| Full formatting and diff checks | Passed; unrelated file hashes preserved |
| One three-file native-filesystem diagnostic | **30 tests: 27 passed, 3 failed, zero skips**; native test exit 1 after 78.086 s |
| Outer focused diagnostic helper | **Timed out at 300 s after the test phase returned**; do not describe it as a successful overall run |

The approved task `\Workbridge Validation legion-20261108-bounded01` ran once and was removed after exact binding/SID/receipt verification and confirmed wrapper/child exit. All source, logs and recovery evidence remain. The bridge's 600-second command limit was not changed. **No second long validation task is authorized.**

The full release passed install, desktop prebuild and prestage, then failed the tests gate. Later gates were not run; no `validated.json` was issued. Subsequent focused passes do not convert that failed release into a valid candidate.

## Remaining causal evidence

- Full-run residual failures were `job-capacity.test.mjs:86` (`JOB_RECORD_SAVE_FAILED`), `job-settlement-cli.test.mjs:265`, and `workflow-cli.test.mjs:404` (fixture `PATCH_BLOCKED/EPERM`). The exact original capacity error/ordinal remains unknown.
- The unchanged focused run passed capacity **14/14** and workflow CLI **8/8**, but settlement **5/8**. It reproduced **five genuine `fs.rename` errors: EPERM, errno -4048**.
- One native failure replaced fixture `State\workflows\wf.json` via `atomicWrite → Workflows.save`. Four replaced `State\patches\patch\record.json` via `atomicWrite → Patches.save → Patches.execute`, including error-journal updates.
- The temporary replacement and destination were distinct regular files. Native stacks were captured before error sanitization. The Windows lock holder or other underlying access cause is **not established**.
- Trace census: 40 files with exit summaries, 298 renames, 1,741 opens; zero recorded dropped events, log-write failures or truncation. Per-prefix call counts and complete descendant coverage were not instrumented.
- Synthetic capacity-test EIO is not one of the five native EPERM events. No assertion/deadline relaxation, blanket retry, ACL change or production filesystem fix was made.
- The prior concurrency-2 full result (**1,128 pass / 11 fail / 3 skip**) and earlier nonreproducing trace remain authoritative historical evidence; serial scheduling did not resolve the native publication issue.

## Evidence and next actions

Evidence root: `C:\work\workbridge-diagnostics\legion-validation-20261108-bounded01`.

- `bounded-validation-result.json` plus `validation\completed.json`: full failed run and verified temporary-task removal.
- `modulepath-audit-focused-02.log`: final unchanged-audit pass through the exact native helper.
- `fsdiag-three-20261109-0003\results-postmortem.json`: final corrected native-error report; SHA-256 `d73d90d9167f06a67b671c8a5176a7da4474ef7eca27e993169ca321488c2e6d`.
- Companion JSON records key hashes, job IDs, timings, provenance and preservation details. The diagnostic's ordinary `results.json` was not issued; use the explicit postmortem record.

Priorities:

1. Diagnose and fix atomic **state-record** replacement using the captured native traces; determine the Windows access/handle cause before changing retry policy. Preserve guarded writes and newer data.
2. Verify the narrow fix, then obtain authorization for a fresh complete bounded release validation from a new committed-source archive. Do not retry the consumed task or reuse the failed candidate.
3. Only after every gate passes, establish an all-client quiet window and perform the already conditionally approved Workbridge-only WB-001 update; then verify fresh LEGION identity, hosted desktop/WinApp and separate LuaPad/RIFT acceptance.

## Recovery

WB-001 runtime rollback does **not** restore launcher edits. The original launcher is retained at `launcher-before\scripts\Start-BackgroundTunnel.ps1` under the evidence root, archive hash `0f006dbe489dcdae6870b1aa8681a0015d86e8fef0b351b907a7082f2627f434` (original commit `34195f2e876663a1b3678a8008447d80fdcfc216`). Restore only with current-hash guards.
Live-owner admission-lock code is not proven: its on-disk `dist/jobs.js` timestamp postdates owner startup. Candidate tests and an idle snapshot do not replace the explicit maintenance window.
