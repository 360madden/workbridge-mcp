# WB-020 — Deployed worker-result evidence validation

**0.16.1-dev**, 52 tools, six shared command-job slots.
Activation `wb020-activate-20261021-01` completed October 21, 2026 at 4:06:56 AM EDT.
UTC: `2026-10-21T08:06:56.1466709Z`. No deployment/recovery error.
Owner during acceptance: `34053cbc-095e-477b-a693-5745efa62955`.

## Delivered

The private WB-019 audit demonstrated acceptance of unrelated and oversized
success evidence despite the real child exiting 7. WB-020 adds a shared strict
result schema, job and fresh invocation identity, a 4,096-byte evidence limit,
regular-file/parent checks, hard-link rejection, bounded short-read handling,
fatal UTF-8 decoding and before/after file checks. The writer creates exclusively.
Pre-existing results block launch without replacement.

Missing or rejected evidence is a failed job with a null, not invented, child exit
and explicit COMMAND_RESULT_MISSING / COMMAND_RESULT_INVALID guidance. Output,
durable replay, original failed outcomes and explicit final-record save recovery
remain. Cancelled/timed-out owner states take precedence. See [contract](command-result-evidence.md).

An invocation UUID is correlation, not authentication against fully consistent
same-user forgery. No universal filesystem-race, power-loss or lost-memory guarantee.

## Verification

| Check | Observed result |
| --- | --- |
| Candidate and fresh installed suites | 437/437 each; no failures, skips or cancellations |
| New production-only cases | 35/35; included in the full suite |
| Release gates | All seven passed |
| Installed runtime | 2808 manifest hashes matched |
| Sealed payload | 3000 hashes matched |
| Rollback runtime | 2805 hashes matched |
| Preserved source/configuration backup | 3395 hashes matched |
| Expected source before final docs | 194 hashes matched |
| Configuration and main staging | Six original configuration hashes and Git index unchanged |

Installed tests ran compiled modules without rebuilding the active installation.
Production-only tests ran without application source, TypeScript or Prettier.
Dependencies are unchanged. Seal: `wb020-20261021-review01`.
Manifest SHA256: `21C23603617E2D637E198981C6B9680CC5FDBE4FA958751574593D7D2AB0C0F0`.

The initial 18 baseline tests passed two and failed sixteen. An intermediate
17/18 run exposed a bad test assumption: the native host can exit 0 while its child
exits 7. The private observation and corrected explicit-host-failure test are
retained; the initial failures were not relabelled passes. Host status is never
used to invent a missing child exit.

## Fresh browser / shared-CLI evidence

Direct browser calls launched the disposable success, failure, cancellation and
timeout fixtures. The installed shared CLI found the same owner and job IDs.
Normal success retained exit 0 and normal failure retained child exit 7. Cancelled
and timed-out jobs retained their states and null exits. Failed waits returned
CLI exit 1 and skipped the next sentinel write. The cancelled fixture child was gone.

Success and failure each executed once. Their result envelopes contained the
correct job IDs, different valid invocation UUIDs, schema version 1 and actual
outcomes within 4 KiB. Repeated requests did not execute again or rewrite records.
Hash-guarded browser restoration returned both counters to empty; subsequent
replay left them empty. Fixture staging, unrelated dirty bytes, four completed-job
records and the two normal result records were unchanged.

Actual malformed/missing/mismatched result injection and unsaved-result recovery
were exercised only in private temporary owners through module and real MCP/CLI
tests. No live evidence file was deliberately damaged to create a hosted error.

## Preservation and checkpoint

15 source files were promoted using current hashes; two package files were
installed with the sealed runtime by the independent updater. The implementing
assistant reviewed the complete 1189-line source diff; no separate independent
reviewer is claimed. Current diagnostics were checked immediately before dispatch
for other occupied slots and retained save failures. No unrelated work was cancelled.

Evidence: `C:\work\workbridge-wb020-20261021-01\evidence`.
Documentation patch: `wb020-deployed-docs-20261021-01`.
Final reports: documentation-validation.json, deployed-integrity-after.json,
checkpoint-workflow-review.json and milestone-complete.json. Inspect their actual
results. The sealed preparation documentation and prior releases remain unchanged.
No main Git staging, commit, push, credentials, permissions or real Rift/RRE edits.

The inherited direct named command_retry_save discovery gap remains separate;
its shared CLI path works. No permanent browser-rendering fix is claimed.
Resume from [the handoff](handoff-20261020.md), not by repeating this activation.
Model: GPT-6 Astra Pro. Reasoning level:
