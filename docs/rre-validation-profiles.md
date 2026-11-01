# RRE validation profiles (AI-004)

Configured: 2026-10-20 on Workbridge 0.6.2-dev; preserved by the subsequent 0.6.3-dev update.

Two fixed profiles reduce repeated command construction for AI workflows. They reuse RRE's existing Node entry points, with explicit executables, project working directories, literal arguments, real exit codes, and Workbridge's existing job supervision. This change adds configuration and documentation only.

## Available commands

Call `commands_list(project="rre")` to inspect the current configuration. The installed absolute project key is `C:/work/rre`; `command_run` resolves that project as its working directory.

| Profile | Native CLI arguments to `C:/Program Files/nodejs/node.exe` | Timeout | Output |
| --- | --- | --- | --- |
| `roadmap_validate` | `["tools/validate-roadmap.mjs"]` | 30 seconds | JSON with `ok`, task counts, and `failures`; exit 0 on success, 1 for consistency failures. |
| `review_adapter_test` | `["--test","--test-reporter=tap","tools/agents/validation/test_agent_review_runner.mjs"]` | 60 seconds | Native TAP with test/pass/fail counts; nonzero exit on failure. |

The second profile tests the review adapter's contracts and response classification. It does not request a model review or run the unified research suite. The inspected suite had 17 tests; that count is evidence for this revision, not a permanent acceptance threshold.

Use a new request ID for each intended run. Example MCP arguments:

```json
{
  "project": "rre",
  "command": "roadmap_validate",
  "requestId": "rre-roadmap-UNIQUE_RUN_ID"
}
```

Replace `UNIQUE_RUN_ID` before execution. After an uncertain response, reuse the original ID only for that same request. Inspect `command_status` and `command_output`, including the terminal status and exit code; an accepted launch is not a passed validation. `command_list` can recover an ID, and `command_cancel` provides cancellation.

## CLI automation

From `C:\work\rre`, the equivalent native PowerShell invocations are:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'tools/validate-roadmap.mjs'
# Inspect $LASTEXITCODE before starting another command.

& 'C:\Program Files\nodejs\node.exe' '--test' '--test-reporter=tap' 'tools/agents/validation/test_agent_review_runner.mjs'
# Inspect $LASTEXITCODE and the TAP results.
```

For [Workbridge batch CLI](workbridge-cli.md) automation, use `terminal_run` steps with those same literal arguments and `cwd`, followed by `waitForJob` and `command_output`. Its fresh private state does not inherit the deployed service's profiles. Do not point the batch CLI at the deployed `.local` directory to reach them.

The examples are execution entry points, not permission to enter another RRE lane or bypass its roadmap. Confirm project ownership and that the current code is trusted before running real-project validation.

## Unified offline gate

Keep `tools/validate-research.py` on `terminal_run`: it requires `--output-dir` to name a directory that does not exist. Its script creates that directory with no-clobber semantics and retains `validation.json` plus per-group logs. A fixed profile cannot supply a new path per invocation.

Use the existing `C:/work/rre/.venv/Scripts/python.exe`, `cwd: "rre"`, and literal arguments:

```json
[
  "-B",
  "tools/validate-research.py",
  "--output-dir",
  "C:/work/rre/artifacts/validation-UNIQUE_RUN_ID"
]
```

Generate a fresh run ID, verify that the parent directory exists, and use `timeoutSeconds: 600` with a separate unique job request ID. The Workbridge limit can expire before all of the validator's internal group deadlines; report that as incomplete and inspect the retained receipt. Never reuse or delete an earlier evidence directory to make a rerun succeed.

The validator uses RRE's existing Python environment and a separate existing image-capable interpreter when available. Its optional `--image-python` selects an explicit existing interpreter. Missing dependencies fail; this change installs none. Validate the current suite inventory and runtimes before authorized use.

Its stdout contains per-group JSON lines and a final summary; failures can also appear as JSON on stderr. Inspect the process exit, final status, `sourcesUnchanged`, per-group results, and saved receipt. Exit 0 indicates a passing gate, 1 indicates a failed gate, and 2 indicates a setup/input error. This gate was inspected but was not executed by the Workbridge configuration task.

## Configuration and recovery

The installed definitions are in `C:/work/workbridge-mcp/.local/commands.json`. [The checked example](examples/rre-commands.json) contains only the two added profiles; it is not a replacement for the whole live configuration. Preserve other project keys and profile definitions during future changes. Existing relative project keys take precedence over absolute keys, so inspect both before changing a profile.

Workbridge reads profiles for each list/run request; no service restart or tool-catalog refresh is needed for this configuration-only change. Runtime, dependencies, tunnel settings, and RRE files were unchanged.

The exact prior configuration and install receipt are retained in:

`C:/work/workbridge-mcp/.local/wb005b-20261020-01/`

Recovery must compare the current configuration hash with `configuration.json` first. Restore `commands.before.json` only while the current configuration still equals the recorded `afterHash`. If another change has occurred, preserve it and remove only these two unchanged definitions after reviewing both project keys.

## Verification evidence

- Existing Workbridge regression suite: **98/98 passed** in the isolated worktree before configuration activation.
- Disposable copy at `C:/work/Workbridge RRE profiles ü 20261020-01`: roadmap success, 17/17 adapter tests, deliberate roadmap/test failures with exit 1, and completed-ID retry without rerunning.
- The same commands passed through fixed profiles in an isolated MCP owner and through the deployed Workbridge launching the installed batch CLI. The latter returned six JSONL rows with `ok: true`; both waited jobs exited 0.
- Source SHA256 checks confirmed all five copied RRE inputs were unchanged and the disposable fixture was restored after negative tests. No commands ran in the real RRE checkout.
- Normal ChatGPT Chat: **3/3 checks passed** using only list/status/output calls: both RRE profiles visible, all five existing Workbridge profiles visible, and the six-row deployed CLI result verified. The [verification conversation](https://chatgpt.com/c/6ad7b504-23ec-83ea-afb7-53d15e11e90b) and local screenshot/text receipt retain the results.
- Existing command profiles, prior source changes, and the Git index were preserved. Final hashes and configuration recovery records are retained in the local evidence directory.

Detailed fixture logs and source hashes are retained under `.local/wb005b/` in the attached `codex/ai-workflows` worktree; the final evidence copy is under `.local/wb005b-20261020-01/` in the source checkout.

AI-005 [bounded multi-file reads](multi-file-reads.md) are now deployed. AI-006 filtered change history remains proposed.
