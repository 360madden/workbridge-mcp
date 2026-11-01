# WB-005 Batch A validation

Date: 2026-10-20\
Deployed version: 0.6.2-dev, 34 MCP tools\
Status: Local checks, controlled deployment, and all five normal ChatGPT Chat acceptance checks passed.

## Source and isolation

The candidate uses the source state from `C:\work\workbridge-mcp`, including pre-existing modified/untracked files, on top of Git HEAD `cf92ed8`. It was copied to the managed worktree `C:\Users\mrkoo\.codex\worktrees\workbridge-ai-workflows\workbridge-mcp` on branch `codex/ai-workflows`.

Before deployment, builds, dependency installation, test fixtures, and logs stayed in the candidate or disposable test directories. The 107 original source files matched the saved baseline before integration. Deployment subsequently replaced only the validated runtime through WB-001. No credential/configuration update or RRE modification was performed.

The source integration into `C:\work\workbridge-mcp` is recorded in `.local/wb005-integration-20261020-review01/journal.json`. Its `before/` directory retains every replaced source file, including prior edits. The journal records before/after hashes, untouched-source checks, Git index preservation, and installed-runtime checks. Integration left the compiled runtime at 0.6.1; the subsequent controlled deployment advanced it to 0.6.2-dev. No source files were staged or committed.

## Checks

| Check | Result |
| --- | --- |
| Pre-change `npm test` | 80/80 passed |
| Candidate and prepared-release `npm test` | 98/98 passed, including 18 new AI-workflow/CLI cases |
| `npm run test:startup` | Passed: disposable DPAPI/ACL, unattended startup, duplicate launcher, process-tree cleanup, restart fixtures, script parsing |
| `npm run test:updater` | All 21 fixture cases passed; no live update or scheduler smoke deployment |
| `npm run format:check` | Passed |
| `npm run acceptance` | Passed generic disposable-project workflow; 0.6.2-dev, 34 tools, fixture cleanup complete |
| `node scripts/release-acceptance.mjs --expected-version 0.6.2-dev` | Passed against dedicated candidate project/state; 34 tools |
| `New-WorkbridgeRelease.ps1 -ReleaseId wb005-20261020-review01` | Passed all seven preparation checks; sealed manifest and validation receipt issued |
| Production-dependency CLI smoke test | Passed launch/wait/discovery/tail after `npm ci --omit=dev --ignore-scripts --offline`; no development dependencies needed |
| Controlled live deployment | `wb005-activate-20261020-01` completed; previous runtime 0.6.1 retained for rollback |
| Deployment integrity | 2,127 installed runtime files matched the sealed payload; 2,530 backup files verified; all 111 source files and Git index unchanged before this documentation update |
| Normal ChatGPT Chat acceptance | 5/5 passed after refreshing the hosted tool catalog |

The startup fixture prints simulated restart messages. Those messages do not indicate a restart of the installed Workbridge service.

The repository-wide `git diff --check` reports a pre-existing blank line at EOF in `docs/validation.md`; that file is preserved byte-for-byte. WB-005 delta whitespace and documentation links are checked separately.

## Deployment and hosted acceptance

The independent updater completed at `2026-10-20T18:36:05Z`. Its retained operation directory is `.local/update-operations/wb005-activate-20261020-01`, containing the journal, previous runtime/source/configuration backup, manifest, and local probe. The first hosted request after restart timed out; a subsequent request returned 0.6.2-dev.

[Normal ChatGPT Chat evidence](https://chatgpt.com/c/6ad7b504-23ec-83ea-afb7-53d15e11e90b) used only the disposable fixture `C:\work\workbridge-wb005-hosted-20261020-01`:

| Hosted check | Observed result |
| --- | --- |
| Actual server identity | `workspace_info.version = 0.6.2-dev` |
| Job execution/status | `wb005-hosted-job-20261020-01` passed with exit code 0 |
| Discovery and retained-output tail | `command_list` recovered the job from 907 scanned records: two matching jobs, `complete:true`, `catalogTruncated:false`, no issues, and no next page. `command_output` with `tailChars:16`, stdout, and no offset returned `"WB005_HOSTED_OK\n"`, passed, exit 0 |
| Structured edit failure | Second replacement returned `EDIT_MISMATCH`, `editIndex:1`, expected count 1, observed count 0, `countExact:true`, and `nextAction:"reread_and_narrow_edit"`; original 13-byte file and SHA-256 remained unchanged |
| CLI through the live bridge | Outer job `wb005-hosted-cli-01` passed; four JSONL rows had `ok:true`; final inner-job tail was `"WB005_CLI_HOSTED_OK\n"` |

The initial browser run passed four checks but saw an old tool catalog without `command_list` or `tailChars`. Workbridge's existing **Refresh tools** control loaded the updated definitions. Repeating only discovery/tail in a new turn of the same chat passed. No jobs or CLI batches were relaunched to obtain that result, and plugin permissions were unchanged.

## New behavior verified

- Job discovery finds the current owner's active jobs, filters canonical project/status, continues empty filtered pages, reports corrupt/oversized records, and classifies historical running records as interrupted without resuming them.
- Tail reads preserve legacy offset paging and combined-only records, return status/exit information, support separate streams, reject explicit offset/tail conflicts, and distinguish retained output from discarded final logs.
- Edit errors report the failed zero-based replacement index, exact/lower-bound occurrence counts, and stale hashes. A failed later replacement leaves original bytes unchanged; successful guarded edit/undo still works.
- The [CLI](workbridge-cli.md) is exercised through Workbridge itself: one owned MCP session, file-based requests, machine output, Unicode/spaces paths, read/edit/undo, discovery/tail, propagated failures, cancellation, and deadline child cleanup. Existing state is refused. A source/runtime version mismatch is rejected before any requested mutation.

## Evidence and limits

Candidate-local logs are retained under `.local/`: the initial `baseline-tests.log`, `wb005-tests.log` (97 tests before the final review), startup/updater/format/acceptance logs, and `wb005-review-tests.log` (18 focused cases after the CLI guard). The prepared release has fresh complete test logs (98 tests). Production-only CLI results are in `.local/wb005-production-cli/validation.json`.

Candidate `.local/wb005-validation.json` records source preservation and before/after hashes for this batch. `.local/wb005-review.patch` contains only the delta from the original dirty source snapshot, so inherited changes can be distinguished from WB-005 work.

The sealed release is `C:\Users\mrkoo\.codex\worktrees\workbridge-ai-workflows\workbridge-mcp\.local\releases\wb005-20261020-review01`. Its `validated.json` binds to manifest SHA-256 `0F53CA8BC8523E1CC1A915B4C4BE335E3C081E38E06C44E320C3F57C9820254F` and reports 0.6.2-dev, 34 tools, and `hostedVerified:false`. The immutable preparation receipt and updater journal retain that local-only flag; later hosted verification is recorded separately. Keep the sealed directory unchanged. Documentation was updated after sealing; runtime and implementation files still match the prepared payload.

Main-checkout evidence includes `.local/wb005-hosted-acceptance.json`, `.local/wb005-deployment-integrity.json`, `.local/wb005-browser-initial.txt`, `.local/wb005-browser-acceptance.txt`, and `.local/wb005-browser-acceptance.png`. Pre-update documentation is retained under `.local/wb005-post-deploy-docs/before`. The disposable fixture remains available for independent inspection.

These checks establish deployment and the requested hosted AI workflow. They do not establish RRE gameplay/research correctness or full management of the deployed bridge from the batch CLI; the CLI never shares live state. Future runtime changes still use the independent [WB-001 workflow](updates.md) and fresh hosted acceptance.
