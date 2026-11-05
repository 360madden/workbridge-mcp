# Crash-only DesktopProbeWatchdog orphan admission + GUI guard (no sidecar)

**Date:** 2026-11-05 (America/New_York). **Status:** SOURCE-ONLY DESIGN; no Windows execution, lock archival, GUI/input, VM, RIFT, service, or Task Scheduler mutation. **Owner:** VMware/desktop boundary reliability design. **Decision:** A tightly scoped, operator-approved, pinned **offline evidence archiver with a guard-covered admission handoff** is feasible for the exact two-lock/no-sidecar watchdog shape, but the present helpers do not implement it. No automation or release by age/PID absence.

## Failure shape and actual source causes

| Observed or hypothetical artifact | Interpretation | Operator decision |
| --- | --- | --- |
| desktop-turn-admission.lock AND desktop-input-turn.lock; zero desktop-turn-quarantine-*.json | Possible watchdog crash/exception after both exclusive creations, before Complete() or before a successfully durable WriteQuarantine(); neither file proves child launch or settlement | RED: do not run GUI; do not infer stale merely from timestamp. Use exact-identity read-only evidence census. |
| Admission alone, no GUI guard or sidecar | Possible failure between admission and guard creation, or after exact GUI guard deletion but before admission release | RED: a separate recovery class. Do **not** use the two-file guard-covered handoff below because no original GUI guard blocks the admission name gap. |
| GUI guard alone without admission | Potential prior migration failure/legacy path/changed state | RED: no generic inference; inspect file identity, owner, evidence and producer participation separately. |
| Either pair plus any quarantine sidecar | Not the no-sidecar protocol; must reconcile exact sidecar population and owner hash | RED: use only a matching reviewed sidecar-specific procedure; do not skip or generate a fictitious sidecar. |
| Partial/invalid admission or guard stamp | Possible crash during write/flush; no reliable identity | RED: forensic/operator escalation only; no generic helper execution. |

Current DesktopTurnLease.cs:
- Acquire takes DesktopAdmissionLease before opening desktop-input-turn.lock. Both files use Windows CreateFileW CREATE_NEW, and crash/abnormal Dispose retains pathnames. The GUI guard stamp has producer desktopprobe-watchdog, requestId/runId, leaseId, owner.pid, processStartUtcTicks/sessionId; admission has producer desktopprobe-watchdog, requestId and owner.pid but **not** process start/session.
- Complete(false) normally creates a quarantine sidecar, verifies exact guard+sidecar identity, then releases admission. It is **not** guaranteed to run on abrupt process termination or exception. Dispose() retains both files without sidecar. Complete(true) deletes the specific originally opened GUI file object before admission; a crash between releases can leave admission-only.
- The private Job is attached **after** turn acquisition, then child started. A no-sidecar orphan alone does not establish whether a DesktopProbe child existed, exited, was killed, or ever produced a target manifest. Program.cs writes intent journal before Acquire and turn-acquired/child-started later, but an absent final receipt is not evidence of success.

**Neither existing archiver can do this:**
- Archive-DesktopQuarantine.ps1 requires an existing matching sidecar hash and hard-pins reasonCode DESKTOP_TREE_UNSETTLED; in Execute mode it must first exclusively create a maintenance admission, which conflicts with an orphan admission already at that path.
- Archive-StaleDesktopLock.ps1 is a one-use, lock-only ChatInputProbe reconciler; it insists on producer chatinput-probe-test, target ChatInputProbe plus non-null target PID/HWND. The watchdog stamp's target PID/HWND are null. It also attempts a fresh maintenance admission and therefore cannot handle the orphan admission pair.
- A user-supplied sidecar fabricated after the crash would falsely suggest Complete(false) executed. Do not do that.

## Narrow proposed recovery contract (NOT IMPLEMENTED)

The operator reviews **only** the shape [one real watchdog admission + one real watchdog GUI guard + no quarantine sidecars], expected exact hashes/file IDs, producer, runId, requestId, leaseId, owner metadata, and linked journal. The helper accepts no wildcard root, glob target, arbitrary producer, force option, automatic timeout or discovery-based replacement. It is a two-phase **dry-run classification** then an independently approved one-shot Execute with unique operationId.

1. **Fresh operator approval and admission-wide quiet period.** Record incident ID and owner-approved archival decision separately from the original operation outcome, which stays unknown_outcome. Freeze automatic GUI launch schedules and prevent new direct legacy GUI scripts while allowing non-GUI Workbridge work. Confirm the actually deployed Workbridge service, standalone CLI and all known GUI producers use the admission then legacy GUI guard; verify any legacy/uncontrolled producer is quiescent. Do not claim that acquiring another unrelated lock freezes producers.
2. **Read-only preflight pinned to native identities.** Require canonical local NTFS root, ordinary non-reparse parent chain, exactly one admission and one GUI lock; zero sidecars; bounded max 4-KiB regular non-link files; exact operator-supplied SHA256/size and Windows volume+FILE_ID for each opened handle; parse schemas v1. Require admission mode producer, producer desktopprobe-watchdog, requestId=runId and owner.pid identical to GUI guard; GUI leaseId valid, synthetic:false, target.process DesktopProbe. The GUI guard's owner start ticks/session must be cross-checked to prior trustworthy journal/process inventory; because admission lacks start ticks, don't conflate PID equality with complete proof. Require fresh process/task/Job/descendant census and ownership provenance (not only PID absence); if any owner/child or ambiguous script host is alive or any enabled launcher could inject input, NO-GO.
3. **Durable staging while the old admission remains a freeze.** Open and hold pinned read+DELETE handles to **both original files** with exclusive-safe share modes; any sharing conflict indicates possible live owner, STOP. Make unique same-volume recovery-archives/<operationId> with CreateNew/no-replace backup of **both** original byte streams; fsync, hash check, write and sync manifest, append-only journal containing file IDs, parent evidence, operator decision, no replay, automaticRetryAllowed:false, priorActionOutcome:unknown_outcome. No original name changes before this is durable.
4. **Guard-covered admission handoff (critical ordering).** The original GUI guard remains at its canonical path and blocks every compliant GUI producer. Under the verified quiescent inventory, rename **the exact pinned orphan admission file** into private relocated/ with Win32 handle-bound no-replace rename. This momentarily frees the admission pathname, but the old GUI guard is still present. Immediately attempt an **atomic CREATE_NEW maintenance admission** using the already deployed schema, with a new owner handle and journal. If a producer beats maintenance to admission, or the new acquisition fails for any reason, **STOP without moving the GUI guard**. Preserve both old admission in archive and old guard at canonical path; never delete the contender's admission or assume it did not enter. The guard-covered gap is defensible ONLY after audited proof that all GUI paths honor the original guard and no producer can act without first acquiring it. If that proof is unavailable, **NO-GO**; perform a separately authorized full GUI-producer offline maintenance instead.
5. **Archive GUI guard as final release commit, still under the NEW maintenance admission.** Re-pin/check old guard identity and SHA, fresh quiescence and no new unexpected sidecar, then use handle-bound no-replace same-volume rename of the **original** guard to private relocated/. Preserve both archived original file IDs/digests and both backups. Verify original guard name absent, no sidecars, no foreign GUI work, and preserved archived originals; persist completion receipt that says only archival completed, actionOutcome=unknown_outcome, newActionPerformed=false. Only then release the **new** maintenance admission by its originally opened owner handle. A new unrelated producer may lawfully enter after handoff; report that as a new turn, not an old action.
6. **Crash/uncertainty semantics.** Every unexpected stop retains whatever admission currently guards work and all archive evidence. Never auto-rollback renamed files, recreate guessed sidecars, force-unlock a new owner's gate, retry an unknown action, or mark the old GUI command successful. Journal stage + two file identities, not timestamps alone, determine the operator's later recovery branch.

The **admission-only orphan** cannot safely use step 4 because the legacy guard no longer protects the gap. Defer it to a future reviewed protocol that proves producers are fully offline (including scheduled/direct launch paths) or to an independently verified guard-sentinel handoff design tested across every producer. Do not silently broaden the above helper to it.

### Why the handoff is not yet approved for production

The existing maintenance archiver correctly starts by acquiring an **unoccupied** admission. The orphan-pair helper cannot do that; it must intentionally transfer admission under the still-existing GUI guard. This is a qualitatively new state transition and depends on an audited **all-producer legacy guard invariant**. Source coverage currently includes MCP captures, VMware host capture, DesktopProbe action, chat input disposable, physical RIFT reload, and watchdog; the standalone screenshot CLI has an exact-parent lock contract. Source coverage is not equal to fresh deployed/legacy process inventory. The helper must be independently code-reviewed before any operator uses it.

## Minimum synthetic-only test matrix (no runtime performed by this reviewer)

