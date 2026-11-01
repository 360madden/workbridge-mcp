# Recover when a browser Chat reply does not display

Workbridge can finish a request even when ChatGPT displays **“This response
couldn’t load.”** Treat the operation result as unknown until you inspect its
durable state. A missing reply is not evidence that a write failed.

## AI recovery procedure

1. Retain the original operation ID, workflow ID, or command request/job ID.
   Do not generate a new ID and repeat the mutation to obtain a visible reply.
2. If the conversation shows generation has completed, reload that conversation
   once and let it finish loading. This recovered replies in the observed case
   below. It is a recovery attempt, not a guaranteed fix.
3. Inspect the same operation through the connected CLI. Use `change_status`
   for a single-file edit, `patch_status` for text/configuration patches,
   `workflow_status`/`workflow_review` for validation, or `command_status` and
   `command_output` for a command job. Read actual output and current conflicts
   before deciding whether to continue, undo, or retry.
4. If an ID was lost, use scoped `change_list`, `patch_list`, `workflow_list`, or
   `command_list`. Follow continuation and inspect all truncation/error fields.
   Match paths, operation metadata, and current state; do not guess an ID from
   a similar-looking result. Catalog state is recorded state, not fresh file
   verification.
5. Continue with the existing operation identity and the documented recovery
   method. A failed validation requires an explicit retry of its failed job;
   a later file edit remains a conflict. Do not overwrite it to make recovery
   appear successful.
6. Record tool correctness and browser presentation separately. A saved report
   should contain actual results, identifiers, hashes, and errors rather than
   only a prose success claim.

## CLI-first inspection

Save a UTF-8 JSON request under a named scratch directory. For a known patch,
replace `YOUR_EXISTING_PATCH_ID` with the original ID:

```json
[
  { "tool": "workspace_info", "arguments": {} },
  {
    "tool": "patch_status",
    "arguments": { "operationId": "YOUR_EXISTING_PATCH_ID" }
  }
]
```

Run from the installed Workbridge directory:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --input "C:\work\Scratch\inspect-existing-patch.json" --timeout 30 --json
$inspectionExit = $LASTEXITCODE
if ($inspectionExit -ne 0) { throw "Workbridge inspection failed with exit $inspectionExit; inspect its JSON result before any retry." }
```

The connected CLI discovers the current endpoint and checks the expected root
and version. Compare `workspace_info.localCli.instanceId` with the browser's
observed owner when available. An owner restart can change that identity while
durable operations remain inspectable; reacquire service-instance cursors.
Never copy the private connection credential into prompts or logs. Use the
[shared-service CLI contract](shared-service-cli.md) for connection and exit-code
behavior and [filtered history](filtered-history.md) for bounded discovery.

## Observed diagnosis — October 20, 2026 local time

After [WB-011 acceptance](wb011-deployment.md), all three new browser replies
failed to display even though their Workbridge operations and saved JSON reports
passed independent CLI checks. A one-line **tool-free** control also failed to
display in the same conversation. This demonstrates that the symptom can occur
without a Workbridge tool call; it does not identify its root cause.

Reloading the completed conversation restored all three acceptance replies and
the exact control text `WB-RENDER-CONTROL-20261020-01`. A subsequent read-only
`workspace_info` request displayed successfully and reported version
`0.12.0-dev`, owner `bec82774-852a-41c1-a1a7-db136478178e`, matching independent
inspection. There was no runtime deployment, service restart, model switch,
permission change, cache clearing, or extension change during this diagnosis.

Captured console diagnostics contained two Statsig cache warnings and no captured
error entries. That limited log does not establish causality or exclude an
uncaptured error. A Copy-button attempt returned unrelated earlier clipboard
text and was excluded as proof of the generated control response. The later
visible response and accessibility snapshot establish the control result.

Evidence is under `.local/browser-render-diagnostic-20261020-01/`:
`tool-free-before-reload.png` and its AX snapshot, `after-reload.png` and its AX
snapshot, `workbridge-read.png` and its AX snapshot, `console.json`, and
`verification.json`. Earlier failed-rendering acceptance evidence remains intact.
No permanent rendering fix is claimed.

This approach follows official OpenAI guidance to distinguish server, component,
and client failures and retain reproducible evidence:
[plugin troubleshooting](https://developers.openai.com/plugins/deploy/troubleshooting).
Workbridge does not supply a custom rendering component; widget-specific fixes
on that page are not evidence for a change to this server. Escalation outside the
user's workspace requires separate authorization to share the relevant evidence.
