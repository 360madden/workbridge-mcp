# WB-014 — Bounded workflow discovery and reliable partial failures

Date: October 20, 2026 EDT (October 21 UTC).  
Release: **0.13.0-dev**, retaining **51 tools**.  
Status: **Deployed and tool-accepted.** All seven sealed release gates passed. Fresh installed tests passed 296/296; production-only tests passed 17/17. See [deployment acceptance](wb014-deployment.md). The sealed payload retains its preparation-time document.

## Reproduced defects on 0.12.2-dev

Disposable owners and state demonstrated three problems:

1. A `workflow_list` request with `limit: 1` returned **1,000 corrupt-record issues** and a **206,179-character** result, exceeding the 60,000-character result budget. Only good rows consumed the old limit.
2. A listing with one corrupt record and one valid workflow returned a successful MCP result and **CLI exit 0**. The batch executed a subsequent sentinel write despite the catalog error.
3. A directory junction substituted for the workflow catalog was accepted by known-ID status and cancellation. Cancellation rewrote the linked journal instead of refusing the storage type.

Evidence is retained under `C:\work\workbridge-wb014-20261020-01\evidence`:
`reproduction.json`, `oversized-catalog-raw.json`, `partial-batch-raw.json`, and
`linked-workflow-raw.json`. Only the disposable reproduction state was changed;
no real saved workflow was corrupted or cancelled.

## Correction

Workflow discovery reuses the existing bounded history pager. Good summaries and
issues share the caller's page limit. Result-size, scan-time, directory-entry,
and record-scan budgets retain explicit continuation. The existing request fields,
exact project/path filters, recorded-state meaning, IDs, and journal format remain.

The response adds `hasErrors`, `complete`, `scanLimitReached`,
`outputLimitReached`, `timeLimitReached`, and `order: "workflowId ascending"`.
A per-record error retains good data but marks the MCP operation unsuccessful and
returns **CLI exit 1**, stopping later batch steps. Ordinary continuation without
errors remains successful; callers must inspect completeness and retain earlier
issues across pages. A clean final page does not erase earlier errors.

Known-ID operations reject linked catalog directories and nonregular/linked
metadata before acting. Reads check file fingerprints before opening and after
reading within the existing 128 KiB journal limit. Saves recheck storage types.
No automatic retry, journal repair/migration, permission change, scheduler,
new dependency, or additional tool is introduced. See the
[workflow contract](resumable-workflows.md#wb-014--bounded-workflow-discovery).

## Tests and compatibility

Eleven new module tests cover bounded issue pages, long serialized summaries,
continuation with no dropped/duplicate IDs, exact filters, scan/time/catalog limits,
invalid direct paging, linked catalogs and metadata, corrupt/oversized records,
a deterministically injected metadata-replacement race, reconstruction, and
metadata-only discovery when watched inputs changed. Six real CLI/MCP tests cover
advertised output fields, identical partial results, stop-on-error, explicit
continuation, task-context retention, owner restart, linked-storage refusal,
and preserved Git staging/unrelated dirty files.

The initial regression tests failed against the old implementation. The first
full build then caught an unused import left by the refactor; it was removed.
The subsequent full build and suite passed **296/296**, with zero failures,
skips, or cancellations: **279 existing tests plus 17 new cases**. Initial failed
build/test evidence is retained, not overwritten or counted as a passing gate.

A read-only comparison of all **seven live workflow metadata records** returned
the same seven summaries with no issues. All metadata hashes were unchanged.
The compatibility harness forbids calls to job/patch managers and does not resume,
cancel, review, or modify real workflows. Evidence:
`live-workflow-compatibility.json`.

The isolated baseline preserves **161 source files**, six configuration hashes,
and the main Git index. Candidate:
`C:\work\workbridge-wb014-20261020-01\candidate`.
Prior releases, acceptance evidence, the live installation, and existing worktrees
remain unchanged during preparation.

## Limits and release gates

The output bound applies to the serialized result body, not duplicated MCP wrapper
or transport bytes. Pagination is live, not an atomic snapshot. File-type,
fingerprint, and checksum checks do not authenticate deliberately forged consistent
records or eliminate every external filesystem race. Real Windows directory
junctions were tested; no file-symlink privilege was enabled. Browser reply-display
behavior remains separate from tool execution.

The following release procedure is retained as history; these gates are now complete.
Before deployment, require all seven sealed-release gates and production-only
execution of the 17 new tests. Promote only the reviewed source delta with current
hashes; let the independent updater install the two package files and runtime.
After activation, verify installed tests, tool catalog/output fields, and normal
browser/CLI workflow discovery and continuation on disposable projects. Keep
isolated corrupt-record tests separate from hosted checks; do not corrupt the
live workflow catalog to manufacture a hosted failure.

Model: GPT-6 Astra Pro.  
Reasoning level:
