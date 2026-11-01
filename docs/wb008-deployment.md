# WB-008 — 0.9.0-dev deployment and workflow acceptance

Date: **2026-10-20**  
Installed version: **0.9.0-dev**, **48 tools**  
Result: **deployment and browser Chat/CLI tool workflows passed**. Browser final replies still display **“This response couldn’t load”**; display acceptance remains unresolved.

## Release and installation

The [tested AI-009 release](wb008-validation.md) adds six workflow tools and the CLI `runWorkflow` step. Workflows connect existing recoverable patches to immutable validation plans, durable job IDs, retained output, explicit retry, review, and cancellation. See the [workflow contract](resumable-workflows.md) and [CLI requirements](cli-requirements.md).

The sealed release `wb008-20261020-review02` passed all seven release gates before deployment, including **172 tests**, **21 updater cases**, and the **48-tool** probe. Its manifest SHA256 is `F547C34E712397AF7644FF454AD3A92DFBCC87518D300199709504202D5ABE50`.

The user’s continuation authorized installation and acceptance of the tested candidate. The main checkout was backed up before integrating the 20 reviewed changed/new candidate files. The independent [WB-001 updater](updates.md) ran operation **`wb008-activate-20261020-01`** and completed at **22:18:04 UTC**. It retained the preceding **0.8.0-dev** runtime for recovery and reused the existing Workbridge Scheduled Task, tunnel association, and protected credential.

The live owner started at `2026-10-20T22:18:04.118Z`, with instance ID **`a0e5ddee-f385-4a68-9002-b97d2bd17185`** and PID **39392** at acceptance. Browser `workspace_info`, connected CLI, and the connector returned the same version and owner. These process details describe this acceptance session; discover the current endpoint through the service-state descriptor after future restarts.

Verification checked **2,907 sealed files**, **2,777 installed runtime files**, **99 implementation/test/script/package files**, and **2,774 recovery runtime files** against their manifests. All **127 pre-integration source backups** matched their original hashes. Git staging and six saved configuration files were unchanged. Unrelated source files were preserved; deployment documentation was updated separately with before-copies. No real RRE project, credential, permission setting, Git commit, or staging operation was changed.

## Installed-runtime verification

All **six connected CLI/MCP workflow integration tests passed against the installed runtime** using disposable owners. They verify sequential checks, literal arguments, output review, failed-check retry, idempotency, CLI deadline/disconnection, owner restart with explicit retry of interrupted work, stale inputs, cancellation, discovery filters, guarded undo, and pinned command profiles.

The live owner was not deliberately crashed. Restart recovery was tested using disposable owners. The sealed release and updater retain `hostedVerified: false` because their local receipts are immutable; the separate acceptance evidence below records the hosted result.

## Normal browser Chat and CLI acceptance

The existing normal [browser Chat acceptance conversation](https://chatgpt.com/c/6ad7dbb6-098c-83ea-ac08-fa9c824e4ddf) used the refreshed Workbridge catalog and direct workflow tools. Local connector calls were not substituted for browser tool execution. Fixture: `C:\work\workbridge-wb008-hosted-20261020-01`.

| Scenario                                                                    | Observed result                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser creates a two-file patch and workflow, then starts the first check  | The CLI found the same workflow and first job, completed the second check, reviewed both output tails and the combined two-file diff, and reached `ready_for_review`. Repeating CLI continuation retained exactly one attempt per check. Browser review then saw the same completed evidence.                               |
| CLI creates a check that intentionally fails with exit 7                    | Browser discovery found the workflow. Browser review exposed `WB008_EXPECTED_FAILURE`; explicit retry using the exact failed job ID produced one replacement job with exit 0 and `WB008_RETRY_OK`. Replaying the old retry token retained two attempts, with no third job.                                                  |
| CLI creates a pending cancellation fixture                                  | Browser continuation started its long check; cancellation stopped the job. Repeated cancellation remained `cancelled`, and the CLI confirmed the same cancelled job ID. File changes remained available for separate undo.                                                                                                  |
| A watched file receives a deliberate later edit after successful validation | Browser status and continuation returned `stale`, with `WORKFLOW_INPUT_CHANGED` and `WORKFLOW_VALIDATION_STALE`. No additional check was launched.                                                                                                                                                                          |
| Browser attempts undo while that later edit exists                          | Undo returned `PATCH_BLOCKED` with cause `PATCH_CONFLICT`; both files retained their prior bytes. The patch then reported `blocked`, which takes precedence in workflow status while its recorded workflow state remains `stale`.                                                                                           |
| Explicit fixture restoration                                                | After verifying refusal and preserving the evidence, the harness restored its deliberately changed fixture bytes to the expected patch version, then used guarded patch undo. All **eight original fixture files** matched their original contents. Patch records are `undone`; the cancelled workflow retains `cancelled`. |

The browser wrote two JSON reports using `write_file`. Independent CLI checks compared server/owner identity, plan hashes, job IDs, attempt counts, output, diff structure, states, errors, and file contents. The final service scan found **zero running jobs**, no scan issues, and no truncated catalog. Request files, reports, retry marker, and recovery journals remain as disposable acceptance evidence; command side effects are not automatically undone.

The acceptance harness initially expected `stale` even after the failed undo. Source inspection and the browser report confirmed the intended precedence: a blocked patch yields `blocked`, while the recorded workflow state remains `stale`. The assertion was corrected and strengthened to check both states and the input-change issue. This was a harness correction; no product code or sealed runtime was changed. A manifest-check script also corrected its initial path assumption to the release `payload` and backup `runtime` directories before successful verification.

## Browser display limitation

Both new browser responses again displayed **“This response couldn’t load”**. Tool activity summaries were visible, and the browser-authored reports plus independent CLI evidence confirmed the operations. The previous [WB-007 acceptance](wb007-deployment.md) also reproduced the display failure in a tool-free reply. This release does not claim to repair the browser UI.

Expected unsuccessful MCP results are wrapped by the hosted adapter as `INVALID_ARGUMENT`; nested workflow states and `PATCH_BLOCKED` / `PATCH_CONFLICT` details remain inspectable. AI callers must preserve these details and inspect current state before deciding the next action. Passing tool acceptance does not establish a fully working final-response display.

## Evidence and next phase

Main evidence directory: `.local/wb008-deployment-20261020-01/`.

- `baseline.json`, `source-before/`, `integration.json`, `docs-before/`, and `documentation-changes.json`: preserved source/configuration/staging and controlled documentation changes.
- `install-verification.json`, `installed-tools.jsonl`, and `installed-workflow-tests.log`: sealed/runtime/source/backup checks, 48-tool discovery, and six installed-runtime integration passes.
- `browser-start-results.json`, `browser-results.json`, `browser-independent-checks.json`, and phase-specific `.input.json` / `.jsonl` files: cross-client observations and assertions.
- `fixture-restoration.json`, `hosted-acceptance.json`, and `final-verification.json`: final acceptance and preservation results.
- `browser-acceptance.png` and `browser-acceptance-ax.txt`: visible browser activity and rendering failure.
- `.local/update-operations/wb008-activate-20261020-01/`: independent update journal, request, probe, source/configuration backup, and recoverable 0.8.0-dev runtime.

The next recommended capability is **AI-010: task-focused context gathering**, with CLI/MCP parity, bounded source excerpts, hashes, relevant project instructions, tests, related workflow/patch IDs, and explicit pagination. This should reduce exploratory calls before an AI edits or resumes work. AI-010 and AI-011 have not started. Browser response rendering remains a separate outstanding issue, and workflow validation remains limited to explicitly watched inputs rather than an atomic project snapshot.
