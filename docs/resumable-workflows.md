# AI-009 — Resumable validation and review

**WB-021, deployed 0.16.2-dev:** [command completion](job-completion.md) now gates retry/reconciliation and CLI waiting. A cancelled/timed-out job with completionPending still true is unfinished; WORKFLOW_JOB_PENDING refuses its premature retry without adding an attempt. Existing input, undo, cancellation and unsaved-result guards remain.

Deployed: **0.9.0-dev**. See [verification](wb008-validation.md), [browser/CLI acceptance and display limitation](wb008-deployment.md), [CLI requirements](cli-requirements.md), and [patch operations](multi-file-patches.md).

A workflow joins an existing recoverable patch to an immutable validation plan. Browser Chat and the connected CLI use the same workflow ID, patch ID, job IDs, saved output, and owner. Reconnecting does not repeat completed edits or checks. The existing patch journal supplies the edit plan and guarded undo; the existing job runner supervises commands. No scheduler, extra daemon, dependency, commit, or deployment action is added.

## Start and continue

1. Read the intended files and use their returned SHA256 values with `patch_preview` and `patch_apply`. Retain the patch operation ID. A partially applied forward patch can also be attached to a workflow.
2. Call `workflow_create` with that patch ID, the project directory, and 1–10 named validation checks. Creation records a plan without editing files or starting commands. All patch after-hashes, including expected absence for deletions, are included automatically.
3. Include other source, configuration, lockfile, or test inputs as explicit `inputs` with current hashes. File paths are workspace-relative or absolute inside configured roots, as with other file tools. They are **not relative to `project`**. Every patch/input file must be inside the selected project, with an existing parent directory.
4. Call `workflow_resume`. It explicitly continues a partial forward patch using saved bytes, reconciles existing jobs, and starts at most one pending check. Inspect returned state, job IDs, and `nextAction`. While a job runs, use `command_status` and `command_output`.
5. After each job ends, call `workflow_resume` to record its outcome and advance. The CLI's `runWorkflow` step performs this loop within its overall deadline. No work is scheduled after the caller disconnects beyond the already launched job.
6. Call `workflow_review` for current validation evidence, a page of the saved combined diff, and output tails. `ready_for_review` is a validation result, not human approval or permission to deploy.

Example request file, after creating `example-edit-001` in `Example project`:

```json
[
  {
    "tool": "workflow_create",
    "arguments": {
      "workflowId": "example-validation-001",
      "title": "Validate the example patch",
      "project": "Example project",
      "patchOperationId": "example-edit-001",
      "inputs": [],
      "checks": [
        {
          "name": "unit tests",
          "kind": "terminal",
          "executable": "node",
          "args": ["--test"],
          "timeoutSeconds": 120
        }
      ]
    }
  },
  { "runWorkflow": "example-validation-001" },
  {
    "tool": "workflow_review",
    "arguments": { "workflowId": "example-validation-001", "limit": 20000, "tailChars": 1000 }
  }
]
```

Use an owner and CLI with matching installed versions. These operations were introduced in 0.9.0-dev and remain available in later releases. Invoke:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\path\to\owner-state" --input "C:\path\to\workflow.json" --timeout 300 --json
node scripts/workbridge-cli.mjs --service-state "C:\path\to\owner-state" --list-tools --tool workflow_create --json
```

Replace the example state/request paths and project/patch IDs with the actual selected owner and saved patch. The `node --test` check assumes a Node project; choose appropriate project commands. Empty `inputs` covers only patch files. Add all other files needed for the coverage you intend to claim. Arguments remain literal, stdin is closed, and commands run as the local user with host/network access beyond the project directory.

Fixed profiles use `{"name":"tests","kind":"profile","command":"test"}` after inspecting `commands_list`. Creation saves the resolved executable, arguments, and timeout. Profile changes block continuation and current readiness; a new plan is required to adopt a changed definition. Terminal definitions are saved directly. Executable contents, PATH resolution, external services, environment, and unlisted files are not pinned by this feature.

## Recovery and discovery

| Operation         | Behavior                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow_create` | Save the immutable plan. Same ID/same request returns the existing workflow; different request returns `ID_REUSE`.                                                                           |
| `workflow_list`   | Discover IDs using exact project/path and last-recorded-state filters. Ascending ID order; continue `nextOffset` even after an empty filtered page. Inspect `issues` and `catalogTruncated`. |
| `workflow_status` | Read the plan, attempt history, authoritative job summaries, patch state, current input hashes, and next action. No jobs or edits are started.                                               |
| `workflow_resume` | Advance the patch/check sequence explicitly. Failure is not an instruction to silently invent a new workflow or job ID.                                                                      |
| `workflow_review` | Inspect status, a paged saved diff, and bounded tails for the latest attempt of each check. Older job IDs remain available through `command_output`.                                         |
| `workflow_cancel` | Persist cancellation before stopping the current job. Repeated calls finish an interrupted cancellation. Future steps remain disabled.                                                       |

Discovery filters use **recorded** state, which may lag job completion or later edits. `workflow_status` checks current evidence. `pending` can mean an unstarted check, a recoverable partial patch, or a completed job awaiting explicit reconciliation. `validating` means a job is running. `failed`, `stale`, and `blocked` require inspection. `cancelled` prevents further execution; `undone` means the patch was undone. No workflow automatically reapplies an undone patch.

For a failed, timed-out, cancelled, or interrupted check, inspect its output, address the cause, and pass the **exact failed job ID**:

```json
[
  {
    "tool": "workflow_resume",
    "arguments": {
      "workflowId": "example-validation-001",
      "retryJobId": "the-job-id-returned-by-workflow-status"
    }
  },
  { "runWorkflow": "example-validation-001" }
]
```

The retry token creates at most one replacement attempt. Replaying it returns current state, including after that replacement finishes. A retry of a later failed attempt must use that later job ID. Ten attempts per check are retained. Already passed current checks are not rerun. A running job must end or be explicitly cancelled before another workflow check starts.

Each launch intent is durably saved before calling the job owner. If the response is lost, continuation reconciles that same job ID and request identity. A job journal is published before process launch; an unexecuted intent with no job can start on continuation. Missing evidence for an already recorded execution blocks automatic rerun. Restarted jobs are reported through the existing job supervisor as interrupted or cancelled and require explicit retry.

CLI `runWorkflow` exits 0 only at `ready_for_review`, 1 on an unsuccessful workflow/tool result, 2 on invalid setup/version mismatch, 124 on deadline, and 130 on interruption. JSON Lines retain schema version 1; diagnostics go to stderr. Deadline output identifies the active workflow. In connected mode, closing the CLI leaves the owner and its current job running. Private CLI mode still ends its owner/jobs on exit and refuses reuse of existing private state; use connected mode for cross-invocation continuation.

## WB-014 — Bounded workflow discovery

The **deployed 0.13.0-dev release** makes workflow discovery use the existing bounded
history pager. See [WB-014 verification](wb014-validation.md) for current release
and deployment status. Tool names, request fields, IDs, journal format, exact
project/path filters, and recorded-state semantics are unchanged.

The response adds `hasErrors`, `complete`, `scanLimitReached`,
`outputLimitReached`, `timeLimitReached`, and `order: "workflowId ascending"`.
`limit` counts good summaries and issues together, up to 50. The serialized result
body is bounded to 60,000 characters, and the existing 20-second scan budget covers
catalog and record scanning. Continue the returned `nextOffset`, not an offset
calculated from the number of matches. Empty filtered pages can continue.

Unreadable/corrupt records retain valid summaries, set `hasErrors: true`, and
produce an MCP error result and **CLI exit 1**. Later steps in that CLI batch do
not run. The returned data still contains issues and continuation. Inspect it
before explicitly continuing discovery. A page with only ordinary continuation
is not a failure; **exit 0 does not prove the whole catalog was exhausted**.
Accumulate issues across all pages. A clean last page cannot erase earlier errors.
Check `complete` together with earlier pages and all truncation/time/output flags;
live pagination is not an atomic snapshot under concurrent additions or changes.

Known-ID reads, replay, resume, review, and cancellation reject linked workflow
catalogs and nonregular metadata before using the record. Reads remain bounded
to 128 KiB and check file fingerprints before/after reading. Saves recheck storage
types. Discovery reports linked metadata records instead of silently omitting them.
No journal repair, migration, automatic retries, or permission changes are added.
These checks do not authenticate forged internally consistent metadata or make
external filesystem races atomic.

## File versions and recovery boundaries

The plan's expected hashes never advance to accept newer edits. Before validation, after observing completion, and during status/review, Workbridge checks the listed files. Each attempt records a digest of their hashes and file fingerprints (identity, size, modification time). A changed fingerprint invalidates an earlier attempt even if the original text is restored. Once the planned bytes match and the job has ended, an explicit retry can validate the new file versions. Changed content requires preserving the newer edit and preparing an appropriate fresh patch/plan, or deliberately restoring the intended bytes outside the workflow.

This is **not an atomic filesystem snapshot or continuous monitor**. Files are read sequentially. External writers can race a check; restoring both bytes and metadata can evade a before/after observation. Unlisted/new files, directory membership, generated dependencies, external services, and command side effects are outside the validation coverage. Review output states this scope explicitly. No percentage or whole-project validation claim is inferred from a process exit code.

Cancellation does not undo edits or command side effects. Inspect `patch_status` and call `patch_undo` separately for guarded undo. Undo refuses later edits. Command side effects are not journaled by the patch system. There is no automatic rollback, conflict merge, commit, push, or deployment. A workflow never changes Git staging itself; user-selected commands can do so.

## Bounds and storage

- At most 10 checks, 10 attempts per check, and 200 additional watched inputs plus up to 20 patch files.
- 32 KiB request/resolved-plan limit; 128 KiB journal limit. Inputs retain the existing 16 MiB per-file hash limit, with a 64 MiB aggregate input-size budget per inspection.
- Existing six concurrent service-job slots, 1–600 seconds per check, closed stdin, retained/truncated output, process-tree cancellation, and request-ID protections remain in effect.
- Review diff pages are at most 60,000 characters; tails are at most 2,000 characters for each of 10 checks. `nextOffset`, `diffComplete`, and output truncation must still be checked.
- Discovery scans at most 20,000 directory entries and 1,000 workflow records per page. The deployed 0.13.0-dev release caps good summaries plus issues at 50 and the serialized result body at 60,000 characters, with explicit time/output/completeness flags. Pagination remains a live catalog.
- Protected `<state>/workflows/<workflowId>.json` stores schema 1, workspace identity, immutable plan/hash, launch intents, and attempts. It reuses patch/job journals and output rather than copying them. Records persist until deliberate operator cleanup; no automatic retention purge is added.

Local tests and CLI/MCP transport tests are separate from normal browser Chat acceptance. The [deployment record](wb008-deployment.md) confirms cross-client tool workflows, explicit retry, stale refusal, cancellation, and guarded undo on disposable files. That historical acceptance recorded browser final-response display failures; browser-authored result files and independent CLI checks established its tool outcomes. No permanent rendering fix is inferred from later tool tests.

## WB-018 — Recover publication before retry

Deployed 0.15.2-dev reports an unsaved retained job result as blocked with WORKFLOW_RESULT_UNSAVED. Do not use retryJobId to replace that result: preserve command_output, resolve storage, explicitly call command_retry_save with the original job ID, then inspect workflow_status and resume without a retry token. A true failed command can still be retried explicitly after its outcome is saved. No automatic save or command execution occurs. Changed inputs, cancellation and undo retain precedence. See [verification](wb018-validation.md).
