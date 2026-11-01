# Command capacity and recovery diagnostics

WB-019 / deployed **0.16.0-dev**, retaining **52 tools**. Fresh direct browser/shared-CLI proof is recorded in [deployment evidence](wb019-deployment.md). This extends existing
`diagnostics` and `JOB_LIMIT` error details; it does not introduce a tool, scheduler,
command queue, retry loop, slot reservation, or automatic recovery.

## Owner capacity is not the running-process count

Call `diagnostics` directly or through the installed shared-service CLI:

```json
[{ "tool": "diagnostics", "arguments": {} }]
```

`jobs.capacity` is a compact snapshot of the current owner. Its versioned fields
are `schemaVersion`, `limit`, `occupied`, `available`, `inProgress`,
`retainedResults`, `closing`, and `jobs`. The current limit remains six.

`occupied = inProgress + retainedResults`; `available = limit - occupied`.
Each listed entry contains only `jobId`, `project`, public `status`, `kind`, and
`nextAction`. Entries are sorted by job ID and bounded by the owner capacity.
They exclude executable names, command arguments, error messages and output.

An `in_progress` entry may still be preparing, executing, cancelling, timing out,
or saving its final result. Its next inspection action is `command_status`.
A `retained_result` entry holds an original outcome whose final save failed;
its recovery action is `command_retry_save`, after inspecting and resolving the
storage problem. Read needed logs with `command_output`. These are guidance fields,
not authorization to execute recovery or to cancel another project's work.

The existing `jobs.runningJobs` keeps its prior meaning: jobs whose public status
is `running`. It can be zero while cancelled work is finishing publication or all
six slots hold unsaved results. Neither zero running jobs nor six available slots
establishes a healthy disk or successful admission of a future request. `closing`
explicitly reports shutdown; available slots are not reserved for the caller.

`JOB_LIMIT` now preserves the same capacity structure in `error.details.capacity`,
with `error.details.nextAction: "diagnostics"`. The rejected request is not created
or executed. MCP and CLI retain those details; a failed CLI batch still stops its
later steps. Identical request replay continues using the original job without
requiring a new slot. Explicit recovery releases a retained slot only after the
existing guarded publication succeeds. See [result recovery](job-retry-save.md).

## Saved inventory has separate completeness

`jobs.storedJobs` counts directory entries with valid job-record names, not validated
job contents, processes, successful commands, or results recoverable by this owner.
Diagnostics does not open or parse job records. Use `command_list` and known-ID
operations for validated history. Historical interrupted records consume no slot
in a new owner merely because they exist on disk.

Inventory enumeration is bounded by the existing scan-entry and cooperative time
budgets. `jobs.inventory` reports `complete`, `scannedEntries`, `limitReached`,
`timeLimitReached`, and `errorCode`.

When complete, the count describes the enumerated names. If a budget is reached,
`storedJobs` is a lower bound and `complete` is false. On unreadable, non-directory,
linked or failed enumeration, `storedJobs` is **null**, `complete` is false and
`errorCode` is `UNREADABLE_JOB_CATALOG`. This replaces the old misleading fallback
to zero. A genuinely missing catalog returns zero and complete true without
creating a directory. Callers must handle nullable counts and completeness.

An inventory error does not discard owner-capacity information or make the whole
health response unusable. `diagnostics` returns a valid diagnostic result, including
the inventory failure; automation must inspect those fields rather than treating
a successful diagnostic call as proof that every health component is healthy.

The owner snapshot is taken after inventory enumeration so its counts and listed
IDs describe one synchronous owner-map observation. Historical inventory and owner
capacity are not an atomic shared snapshot. A filesystem operation already awaiting
the operating system is not forcibly aborted by the cooperative scan-time budget.

## Verification and boundaries

Eighteen new tests cover idle/active/retained capacity, six occupied slots with no
running jobs, exact one-slot recovery, concurrent callers, success/cancellation
finalization, shutdown, missing/unreadable/linked storage, entry/time budgets,
iteration failure, and historical records. Four cases use real private MCP/CLI
owners, including structured schema discovery, error-detail parity and preservation
of staged/unrelated files. Deliberate faults remain confined to disposable state.

Preparation is recorded in [WB-019 validation](wb019-validation.md). Source tests
alone do not establish deployment or live browser behavior. No journal migration,
new dependency, permissions change, or recovery of already-lost owner memory is
included. Existing recovery and external-filesystem-race limitations remain.

Model: GPT-6 Astra Pro.  
Reasoning level:
