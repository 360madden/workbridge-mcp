# WB-024 — Identify uncertain CLI requests

Date: October 21, 2026 (America/New_York). **CLI-only milestone complete.**
The server remains **0.16.3-dev / WB-022**, with 52 tools and six shared command slots. This changes the local CLI script and tests, not server source, compiled binaries, package versions or dependencies. No rebuild, service restart or new runtime release occurred.

## Delivered contract

When a deadline, interruption or thrown transport error occurs during a batch step, the CLI now adds **error.requestContext**. It contains the zero-based step index, a bounded tool name, supported original identifiers, and a read-only inspection request when a known mapping exists.

A real live deadline returned this context:

```json
{
  "index": 0,
  "tool": "waitForJob",
  "jobId": "wb024-hosted-gate-20261021-01",
  "inspection": {
    "tool": "command_status",
    "arguments": {
      "jobId": "wb024-hosted-gate-20261021-01"
    }
  }
}
```

This describes what the caller requested. **It does not prove the server accepted or executed it.** A status lookup can return unknown when no operation was accepted. Inspect the same owner and durable identity before deciding what to do; the CLI never follows the suggestion automatically and never changes or reruns a command on the caller's behalf.

Supported mappings include terminal_run/command_run requestId to command_status; job status/output/cancel/save-recovery jobId to command_status; explicit workflow operations and runWorkflow to workflow_status; patch operations/config_apply to patch_status; write_file/edit_file/delete_file/undo_change/change_status to change_status. waitForJob preserves its jobId. workflow_resume also retains a valid retryJobId. Other tool names receive only the index/name, without inferred identifiers or a fabricated inspection action.

Identifiers must match the existing 1–100-character durable-ID syntax; malformed, overlong or nonstring values are omitted, not truncated or guessed. Unknown tool names are limited to 100 characters and marked toolTruncated when needed. The context does not copy full payloads, paths, file contents or command arguments. Existing error messages are unchanged; this is not a new universal error-message redaction feature.

Context is set only when a batch step begins and cleared after its normal result is emitted. Setup failures before that point do not claim a request ran. Existing workflowId compatibility, normal tool-error envelopes, failure exits 1/2/124/130, stop-on-error and shared-owner behavior remain. In isolated mode the existing owner shutdown rules still apply; identifiers do not reconstruct lost memory.

## Validation and negative evidence

| Check | Result |
| --- | --- |
| Original CLI, controlled missing-context case | Expected failure reproduced; actual test exit 1 retained |
| Isolated full regression suite | 490/490 passed |
| Main-repository full suite against unchanged server modules | 490/490 passed |
| New focused integration cases | 15/15 passed |
| New cases with production dependencies only | 15/15 passed; included in the full total |
| Formatting | Passed |
| Normal live browser / installed CLI | Deadline context found the same running job; it later completed once |

The new tests cover accepted job response loss, waiters before submission, write/patch/workflow identities, prior successful batch rows, legacy workflowId, interruption, setup mismatch, ordinary tool errors, actual lost write response, invalid IDs and prototype/overlong tool names. Real private MCP owners and caller-only interceptors are used. No production server hook or fault injection into live journals was introduced. Node during validation: v26.5.0; dependencies stayed pinned.

The first attempt to reuse an earlier production fixture failed an overstrict comparison with the development installation: two generated node-which launchers and the production-only installation metadata differed, while shared library files matched. That rejected fixture and output were retained. A separate fixture was installed offline from the unchanged lockfile using --omit=dev --ignore-scripts, and all 15 tests passed without source, TypeScript or Prettier. No failed run was relabelled successful.

## Live behavior and preservation

The direct browser launched the disposable job wb024-hosted-gate-20261021-01. The updated installed CLI timed out with exit 124 and reported that exact ID plus command_status guidance. The guidance was actually executed through the shared CLI and found the original job still running; a direct browser status check also observed the same original job. Explicit fixture release let it finish with exit 0. Request replay did not run the command again, including after its counter was restored.

Counter, unrelated dirty fixture bytes and its Git index were restored; temporary markers were removed only after checking their expected contents. The completed job record stayed unchanged. The service owner remained d7ca7bc4-79c7-4588-b421-518a0dd5253c. Deliberate response withholding/disconnect/interruption tests ran only with private owners/callers, not the live transport.

Final verification checks the expected source changes, 2,808 unchanged runtime-file hashes, six unchanged configuration hashes, main Git staging and the original WB-022 sealed payload. The implementing assistant reviewed the complete diffs; no independent reviewer is claimed. No commits, pushes, credentials, permissions or unrelated projects were changed. Since no server binary changed, a new seven-gate runtime release and activation were neither needed nor claimed.

## Resume

Evidence: C:\work\workbridge-wb024-20261021-01\evidence.
Code patch: wb024-cli-promotion-20261021-01.
Documentation patch: wb024-docs-20261021-01.
Final workflow: wb024-final-checkpoint-20261021-01.
Inspect final-verification.json and milestone-complete.json for actual final results. The package/CLI --version still reports 0.16.3-dev to match the server; this source-level CLI enhancement is identified as WB-024, not a fictional new server version.

See [CLI usage](workbridge-cli.md), [last runtime deployment](wb022-deployment.md), and [resume handoff](handoff-20261020.md). No repeat deployment is pending. This does not resolve cached direct-tool exposure for command_retry_save or browser rendering. Private failure simulations are not exhaustive coverage of all network faults or all platforms.

Model: GPT-6 Astra Pro. Reasoning level:
