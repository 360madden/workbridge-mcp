# Independent gate: orphan DesktopProbe watchdog lock-pair inspector

**Date:** 2026-11-06 (UTC)  
**Scope:** Source audit + independent inspection of previously saved **synthetic-only** Workbridge jobs. This reviewer launched no PowerShell process, GUI, VMware session or input action.  
**Result:** 🟢 **PASS for one private synthetic 12-case contract**. 🔴 **HOLD all real orphan lock recovery, archival/release, or automatic replay**.

## Exact reviewed versions

| Component | Project-relative source | SHA-256 |
| --- | --- | --- |
| Read-only classifier | `investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/Inspect-WatchdogOrphanPair.ps1` | `2703a06c062936cba47456515af316f35c1b28c85c7cee49d1ebaca08a3cc703` |
| Discrete synthetic matrix | `investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/Inspect-WatchdogOrphanPair-Synthetic.Tests.ps1` | `f9d18f3149b619a142e3c5d4bc973396e3abab4ae61ca5bd3e5060ab449c6d2a` |
| Native identity helper source (data extraction only) | `scripts/Archive-DesktopQuarantine.ps1` | `5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0` |

## Why source gate was temporarily RED — and what changed

1. First independently reviewed prototype had no hash pin for the inspector its harness spawned 11 times. The author added exact SHA check before any fixture creation and immediately before each child run.
2. An intermediate PID0/Idle fix accidentally produced an unterminated PowerShell regex line during guarded text replacement. This reviewer caught actual malformed lines in source; author restored valid `-notin` check, skipping only known PID 0 Idle and refusing unexpected zero/duplicate positive PIDs. A parser-only preflight was required before runtime.
3. The first private matrix (e01) **failed at I01** with `EXPECTED_NATIVE_FILE_ID_INVALID` because expected FileId format used dashed byte groups. The SHA-pinned native C# helper actually emits **16 lowercase volume hex, colon, 32 contiguous uppercase ID hex**, using `BitConverter.ToString(...).Replace("-", "")`. Author changed inspector validation to exact `^[0-9a-f]{16}:[0-9A-F]{32}\z`, fixed missing-file dummy FileId to compact bytes, updated hash pin, and added I12 rejecting the dashed form. **e01 was not automatically retried; failed fixture retained.**

## Key safety gates inspected

- **No real mutations:** Classifier `-Execute` throws `EXECUTE_DISABLED_PENDING_WB001_INDEPENDENT_REVIEW` before file access. Even a successful read-only real classification promises only `readyForManualReview:true`; it returns `releaseEligible:false`, `archiveCreated:false`, `newActionPerformed:false`, `priorActionOutcome:unknown_outcome`, and `historicalTreeSettled:unverified`. It does not rename, delete or release real locks.
- **Exact native evidence:** Non-reparse NTFS ancestors; both admission + GUI guards required; any quarantine sidecar vetoes this branch; exact source bytes SHA and native FileId pinned against explicit expected values; JSON owner PID/start ticks/session + run/lease IDs and journal SHA/stages cross-checked. The native helper’s pinned handles block conflicting rename/write and recheck native ID after census.
- **Fail-closed quiet census:** Real branch performs bounded read-only process / scheduled task enumeration, rejects live watchdog/child/descendant and active GUI producers, unknown script hosts, enabled relevant launcher, stale census. The private synthetic branch substitutes local `census.json` inside an explicit OS-temp GUID fixture, **without** invoking live WMI/Task Scheduler.
- **Test boundary:** Harness checks safe canonical NTFS OS-temp (rejects workspace/VM/RIFT/OneDrive etc), creates fresh exclusive `wb-orphan-recovery-fixture-<GUID>` roots, uses `-SyntheticFixture` for every child, 4.5s child wait/1.5s stop, 55s global guard, 90s Workbridge outer deadline. Uses only test-owned files and verifies admission+guard bytes unchanged and no `recovery-archives`. It cleans only the 12 created fixture roots after all pass. No production worktree or live evidence mutation authorized.

## Independent saved-job evidence (no rerun)

**Parser / preflight** `wd_orphan_inspector_fileid_parser_preflight_20261106_e02`: Workbridge status **passed, actual OS exit0**, untruncated stdout 270B, stderr0. Its fixed JSON reported `sourceFilesParsed:2`, `syntaxErrors:0`, `inspectorShaPinned:true`, `nativeIdentityCompactSourceProof:true`, `osTempSafe:true`, `ntfs:true`, `ordinaryParents:true`, `noFixtureCreated:true`, `noLiveDesktopAccess:true`.

**Synthetic 12-case fixture** `wd_orphan_inspector_private_matrix_20261106_e02`: Workbridge status **passed, actual OS exit0**, bounded 90s, start `2026-11-06T00:05:17.414Z`, end `00:05:26.148Z`, untruncated stdout 846B and stderr0. Fixed JSON returns `passed:12,failed:0,fixtureCount:12,cleanedFixtureCount:12,runtimeMs:7929`; all 12 unique cases:

- I01 exact pair → manual review only.
- I02 missing guard; I03 missing admission; I04 expected SHA drift.
- I05 owner present; I06 known child present; I07 quarantine sidecar.
- I08 foreign producer; I09 enabled launcher; I10 possible descendant.
- I11 `-Execute` hard refusal; I12 dashed noncanonical native FileId hard refusal.

The same fixed receipt reports `executeDisabled:true`, `liveLocksRead:false`, `liveLocksModified:false`, `guiLaunched:false`, `vmTouched:false`, `serviceTouched:false`, `priorActionOutcome:unknown_outcome`. These are **harness-reported negatives**, not an independent OS-wide process trace; source restrictions and fixed output support the narrow contract.

**Unresolved:** e01 had a refused native-identity baseline and its temp fixture was retained after failure; no cleanup action was authorized here. No real orphan lock has been archived, released or certified safe; historical GUI action outcome is still unknown. A future real read-only inspector call must have separate operator approval and must **never** be treated as a release or success certificate.
