# Read-only GUI-turn quarantine reconciliation — synthetic validation (2026-11-04)

Status: GREEN — 9/9 synthetic tests pass. CAUTION — live quarantine untouched; Joey's explicit later archive decision remains mandatory.

## Scope and deliverables

- prototypes/gui-turn-reconcile-readonly.ps1: Windows PowerShell 5.1-compatible observation-only classifier; accepts exact lock path, quarantine sidecar, optional expected SHA256/lease/request pins, optional InventoryJson for synthetic fixtures.
- prototypes/gui-turn-reconcile-readonly.test.ps1: nine cases under unique OS-temp workbridge-gui-turn-fixture-GUID; removes only its own fixture in finally.
- No delete/move/archive/unlock, process start/kill, GUI focus/input, VMware/RIFT/OneDrive operation, or replay of the old capture. In live mode it only reads Win32_Process through Get-CimInstance. LIVE MODE HAS NOT RUN.

## Existing evidence

- Lock: workbridge-mcp/.tools/desktop-evidence/desktop-input-turn.lock, SHA256 635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0.
- Owner PID43508, owner processStartUtc=null and sessionId=null; lease 8aed4916-1cf3-4100-bc1b-d56f2308585f; request rc18-physical-rift-screenshot-20261102-postinstall-b1; acquired 2026-11-02T20:46:12.574Z; old RIFT target PID17412.
- Quarantine sidecar SHA256 f1b37ebbeca97b4351d719786beb8c93dc678b76170f7e1a32b04bdecf0750a0. Sidecar matches lock SHA/lease/request; reasonCode DESKTOP_TREE_UNSETTLED; processTreeSettlement unknown; intentSha256=null; automaticRetryAllowed=false.
- Coordinator's separate read-only text search over 135 .tools/desktop-evidence files found the exact request ID only in lock and quarantine, not an independent request-specific screenshot or settlement receipt.

## Algorithm and limits

1. Reject missing, linked, oversized or changing files, bad JSON/schema, wrong sibling filename, SHA drift, wrong lease/request/hash, non-quarantined status, or optional pin mismatch. Double-read exact file SHA after inspection.
2. In live mode take fresh PID/parent PID/session/creation-time inventory with no command lines. In synthetic mode exclusively use JSON fixture and mark output synthetic:true.
3. Require current owner PID and pre-acquire process creation. Compare stored owner start/session when available. Legacy live stamp has no owner creation identity: report pid_only_start_unpinned, never verified ownership.
4. Compute owner descendant closure; exclude only proven inspection command ancestor branch and direct probe descendants; distinguish pre-lease baseline descendants and post-lease candidates using creation times. Other recent Workbridge jobs may be false-positive candidates; they are NOT proof of a still-running old screenshot.
5. Classify quarantined_no_present_descendant versus quarantined_candidate_descendant_present; otherwise conflict/unknown. Every output remains releaseEligible:false, automaticRetryAllowed:false, priorActionOutcome:unknown, historicalTreeSettled:unverified, manualArchiveDecisionRequired:true.

IMPORTANT: No currently seen post-lease descendant does not prove historical Windows Job Object settlement or old RIFT screenshot success. Parent PID lineage and process IDs may be reused; original capture-specific child PID/creation identity was not saved.

## 9-case synthetic-only receipt

Workbridge terminal job: wda-gui-turn-synthetic-tests-ps51-20261104-001.
Command: powershell.exe -NoProfile -NonInteractive -File C:\work\workbridge-mcp\investigations\windows-desktop-automation\prototypes\gui-turn-reconcile-readonly.test.ps1
Resolved executable: C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe
2026-11-04T22:59:20.280Z–22:59:21.444Z; status passed, exit 0, complete stdout 918 chars, stderr 0, no truncation.

| Test | Actual / expected |
|---|---|
| clean_no_postlease | quarantined_no_present_descendant |
| candidate_descendant | quarantined_candidate_descendant_present |
| owner_stamp_hash_mismatch | conflict / QUARANTINE_IDENTITY_CONFLICT |
| owner_pid_reused | conflict / OWNER_PID_REUSED |
| stale_inventory | unknown / INVENTORY_NOT_FRESH |
| quarantine_lease_mismatch | conflict / QUARANTINE_IDENTITY_CONFLICT |
| missing_sidecar | unknown / EVIDENCE_MISSING |
| owner_missing | unknown / OWNER_PID_NOT_PRESENT |
| owner_start_matched | quarantined_no_present_descendant |

Each fixture verifies original lock/sidecar SHA256 remain unchanged and all five fail-closed output invariants. Earlier PowerShell7 attempted paths were immediately rejected EXECUTABLE_NOT_FOUND (exitCode null, output 0) before launching a process; we ported to already installed Windows PowerShell5.1 without weakening checks.

## Future gate — not executed

Nov 2 lock remains quarantined. Joey must separately authorize exact archive/recovery operation after a fresh read-only live classification, with explicit acceptance that old capture outcome is unknown. Any later recovery needs atomic expected SHA/lease/request comparison, preservation of lock/sidecar/journal, independent active-turn and process checks, abort on hash drift or new owner descendant, and no automatic replay. This classifier intentionally does NONE of those mutations.
