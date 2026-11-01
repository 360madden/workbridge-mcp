# WB-018 — Recover an unsaved workflow result before retry

Date: October 21, 2026 (America/New_York). Release: **0.15.2-dev**, **52 tools**.
Status: **Deployed and verified.** Candidate and installed suites passed 384/384; all eight new cases passed with production dependencies only; seven release gates passed. See [deployment evidence](wb018-deployment.md).

## Reproduction and correction

The 0.15.1-dev workflow treated JOB_RECORD_SAVE_FAILED like an ordinary command failure. Its next-action guidance suggested retryJobId, and following that guidance admitted a second attempt while the first result remained unsaved. The corrected baseline regression run passed one and failed seven of eight cases; the retained failure output shows the second job being admitted. This was an explicit retry permitted by the old workflow, not an automatic retry claim.

Workflow status/review now report WORKFLOW_RESULT_UNSAVED and block progression when the latest job result is retained but unsaved. The next action identifies the original job ID and directs the caller to preserve output, resolve storage and explicitly use command_retry_save. A retry token for that result fails before changing its attempt journal. Normal continuation also checks current jobs before launching or advancing, including after uncertain-launch reconciliation. No automatic record save, command retry or owner restart is introduced.

After saving the original result, ordinary workflow_resume reconciles it without another attempt. A successful original check can advance to the next check. A genuinely failed command still requires its existing explicit retry policy. Changed watched bytes remain protected; restoring the planned bytes does not bypass file-version invalidation. Cancelled and undone workflows do not resume merely because a result is saved.

## Evidence

New tests: test/workflow-publication-cli.test.mjs, eight real private-owner MCP/CLI cases. They cover status/review guidance; explicit retry refusal and unchanged attempt bytes; CLI stop-on-error; no automatic saving or later-step execution; same-attempt reconciliation; legitimate failed-command retry; stale/restored inputs; six concurrent retry requests; and cancellation/undo. Staged fixture bytes and unrelated dirty files are preserved. Faults are injected only in private temporary owners.

Full candidate job: wb018-full-tests-20261021-01, **384 passed, zero failed/skipped/cancelled**, exit 0. The eight new tests are included in that total. An existing result-recovery test was updated to expect blocked rather than failed for an unsaved workflow result; its same-attempt and exactly-once assertions remain. The first new test harness incorrectly expected successful MCP envelopes for cancelled/blocked workflow_resume responses; it was corrected to assert the existing error-envelope contract, then the unchanged baseline was rerun. Both failed logs are retained separately.

Evidence and isolated candidate: C:\work\workbridge-wb018-20261021-01. Baseline: 180 source files, six configuration hashes, main Git index SHA256. No live journal fault injection, dependencies, new tools, permissions, credentials, broad staging, commits, pushes or unrelated-project changes.

## Historical preparation procedure and limits

The release, production-only, promotion and activation gates below were completed; see [deployed evidence](wb018-deployment.md). Do not repeat activation.

Run the existing seven-gate release seal and the eight cases with production dependencies only. Review the exact source delta and preserve its hashes; activate through the independent updater only after confirming no other running jobs or retained publication failures. Run the installed suite without rebuilding. Fresh hosted checks must verify ordinary workflow success, true failure, explicit retry, replay and restoration; induced unsaved-result recovery remains private-test evidence.

Existing limits remain: a lost owner's unsaved memory cannot be reconstructed; checks are not an atomic whole-filesystem snapshot; cancellation/undo and external state changes retain their existing contracts. Saving a failed result is not command success. The WB-016 direct named command_retry_save exposure gap is separate; the shared CLI path works. No permanent browser rendering fix or independent-agent review is claimed.

Model: GPT-6 Astra Pro. Reasoning level:
