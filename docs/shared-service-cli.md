# Shared-service CLI

Audience: AI coding agents and Workbridge maintainers  
Status: AI-007 is **deployed and retained in current 0.12.0-dev**. The original 0.7.0-dev candidate passed all seven local release checks; [WB-007 deployment acceptance](wb007-deployment.md) records browser/CLI tool interoperability and the browser response-rendering limitation.

## Purpose

Shared-service mode lets a noninteractive CLI call the same Workbridge owner used by browser Chat mode. Both clients then address the same workspace, change journal, jobs, and service-instance cursors. This closes the isolated CLI's ownership gap while preserving Workbridge path, hash, operation-ID, command, and recovery checks.

This is the AI-007 prerequisite for recoverable multi-file patching and resumable edit, validate, and review workflows. The separate [AI-008 patch engine](multi-file-patches.md) is deployed in 0.8.0-dev and retains this connection contract. [AI-009 workflow orchestration](resumable-workflows.md) is deployed in 0.9.0-dev; [WB-008](wb008-deployment.md) records cross-client continuation, retry, review, and cancellation.

Verification evidence is recorded in the [WB-006 validation report](wb006-validation.md). Candidate source and local verification do not establish the installed runtime state.

## Connection contract

The existing tunnel-launched stdio server remains the owner. `Start-Tunnel.ps1` sets `WORKBRIDGE_LOCAL_CLI=1`, causing that same process to publish an additional authenticated MCP endpoint on a random IPv4 loopback port. It does not replace the tunnel transport, start a daemon, or create a second Workbridge owner.

The owner writes its private endpoint descriptor below the configured service state. The descriptor includes the endpoint, workspace root, state path, version, instance ID, process ID, start time, and a random bearer credential. The entire private payload is encrypted with DPAPI. Public status and connection metadata omit the credential. The credential is never accepted as a CLI argument and must not be printed to stdout, stderr, diagnostics, or logs.

The connection boundary is:

- HTTP binds only to `127.0.0.1`; requests from another address are rejected.
- Requests require exactly one `Host` header matching the actual loopback port, no `Origin` header, and exactly one valid authorization header.
- The descriptor is encrypted for the current Windows user with DPAPI.
- The descriptor directory has protected ACLs granting full control only to the current user SID and `SYSTEM`.
- An OS file lock held by a guardian process on `ipc\owner.lock` establishes one live owner for the state. A second owner is refused.
- Client discovery uses one protected helper operation to prove the owner lock is active and decrypt the current-user DPAPI descriptor. It then validates descriptor shape, loopback URLs, state identity, owner PID, authenticated readiness metadata, and descriptor stability before connecting. Readiness and MCP requests reject redirects.
- The descriptor is removed on an orderly owner shutdown when it still belongs to that instance. A stale, missing, unreadable, or invalid descriptor is a connection failure; the CLI does not start or replace the owner.
- The endpoint accepts at most 32 simultaneous connections and bounds each HTTP MCP request body to 32 MiB. The CLI's request-file limit remains the smaller 4 MiB limit.
- If the guardian exits unexpectedly, the local endpoint closes and the failure is propagated so the root owner can close its backend and stdio transport.

Orderly shutdown first stops accepting local connections and removes the matching descriptor while retaining the exclusive owner lock. After the stdio connection closes and edit, job, and cache shutdown drains complete, the owner releases the lock last. This prevents a replacement owner from entering while the prior backend is still closing.

The descriptor helper source is `scripts/Local-Service-Descriptor.ps1`. The build copies it to `dist/Local-Service-Descriptor.ps1`, and the runtime resolves that packaged copy. Release preparation, manifest verification, update, and rollback therefore carry the helper with the runtime rather than depending on an editable source checkout.

Connected calls retain the owner's configured workspace roots and run with the owner's Windows rights. Browser plugin permissions govern browser calls. Local CLI access is independently authorized by the Windows account and its protected endpoint credential; it does not use browser confirmation prompts.

## Command shape

Shared-service mode requires an existing absolute state path:

```text
node scripts/workbridge-cli.mjs --service-state ABS_PATH [--root EXPECTED_ROOT] --input FILE [--timeout SECONDS] [--json]
node scripts/workbridge-cli.mjs --service-state ABS_PATH [--root EXPECTED_ROOT] --list-tools [--tool NAME] [--timeout SECONDS] [--json]
```

`--service-state` and `--state-dir` are mutually exclusive. `--root`, when supplied, is an expected-root guard. The CLI resolves it and refuses `ROOT_MISMATCH` before invoking any requested tool if it differs from the owner root.

Choose exactly one of `--input` or `--list-tools`. `--tool` requires `--list-tools`. The timeout is an overall 1–600 second deadline and defaults to 120 seconds. JSON Lines is the default output; `--json` makes the intended automation format explicit. Diagnostics belong on stderr.

The deployed service uses this state path:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --list-tools --json
```

The live 0.12.0-dev owner publishes this endpoint. Use the state path of the intended installation when running another service.

## Discover tools and schemas

List the running owner's actual catalog:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --list-tools --timeout 30 --json
```

Inspect one exact schema before constructing a mutation:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --list-tools --tool edit_file --timeout 30 --json
```

Success is one JSONL row:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "discovery": "tools",
  "serverVersion": "0.12.0-dev",
  "tools": [{ "name": "edit_file", "description": "...", "inputSchema": {} }]
}
```

An exact name that is not registered returns one failing row with `TOOL_NOT_FOUND` and exits 1. Discovery does not invoke the tool. Catalog pagination is bounded to 100 pages and 1,000 returned tools.

## Recover across CLI invocations

Use durable operation IDs for mutations. Suppose an earlier browser or CLI request used `operationId: "task-042-edit"`, but its response was lost. Do not invent a new ID or repeat the mutation first. Save this UTF-8 request as `C:\work\Scratch\inspect-task-042.json`:

```json
[{ "tool": "change_status", "arguments": { "operationId": "task-042-edit" } }]
```

Inspect the authoritative journal in a new invocation:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --input "C:\work\Scratch\inspect-task-042.json" --timeout 30 --json
```

If the record proves the change was applied and undo is intended, use a separate reviewed request such as `undo-task-042.json`:

```json
[
  { "tool": "change_status", "arguments": { "operationId": "task-042-edit" } },
  { "tool": "undo_change", "arguments": { "operationId": "task-042-edit" } }
]
```

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --input "C:\work\Scratch\undo-task-042.json" --timeout 30 --json
```

Guarded undo still refuses to overwrite a later edit. Reusing the same operation ID is valid only for the same request after uncertainty. A different mutation needs a new operation ID.

## Launch and wait in separate invocations

Connected CLI exit does not stop owner jobs. This permits a short launch call followed by later status, output, or wait calls. Save a launch request as `launch-validation.json`:

```json
[
  {
    "tool": "terminal_run",
    "arguments": {
      "cwd": "C:\\work\\Example project",
      "executable": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["tools/validate.mjs"],
      "requestId": "validation-042",
      "timeoutSeconds": 120
    }
  }
]
```

Launch it:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --input "C:\work\Scratch\launch-validation.json" --timeout 30 --json
```

The launch row reports the job ID and its current state. A zero exit from this launch-only invocation means the launch request succeeded; it does not prove the command passed.

To wait later, save `wait-validation.json`:

```json
[
  { "waitForJob": "validation-042" },
  { "tool": "command_output", "arguments": { "jobId": "validation-042", "tailChars": 4000 } }
]
```

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --input "C:\work\Scratch\wait-validation.json" --timeout 180 --json
```

`waitForJob` polls `command_status` and succeeds only when the job is `passed` with exit code zero. If the CLI deadline expires, it exits 124 without cancelling the owner job. Inspect the same job ID in another invocation before deciding whether to wait, cancel, or retry. A request ID may be reused only for the same command after uncertainty.

## Failure and retry contract

| Exit | Representative result                                                 | Meaning                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `ok:true` rows                                                        | Discovery or every requested step satisfied its CLI contract. A launch-only job can still be running.                                                                     |
| 1    | `TOOL_NOT_FOUND`, an MCP connection error, or a failing tool/wait row | Operation or connection failure. Later request-file steps are not run.                                                                                                    |
| 2    | `INVALID_INPUT`, `ROOT_MISMATCH`, or `RUNTIME_MISMATCH`               | Invalid arguments/setup, missing service-state path, wrong expected root, malformed request file, or candidate/runtime version mismatch. Requested operations do not run. |
| 124  | `DEADLINE` with `retryAttempted:false`                                | The CLI deadline elapsed. The owner and its jobs continue; inspect known IDs before retrying.                                                                             |
| 130  | `INTERRUPTED`                                                         | The CLI received SIGINT or SIGTERM. The owner and its jobs continue.                                                                                                      |

The client performs no automatic retry, owner auto-start, isolated-mode fallback, or job cancellation. It requires the running server version to equal the CLI package version. A mismatch is refused before request-file operations. A successful version and root check confirms connection identity; it does not weaken per-file hashes, expected Git HEADs, or operation-ID conflict checks.

A deadline always reports `retryAttempted:false` with the next step to inspect known operation or job IDs. An interruption or transport exception after request-file operations began provides the same guidance. This is necessary because the owner may have accepted a request even when the CLI did not receive its result.

Closing the CLI closes only its MCP client transport. Durable change records and completed job records remain discoverable through the owner across CLI invocations. In-memory cursors belong to the current service instance; reacquire them after an owner restart.

## Credential and input handling

- Never put the local bearer credential, tunnel key, or other secrets in arguments, request files, output, or logs.
- Point `--service-state` at the configured service state directory, not at `endpoint.dpapi` or a copied descriptor.
- Use absolute paths and literal argument arrays. Do not interpolate source text into shell commands.
- Keep large or structured inputs in the bounded UTF-8 request file. It accepts 1–100 steps and at most 4 MiB.
- Treat the workspace root as a Workbridge scope boundary, not an OS sandbox. Launched commands retain the owner's host access.

## Deployment boundary

The [WB-006 validation report](wb006-validation.md) records the original service foundation results. [WB-007 candidate verification](wb007-validation.md) and [deployment acceptance](wb007-deployment.md) record the installed 0.8.0-dev runtime, cross-client patch workflows, preservation, and browser display limitation. Future deployments still follow [WB-001](updates.md). [WB-008 deployment acceptance](wb008-deployment.md) records the 0.9.0-dev AI-009 resumable validation/review rollout. [WB-009 deployment acceptance](wb009-deployment.md) records 0.10.0-dev task-context interoperability. [WB-010 deployment acceptance](wb010-deployment.md) records 0.11.0-dev structured configuration editing. [WB-011 deployment acceptance](wb011-deployment.md) records current 0.12.0-dev filtered recovery history.