| ID | Synthetic fixture/action | Required safe outcome |
| --- | --- | --- |
| S01 | Exact watchdog admission+guard, matching owner/runId, no sidecar, proven quiescent | Dry-run classifies eligible-for-operator-review; **no files moved**; Execute simulation preserves both bytes and moves admission, acquires new maintenance, then guard; archival receipt only. |
| S02 | Original watchdog owner PID present; process-start mismatch/PID reuse | NO-GO; no original move. |
| S03 | Child/Job descendant alive; enabled TaskScheduler launcher; uninspectable script host | NO-GO; no original move. |
| S04 | Admission request/producer/PID differs from guard; bad JSON, missing start/session, synthetic:true | NO-GO; no original move. |
| S05 | Reparse/hardlink/oversize file; SHA drift; file-ID changed after read; locked open handle | NO-GO; no original move. |
| S06 | Unexpected any sidecar or unrelated GUI guard; more than one quarantine | NO-GO; no original move; no sidecar fabricated. |
| S07 | Stop/crash before backup durable or before orphan admission rename | Both original canonical names remain; no assumed success. |
| S08 | Stop/crash **after orphan admission rename but before new maintenance create** | Canonical GUI guard still blocks input; archived orphan admission present; report incomplete, no guard move. |
| S09 | Inject racing producer that wins CREATE_NEW admission during gap | Maintenance gets UI_TURN_BUSY, old GUI guard still present; competitor **cannot** obtain GUI lock/input; no delete of contender gate. |
| S10 | Maintenance creation succeeds; crash before GUI guard rename | New maintenance gate remains blocking; original GUI guard preserved; journal permits reviewed continuation only. |
| S11 | Stop/crash after GUI guard rename, before postchecks/admission release | New maintenance gate remains; original guard preserved in relocated/; operator must reconcile; no auto-release or replay. |
| S12 | Colliding operationId/destination, failed no-replace rename, disk full, journal failure | Fail closed with correct surviving guard and archive evidence, never overwrite. |
| S13 | New GUI claimant appears after explicitly released maintenance | Recognize new file-ID/lease, do not overwrite, do not attribute new action to old run. |
| S14 | Admission-only orphan; guard-only orphan; partial admission; different producer | **Reject** helper's exact shape before any Execute. |
| S15 | Simulated old script that ignores admission but honors GUI guard | During admission handoff it still cannot execute. Any script ignoring BOTH guards is a **hard deployment NO-GO**, not a test waiver. |
| S16 | Recovery helper itself crashes/restarts; second operator attempts same operationId | Durable journal/manifest and no-replace path prevent automatic replay; second invocation returns manual-reconciliation-required. |

For S08/S09, a stress test must show the old GUI guard remains continuously at the canonical path until the newly-owned maintenance admission has been established. For S11, no operation may run while maintenance admission remains. Synthetic tests must use a private fixture directory, no shared live .tools names, and test the exact Windows FileId/rename/share semantics on a same-volume disposable NTFS fixture before considering deployment.

## Exact source evidence (read-only, SHA-256 at inspection)

| File | SHA-256 | Relevant lines |
| --- | --- | --- |
| investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/DesktopTurnLease.cs | 00e67f7f0721f2a139a39c3e799f666fc3577d68830142a674e99cd82ae54b3f | Acquire 61–132; Complete 134–197; quarantine 199–245; abnormal Dispose 247–254; admission Acquire/Release now 303–384 |
| investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/Program.cs | 2431c49f3257e219c3d839a309d9f10c96dc25e8b4d17b92d5289b9c8fcd8ecb | intent/turn journal 132–173; attach Job and child 175–225; settlement 237–324; HWND proof 327–408 |
| scripts/Archive-DesktopQuarantine.ps1 | 5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0 | admission and sidecar-specific matching 303–351; sidecar-first/guard-last 363–447 |
| scripts/Archive-StaleDesktopLock.ps1 | bb9ad4f1b3c7539a9515f4dbd3faa87de4f62417d260ca1c3adfdc01ffebb312 | producer ChatInputProbe-only match 133–149; admission acquisition 123–131; guard-only archive 157–208 |
| scripts/desktop-turn-admission.mjs | 2d07155795c6766ea2adbff96907e523b0550f9ab3df7fc7020dfa2b3f941f21 | atomic producer/maintenance acquisition 53–104; identity-checked release 109–159 |
| investigations/windows-desktop-automation/reports/manual-gui-turn-archive-protocol-2026-11-04.md | 371a35d97f24fdcbcb8024d0b808b128eabb52b1ada5233085e6d9817122abdd | Prior sidecar-first architecture, **not applicable unmodified** to orphan admission pair |

**Coordination:** reliability reviewer separately updated the normal-unsettled watchdog sidecar schema to add requestId and null intentSha256; the crash-only, no-sidecar branch remains. This report deliberately makes no changes to watchdog, its sidecar format, archival scripts or live .tools files.
