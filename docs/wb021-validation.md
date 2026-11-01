# WB-021 — Completion-aware workflow retry and CLI waits

Date: October 21, 2026, America/New_York. Release: **0.16.2-dev**, **52 tools**.
Status: **Deployed and verified.** Candidate and installed suites passed 453/453, all 16 new cases passed with production dependencies only, and all seven release gates passed. Normal browser/shared-CLI checks and preservation passed; see [deployment evidence](wb021-deployment.md).

## Demonstrated gap

A cancelled or timed-out job can still be stopping or saving its final result. The old workflow interpreted its terminal-looking status as complete. Private delayed-publication regression tests observed an explicit retry creating attempt 2 while attempt 1 still owned its pending final save. CLI waitForJob and runWorkflow also returned the provisional termination state instead of waiting for completion.

These were deterministic delays inside disposable owners, not an observed spontaneous incident in the live service. The initial eight integration checks failed against unchanged baseline modules. Some failures describe absent reporting fields or error contracts, not eight independent defects.

The first corrected run passed 15/16 cases. The remaining failure was a test assertion that treated cancelled workflow_resume as a successful MCP operation; the existing contract intentionally returns an error-marked cancelled state. That test was corrected without weakening its cancellation, input-preservation or no-extra-attempt checks. Original failing logs remain retained.

## Candidate behavior

Job summaries now expose derived completionPending. It remains true during active ownership and normal final publication, even after cancellation or timeout was requested. It is false after publication or a completed publication failure, and for historical records with no owned execution. It is not a success or durability flag and does not replace JOB_RECORD_SAVE_FAILED or capacity diagnostics.

Workflow retry refuses terminal-looking pending jobs with WORKFLOW_JOB_PENDING and the original ID. Status/review remain validating when inputs otherwise match. Normal resume does not reconcile or advance past an unfinished job. Existing stale/undone/cancelled and unsaved-result guards remain authoritative. Workflow cancellation waits for any pending completion.

CLI waitForJob and runWorkflow poll through pending completion under their existing caller deadline. They retain actual failure exits and stop-on-error; deadline does not cancel the original job or grant permission to rerun it. See [the field and workflow contract](job-completion.md).

## Validation performed

Full candidate job `wb021-full-tests-20261021-01` passed **453/453**, exit 0, with no failures, skips or cancellations. The sixteen new cases include eight direct owner checks and eight real private MCP/shared-CLI cases. They cover ordinary success/failure, cancelled/timed-out/prelaunch publication, unchanged historical records, active replay, retained-result recovery, refused and concurrent retry, status/review, CLI deadlines, delayed save failure, valid later retry and preserved staged/unrelated files.

The baseline contains 195 source files, six configuration hashes and the existing Git index hash. Candidate/evidence: `C:\work\workbridge-wb021-20261021-01`. Live service remained 0.16.1-dev during preparation. No dependencies, public tools, journal formats, configuration or unrelated-project files changed during preparation.

## Completed delivery gates and retained procedure

The following procedure is complete, not a pending activation instruction. Do not repeat activation.

Use the independent seven-gate release builder. Keep the sealed release unchanged. Run both new test files with production dependencies only, without source, TypeScript or Prettier. Review the complete source delta and use guarded promotion; leave runtime/package installation to WB-001. Before activation, inspect current capacity and refuse to interrupt other occupied slots or lose retained results.

Then run the installed suite without rebuilding the active runtime. Verify normal browser/shared-CLI job summaries, termination, failed waits, workflow timeout followed by one explicit retry, old-token replay and restoration. Delayed publication remains private test instrumentation, not a live-service fault. Update the deployment report/handoff from actual evidence and preserve Git staging, six configuration files, previous releases/backups and unsuccessful test logs. No commit or push.

## Boundaries

completionPending is a point-in-time observation, not a process lease or guarantee about future state. False does not mean successful or durably saved. No general filesystem-race, permanently blocked OS-call, lost-memory or power-loss guarantee is claimed. This adds no scheduler or automatic retry. The existing direct named command_retry_save catalog limitation remains separate from its usable shared-CLI path. Implementation and review are by the same assistant; no independent reviewer or permanent rendering fix is claimed.

Model: GPT-6 Astra Pro. Reasoning level:
