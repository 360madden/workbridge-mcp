# WB-015 — Consistent saved command-job recovery and discovery

Date: October 20–21, 2026 EDT (October 21 UTC).  
Release: **0.14.0-dev**, retaining **51 tools**.  
Status: **Deployed and tool-accepted.** Final candidate and installed suites passed 332/332 tests; production-only execution passed 36/36 new cases. All seven sealed-release gates and fresh browser/CLI acceptance passed. See [deployment evidence](wb015-deployment.md).

## Reproduced defects in 0.13.0-dev

Disposable saved records and a private CLI/MCP owner demonstrated:

1. A request for job `bad` returned a stored `wrong-id` through status/output,
   although discovery rejected the same record as `UNREADABLE_JOB_RECORD`.
2. A **16,777,652-byte** record exceeded discovery's **16,777,216-byte** bound,
   but known-ID status accepted it and exposed an unknown field containing
   **16,777,217 characters**. The separate known-ID loader was an unchecked cast.
3. Discovery with `limit: 1` returned one good row plus one error row. Errors did
   not consume the page limit.
4. A catalog containing a corrupt record produced successful MCP/CLI results:
   the CLI exited **0** and executed a subsequent sentinel write.
5. Known-ID status accepted a junction substituted for the jobs catalog.

Evidence is retained in `C:\work\workbridge-wb015-20261020-01\evidence`, including
`reproduction.json`, `catalog-raw.json`, and `partial-batch-raw.json`. The large
fixture and linked storage are confined to the retained disposable reproduction.
No real command record was deliberately corrupted, cancelled, or replayed.

## Correction

All persisted job callers now share a schema-validated, **16 MiB bounded reader**,
including known-ID status, output, cancellation, replay, and catalog discovery.
The requested and stored IDs must match exactly. Invalid request hashes,
timestamps, field types, and optional timeouts are refused. Unknown legacy fields
are stripped from returned summaries without rewriting historical records.

Storage checks refuse linked/nonregular catalog directories and metadata files.
Fingerprint comparisons detect tested changes before and during the bounded read.
New and final job-record writes recheck storage types. Live in-memory jobs remain
authoritative; a corrupt disk copy cannot replace the current owner's cancel
handle, output, or live status. Existing IDs, legacy combined-only output,
interrupted historical jobs, and valid exactly-once request replay remain supported.

`command_list` counts good summaries and issues together. Enumeration and record
scanning share a time budget, serialized output is bounded, and continuation
points to the first unconsumed ID. The output adds `schemaVersion`, `hasErrors`,
`scanLimitReached`, `outputLimitReached`, and `timeLimitReached`, retaining the
existing filters, fields, order, and independent live `runningJobs` view.
A partial-error page retains good rows but marks MCP failure and returns CLI
**exit 1**, stopping later batch steps. Ordinary incomplete pages without record
errors remain successful and must be continued explicitly.

See the [job recovery contract](job-recovery.md). No new tool, dependency,
transport, scheduler, automatic command retry, permission change, or journal migration
was introduced.

## Tests and preserved failures

The baseline contained **296 tests**. The candidate adds **24 saved-record module
cases**, **seven CLI/MCP cases**, and **five publication-failure cases**, for
**332 tests**. The initial saved-record tests failed against the original reader;
the 31-case recovery suite subsequently passed. All five new publication tests
failed before their fix. Final candidate job
`wb015-full-tests-publication-20261021-01` passed **332/332**, exit 0, with no skips
or cancellations. The 36 new cases are a subset of 332, not additional tests.

Coverage includes identity/case mismatches, malformed/oversized records, field
validation, unknown-field stripping, linked/nonregular storage, injected read
replacement, legacy streams, interruption, page/time/output budgets, live-owner
authority, CLI error parity and stop-on-error, exactly-once replay, owner restart,
true child exits, delayed/transient/permanent publication, bounded failure
retention, and preserved fixture staging/unrelated edits.

Two early full runs exposed invalid placeholder metadata in a legacy-output
fixture and the interval between live completion and disk publication. A later
327-test run passed, but the first release attempt, `wb015-20261020-review01`,
failed that fixture again and issued **no validation receipt**. Its logs and
payload are retained unchanged; it is not an approved release.

A dedicated 40-job probe then captured **five actual EPERM rename failures**.
Those completed processes lost their final saved results and appeared interrupted
on the next read. The correction performs at most ten attempts for selected
record-publication errors, rechecking storage each time; commands are never
rerun. Success is published only after the final record is saved. Persistent
failures retain output and the actual child exit in the bounded owner map with
`JOB_RECORD_SAVE_FAILED`, instead of reverting to stale disk state.
The repeated real probe saved **40/40 results with zero errors**. The temporary
legacy-fixture wait loop was removed: it now directly asserts that a reported
passed job already has its saved result. See `persistence-probe.json`,
`persistence-probe-fixed.json`, and `persistence-correction.json`.

## Read-only compatibility

A bounded comparison of **1,016 real saved job records** found the same **1,016
summaries**, **zero issues**, and unchanged metadata byte hashes in old and new
implementations. Candidate known-ID status matched all 1,016 discovery summaries.
The comparison instantiated read-only job managers with no live jobs; it did not
start, cancel, replay, or resume real commands. Evidence:
`live-job-compatibility.json`.

The audit resumed an existing isolated WB-015 folder instead of overwriting it.
A no-overwrite preflight first refused its creation. The existing baseline,
reproduction, and candidate were then inspected and checked against all **165
source files**, **six configuration hashes**, and the original main Git index.
The live installation and prior candidates remain untouched during preparation.

Candidate: `C:\work\workbridge-wb015-20261020-01\candidate`.  
Model: **GPT-6 Astra Pro**.  
Reasoning level:

## Historical release and live-gate procedure

The following procedure was completed with release `wb015-20261021-review02`
and activation `wb015-activate-20261021-01`; it is retained as preparation history,
not a pending instruction. The earlier failed review01 release remains untouched.

Run all seven sealed-release gates, then the 36 focused tests from a production-only
installation without source/compiler/development dependencies. Preserve the seal.
Promote only reviewed, hash-guarded source changes; package/runtime installation
belongs to the independent updater. Before activation inspect active jobs and the
intended operation ID; do not restart the service from its own command worker.

After activation, run the installed complete suite without rebuilding. Verify
normal browser/CLI job launch, same-owner replay, output tails, real failure,
cancellation, catalog continuation, and restored fixture/staging. Keep private
corruption tests distinct from direct hosted tests; do not damage live records to
manufacture an error. Record deployed hashes, rollback backups, configuration,
source, staging, and actual tool results before declaring completion.

## Limits

Structural validation does not authenticate a deliberately forged, internally
consistent record. Fingerprint checks and live pagination are not atomic
filesystem snapshots or a guarantee against every external race. The output
budget describes the serialized result body, not repeated transport wrappers.
A process completing and final publication are distinct events; `passed` now
requires successful publication. Failed publication retained only in the current
owner cannot survive a restart that also loses unsaved memory.
Browser final-response rendering remains separate; no permanent display fix is
claimed by these tool-correctness tests.

## Completed release and deployed verification

The replacement seal passed all seven gates, including 332 tests, startup, updater,
formatting, generic acceptance, and the 51-tool probe. Manifest SHA256:
`A06C46999908538F792001FCC74785D4C888B6858FD997B861F89A0F88241108`.
An offline production-only installation passed all 36 focused cases without
application source, TypeScript, or Prettier. A second read-only compatibility
comparison against the sealed output checked 1,041 live job records with identical
summaries, zero issues, and unchanged metadata bytes.

Activation completed at **2026-10-21 00:21:02 EDT**, with no deployment or recovery
error. Fresh installed tests passed 332/332 without a rebuild. Browser/CLI
job replay executed once, preserved true child exit 7 and stopped its failed batch,
cancelled a CLI-started process, shared a five-page sparse catalog continuation,
and restored fixture hashes/staging. Source promotion used 18 explicit reviewed
files and left two package files to the updater. See [deployed evidence](wb015-deployment.md).
