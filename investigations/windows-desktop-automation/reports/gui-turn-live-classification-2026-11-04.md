# Live read-only GUI-turn quarantine classification (2026-11-04)

**Status:** YELLOW — quarantine still active; two current post-lease Workbridge-owner descendants are **unattributed**. No release or historical action success is established.

## Scope

- Exact read-only subject: November 2 workbridge.gui-turn lease 8aed4916-1cf3-4100-bc1b-d56f2308585f; request rc18-physical-rift-screenshot-20261102-postinstall-b1; owner PID43508; old RIFT target PID17412.
- Ran only prototypes/gui-turn-reconcile-readonly.ps1 with explicit ExpectedLockSha256, ExpectedLeaseId and ExpectedRequestId through bounded Workbridge Windows PowerShell5.1 terminal_run.
- Script collected current Win32_Process PID/parent/creation/session metadata via CIM, without command lines or window titles. No GUI automation, focus, screenshot, RIFT, VMware, OneDrive, desktop lock write, archive, unlock, retry or process kill.
- Outcome is a **snapshot of current visible ancestry**, not proof of prior screenshot completion or private Windows Job Object settlement.

## Preflight and postflight

Workbridge diagnostics before and after: 0.16.4-dev, local instance 9aa9b65f-b34f-49a7-8b92-c7954bd4dc9a, owner PID43508, tunnel available/ready, control plane OK. 36 command slots available, occupied0, running0 after. Historical command inventory was incomplete (scan hit 20,000-entry limit), so no global job-history absence is claimed.

Exact evidence hashes **unchanged before and after** both read-only jobs:

| Evidence | SHA256 |
|---|---|
| .tools/desktop-evidence/desktop-input-turn.lock | 635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0 |
| .tools/desktop-evidence/desktop-turn-quarantine-8aed4916-1cf3-4100-bc1b-d56f2308585f.json | f1b37ebbeca97b4351d719786beb8c93dc678b76170f7e1a32b04bdecf0750a0 |

Sidecar remains DESKTOP_TREE_UNSETTLED, processTreeSettlement unknown, automaticRetryAllowed false; its ownerStampSha256 binds the exact lock.

## Evidence chronology

1. First exact-pinned live classifier job wda-gui-turn-live-readonly-20261104-001, 23:03:53.838–23:03:54.980Z: terminal passed/exit0, complete stdout, JSON state conflict reason INVENTORY_DUPLICATE_PID. Static review exposed a *classifier bug*: it rejected Windows System Idle PID0 in the same branch as duplicate positive PIDs. The live run made no changes. Microsoft Learn documents the Idle process as PID0 (https://learn.microsoft.com/en-us/powershell/scripting/samples/managing-processes-with-process-cmdlets?view=powershell-5.1).
2. Investigation-only fix now skips exactly PID0 before reading its nullable creation time while retaining duplicate detection for **all positive PIDs**. Synthetic regression wda-gui-turn-synthetic-tests-ps51-20261104-002: **10/10 passed**, exit0, complete stdout1045, stderr0; added system_idle_pid_zero fixture and preserved all fail-closed invariants.
3. Second exact-pinned live classifier job wda-gui-turn-live-readonly-20261104-002, 23:05:44.938–23:05:49.015Z: terminal passed/exit0, complete stdout703, stderr0. Fresh capture timestamp 23:05:48.2559425Z:
   - state: quarantined_candidate_descendant_present
   - reasonCode: POSTLEASE_DESCENDANT_UNATTRIBUTED
   - baselineDescendantCount: **2** (creation before lease)
   - postLeaseCandidateCount: **2** (creation after lease, current ancestry under owner)
   - ownProbeBranchExcludedCount: **3** (the currently inspecting command's identified ancestor branch)
   - ownerIdentity: pid_only_start_unpinned (original owner processStartUtc and sessionId absent from saved lock)
   - releaseEligible: **false**; automaticRetryAllowed: **false**
   - priorActionOutcome: **unknown**; historicalTreeSettled: **unverified**; manualArchiveDecisionRequired: **true**

Do **not** identify either current post-lease candidate as the old RIFT capture worker: other routine Workbridge commands also descend from the long-lived owner. Conversely, their presence prevents claiming a clean current descendant roster. The original capture-child identity/creation time was not saved, so no current PID-only observation can establish exact past closure.

A **separate later read-only lineage snapshot** at 23:07:39.5039602Z (job wda-gui-turn-live-lineage-readonly-20261104-001, passed/exit0, stdout425, stderr0) again found two post-lease candidates, now with process identities:

| PID | Name | UTC start | Parent PID | Observed ancestry to Workbridge owner |
|---|---|---|---|---|
| 68880 | conhost.exe | 2026-11-04T23:07:38.5590250Z | 37956 | 68880 → 37956 → 72204 → 43508 |
| 68848 | conhost.exe | 2026-11-04T23:07:38.5077420Z | 72204 | 68848 → 72204 → 43508 |

Both session1 processes began within ~0.06 seconds of the **new diagnostic job** starting at 23:07:38.496Z, not on November 2. This strongly suggests incidental console-host sidecars of the read-only inspection itself; their ancestor names and starts were not captured, so the exact ownership link remains unproven. **This later sample cannot identify the PIDs in the 23:05 sample.** Neither sample demonstrates an old persistent RIFT capture process or historical Job settlement.

## Next gate — user decision, not performed

**NO-GO for archive/unlock or GUI pilot at this milestone**, even if Joey were to approve permission: live descendants and old capture provenance have not been technically reconciled. The private DesktopProbe watchdog launch checks for **either** desktop-input-turn.lock **or any** desktop-turn-quarantine-*.json; merely moving one guard while leaving the other in place would not unblock the pilot. A future, explicitly Joey-approved, technically reviewed/frozen transition would need to preserve both originals and associated journals, atomically compare pinned SHA/lease/request, exclude current active turns, resolve both guard surfaces consistently, and retain the prior screenshot outcome as UNKNOWN. None of those changes is implemented or authorized by this report.

**Bottom line:** Current desktop automation remains quarantined, Workbridge itself is healthy, and the only demonstrated activity in this lane was read-only process metadata inspection plus synthetic regression.
