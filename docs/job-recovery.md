# Saved command jobs: recovery and bounded discovery

**WB-022, deployed 0.16.3-dev:** [guarded publication](job-publication.md) now applies original-intent and post-save verification to the first final save, not only explicit recovery. An observed conflict retains the original outcome and output. No command is rerun and no conflicting metadata is automatically repaired.

**WB-021, deployed 0.16.2-dev:** [completion reporting](job-completion.md) distinguishes terminal-looking requested cancellation/timeout from finished publication. Pending jobs cannot be retried by a workflow. A retained final-save failure is no longer completion-pending but still needs explicit result recovery; false alone is not proof of success or durable storage.

**WB-020, deployed 0.16.1-dev:** [worker-result validation](command-result-evidence.md) rejects missing, corrupt, oversized or mismatched evidence. The child exit remains unknown rather than guessed. Existing final-record save recovery preserves this failure and never reruns it. Historical finalized job records are unchanged.

**WB-019, deployed 0.16.0-dev:** [capacity diagnostics](job-capacity.md) identifies retained-result IDs without a history search and distinguishes occupied slots from running jobs. JOB_LIMIT includes the same bounded owner view. Saved inventory has explicit completeness and nullable unavailable counts. This is read-only guidance, not automatic recovery.

**WB-017, deployed 0.15.1-dev:** requests are owned after their initial intent is saved, including executable resolution and host setup. Startup errors and process results use the same publication/recovery path. Preparation cancellation prevents launch once the in-progress filesystem operation returns. See [contract and validation](wb017-validation.md) and [deployed proof](wb017-deployment.md).

**WB-016 addition, deployed in 0.15.0-dev:** after resolving a publication failure, use [explicit retained-result recovery](job-retry-save.md) to save the original outcome and free its slot without restart or command replay. The WB-015 behavior below remains the foundation; automatic repair is still not performed.

WB-015 / deployed **0.14.0-dev**. Preparation evidence is recorded in
[WB-015 verification](wb015-validation.md); fresh installed/browser/CLI proof is
recorded in [deployment acceptance](wb015-deployment.md). No new tool, transport,
dependency, background scheduler, automatic command retry, or journal migration is added.

## Shared saved-record validation

`command_status`, `command_output`, `command_cancel`, command/profile replay,
and `command_list` use the same bounded saved-job reader. The requested ID must
match the stored ID exactly, including case on Windows. Schema checks cover
request hashes, status, timestamps, exit-code/output types, optional execution
fields, and stream/output limits. Unknown historical fields are stripped from
returned summaries but are not rewritten or echoed into responses.

Job records contain retained output, unlike metadata-only change/workflow records.
Their existing **16 MiB serialized-file ceiling** is checked before opening or
allocating the buffer. Retained combined output remains capped at **1 MiB of
JavaScript string characters**; a tail is the tail of captured output, not proof
that the final process output was retained. Separate stdout/stderr remain
available where the record contains them. Legacy combined-only records continue
to return `OUTPUT_STREAM_UNAVAILABLE` for a separate-stream request.

The jobs catalog must be a regular directory. Individual records must be regular
files rather than links, junctions, or directories. Reads compare file
fingerprints before opening and after reading; a changed or replaced record is
refused. New/final record writes also recheck the storage types. These checks do
not authenticate deliberately forged, internally consistent records or eliminate
every possible race with an external writer.

Malformed, oversized, changed, linked, nonregular, or identity-inconsistent saved
records return **`UNREADABLE_JOB_RECORD`**. No saved command is launched to repair
them, and refused recovery leaves the record unchanged. Missing IDs retain
`UNKNOWN_JOB`; malformed caller IDs retain `INVALID_JOB_ID`.

## Live ownership and replay

The running owner's in-memory job remains authoritative. A stale or damaged disk
copy does not replace the active job's status, output, cancellation handle, or
live-job listing. Historical records marked running are reported as interrupted
by a new owner; they are never automatically resumed or rewritten merely by
reading them. Only the current owner can cancel its own running process tree.

Successful completion is not exposed as `passed` until its final record is saved.
Final publication may retry `EPERM`, `EACCES`, or `EBUSY` at most ten times, with
bounded pauses and storage-type checks before every attempt. This retries only
the record write: it never reruns the process, repeats a user edit, retries
exclusive job creation, or adds a scheduler. Other I/O errors are not retried.

If publication still fails, this owner retains the result and output, reports
`failed` with `errorCode: JOB_RECORD_SAVE_FAILED`, and preserves the actual child
exit code. It does not fall back to the stale on-disk running record. An identical
request ID returns that retained failure without executing again. A retained
publication failure consumes one of the existing six job slots, bounding memory;
it is not listed as an actively running process. Inspect/export its output and
resolve the storage problem before any separately authorized restart. No automatic
repair or restart is performed. A new owner can only read the old persisted
record, which remains interrupted rather than falsely successful.

Cancellation and timeout signals can still be visible before finalization; they
do not certify that all output is durably saved. Use the owner APIs rather than
copying private state. These guarantees do not assert atomicity against power
loss or arbitrary external changes after a successful publication.

Reuse a request ID only with the identical command request. A valid repeated
request returns the saved/live job rather than executing again. A different
request retains `ID_REUSE`. After an uncertain call, inspect the original ID
before deciding whether any new action is necessary. The shared CLI and browser
address the same owner; do not create a second owner against the live state.

## `command_list` paging and failures

The request keeps exact `project` and `status` filters, `offset`, `limit` (1–100),
and `scanLimit` (1–1,000). Ordering remains `id-ascending`. `nextOffset` counts
scanned IDs, not matched jobs. Empty filtered pages may still need continuation.

The result adds `schemaVersion: 1`, `hasErrors`, `scanLimitReached`,
`outputLimitReached`, and `timeLimitReached`. Existing `jobs`, `runningJobs`,
`issues`, `scanned`, `nextOffset`, `catalogTruncated`, `complete`, and `order` remain.

Good rows and per-record issues **share the requested page limit**. The separate
`runningJobs` array retains the owner's current matching active jobs even on a
partial disk scan. Directory enumeration and record reads share the scan-time
budget. The serialized result body stays within the 60,000-character budget;
this is not a bound on duplicated MCP wrappers or total network bytes. A single
summary too large for a fresh page becomes `JOB_ENTRY_LIMIT` and advances the
cursor rather than causing an infinite retry of the same entry.

A page containing a record issue preserves its good rows but is a failed MCP
operation. The CLI returns **exit 1** and does not execute later batch steps.
Ordinary non-error continuation remains successful; success alone does not mean
that the catalog is complete. Follow actual returned offsets and retain earlier
issues: a clean last page does not erase a problem on a preceding page. Catalog
storage itself being invalid is a whole-operation error, not an empty catalog.

`complete` is true only when no continuation, truncation, time/output limit, or
record issue remains on that page. Paging is live rather than an atomic snapshot.
Narrow a filter when a live-job view cannot fit; never silently discard active
jobs or assume a partial scan proves that none exist.

## CLI usage

Use the installed CLI version matching the owner. A request-file example is:

```json
[
  {
    "tool": "command_list",
    "arguments": { "project": "Example", "limit": 20, "scanLimit": 200 }
  }
]
```

Do not append writes to a batch whose discovery is expected to fail. Read the
returned error page, inspect good rows and issues, and make an explicit next
request using the returned continuation. Known-ID `command_status` and
`command_output` are still the shortest path when the ID is already known.

See [the CLI contract](workbridge-cli.md), [coding workflow](coding-workflow.md),
and [CLI-001 requirements](cli-requirements.md).
