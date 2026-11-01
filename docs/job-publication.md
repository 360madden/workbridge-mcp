# Guarded final-result publication

WB-022 / deployed **0.16.3-dev**, retaining **52 tools** and six shared command slots. [Deployment evidence](wb022-deployment.md) records installed and hosted acceptance separately from private fault tests.

## One save contract for normal completion and recovery

The first final-result save now uses the same original-intent hash guard as explicit `command_retry_save`. Before each publication attempt, Workbridge reads the current bounded job record and accepts either the original saved intent or the exact final bytes. A missing, corrupt, oversized, nonregular or changed record is not silently recreated or replaced after it is observed.

After saving, Workbridge rereads the record and compares its SHA256 with the intended final bytes. It releases the original in-memory outcome only after this verification. A successful filesystem call alone is not proof that the expected result was retained. Identical final bytes are acknowledged without rewriting the record.

Normal completion and explicit recovery share one implementation. The original process outcome, output, durable request ID and completionPending semantics remain. No journal schema, dependency, public tool, automatic command retry or scheduler is added.

## Conflict behavior

If normal publication cannot verify the record, the owner reports **JOB_RECORD_SAVE_FAILED**, retains the actual child outcome and output, and keeps the job slot occupied. An exit code of zero still does not make the publication failure successful. Status and replay return the retained failure; replay never starts another command. Diagnostics lists the original retained-result ID.

Explicit recovery still refuses changed or missing intent with **JOB_SAVE_CONFLICT**, and invalid metadata with **UNREADABLE_JOB_RECORD**. It does not discard the result or override another writer. Preserve command_output and inspect the conflicting evidence before deciding how to resolve storage. Do not automatically replace a newer journal or restart the owner just to free a slot; retained memory is lost on restart.

When the original intent is legitimately available again, explicit recovery saves the held original result without rerunning its command. A failed child stays failed, cancellation/timeout retain their states, and a prelaunch error retains its error code. A workflow remains blocked by WORKFLOW_RESULT_UNSAVED until publication is resolved; normal explicit retry policy applies afterward.

The tests restore only their own disposable fixtures to prove recovery. That test procedure does not authorize rewriting a real conflicting record.

## Boundaries and verification

Before/after checks detect observed conflicts; they are **not an atomic cross-process compare-and-swap**. Another process can still change bytes between filesystem calls or after verification. There is no continuous monitoring, tamper authentication, lost-memory reconstruction or power-loss guarantee.

Private regression tests cover changed/missing/corrupt/oversized/nonregular intent, post-save replacement/removal, an acknowledged write with no changed bytes, a transient rename failure followed by conflicting metadata, exact-final-byte replay, ordinary outcomes, real MCP/shared-CLI recovery, and workflow blocking. The live acceptance uses normal disposable commands, never deliberately damaged service journals.

See [saved-job recovery](job-recovery.md), [explicit recovery](job-retry-save.md), [completion state](job-completion.md), [capacity](job-capacity.md), and [WB-022 validation](wb022-validation.md).

Model: GPT-6 Astra Pro. Reasoning level:
