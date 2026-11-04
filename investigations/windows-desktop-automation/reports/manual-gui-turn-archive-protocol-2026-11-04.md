# Future manual GUI-turn recovery: sidecar-first archive and admission handoff

**Date:** 2026-11-04 (America/New_York)  
**Status:** DESIGN ONLY / NO EXECUTION. Workbridge production remains live. **NO-GO** for removing the existing host GUI lock today. This document does not authorize any file rename/delete, UI/focus action, restart, screenshot, VMware/RIFT input or replay.

## Decision and confirmed starting evidence

The November 2 host RIFT screenshot request `rc18-physical-rift-screenshot-20261102-postinstall-b1` is still **unknown_outcome**, not a verified successful or failed screenshot. Read-only reports `desktopprobe-host-ops-preflight-2026-11-04.md` and `gui-turn-reconcile-readonly-2026-11-04.md` record:

| Exact artifact | November 4 read-only reference | Required treatment |
| --- | --- | --- |
| `.tools/desktop-evidence/desktop-input-turn.lock` | SHA256 `635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0`; historical lease `8aed4916-1cf3-4100-bc1b-d56f2308585f` | Preserve its original bytes, file identity, path and linkage before any future move |
| Matching `desktop-turn-quarantine-8aed4916-1cf3-4100-bc1b-d56f2308585f.json` | SHA256 `f1b37ebbeca97b4351d719786beb8c93dc678b76170f7e1a32b04bdecf0750a0`; `DESKTOP_TREE_UNSETTLED`, `automaticRetryAllowed:false` | Archive together with guard, retain original incident classification |
| Original action receipt / historical child Job settlement | No independent request-specific receipt found by bounded searches; owner PID was persistent Workbridge service with no start/session stamp in legacy lock | Cannot infer original screenshot success or historical descendant settlement from today's absent PID |

These hashes are **historical preflight pins**, not a claim the live files will remain identical. Revalidate immediately before a later authorized recovery, then abort on any mismatch. The read-only classifier intentionally always returns `releaseEligible:false` and cannot authorize release.

## Why both files matter — source-verified gate mismatch

| Caller | Current admission behavior | Implication |
| --- | --- | --- |
| Live `src/desktop-registration.ts:36-50` `withDesktopCaptureTurn` | `open(lockPath,'wx')`; **no orphan-sidecar check** | A sidecar alone will **not** stop a new Workbridge capture if the main lock name becomes free |
| Direct `scripts/vmware-host-capture.mjs:311-338` and `scripts/desktop-probe-act.mjs:247-270` | Own `wx` on same filename | Must be included in desktop admission freeze, including direct terminal-run entrypoints |
| New `prototypes/desktopprobe-watchdog/Program.cs:102-110` | Rejects an existing guard **or any top-level** `desktop-turn-quarantine-*.json` | Orphan sidecar continues to block watchdog even if the guard is renamed |
| `src/desktop-cli-runner.ts:109-183` | Timeouts/killed or malformed child replies can mean `DESKTOP_TREE_UNSETTLED` | Do not reinterpret the old uncertainty as an erroneous lock and silently replay |

**Correction to prior conceptual sequencing:** Moving/archiving the guard *first* while its orphan sidecar remains creates a window where the live Workbridge `wx` caller can seize the unguarded desktop even though the watchdog still refuses. The safer ordering is **sidecar first while the old guard remains, then guard last as the explicit admission-release commit point**. This is an ordering guarantee only, not an atomic two-file transaction.

## Minimum future authorized protocol

1. **Human decision + scope.** Joey must explicitly authorize recovery of this **exact** legacy lease and acknowledge original screenshot `unknown_outcome`, no replay and no synthesized success receipt. Nothing is approved by age alone. Record actor, approval scope/time, expected exact hashes, and a release decision separate from the original capture outcome.
2. **Freeze only desktop-input/capture admission; keep Workbridge service running.** The freeze must cover Workbridge capture registration, direct CLI scripts, helper/task launch paths, all ChatGPT/other-agent producers, and the new watchdog. Drain or independently identify any already-entered desktop turn before proceeding. A chat instruction, sidecar existence, or ad-hoc sentinel that legacy `wx` callers do not check is **not an enforceable freeze**. Preferred future implementation is one cross-process desktop admission gate with an exclusive maintenance owner and per-producer participation, enabled without stopping unrelated Workbridge jobs. Its deployment and synthetic race tests require separate approval; **current code does not yet provide this barrier**.
3. **Reconcile originals under the freeze.** Run the existing read-only classifier and fresh bounded process inventory; inspect the original request/Job/receipt via permitted routes. Require no current relevant GUI request/child, exact ordinary (non-link) guard and sidecar file IDs, SHA256, sizes, lease ID, request ID, owner stamp hash, and exactly the expected top-level quarantine population. Missing historical settlement remains UNKNOWN and needs the separately accepted human decision. Any new claimant, drift, unreadable artifact or ambiguous ownership is **STOP**.
4. **Prestage a recoverable byte-exact archive.** Under an ignored, uniquely allocated same-volume directory such as `.tools/desktop-evidence/recovery-archives/<incident-id>/`, create non-overwriting `backup/`, `relocated/`, and an append-only progress journal. Copy both original byte streams into `backup/`, verify full SHA256/size and file-identity metadata, and durably write a signed-off manifest stating `priorActionOutcome:unknown_outcome`, `automaticRetryAllowed:false` and `newActionPerformed:false`. No overwriting or recursive cleanup.
5. **Two single-file moves under the still-held admission freeze:** (a) recheck exact sidecar identity/bytes and rename that sidecar to unique `relocated/` path **without replace**; verify digest; guard stays in its original location and continues blocking all legacy `wx` claimants. (b) recheck exact guard identity/bytes against the original pinned file object, then rename **that exact guard last** into `relocated/`, without replace. This final rename is the intentional release commit point only after backup, manifest and human decision are already durable. Prefer a verified Win32 handle-bound `SetFileInformationByHandle(FileRenameInfo)` implementation to reduce path-swap risk; its permissions, sharing and crash semantics must first be tested on disposable files. Windows documents a per-file no-replace rename, **not** atomicity for two files.
6. **Postcommit while maintenance admission is still frozen.** Verify the original guard/sidecar names are absent; relocated originals retain their original file IDs and pinned SHA, while backup copies retain the pinned SHA/size (but necessarily have different file IDs); there is no new unexpected owner, orphan sidecar, pending GUI action or foreground change. Check Workbridge owner instance/health non-mutatingly. Mark only the **recovery archival operation** complete. The November 2 screenshot stays `unknown_outcome`. Release the maintenance gate as a separate reviewed handoff; then later schedule a separately authorized DesktopProbe pilot.

## Crash/race handling (fail closed)

| Interruption point | Expected state | Recovery rule |
| --- | --- | --- |
| Before archive verification | Original lock + sidecar still present | Stop; no release, preserve evidence |
| After sidecar rename, before final guard rename | Original guard still present, sidecar in verified private archive | All existing `wx` claimants remain blocked; retain maintenance record and manually reconcile, do not silently recreate/move files |
| After final guard rename, before postcheck | Both originals archived; admission could become free if freeze is lost | Treat release state as **uncertain**, inspect exact archive and any newly acquired guard. Never overwrite or move back a new owner's lock |
| A contender acquires new guard at/after release | New lock has different file identity, stamp/lease | Preserve it untouched, halt release diagnosis and report new owner; do not delete to restore old state |
| Unexpected extra sidecar, checksum drift, PID reuse, open-handle sharing failure, or failed rename | Unknown partial state | Keep gate engaged if possible, preserve all bytes/journal, manual reconciliation; never auto-retry an operation of uncertain effect |

**No-gap proof requirement:** A single-path rename may be atomic on its filesystem, but it does not make guard+sidecar a transaction. The guard-last order blocks old `wx` callers *until* the intended release commit. To guarantee no competing GUI actions **during postcommit verification**, the separate, enforced admission freeze must stay active until explicit handoff. Without that shared freeze implementation, do **not** run the recovery just because the artifacts appear old.

**Proof before considering live use:** disposable filesystem tests for identical destination, simultaneous `wx` contenders, foreign/mismatched lease, extra orphan, reparse point, stale source-file identity, crash after each journal stage, blocked share-delete handle, and unexpected new owner; independently verify ordinary Workbridge command throughput remains available while only desktop inputs are frozen. Avoid relying on `ReplaceFileW` as a magical multi-file transaction: Microsoft documents partial-error states for that API.

Primary Windows API references: [FILE_RENAME_INFO / no-replace behavior](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info), [GetFileInformationByHandle file identity](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle), [ReplaceFile error/backup behavior](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilea).

**No recovery operation, lock/sidecar read-modify-write, GUI action, service restart or replay was executed for this design note.**
