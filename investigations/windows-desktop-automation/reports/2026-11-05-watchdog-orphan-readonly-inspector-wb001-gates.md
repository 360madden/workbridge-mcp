# Read-only watchdog orphan inspector and WB-001 gates — 2026-11-05

Status: **SYNTHETIC VERIFIED 12/12; REAL INCIDENT RECOVERY HOLD.** Existing Workbridge 0.16.4-dev and all live GUI, RIFT, VMware, services, Task Scheduler, and desktop locks remain untouched.

## Purpose and exact scope

The investigation-only PowerShell inspector at investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/Inspect-WatchdogOrphanPair.ps1 classifies a **specific** orphaned desktopprobe-watchdog incident with BOTH desktop-turn-admission.lock and desktop-input-turn.lock, no sidecar, and a matching watchdog JSONL journal.

It requires operator-pinned runId, leaseId, owner PID/start-ticks/session, original SHA256 for admission, GUI guard, and journal, NTFS FileIdInfo (volume+128-bit ID) for both locks, and unique OperationId. It validates bounded ordinary single-link non-reparse guard files with hash-pinned native read-only class extracted from the existing archive script; it never executes the archive script body. It refuses changed identities, mismatched producer/target, incomplete pair, sidecar-present path, missing/mismatched journal, and relevant live owner/child/descendant or competing producer/task evidence.

The inspector has NO recovery/move/archive/delete implementation. The -Execute flag hard-fails before touching the requested path with EXECUTE_DISABLED_PENDING_WB001_INDEPENDENT_REVIEW.

Its sole positive output is a **review invitation, not release permission**:

- readyForManualReview=true; releaseEligible=false
- executeEnabled=false; archiveCreated=false; newActionPerformed=false
- priorActionOutcome=unknown_outcome; historicalTreeSettled=unverified

The twice-sampled process/Task Scheduler census catches named known producers only. It does **not** prove every external actor quiescent or reconstruct old historical descendants after parent exit. Missing original PIDs are never settlement proof.

## Verified synthetic fixture matrix

A separate fixture harness at investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/Inspect-WatchdogOrphanPair-Synthetic.Tests.ps1 creates only unique GUID-owned OS-temp NTFS roots and invokes the inspector with -SyntheticFixture. In that mode the census reads private mock data; it does not query live Windows CIM or Task Scheduler.

| ID | Condition | Expected outcome |
| --- | --- | --- |
| I01 | Exact pinned pair | Read-only manual-review invitation, all unsafe flags false |
| I02 | Admission only | Fail-closed incomplete pair |
| I03 | Guard only | Fail-closed incomplete pair |
| I04 | SHA drift | Fail-closed bytes/identity changed |
| I05 | Mock owner alive | Fail-closed reused/live owner PID |
| I06 | Mock child alive | Fail-closed known child |
| I07 | Sidecar exists | Refuse, route separate protocol |
| I08 | Foreign producer | Fail-closed schema/identity |
| I09 | Mock enabled launcher task | Fail-closed competing launch |
| I10 | Mock descendant alive | Fail-closed unsettled tree |
| I11 | -Execute supplied | Refuse execution before file inspection |
| I12 | Native FILE_ID rendered with dashes | Refuse noncanonical identity even if original native file exists |

Each child PowerShell command is noninteractive, no shell, timeout limited and independently checked for process exit. Unsafe TEMP roots (C:\work, Workbridge repo, .tools, .local, RIFT/VM, OneDrive, UNC/root) are rejected BEFORE fixture creation. Fixture admission/guard SHA must remain unchanged; only exact private GUID roots may be deleted on all-cases-PASS. A failure retains private evidence and reports failure. This verifies the **synthetic parser contract only**, not real-world task/process quiescence.

## WB-001 operational release and recovery gates

1. **Source baseline:** independent peer reviews of inspector and fixtures, bounded synthetic Windows test with true OS exit0 and exact expected counts. Persist source SHA, operation ID, sanitized receipt. No source change implies Workbridge deployment.
2. **Incident read-only gate:** operator pins exact incident hashes, IDs, original owner PID/start/session, journal and all known child/descendant/process/task evidence. Reject stale/foreign/reused owner, incomplete producer inventory, or nonordinary root. Unknown outcome remains unknown.
3. **Separate two-phase recovery design:** AFTER dedicated approval and a new independently reviewed tool, stage byte-exact backups; retain old GUI guard while moving admission first by HELD HANDLE + no-replace native FILE_ID; race for maintenance admission CREATE_NEW; if contender wins, STOP without touching old GUI guard; move guard last; verify archive file IDs and retained evidence. No new sidecar fabricated. Admission-only and guard-only orphans remain outside this route.
4. **Native correctness:** confirm FILE_DISPOSITION_INFO DeleteFile has native 1-byte BOOLEAN ABI before any file-release routine; existing helper/source may use 4-byte MarshalAs(UnmanagedType.Bool) and needs separate review. Synthetic FileId helper R0 is separate, unadopted.
5. **All-provider admission and TOCTOU:** independently verify every deployed producer respects both admission and GUI guards, and address current desktop-turn-admission.mjs identity-check then pathname-unlink swap window before any production archival action. The old N06 test is a single-process race ordering model, NOT an observed exploit.
6. **Live GUI gate:** preserve deployed Workbridge owner until WB-001 staged release+rollback and separately approved disposable GUI pilot; never touch physical RIFT, real VM or share existing input-turn during synthetic testing.

No automatic retry of uncertain desktop input or removal of quarantined locks. Insufficient process, task, incident or descendant evidence yields HOLD and requires operator review.

## Verified Workbridge evidence (actual host OS exit)

- **Source hashes:** inspector 2703a06c062936cba47456515af316f35c1b28c85c7cee49d1ebaca08a3cc703; fixture matrix f9d18f3149b619a142e3c5d4bc973396e3abab4ae61ca5bd3e5060ab449c6d2a. Native archived C# source 5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0.
- **Parser/NTFS/temp preflight:** job wd_orphan_inspector_fileid_parser_preflight_20261106_e02, OS exit0, sourceFilesParsed=2, syntaxErrors=0, nativeIdentityCompactSourceProof=true, osTempSafe=true, ntfs=true, ordinaryParents=true; no fixture/GUI/live access.
- **One independently approved e02 fixture run:** job wd_orphan_inspector_private_matrix_20261106_e02; 2026-11-06T00:05:17.414Z to 00:05:26.148Z; **true OS exit0**, status passed, 846 retained stdout bytes, zero stderr, outputTruncated=false.
- **Exact e02 result:** passed=12 failed=0, cases I01–I12, runtimeMs=7929, fixtureCount=12, cleanedFixtureCount=12, executeDisabled=true, liveLocksRead=false, liveLocksModified=false, guiLaunched=false, vmTouched=false, serviceTouched=false, priorActionOutcome=unknown_outcome.
- **Earlier e01 NOT a pass:** job wd_orphan_inspector_private_matrix_20261106_e01 had OS exit1 at I01 due validator format mismatch (dashed-byte vs exact compact 32-character FileId); private first fixture retained for review. A separate failure receipt is at reports/2026-11-06-watchdog-orphan-inspector-synthetic-e01-failure.md. E02 used a NEW requestId and isolated fixtures, did not replay uncertain GUI actions and did not remove e01 evidence.
- **Interpretation:** 12/12 PASS proves only fixture parser/identity/refusal behavior under synthetic injected process/task census. It is NOT independent proof real historical GUI action outcome, full external producer quiescence, native archive/move readiness, live desktop target safety, or permission to remove locks.
