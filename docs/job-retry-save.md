# Explicit recovery of a retained final job result

WB-016 / deployed **0.15.0-dev**, connected-CLI accepted. Direct named-tool exposure in the current ChatGPT conversation remains unverified; see [deployment coverage](wb016-deployment.md). Adds **`command_retry_save`** to the existing
shared owner and CLI. This operation saves a result; it never executes a command,
restarts a service, changes permissions, or repairs an invented/missing result.
See [verification](wb016-validation.md) and the [saved-job contract](job-recovery.md).

## When to use it

After `command_status` or `command_output` reports `JOB_RECORD_SAVE_FAILED`,
inspect and resolve the underlying storage problem without changing the job's
record. Preserve needed output before restarting the owner. Then explicitly call:

```json
[
  { "tool": "command_retry_save", "arguments": { "jobId": "THE_ORIGINAL_JOB_ID" } }
]
```

Use the installed CLI matching the running service, with its existing
`--service-state` and `--input` options. The same tool and job ID are available to
browser MCP callers. Discovery advertises its input/output schema and mutation
annotations. There is no additional listener, dependency, authentication flow,
permission requirement, task scheduler, or automatic command retry.

## Meaning of success

The result has `schemaVersion: 1`, `publication: "saved" | "already_saved"`,
`commandRerun: false`, and `job`, containing the original job summary.

`publication: "saved"` means this call wrote and verified the retained final
record. `already_saved` means the exact final bytes were already present, or a
valid terminal record was already saved and no retained result needed recovery.
Repeated calls do not rewrite that completed record. The original success,
failure, cancellation or timeout, child exit code, timestamps, request identity,
combined output, and separate streams are preserved. A successful recovery frees
its retained-result slot within the existing six-job capacity.

**Publication success is not command success.** A failed child with exit code 7
can be saved successfully while the returned `job.status` is still `failed` and
`job.exitCode` remains 7. CLI exit 0 describes saving the record, not passing the
original command. Continue to inspect the job or use `waitForJob` when a later
step requires an actually successful command.

A saved workflow can recheck the repaired original job and continue without a new
attempt. Use `workflow_status` / explicit `workflow_resume`, not `retryJobId`, to
reconcile a successfully repaired publication. A real failed command still needs
the workflow's separate explicit retry policy.

## Guards and limits

The current owner retains the original final result separately from its public
save-failure diagnostic. It also retains the SHA256 of the initial saved intent.
Recovery accepts only that original intent's exact bytes or its exact final bytes.
It refuses changed, missing, corrupt, oversized, nonregular, or linked records and
catalogs. The guard is rechecked before each bounded publication attempt; final
bytes are reread and verified before memory and capacity are released. A conflict
never authorizes overwriting the record with a hash copied from an error.

Concurrent recovery calls are serialized with command admission. One publishes;
other callers observe the completed record without another write. Normal process
finalization is not a recovery opportunity. Closing waits for already-started
recovery and rejects new work. The existing at-most-ten transient record-write
attempts remain bounded; commands and exclusive job creation are never retried.

On a persistent write failure, the operation fails, the CLI stops later steps,
and the current owner keeps the original result, output, and occupied slot. A
caller may explicitly try again after resolving the cause. No force mode, implicit
record creation, repair loop, slot eviction, or silent result reconstruction exists.

| Error | Meaning |
| --- | --- |
| `JOB_SAVE_NOT_READY` | The command or its ordinary final publication is still active. |
| `JOB_SAVE_CONFLICT` | The expected intent/final bytes changed or disappeared. |
| `UNREADABLE_JOB_RECORD` | Saved metadata or its storage is invalid, changed, linked, or oversized. |
| `JOB_RECORD_SAVE_FAILED` | The explicit save still failed; the owner retains the result. |
| `JOB_RESULT_UNAVAILABLE` | This owner has no recoverable final result for the interrupted record. |
| `UNKNOWN_JOB` / `INVALID_JOB_ID` | The ID is missing or malformed. |
| `SERVER_CLOSING` | Shutdown has started; new recovery is refused. |

A restart before recovery loses the unsaved in-memory result. The new owner must
refuse reconstruction rather than relabel an interrupted record successful or
rerun its command. Recover before restarting when the original owner is available.
Normal completed saved records remain readable after restart.

Hash, type and fingerprint guards are not an atomic filesystem compare-and-swap
against arbitrary external writers, authentication of forged journals, or a
power-loss guarantee. Tested before/during/after-write races are detected; an
external change after the last verification cannot be ruled out. Failure injection
belongs in disposable private owners, never in the real service's journals.

Model: GPT-6 Astra Pro.  
Reasoning level:
