# Workbridge CLI: isolated and shared-service automation

**WB-025 input consistency:** finish writing --input before invocation. The bounded reader rejects observed growth, identity/metadata changes and pathname replacement before connection or execution; failures use INVALID_INPUT / exit 2. Stable Unicode/BOM, 4 MiB and 100-step limits remain. Checks are not an atomic filesystem snapshot or writer lock. See [contract and validation](wb025-validation.md).

**WB-024 CLI enhancement:** error.requestContext preserves the current batch index, bounded tool name and supported durable IDs after a deadline, interruption or thrown transport failure. Its inspection object is read-only guidance, not an automatic action or proof of acceptance. Payloads and command arguments are not copied. The server/package version remains 0.16.3-dev. See [contract and verification](wb024-validation.md).

**WB-022 deployed: 0.16.3-dev**, 52 tools. Initial and recovery publication share conflict and post-save verification. Failed waits still stop the next step; recovery never repeats a command. See [contract](job-publication.md) and [deployment evidence](wb022-deployment.md).

The current deployed release is **0.16.3-dev**. Observed altered, missing or invalid job records retain the original outcome with JOB_RECORD_SAVE_FAILED. Explicit recovery still refuses unresolved conflicts. Preserve output before any service restart. No journal migration or automatic repair is introduced.

The installed **0.16.3-dev** CLI matches the live owner. Existing completionPending, workflow retry guards, real child exits and stop-on-error remain. The inherited direct named command_retry_save catalog check remains separate from its shared-CLI path. See [handoff](handoff-20261020.md).

Deployed **0.12.0-dev** adds [filtered recovery history](filtered-history.md) to `change_list` and `patch_list`: project/path/state filters, bounded metadata scans, per-record partial errors, and scanned-ID continuation. Existing summaries and recovery IDs remain; single-file listing switches from newest-time order to ascending operation ID. See [release verification](wb011-validation.md) and [browser/CLI acceptance](wb011-deployment.md).

Release **0.10.0-dev** introduced [task_context](task-context.md): scoped instructions, source/test excerpts and hashes, search hits, and related workflow/patch IDs in bounded read-only pages. It uses ordinary tool request files and the same CLI exit/JSONL conventions. Continue the outer selection with `nextOffset` and `expectedPlanHash`; section `followUp` requests independently continue file/search/catalog results. Use a CLI matching the owner version. See [WB-009 verification](wb009-validation.md) and [browser/CLI deployment acceptance](wb009-deployment.md).

This CLI implements [CLI-001](cli-requirements.md) for noninteractive local workflows using the same MCP operations as the bridge. Historical 0.6.3-dev acceptance covers isolated batches; [WB-007](wb007-deployment.md) records the subsequent shared-service browser/CLI acceptance.

Version 0.8.0-dev retains shared-service mode and adds [multi-file patch operations](multi-file-patches.md): preview, apply, status, combined diff, discovery, explicit resume, and guarded undo. Use the CLI matching the running owner's version. See [WB-007 release verification](wb007-validation.md).

## Choose a mode

| Mode           | Required connection arguments                                              | Owner and lifetime                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated       | `--root ABS_PATH --state-dir NEW_ABS_PATH`                                 | Starts one private stdio owner for this invocation. The state directory must not exist. Exit terminates its remaining jobs.                                                |
| Shared service | `--service-state EXISTING_ABS_PATH`, optionally `--root EXPECTED_ABS_PATH` | Connects to the already-running Workbridge owner. It never creates state or starts a server. CLI disconnect, timeout, or interruption does not stop the owner or its jobs. |

Choose exactly one connection mode. `--service-state` and `--state-dir` are mutually exclusive. In shared-service mode, `--root` is an optional expected-root guard; it is not a second workspace selection.

## Isolated-mode scope

The CLI owns one local stdio MCP server for the duration of a request-file batch. It requires an existing workspace root and a **new** private state directory. Existing state directories are rejected, including after a prior successful invocation. This prevents it from impersonating the live bridge's job owner.

The isolated mode does not connect to the running tunnel, read its local-service descriptor, or manage the deployed bridge's jobs. No listener, daemon, or scheduler is introduced for isolated operation. The existing pinned MCP client is a runtime dependency because the CLI uses it. Commands run with the current user's rights, as with `terminal_run`; a workspace root is not an OS sandbox.

Shared-service mode connects to an authenticated IPv4-loopback MCP endpoint owned by the existing tunnel process. It shares that owner's workspace, change journal, jobs, and service-instance cursors. It does not attach a second owner to the state directory. See [Shared-service CLI](shared-service-cli.md) for its security, discovery, failure, and recovery contract.

The Windows descriptor and owner-lock helper is maintained in `scripts/Local-Service-Descriptor.ps1` and copied into `dist/Local-Service-Descriptor.ps1` by the normal build. The runtime loads the packaged `dist` copy, so the release manifest, updater, and rollback cover it with the rest of the runtime payload.

## Invoke

The installed release is already built. For source development, build an isolated checkout using `npm ci` and `npm run build`. Do not build over a running installation without following the update workflow.

Before executing the batch, the CLI checks the compiled server's reported version against the package version. A mismatch exits with `RUNTIME_MISMATCH` and runs no requested operations. This catches newly integrated source alongside an older installed runtime. Use a matching built checkout or complete the update workflow; matching versions do not replace the release manifest's file-integrity checks.

From the built checkout:

```powershell
node scripts/workbridge-cli.mjs --help
node scripts/workbridge-cli.mjs --version
node scripts/workbridge-cli.mjs --root "C:\work\Example project" --state-dir "C:\work\Scratch\batch-001" --input "C:\work\Scratch\requests.json" --timeout 120 --json
node scripts/workbridge-cli.mjs --root "C:\work\Example project" --state-dir "C:\work\Scratch\catalog-001" --list-tools --tool edit_file --timeout 30 --json
```

The example paths are caller-selected placeholders. The root and state-directory parent must already exist; `batch-001` and `catalog-001` must not exist. The CLI does not create a project or replace state. `npm run cli -- <options>` is also available.

With the deployed owner running and local CLI access enabled, shared-service syntax is:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --list-tools --timeout 30 --json
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --input "C:\work\Scratch\requests.json" --timeout 120 --json
```

`C:\work\workbridge-mcp\.local` is the state path verified for the installed 0.13.0-dev service. Use the intended installation's state path for other owners.

The UTF-8 request file is a JSON array with 1–100 steps, at most 4 MiB:

```json
[
  { "tool": "workspace_info", "arguments": {} },
  {
    "tool": "terminal_run",
    "arguments": {
      "cwd": ".",
      "executable": "node",
      "args": ["-e", "console.log('validation complete')"],
      "requestId": "validation-001",
      "timeoutSeconds": 30
    }
  },
  { "waitForJob": "validation-001" },
  { "tool": "command_list", "arguments": { "status": "passed" } },
  { "tool": "command_output", "arguments": { "jobId": "validation-001", "tailChars": 4000 } }
]
```

Use actual installed executable paths when PATH resolution is uncertain. Arguments stay literal; do not interpolate source text into shell commands. Large edits belong in the JSON request file. Child commands receive closed stdin, so use their supported file-input options.

Any registered tool can be called with its actual MCP arguments. `waitForJob` polls `command_status` within the overall deadline and requires `passed` with exit code zero. It does not infer semantic review acceptance or gameplay correctness from a successful process.

Release **0.9.0-dev** introduced `workflow_create/status/list/resume/review/cancel` and the request step `{"runWorkflow":"saved-workflow-id"}`. The latter advances existing workflow steps and waits for jobs until `ready_for_review`, failure, or the CLI deadline. It never retries failed checks automatically. It uses the same operation module as MCP and preserves workflow/job IDs across CLI invocations. See [resumable workflows](resumable-workflows.md) for explicit retry, file-version checks, cancellation, limits, and coverage. Use the CLI matching the selected owner; the installed 0.13.0-dev owner exposes all six workflow tools.

Version 0.6.3-dev added [read_files](multi-file-reads.md) for bounded multi-file reads. Partial failures retain good file results, set the CLI step's `ok` to false, and exit 1. Error-free pages still require inspection of `nextOffset` and individual file cursors; the CLI does not follow them automatically. In shared-service mode, a valid cursor belongs to the same running service instance used by browser Chat; reacquire it after an owner restart.

For edits, use a current SHA-256 obtained by reading the intended file. All requests still perform the normal conflict checks. A batch can include `edit_file`, `change_status`, and `undo_change` with known operation IDs. There is no variable-substitution or scripting language inside the request file.

## Discovery

Catalog discovery is supported in both modes. Use `--list-tools` instead of `--input`; add `--tool NAME` to return one exact definition. Discovery never invokes the selected tool.

```json
{
  "schemaVersion": 1,
  "ok": true,
  "discovery": "tools",
  "serverVersion": "0.13.0-dev",
  "tools": [{ "name": "edit_file", "description": "...", "inputSchema": {} }]
}
```

An unknown exact name exits 1 with `TOOL_NOT_FOUND`. Discovery follows MCP catalog pagination with explicit page and tool-count limits. Inspect the returned schema instead of relying on stale examples.

## Results and lifetime

Stdout is JSON Lines by default; `--json` makes the intent explicit. Help and version are ordinary text. Each completed step returns:

```json
{ "schemaVersion": 1, "index": 0, "tool": "workspace_info", "ok": true, "result": {} }
```

`index` is zero-based. `result` contains the actual tool response, including structured edit-error details on failures. Setup/transport/deadline failures instead return `ok:false` and an `error` object. Diagnostics use stderr.

| Exit | Meaning                                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | All requested steps succeeded. A launch-only step may still have reported a running job.                                                                                                        |
| 1    | Tool/transport failure or unsuccessful waited job; later steps were not run.                                                                                                                    |
| 2    | Invalid arguments, request file, or setup, including an existing isolated state directory, missing shared-service state path, shared-service root mismatch, or source/runtime version mismatch. |
| 124  | Overall deadline reached.                                                                                                                                                                       |
| 130  | Interrupted via SIGINT/SIGTERM.                                                                                                                                                                 |

The deadline defaults to 120 seconds and accepts 1–600. In isolated mode, remaining session jobs are terminated when the CLI exits, including on failure or deadline. Use `waitForJob` before exit for work that must complete, or `command_cancel` for deliberate cancellation. Do not use isolated mode to launch persistent helpers.

In shared-service mode, CLI exit closes only that client connection. The existing owner and its jobs continue. A deadline exits 124, reports `retryAttempted:false`, and directs the caller to inspect known operation or job IDs before deciding whether to retry. An interruption or transport error after request-file operations began provides the same no-retry guidance. The CLI does not auto-start an owner, fall back to isolated mode, retry a request, or cancel owner jobs on disconnect.

An isolated private state directory is retained for inspection. Do not delete it until any required change backups or results have been retained. A new isolated invocation does not resume that session.

Shared-service invocations reconnect to the running owner and can inspect durable operation IDs and job IDs from earlier browser or CLI calls. After uncertainty, use `change_status`, `command_status`, or `command_output` before retrying. Reuse an operation or request ID only for the same request, as described in [coding workflow](coding-workflow.md). See [Shared-service CLI recovery examples](shared-service-cli.md#recover-across-cli-invocations).

## Verified coverage

Historical 0.6.3-dev regression and hosted evidence invoke isolated mode through Workbridge `terminal_run` against disposable Unicode/spaces paths. They verify job launch/wait/discovery/tail, read/edit/undo, structured errors and stop-on-failure, existing-state refusal, runtime-mismatch refusal before mutation, failed child exits, cancellation, and deadline process cleanup. See [WB-005 validation](wb005-validation.md).

Shared-service and multi-file patch implementation, release validation, and deployment are complete. [WB-007 deployment acceptance](wb007-deployment.md) records normal browser Chat/CLI tool workflows and the unresolved browser response-rendering issue. [WB-006](wb006-validation.md) records the original service foundation; [WB-007 candidate verification](wb007-validation.md) records pre-deployment tests. Resumable validation/review is deployed in 0.9.0-dev; [WB-008](wb008-deployment.md) records its current acceptance. Task-focused context gathering is deployed in 0.10.0-dev; [WB-009](wb009-deployment.md) records browser/CLI section and file-cursor handoffs, expected failures, and no implicit mutations. AI-011 is deployed in 0.11.0-dev: `config_preview` and `config_apply` use ordinary request files and existing patch status/diff/discovery/resume/undo. See [structured configuration edits](structured-config-edits.md) and [WB-010 verification](wb010-validation.md). The installed CLI and owner now match at 0.12.2-dev; [WB-013 acceptance](wb013-deployment.md) verifies deployed recovery and preservation. [WB-010 acceptance](wb010-deployment.md) verifies configuration replay, validation, failures, and guarded undo across browser Chat and CLI. New browser replies rendered in this acceptance; historical display failures remain in earlier reports.

[WB-011 acceptance](wb011-deployment.md) adds filtered-history continuation, discovery of moved files and configuration patches, partial-result handling, and restored fixtures. Browser response display failures recurred despite successful tools; they remain an intermittent presentation limitation.
