# WB-019 — Visible command capacity and bounded recovery diagnostics

Date: October 21, 2026, America/New_York.  
Release: **0.16.0-dev**, retaining **52 tools**.  
Status: **Deployed and verified.** Candidate and fresh installed suites passed 402/402; the 18 new cases also passed with production dependencies only. All seven release gates, direct browser/shared-CLI diagnostics and preservation checks passed. See [deployment evidence](wb019-deployment.md).

## Demonstrated gap

The 0.15.2-dev diagnostic view returned only stored-job and running-job counts.
Six unsaved results could occupy all command slots while runningJobs was zero.
JOB_LIMIT did not identify those original jobs, leaving a resumed caller to search
history instead of seeing the current owner's recovery candidates directly.
The inventory reader also allocated an unbounded directory listing, followed a
linked catalog and converted all enumeration errors to a misleading zero count.

Fourteen new module checks first failed against the unchanged baseline. After the
change, those fourteen and four real private-owner MCP/CLI checks passed. This is
an additive observability feature plus bounded/accurate inventory handling; the red
tests do not imply that all existing behavior was broken. Original failures remain
recorded separately from passing results.

## Delivered candidate

Existing diagnostics now has a structured output schema and a bounded owner-capacity
view: occupied/available slots, in-progress work, retained results, shutdown state,
and at most six compact job IDs with project, public status and next inspection or
explicit recovery action. The same view accompanies JOB_LIMIT error details.
No raw commands, arguments, error messages or captured output are added to that view.

A cooperative bounded inventory scan counts only candidate record names. Complete,
partial and unavailable counts are distinguished. An unreadable, linked or failed
catalog produces a null count and an explicit error while owner capacity remains
available. Callers must handle nullable storedJobs and inspect inventory.complete.
A successful diagnostics call describes the health report, not necessarily healthy
storage. See [the precise field contract](job-capacity.md).

Nothing automatically cancels another project's work, reruns a command, saves an
unsaved result, evicts a retained result, reserves a slot or restarts the service.
The existing explicit guarded recovery remains the mutation path.

## Validation performed

Focused job-capacity suite: **18/18 passed**, job
`wb019-capacity-green-20261021-01`. Full candidate suite: **402/402 passed**, job
`wb019-full-tests-20261021-01`, exit 0, no failures/skips/cancellations.
The new cases are included in the full count, not additional unique tests.

Coverage includes idle/missing storage, all-six-retained/no-running state, mixed
active and retained jobs, cancelled/successful finalization still occupying a slot,
concurrent recovery releasing exactly one slot, shutdown, denied/non-directory/
linked catalog, entry/time budgets, interrupted enumeration and saved historical
records. Real MCP/CLI cases prove schema discovery, read-only annotations,
structured capacity-error parity, failed batches skipping their next write, same
owner recovery and preservation of staged/unrelated dirty fixture files.
Fault injection is restricted to private disposable owners, not live service state.

## Preservation and historical preparation gates

The release, production-only, source promotion, activation and installed acceptance
gates below have completed; they are retained procedure, not pending instructions.
Do not repeat activation. The actual coverage is in [deployment evidence](wb019-deployment.md).

Candidate/evidence: `C:\work\workbridge-wb019-20261021-01`.
The starting inventory contains 183 source files, six configuration hashes and the
main Git index hash. The running service remained 0.15.2-dev during preparation.
An active RogueTV job was observed and was not cancelled. Before activation, check
again for other active jobs and unsaved retained results; do not interrupt them.

Use the existing seven-gate independent release/updater workflow. Test the two new
files using production dependencies only with no source/compiler/formatter. Review
and promote only the sealed hashed source delta, leaving runtime/package files to
the updater. Run the installed suite without rebuilding and verify direct browser
and shared-CLI diagnostics with a disposable active job and restored fixtures.
Do not create live publication faults just to manufacture a hosted recovery result.

No new tools, dependencies, permissions, credentials, broad Git staging, commit,
remote push or unrelated-project edits are part of this milestone. Implementation
and review are by the same assistant; no independent reviewer is claimed.

## Boundaries

Capacity is current-owner state, not a reservation or proof of successful future
admission. Inventory and capacity are separate live observations, not an atomic
filesystem snapshot. Name counts do not validate records. Scan-time bounds are
cooperative; an operating-system call already in progress is not forcibly aborted.
The inherited direct named command_retry_save catalog check remains separate from
usable shared-CLI recovery. No permanent browser rendering fix, power-loss guarantee,
or reconstruction of already-lost owner memory is claimed.

Model: GPT-6 Astra Pro.  
Reasoning level:
