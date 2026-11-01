# Command completion, cancellation and workflow retry

WB-021 / deployed **0.16.2-dev**, retaining 52 tools and six shared command-job slots. [Deployment evidence](wb021-deployment.md) records installed and hosted checks.
Preparation and deployment evidence are separate; source tests alone do not prove live behavior.

## Completion is separate from status

Every returned job summary now includes **completionPending**, derived from the current owner's live state. It is true while that owner is preparing, executing, stopping, or publishing the final result. In particular, a public `cancelled` or `timed_out` status can coexist with `completionPending: true`: requesting termination is not proof that the process and final save have finished.

The field is false after final publication, for an interrupted historical record with no current execution, or when normal publication has finished unsuccessfully and the owner retains an unsaved result. Therefore **false does not mean success, durable storage, or an available slot**. Inspect status, exitCode and errorCode. JOB_RECORD_SAVE_FAILED still requires explicit command_retry_save after resolving storage; diagnostics identifies occupied retained-result slots.

This field is not persisted in the job journal. Old records do not need migration, and a similarly named value added to an old record is not trusted as owner state. Status/output/catalog/replay and nested workflow/recovery summaries use the same derivation. Read-only inspection does not rewrite records.

## Workflow behavior

A workflow does not reconcile an attempt as finished, advance another check, or launch a retry while its original job is completion-pending. A premature retry of a terminal-looking job returns **WORKFLOW_JOB_PENDING**, with the original job ID and command_status as the next inspection action. The refused request adds no attempt and does not alter the workflow journal.

With otherwise valid inputs, workflow status/review remain validating while completion is pending. Existing stale-input, patch-undo and explicit workflow-cancellation states retain precedence. Workflow cancellation also waits for a pending timeout/cancellation to finish instead of overlooking it because its public status is no longer running.

After completion, genuinely failed, cancelled or timed-out attempts remain explicitly retryable under the existing exact retryJobId contract. Repeating an old retry token cannot create a third attempt. If publication finishes with JOB_RECORD_SAVE_FAILED, WB-018's WORKFLOW_RESULT_UNSAVED guard still requires recovery of the original outcome before another attempt.

## CLI behavior

The matching installed CLI uses both status and completionPending for `waitForJob` and the inner waiting loop of `runWorkflow`. It keeps waiting through pending termination/publication instead of prematurely returning a provisional timeout/cancellation result. The caller's CLI deadline remains enforced: deadline exit 124 does not cancel, rerun, or replace the owned job, and later batch steps are not executed.

Once the result is available, normal command failure still exits 1 and stops the batch. CLI success still requires a passed job with exit 0, or a workflow ready_for_review. A retained save failure is surfaced as such, not relabelled successful. Use durable job IDs to inspect an uncertain or timed-out caller result.

## Verification boundary

Regression tests delay final publication only inside private disposable owners. They test refused retries, unchanged attempt journals, real MCP/shared-CLI behavior, cancellation, timeout, deadlines, save failure and explicit recovery. Normal hosted acceptance must separately exercise the deployed owner without manufacturing live storage faults.

This is not a new scheduler, retry policy, cancellation guarantee, atomic filesystem snapshot, or solution for a permanently blocked operating-system call. Current-owner observations can change immediately after a response. Existing output retention, six-slot limits, historical restart behavior and lost-memory limitations remain. No dependency or tool-catalog expansion is required.

See [workflow contracts](resumable-workflows.md), [result saving](job-retry-save.md), [capacity](job-capacity.md) and [WB-021 validation](wb021-validation.md).

Model: GPT-6 Astra Pro. Reasoning level:
