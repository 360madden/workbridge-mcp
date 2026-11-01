# WB-016 — Deployed retained-result recovery

Date: **October 21, 2026**, America/New_York.  
Runtime: **0.15.0-dev**. Advertised catalog: **52 tools**.  
Status: **Runtime, release and connected-CLI milestone passed. Direct named-browser-tool exposure remains unverified.**

## Delivered behavior

The new `command_retry_save(jobId)` saves an original final job result retained
by the current owner after a publication failure. It preserves original success,
failure, cancellation or timeout, exit codes, request identity and captured output.
The operation never executes the command or restarts the owner. It verifies the
original intent or exact final bytes, refuses changed/missing/corrupt/linked
storage, rereads final bytes, and releases its occupied job slot only on success.
Concurrent and repeated recovery calls do not publish or execute twice.
See [the recovery contract](job-retry-save.md).

## Release and deployment evidence

Release `wb016-20261021-review01` passed all seven checks: dependency installation,
full tests, Windows startup, updater, formatting, generic acceptance and actual
MCP catalog probing. Its manifest SHA256 is:
`71799B63A06305CC90CC6F390898298B8F7528808628B59338D761380A7E7A3B`.
The sealed release remains unchanged.

Activation `wb016-activate-20261021-01` completed at **01:45:15 EDT / 05:45:15 UTC**,
replacing 0.14.0-dev through the independent updater with no deployment or recovery
error. Before activation, a full paged check found no other running jobs and no
retained save failures. The running owner after activation was
`1c706be0-aaea-4d93-883f-bf01579a9c29`.
The updater's local `hostedVerified` flag was not modified to imply external proof.

| Check | Result |
| --- | --- |
| Full candidate suite | 361/361 passed |
| Fresh installed suite | 361/361 passed; exit 0; no skips/cancellations |
| Production-only focused suite | 29/29 passed; subset of 361 |
| Seven sealed-release checks | All exit 0 |
| Read-only existing-job compatibility | 1,088 identical summaries; zero issues; metadata unchanged |
| Installed runtime hashes | 2,805 files matched |
| Sealed payload hashes | 2,978 files matched |
| Rollback runtime hashes | 2,805 files matched |
| Preserved backup hashes | 3,376 files matched |
| Source before final documentation | 175 expected files matched |
| Live configuration | Six original hashes unchanged |
| Main Git index | Original hash unchanged |

Installed suite: `wb016-installed-full-tests-20261021-01`, using
`node --test test/*.test.mjs`, without rebuilding the live installation.
The production-only test copy had no application source, TypeScript or Prettier;
its dependencies were installed offline with `--omit=dev --ignore-scripts`.
No dependency versions changed.

## Coverage boundaries

**Private real MCP/CLI owners:** 21 new module cases and eight transport cases
proved actual save-fault recovery, all-six-slot release, original exit/state and
stream preservation, duplicate/concurrent callers, changed-storage refusal,
shutdown/read/write races, saved-result reconstruction, refusal after lost memory,
and workflow reconciliation with the original job and one execution. The original
red tests and a Windows file-URL test-harness failure are retained accurately.
No skip or weakened assertion was used to hide them.

**Installed live owner:** browser-launched success job
`wb016-hosted-success-20261021-01` ran exactly once. Shared CLI save calls returned
`already_saved`; request replay did not execute again or change the record.
The CLI-started failure returned child exit **7** and preserved it in the save
result; a waited batch exited **1** and skipped its sentinel write. Active-job
recovery returned `JOB_SAVE_NOT_READY`; unknown-ID recovery returned
`UNKNOWN_JOB`; both stopped the CLI batch. Browser cancellation terminated the
CLI-started fixture process, and the saved cancelled result remained cancelled.

The counter was restored with a hash-guarded browser write. Further save/no-op and
request replay left it empty. Original hashes of all three completed job records,
fixture staging, and unrelated dirty file remained unchanged; no sentinel appeared.
No live journal was deliberately corrupted and no save fault was injected into
the real owner to manufacture a hosted recovery result.

**Direct named-browser-tool limitation:** fresh installed MCP catalog discovery
shows `command_retry_save` and its schema among 52 tools. This conversation's
available Workbridge tools did not expose a callable named schema for it, despite
discovery attempts. The new operation was therefore called through the installed
shared CLI, reached by existing browser terminal tools. Direct named invocation
is **not claimed passed**. Catalog exposure needs a separate client-side check;
reinstalling a validated runtime is not required by the evidence. No available
management action offered refresh, and no connection/permission was changed.

## Preservation, review and resume

Sixteen source files were promoted with recorded current hashes and a durable
patch; the independent updater installed the two package files and runtime.
The implementing assistant reviewed all 1,412 lines of the complete saved patch.
No independent-agent review is claimed. The response preview was truncated but
engine preflight covered the full set; both pages of the saved full diff were read.

Evidence root: `C:\work\workbridge-wb016-20261021-01\evidence`.
It retains baseline, red/passing logs, production verification, compatibility,
source review/promotion, seal, deployment comparisons, installed test logs,
actual selected browser observations, raw CLI calls and restored fixture hashes.
Documentation patch: `wb016-deployed-docs-20261021-01`.
Final verification files are `documentation-validation.json` and
`deployed-integrity-after.json`; inspect their actual pass status. Expected hashes
of intentional documentation changes were recorded before applying them.

No main staging, commit, remote push, credential, permission, unrelated worktree
or real Rift/RRE edits were made. Prior releases and their evidence are retained.
Hash/readback checks do not certify all external races or power-loss durability.
Already-lost owner memory cannot be reconstructed. Browser final-response display
is separate and no permanent rendering fix is claimed.

Resume from [the handoff](handoff-20261020.md). Verify direct named-tool exposure;
do not repeat the completed activation. No further runtime feature was started.

Model: **GPT-6 Astra Pro**.  
Reasoning level:
