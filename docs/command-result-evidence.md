# Worker-result evidence and uncertain command outcomes

WB-020 / deployed **0.16.1-dev**, retaining **52 tools** and six shared job slots. Fresh [deployment evidence](wb020-deployment.md) records installed and browser/shared-CLI acceptance.
This changes the internal command-worker result contract, not the public tool
catalog or the saved job-journal format. Source tests do not establish deployment.

## What a new result must establish

The owner supplies a job ID and a fresh UUID for the invocation through the existing
private stdin request. The worker emits schema version 1 with that identity,
`exitCode`, `timedOut`, and an optional bounded `errorCode`. Reader and writer share
the schema. Unknown fields, missing identity, unsupported versions and inconsistent
outcomes are rejected. A timeout or start/signal error has no invented child exit;
a normal process outcome has an integer exit code.

Result evidence is at most **4,096 UTF-8 bytes**. The reader checks the parent and
result path, rejects observed symbolic links, nonregular files and hard-linked
results, opens the file, reads no more than the observed size plus one byte, and
checks file identity/size/timestamps again. Its buffer is at most 4,097 bytes.
Invalid UTF-8 and malformed JSON are rejected. Short reads are consumed in a bounded
loop; file growth, truncation and tested replacement races invalidate the evidence.
The job and invocation must match the currently owned request.

A result already present before launch yields `COMMAND_RESULT_EXISTS` and no
command starts. The original file remains untouched. The worker creates its result
exclusively, so a result appearing later is not overwritten. No automatic deletion,
repair, repeat execution or migration is introduced.

## Public outcomes and next actions

| Condition | Public result and action |
| --- | --- |
| Valid success | `passed`, actual child exit 0; ordinary replay does not execute again. |
| Valid nonzero child exit | `failed`, actual exit retained; inspect output before explicitly choosing a retry. |
| Missing result after host exit | `COMMAND_RESULT_MISSING`, `failed`, child exit null. Inspect `command_output`; do not infer success or repeat automatically. |
| Invalid, mismatched, oversized or changed result | `COMMAND_RESULT_INVALID`, `failed`, child exit null. Retain evidence and output; the actual child outcome cannot be inferred from rejected evidence. |
| Result already exists before launch | `COMMAND_RESULT_EXISTS`, `failed`, child exit null. Inspect existing job/history and the result locally; no command was started. |
| Cancellation or timeout | The owner's cancelled/timed-out status retains precedence. Missing evidence during termination does not turn it into success. |
| Final job-record save fails | Existing `JOB_RECORD_SAVE_FAILED` retains the original outcome. After fixing storage, explicitly use `command_retry_save`, then inspect the saved failure. Recovery never reruns the command. |

All existing known-ID status/output/replay and CLI waiting paths remain applicable.
A failed CLI wait stops later batch steps. Saving invalid-result failure evidence
is not equivalent to making the underlying command successful.

The native Windows command-host exit is **not** the child exit. A private probe
observed host exit 0 while valid worker evidence recorded child exit 7. Do not use
host success as a fallback. An explicitly failed host also cannot validate claimed
child success. The trusted outcome in normal operation is the matching worker
record, not the wrapper's process status.

## Compatibility and boundaries

Finalized historical job records retain their existing schema and replay behavior.
They are not reinterpreted through old raw worker-result files. Existing recovery
IDs, output retention, workflows and six-slot capacity remain unchanged.

The invocation UUID correlates stale or mixed records; it is **not authentication**
against arbitrary same-user code that can rewrite both content and matching IDs.
No absolute protection against all filesystem races, blocked operating-system
calls, deliberate consistent forgery, lost owner memory or power loss is claimed.
The reader checks observed filesystem state, not an atomic filesystem snapshot.
Actual fault injection belongs in disposable owners, never live service journals.

See [saved-job recovery](job-recovery.md), [explicit result saving](job-retry-save.md),
[capacity diagnostics](job-capacity.md), and [WB-020 validation](wb020-validation.md).

Model: GPT-6 Astra Pro. Reasoning level:
