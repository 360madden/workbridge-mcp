# WB-018 — Deployed workflow publication guard

**0.15.2-dev**, 52 tools. Deployment and validation completed on October 21, 2026.
Activation `wb018-activate-20261021-01`: October 21, 2026 at 2:58:47 AM EDT.
UTC: `2026-10-21T06:58:47.1409588Z`. No deployment/recovery error.
Owner during acceptance: `0ba65319-559c-4268-93fe-6a0bdbadb792`.

## Delivered and demonstrated

The prior workflow allowed an explicit retry while the original completed result
remained unsaved. The revised baseline tests passed one and failed seven of eight,
including a response admitting a second attempt. WORKFLOW_RESULT_UNSAVED now
blocks replacement and gives original-job recovery guidance. Saving the result
and ordinary resume preserve the original attempt. True command failures remain
explicitly retryable; input changes, cancellation and undo retain their guards.

Candidate and installed suites passed **384/384**, with no failures, skips or
cancellations. The eight new MCP/CLI cases also passed using only production
dependencies, without application source, TypeScript or Prettier. All seven release
gates passed. The initial test-harness state-envelope correction and red failures
remain recorded; they are not relabelled passes. One existing test now expects
blocked rather than failed for an unsaved result; its exactly-once checks remain.

## Hosted proof and coverage boundary

A direct browser patch and workflow were shared with the installed CLI. The first
check ran once. The second failed with actual child exit **7**, CLI exit **1**, and
its next sentinel write was skipped. A direct browser explicit retry then ran the
second check once more and it passed. Replaying that old token caused no third
attempt. The workflow reached ready_for_review with attempt counts **[1, 2]**.
Browser patch undo and guarded counter restoration returned all fixture files and
Git staging to baseline; completed-job hashes stayed unchanged.

Induced publication failures, concurrent refused retries, and save recovery were
proved through private real MCP/CLI instances in the tests, not fault injection
against the live owner. Direct named command_retry_save exposure remains an
inherited client-catalog limitation; its installed shared CLI path works.

## Preservation and evidence

Release: `wb018-20261021-review01`.
Manifest SHA256: `42A1389627616F8E48B7B45A11EF191AB189A3C00C0BAEA3F0702AA9A25FF1C4`.
Verified before final documentation: 2805 runtime files,
2985 sealed payload files,
2805 rollback files,
3383 preserved backup files,
182 expected source files and six configuration hashes.
The original main Git index was unchanged. Final documentation hashes are tracked
separately and verified in deployed-integrity-after.json.

Eleven source files were promoted with guarded hashes; two package files were
installed by the independent updater. The full 612-line source diff was reviewed
by the implementing assistant, not an independent agent. No dependency change,
main staging, commit, push, permissions, credentials or real Rift/RRE edits.
Preactivation checks found no other running jobs or retained unsaved results.

Evidence: `C:\work\workbridge-wb018-20261021-01\evidence`.
Final reports: documentation-validation.json, deployed-integrity-after.json,
and milestone-complete.json. Check their actual results. Prior seals, failed logs
and rollback backups are retained. The sealed preparation docs remain unchanged.
No guarantee is claimed for lost owner memory, arbitrary filesystem races,
power-loss durability or browser final-reply rendering.

Resume from [the handoff](handoff-20261020.md); do not repeat activation.
Model: GPT-6 Astra Pro. Reasoning level:
