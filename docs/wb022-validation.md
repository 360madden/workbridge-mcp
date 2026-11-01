# WB-022 — Guard initial final-result publication

Date: October 21, 2026, America/New_York. Release: **0.16.3-dev**, **52 tools**.
Status: **Deployed and verified, with a recorded timing-sensitive test limitation.** Candidate and unchanged installed rerun passed 473/473. The first installed run passed 472/473 because the one-second CLI deadline test observed pending instead of validating; the isolated test then passed without edits. All 20 new cases and seven release gates passed. See [deployment evidence](wb022-deployment.md) for all runs and normal hosted/preservation acceptance.

## Reproduced behavior and scope

The initial final save called save without the original intent hash and released the retained result without verifying the stored final bytes. Explicit recovery already had both checks. Private regression tests demonstrated replacement of changed, deleted or corrupt intent, loss of retained ownership after an unverified save, and conflicting metadata replacement during a transient write retry.

The baseline run failed 13 of 15 direct checks; ordinary publication/replay and the existing nonregular-file refusal passed. These were deliberate faults in private disposable instances, not an observed spontaneous production incident. The first changed full suite passed 472/473. Its older cancellation fixture deliberately corrupted a record and expected cancellation to overwrite it. That assertion now verifies corrupt-byte preservation, actual cancellation retained in memory, refusal of conflicting recovery, and explicit recovery using only the fixture's original saved intent. The implementation guard was not weakened. Both unsuccessful runs remain retained.

## Implementation and passing evidence

Initial publication and explicit recovery share saveResult. Both verify the original intent or exact-final-byte hash before writing and reread the intended final bytes before releasing the owned outcome. Existing storage retries recheck the same guard. Observed conflict or unverifiable publication follows JOB_RECORD_SAVE_FAILED, preserving output, actual child exit and original result; no command is replayed or history automatically repaired. See [the publication contract](job-publication.md).

The revised candidate suite `wb022-full-tests-v2-20261021-01` passed **473/473**, exit 0, no failures, skips or cancellations. Focused suite `wb022-publication-green-20261021-01` passed **20/20**: fifteen direct owner checks and five real private MCP/shared-CLI checks. They cover changed/missing/corrupt/oversized/nonregular records, post-save changes, false save acknowledgement, transient retry conflicts, identical final-byte acknowledgement, actual outcomes, replay, restart, explicit recovery, workflow blocking and unrelated staged/dirty fixture preservation. The twenty cases are included in the full count, not additional unique tests.

The baseline contains 200 source files, six configuration hashes and the main Git index hash. Preparation is isolated at `C:\work\workbridge-wb022-20261021-01`; live runtime remains 0.16.2-dev until independent activation. Dependencies, tool count and saved-job schema are unchanged.

## Completed delivery gates and retained procedure

The procedure below is complete, not a pending deployment request. Do not repeat activation.

Run the independent seven-gate release builder and preserve the immutable manifest. Run both new test files with production dependencies only and without application source, TypeScript or Prettier. Review the complete source delta and promote only current-hash-guarded files; use WB-001 for runtime/package installation after fresh checks show no other occupied slots or retained results.

Run the installed suite without rebuilding the active service. Exercise normal browser/shared-CLI success, genuine failure, cancellation, timeout, workflow retry, replay, explicit patch undo and restored fixture hashes. Actual conflict injection remains confined to private owners. Preserve existing staging, configuration, prior release evidence, backups and unsuccessful logs. Update the deployed checkpoint only from observed results. No commits, pushes or unrelated-project changes.

## Limits

Before/after filesystem checks are not an atomic compare-and-swap across other processes, continuous monitoring or protection against every race. Another writer may change data between calls or after verification. Existing lost-owner-memory and power-loss limits remain. The inherited direct named command_retry_save discovery check is separate from its working shared-CLI path. The implementing assistant reviews this work; no independent reviewer or permanent rendering fix is claimed.

Model: GPT-6 Astra Pro. Reasoning level:
