# WB-021 — Deployed completion-aware workflow retry and CLI waits

**0.16.2-dev**, 52 tools, six shared command-job slots.
Activation `wb021-activate-20261021-01` completed October 21, 2026 at 5:38:43 AM EDT.
UTC: `2026-10-21T09:38:43.8143736Z`. No deployment or recovery error.
Owner during acceptance: `5675c265-76a3-4b26-a4b8-b65ef59f868c`.

## Delivered

Private delayed-publication tests showed the old workflow accepting a second attempt while the original cancelled/timed-out job still owned final publication. Old CLI waiters also returned a provisional terminal-looking state. The new derived completionPending field makes that distinction explicit without changing stored journal formats.

WORKFLOW_JOB_PENDING refuses an unfinished terminal-looking retry without altering attempts. Workflow status/review remain validating when inputs otherwise match; normal reconciliation and later checks wait. Existing changed-input, cancellation, patch-undo and retained-save-failure guards remain. The matching CLI respects completion under its own deadline; it never cancels or reruns a command merely because the caller deadline expired. See [precise semantics](job-completion.md).

False means no normal in-progress completion for this owner, not success or durable storage. Retained save failures remain visible and explicitly recoverable. Historical records derive false without rewriting bytes; interrupted history does not resume automatically.

## Validation

| Check | Result |
| --- | --- |
| Candidate suite | 453/453 passed |
| Fresh installed suite | 453/453 passed; exit 0, no skips/cancellations |
| New production-only cases | 16/16; included in the full suite |
| Release gates | All seven passed |
| Installed runtime | 2808 files matched the seal |
| Sealed payload | 3005 matched |
| Rollback runtime | 2808 matched |
| Preserved backup | 3403 matched |
| Expected source before final docs | 199 matched |
| Live configuration and Git staging | Six configuration hashes and original index unchanged |

Installed tests did not rebuild the active runtime. Production-only tests lacked application source, TypeScript and Prettier. No dependencies changed. Seal: `wb021-20261021-review01`; manifest SHA256 `E69809C4FF24113BA3DCFCF7418CE7D465C7BF22D631BA3FFD9C8F5E848EFCEA`.

Eight new baseline integration tests failed. The first corrected sixteen-case run passed fifteen; its remaining test mishandled the existing error-marked cancelled-workflow response. The assertion was corrected, not the cancellation contract. Failed evidence remains retained separately.

## Hosted browser / shared CLI proof

Direct browser launches returned completionPending true, while completed success/failure/cancellation/timeout summaries returned false with real exits 0, 7, null and null. The shared CLI observed the same owner/job IDs, and failed waits stopped the next sentinel write. The cancelled child was gone.

A disposable workflow timed out on its first attempt, fully completed, and then passed on one explicit browser retry. The CLI reconciled it to ready_for_review. Repeating the old retry token created no third attempt. Normal command replay also did not execute twice. Direct guarded restoration and patch undo restored all counters, target bytes, unrelated dirty fixture bytes and Git staging. Six completed-job record hashes remained unchanged; completionPending was not written into those records.

Actual slow-publication pauses, premature retry refusal, concurrent requests, caller deadlines and save-failure recovery were tested only with private disposable module/MCP/CLI owners. No live journals were damaged or delayed artificially to manufacture acceptance.

## Preservation and resume

15 source files were promoted by guarded hashes; two package files were installed with the sealed runtime by the independent updater. The implementing assistant reviewed the complete 908-line source diff. No independent reviewer is claimed. Idle-owner checks refused interference with other occupied slots or retained results.

Evidence: `C:\work\workbridge-wb021-20261021-01\evidence`.
Documentation patch: `wb021-deployed-docs-20261021-01`.
Inspect documentation-validation.json, deployed-integrity-after.json, checkpoint-workflow-review.json and milestone-complete.json for their actual final results. Prior releases, sealed preparation docs, rollback backups and failed logs are retained. No staging, commit, push, permissions, credentials or unrelated-project edits.

The inherited direct named command_retry_save discovery gap remains separate from its shared-CLI recovery path. Current-owner observations are not reservations, continuous monitoring or guarantees against permanently blocked OS calls, all filesystem races, lost memory or power loss. No permanent browser rendering fix is claimed.

Resume from [the handoff](handoff-20261020.md). Do not repeat activation or fixed acceptance IDs.
Model: GPT-6 Astra Pro. Reasoning level:
