# WB-022 — Deployed guarded final-result publication

**0.16.3-dev**, 52 tools, six shared command slots.
Activation `wb022-activate-20261021-01`: October 21, 2026 at 8:24:37 AM EDT.
UTC: `2026-10-21T12:24:37.6891055Z`. No deployment/recovery error.
Acceptance owner: `d7ca7bc4-79c7-4588-b421-518a0dd5253c`.

## Delivered behavior

Previously the first final save did not apply the original-intent guard used in explicit recovery. Private tests showed newer, missing or malformed records could be replaced, and an unverified save could release the only in-memory result. Both normal publication and explicit recovery now share the existing guarded save and a reread of the exact expected final bytes.

Observed conflicts retain the original outcome/output under JOB_RECORD_SAVE_FAILED; the command is not rerun. Exact already-saved bytes are acknowledged without replacement. Child failure, cancellation, timeout and prelaunch error keep their original outcome through recovery. A blocked workflow cannot retry over the retained result. See [contract](job-publication.md).

These checks are not atomic across independent filesystem writers. Later changes can occur between calls or after verification. No authentication, permanent race prevention, crash-proof disk flush, lost-memory reconstruction or continuous monitoring is claimed.

## Evidence

| Check | Observed result |
| --- | --- |
| Candidate suite | 473/473 passed |
| Installed unchanged rerun | 473/473 passed; no failures/skips/cancellations |
| First installed run | 472/473; one deadline/admission timing assertion failed |
| Isolated unchanged deadline check | 1/1 passed; included in the full suite |
| Historical compatibility | 1,398 finalized summaries matched; hashes unchanged |
| New production-only tests | 20/20; a subset of the full suite |
| Release gates | Seven passed |
| Installed runtime | 2808 manifest hashes matched |
| Sealed payload | 3010 matched |
| Rollback runtime | 2808 matched |
| Preserved backup | 3408 matched |
| Source before final documentation | 204 expected hashes matched |
| Main Git index / configuration | Original index and six configuration hashes unchanged |

Seal: `wb022-20261021-review01`. Manifest SHA256: `04B5CAAFB9F2E91552FCE1D2A91C02456B7E43073E8C60DC3E217DDE6A7C9A26`.
Installed tests ran without rebuilding the active runtime. Production-only tests ran without application source, TypeScript or Prettier. Dependencies and stored journal formats are unchanged.

The initial targeted baseline failed 13/15 checks; ordinary publication and existing nonregular-file rejection passed. The first full candidate suite passed 472/473. Its old cancellation test deliberately corrupted the journal and expected cancellation to replace it. The updated test instead proves that the command stops, corrupt bytes survive, the original cancellation is retained, conflicting recovery is refused, and explicit fixture recovery does not execute another command. Both unsuccessful candidate runs are retained separately.

A separate first installed run, wb022-installed-full-tests-20261021-01, passed 472/473. The unchanged workflow CLI deadline test assumed admission within one second and observed pending rather than validating. The expected CLI deadline exit 124 and workflow ID were present. Its isolated rerun passed 1/1, and the unchanged full rerun wb022-installed-full-tests-v2-20261021-01 passed 473/473. There was no source/runtime edit or reactivation between these installed runs. The first run overlapped the integrity scan; timing sensitivity is supported but the precise scheduling cause is not proved. The test remains a known validation limitation, not a fixed defect. The milestone NEXT-AUDIT.md proposes deterministic admitted-job and pre-admission deadline coverage.

The read-only compatibility comparison checked 1,398 finalized saved jobs with matching summaries and unchanged hashes; only its own nonfinal job was excluded. Activation was held for the active RogueTV build, which finished successfully without cancellation.

## Hosted scope

Browser and shared CLI observed the same owner and real normal outcomes: success 0, failure 7, cancellation/timeout with null exits, and completionPending true during admission then false after completion. Failed waits skipped the sentinel write. A normal workflow timed out once, then passed on one explicit retry. Old-token replay made no third attempt; normal command replay also did not execute again.

Guarded restoration and patch undo returned counters, target bytes, unrelated dirty fixture contents and staging to their original hashes. Six completed-job records stayed unchanged. Actual altered/missing/corrupt-record faults and result recovery were tested only in private disposable module/MCP/CLI owners. No live state was damaged to manufacture acceptance.

## Preservation and resume

13 source files were promoted with current hashes; two package files were installed by the independent updater with the sealed runtime. The complete 763-line source diff was reviewed by the implementing assistant, not an independent reviewer. Fresh preactivation capacity checks found no other occupied slots or retained results. No unrelated jobs were cancelled.

Evidence: `C:\work\workbridge-wb022-20261021-01\evidence`.
Documentation patch: `wb022-deployed-docs-20261021-01`.
Inspect documentation-validation.json, deployed-integrity-after.json, checkpoint-workflow-review.json and milestone-complete.json for their actual final results. Existing seals, rollback backups and failed evidence remain retained. No commits, pushes, credentials, permissions or unrelated project edits.

The inherited direct named command_retry_save catalog limitation remains separate from its shared-CLI path. Resume from [the handoff](handoff-20261020.md); do not repeat activation or fixed acceptance IDs.
Model: GPT-6 Astra Pro. Reasoning level:
