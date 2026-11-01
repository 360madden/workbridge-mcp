# WB-016 — Explicit retained job-result recovery

Date: October 21, 2026, America/New_York.  
Release: **0.15.0-dev**, **52 tools**.  
Status: **Deployed and connected-CLI accepted.** Candidate and fresh installed suites passed 361/361; production-only execution passed 29/29 focused cases; all seven release gates passed. Existing browser tools and the shared CLI reached the same new owner. Direct browser invocation of the new named tool remains unverified because this conversation did not expose its schema. See [deployment evidence](wb016-deployment.md).

## Demonstrated gap

WB-015 retains a final job result in owner memory when final publication fails.
It correctly prevents false success and command replay, but the retained result
continues occupying one of six slots even after the storage problem is resolved.
The owner had no explicit operation to save that retained result and free its slot.
Restarting instead loses the unsaved result. The new regression suite first failed
against the unmodified 0.14.0-dev runtime because that recovery API did not exist.

## Delivered candidate

`command_retry_save(jobId)` reuses the existing shared owner, serialization,
bounded record reader, publication retry policy, and CLI request-file transport.
It retains the original final outcome separately from the public save-error
summary and binds recovery to the SHA256 of the original saved intent. It may
replace only the unchanged intent, or acknowledge exact already-final bytes.
Changed/missing/corrupt/linked storage is refused without discarding the result.
Readback is required before memory/capacity are released. No command is rerun,
no service restarted, no permission changed, and no missing result reconstructed.

A successful save returns the original command outcome. Saving a failed command
is not a passing command; callers must still inspect the nested job/exit code.
Repeated or concurrent callers observe the completed record without duplicate
execution or writes. A saved workflow can reconcile that original job with the
same attempt rather than launching a replacement check. See the
[complete contract](job-retry-save.md).

## Tests

The prior suite contained 332 cases. The candidate adds **21 module cases** and
**eight actual CLI/MCP cases**, for **361 tests total**. Focused suite
`wb016-focused-retry-save-20261021-02` passed 29/29. Complete suite
`wb016-full-tests-20261021-01` passed 361/361, exit 0, no failures, skips or
cancellations. The focused cases are a subset, not additional unique tests.

Coverage includes successful/failed/cancelled/timed-out outcomes, exact retained
stdout/stderr, duplicate and concurrent calls, all-six-slots recovery, repeated
save failure, later valid or unknown-field edits, malformed/missing/linked storage,
already-final bytes, active/finalizing jobs, unknown IDs, interrupted results,
owner shutdown, changes between transient attempts, post-write replacement,
real CLI stop-on-error, private owner restart, and workflow continuation without
an additional job attempt. Test repositories preserve staged and unrelated dirty
files. Fault injection uses disposable owners, not live journals.

The first CLI test run stopped during setup: a Windows absolute filesystem path
was supplied to Node's `--import`. A standalone probe captured
`ERR_UNSUPPORTED_ESM_URL_SCHEME`; the fixture now uses a `file:` URL. Its original
failed run and probe are retained. No runtime workaround or test skip was added.
The baseline failing regression evidence is also retained rather than counted as
a passing run. Review is by the implementing assistant, not an independent agent.

## Read-only compatibility and preservation

The old and candidate readers returned identical summaries for **1,088 saved jobs**,
with zero issues. Candidate known-ID status matched every summary. All metadata
hashes were unchanged. The comparison creates no live jobs and does not invoke
save recovery, replay, cancellation or workflow continuation on real records.
Evidence: `evidence/live-job-compatibility.json`.

The isolated candidate began from 171 source files, six configuration hashes and
the unchanged main Git index. Existing dirty source and earlier releases are
preserved. No Git staging, commit, push, credential or permission change is part
of this milestone. Candidate and evidence root:
`C:\work\workbridge-wb016-20261021-01`.

## Historical preparation gate procedure

The release, production-only, promotion and activation gates below were completed.
Actual coverage and the remaining direct named-browser-tool exposure check are
recorded in [deployment evidence](wb016-deployment.md). Do not repeat activation.

Seal a new release through the existing seven-gate release script. Run the 29
focused tests using production dependencies only and no source/compiler. Review
and promote only the exact hashed source delta; let the independent updater
install runtime/package files. Check running jobs and retained publication errors
before activation. Never start a second owner against live state or redeploy an
already-completed operation ID.

After activation, run all installed tests without rebuilding. Verify fresh
browser/CLI discovery of the new tool, same owner/version, valid saved-result
no-ops, error handling, unchanged job bytes, and fixture restoration. Deliberate
save faults and actual retained-result recovery are demonstrated in private-owner
MCP/CLI tests; do not damage live journals merely to manufacture hosted failure.
Record direct hosted coverage separately from private fault-injection coverage.

## Limits

An unsaved in-memory result lost on owner restart cannot be recovered by this API.
Hash/readback/type checks detect the tested races but are not an atomic filesystem
compare-and-swap or a guarantee against power loss and arbitrary external writers.
No journal migration, new dependency, scheduler, forced overwrite, automatic job
retry or broad maintenance framework was added. Browser final-reply rendering
remains separate from execution correctness.

Model: GPT-6 Astra Pro.  
Reasoning level:
