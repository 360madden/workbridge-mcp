# WB-020 — Invocation-bound, bounded worker-result evidence

Date: October 21, 2026, America/New_York. Release: **0.16.1-dev**, **52 tools**.
Status: **Deployed and verified.** Candidate and installed suites passed 437/437. All 35 new cases passed with production dependencies only; all seven release gates, normal browser/shared-CLI acceptance and preservation passed. See [deployment evidence](wb020-deployment.md).

## Reproduced gap

The preceding private audit replaced a genuine child-exit-7 result with an unrelated
success record, including a 131,193-byte version. Both were accepted by 0.16.0-dev.
That was deliberate disposable fault injection, not an observed spontaneous live
incident. The old reader had neither a small byte limit nor an invocation identity.

The first 18 regression checks against unchanged compiled baseline passed two
(cancellation and timeout) and failed sixteen. The first implementation run passed
17/18. Its remaining test incorrectly assumed Windows host exit must equal child
exit. A separate private probe showed host exit 0 and valid child exit 7; that
assumption was corrected by explicitly injecting a failed-host contradiction. The
original red run, intermediate failure and probe are retained separately. Tests
must not turn the wrapper's exit into a fabricated child result.

## Correction

The owner and worker share a strict versioned envelope containing job ID and fresh
invocation UUID. Results are read with a 4,096-byte ceiling, regular-file/parent
checks, hard-link rejection, bounded read allocation, fatal UTF-8 decoding and
before/after identity checks. Unknown fields, versions, identities and inconsistent
outcomes fail closed. Existing result files block launch and remain untouched;
the worker writes exclusively. See [the exact contract](command-result-evidence.md).

Rejected or missing evidence yields a failed job with an explicit
COMMAND_RESULT_INVALID or COMMAND_RESULT_MISSING and a **null child exit**. It
retains output and follows existing durable replay/save-recovery behavior. Cancelled
and timed-out owner states retain precedence. Actual valid child failure still
retains its real exit, including exit 7 when the native host exits 0.

## Validation performed

Full suite `wb020-full-tests-20261021-01`: **437 passed, zero failures, skips or
cancellations**, exit 0. Focused suite `wb020-focused-all-20261021-01`: **35/35**;
these are included in the full count. Ten direct reader checks, eighteen runner
checks, and seven private MCP/shared-CLI checks cover bounds, short reads, changing
files, mismatched identity, corrupt/absent evidence, replay, restart, retained-result
recovery, staged/unrelated-file preservation and stop-on-error.

The live service remained 0.16.0-dev during preparation. Fault injection used only
private temporary owners. New code is in an isolated candidate under
`C:\work\workbridge-wb020-20261021-01`. The baseline retains 188 source files, six
configuration hashes and the main Git index. Dependencies and tool count are unchanged.

## Completed delivery gates and retained procedure

The following delivery procedure is complete, not a pending activation request. See [deployed evidence](wb020-deployment.md); do not repeat activation.

Use the independent seven-gate release builder and immutable release digest. Run
the 35 cases with production dependencies only, without application source,
TypeScript or Prettier. Review and promote the complete guarded source delta;
install only through WB-001 after current diagnostics show no other occupied slots
or retained unsaved results. Do not interrupt another project.

Run the installed full suite without rebuilding and exercise normal success,
actual failure, cancellation, replay and restored fixtures through browser and
shared CLI on the same owner. Do not damage live result files to manufacture proof.
Update the deployment report and handoff only from observed results. Preserve
existing staging, configuration, prior releases, rollback backups and failed evidence.
No commits, pushes, credentials, permission changes or unrelated-project edits.

## Limits

UUID correlation is not authentication against deliberate same-user forgery of a
fully consistent record. File checks are not an atomic snapshot or a guarantee
against every filesystem race or blocked OS call. Existing finalized journal
records are not migrated. This does not recover previously lost owner memory or
fix the inherited named-tool catalog gap for command_retry_save. Its shared-CLI
path remains usable. No independent reviewer or permanent rendering fix is claimed.

Model: GPT-6 Astra Pro. Reasoning level:
