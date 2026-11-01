# WB-005 — Impact-first improvements for AI-driven workflows

Planned: 2026-10-20\
Audience: AI coding agents and Workbridge maintainers\
Status: **WB-022 is deployed and verified at 0.16.3-dev**, retaining 52 tools. Initial result publication and explicit recovery share original-intent and post-save hash checks. Observed conflicts retain output and the original result without rerunning. Candidate and installed suites passed **473/473**; **20 new cases** also passed with production dependencies only. See [deployment evidence](wb022-deployment.md), [contract](job-publication.md), and [handoff](handoff-20261020.md). No repeat activation is pending.

## Objective and boundaries

Improve current and future RRE workflows through reliable multi-file changes, resumable validation, and shared browser/CLI recovery. Prioritize practical benefit and complete AI workflows. Implementation effort affects sequencing and design, but does not exclude a high-value capability. Keep the bridge generic; RRE-specific commands and research judgments belong in project configuration or RRE.

[CLI-001](cli-requirements.md) is mandatory for the applicable work. Prefer supported existing CLIs, literal arguments, and machine-readable results. Do not change the selected AI model or reasoning level as part of this plan.

The user subsequently authorized Batch A implementation and testing on 2026-10-20, then continued through the deployment handoff. Implementation used an isolated worktree copied from the current source state. The validated runtime was installed through WB-001 as operation `wb005-activate-20261020-01`, followed by normal ChatGPT Chat acceptance. Existing source changes, command profiles, service configuration, and RRE files are preserved. See [validation](wb005-validation.md).

## Source-checked baseline

The planning baseline declared version 0.6.1. AI-001 through AI-005 were subsequently deployed at 0.6.3-dev and are retained in current 0.14.0-dev. The points below describe their pre-change baseline.

- [Job handling](../src/jobs.ts) already persists job records, exposes known-ID status/output/cancellation, and keeps a live job map. Diagnostics count jobs but do not provide a paged job catalog.
- `command_output` already returns the job summary, including status and exit code, alongside output. The useful addition is a bounded tail option, not a duplicate combined-result endpoint.
- [File changes](../src/changes.ts) already support multiple exact replacements within one file, expected hashes, encoding/EOL preservation, durable IDs, and guarded undo. Match-count errors exist, but lack structured replacement details.
- [Error handling](../src/core.ts) and [tool registration](../src/server.ts) currently serialize error codes/messages. Additive edit diagnostics must survive that serialization.
- [Coding workflow](coding-workflow.md) already documents fixed command profiles, dynamic CLI execution, output limits, and recovery. Reuse these facilities.

## Impact-first roadmap

The priorities below replace the earlier requirement that improvements be small or uncomplicated. CLI-001 remains mandatory. Priority describes practical benefit; implementation order accounts for dependencies. The shared service/CLI connection comes first because later edit and workflow recovery must reach the same owner, history, and operation state as browser Chat mode.

| Impact priority / ID | Capability                                                  | Practical benefit                                                                                                                                                                                         | State                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 / AI-008           | Recoverable multi-file edits with patch support.            | An AI can update source, callers, tests, configuration, and documentation as one identified change set, with preflight conflict checks, a combined diff, explicit progress, and guarded recovery or undo. | Deployed in 0.8.0-dev; cross-client tool workflows passed. [Contract](multi-file-patches.md), [acceptance and display limitation](wb007-deployment.md) |
| 2 / AI-009           | Resumable edit, validate, and review workflows.             | An interrupted browser conversation or failed check can resume from recorded state instead of reconstructing the edit plan and rerunning completed work.                                                  | Deployed in 0.9.0-dev; cross-client continuation, retry, review, cancellation, and conflicts passed. [Contract](resumable-workflows.md)                |
| 3 / AI-007           | A complete CLI connected to the running Workbridge service. | CLI automation and browser Chat operate on the same jobs, changes, history, recovery state, and service owner rather than separate private sessions.                                                      | Deployed in 0.8.0-dev; same-owner browser/CLI access verified                                                                                          |
| 4 / AI-010           | Task-focused context gathering.                             | The AI can gather relevant source sections, search context, project instructions, tests, hashes, and related change records with bounded output and fewer exploratory calls.                              | Deployed in 0.10.0-dev; browser/CLI acceptance passed. [Contract](task-context.md)                                                                     |
| 5 / AI-011           | Structured configuration editing.                           | The AI can update specific fields or array entries without fragile whole-file replacement while retaining format-aware conflicts and recovery.                                                            | Deployed in 0.11.0-dev; browser/CLI acceptance passed. [Contract](structured-config-edits.md)                                                          |

AI-006 filtered change history remains useful, but it is now part of AI-007, AI-009, and AI-010 rather than a standalone delivery target. Project, path, state, and operation filters should support shared-service recovery and task context. AI-006 is deployed in 0.12.0-dev, extending the existing catalogs; see [filtered history](filtered-history.md).

See the [shared-service CLI contract](shared-service-cli.md) for AI-007 behavior, [WB-006](wb006-validation.md) for its original release evidence, [WB-007 deployment acceptance](wb007-deployment.md) for the patch release, and [WB-008 deployment acceptance](wb008-deployment.md) for resumable validation, and [WB-009 deployment acceptance](wb009-deployment.md) for task context. [WB-010 deployment acceptance](wb010-deployment.md) records 0.11.0-dev structured editing. [WB-011 deployment acceptance](wb011-deployment.md) records the 0.12.0-dev history rollout; [WB-012 deployment acceptance](wb012-deployment.md) records the 0.12.1-dev recovery release. [WB-015 acceptance](wb015-deployment.md) records current 0.14.0-dev saved-job reliability.

### Required design outcomes

- **Shared ownership:** Browser Chat and the CLI address the same running service and authoritative operation state through a supported local transport with explicit authentication and lifecycle rules. Do not start a second server against the same state as a management shortcut.
- **Recoverable multi-file mutation:** Validate every expected file version before mutation. Record one operation identity, per-file progress, before/after hashes, and enough durable state to inspect or recover after interruption. Recovery and undo must refuse to overwrite later work.
- **Patch semantics:** Support a reviewable patch representation, preflight applicability, bounded diagnostics, and a combined result. Patch support must retain Workbridge path boundaries, protected-state rules, size limits, journaling, and conflict checks.
- **Resumable workflow state:** Persist an explicit plan and step outcomes for edit, validation, and review. A resumed caller can discover the workflow, identify the failed or interrupted step, inspect retained output, and continue without silently repeating completed mutations.
- **CLI completeness:** Expose discovery, inspection, preview, execution, status, output, cancellation, recovery, and undo as applicable. Use stable structured output and meaningful exit codes; CLI and MCP adapters share operational logic.
- **Bounded context and structured edits:** Report truncation and continuation, preserve current hashes, and keep config mutation format-aware. JSON is the first structured format; add other formats only when the selected library preserves required comments and formatting reliably.

### Acceptance direction for the new phase

AI-007/AI-008 release and deployed cross-client tool evidence is recorded in [WB-006](wb006-validation.md), [WB-007 verification](wb007-validation.md), and [deployment acceptance](wb007-deployment.md). The latter records the browser rendering limitation separately. For AI-009 and later work, use disposable multi-file fixtures to demonstrate success, preflight conflicts, a validation failure, interruption between steps, status recovery, guarded rollback, and refusal to overwrite a later edit. Local tests, CLI verification, and fresh hosted acceptance remain separate evidence gates. Follow [WB-001](updates.md) before any deployment.

## Completed and proposed earlier backlog

This table preserves the historical WB-005 sequence and evidence. It no longer constrains later work to small extensions. AI-001 through AI-003 are implemented, deployed, and verified locally and through normal ChatGPT Chat. AI-004 is configured using existing facilities; see [RRE commands and verification](rre-validation-profiles.md). AI-005 is deployed; see [multi-file reads](multi-file-reads.md) for verification and limits. AI-006 was proposed in this historical sequence and is now deployed in 0.12.0-dev.

| Order / ID | Historical change                                                        | Practical benefit                                                                                                     | Effort / delivered batch           |
| ---------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1 / AI-001 | Add paged `command_list`, filtered by project and status.                | A resumed AI finds active, failed, or interrupted jobs without remembered IDs; avoids duplicate execution.            | Small / A                          |
| 2 / AI-002 | Add an optional bounded tail to existing `command_output`.               | Obtain job status, exit code, and useful recent retained output in one call without calculating offsets.              | Small / A                          |
| 3 / AI-003 | Add structured edit-failure details.                                     | Correct the specific failed replacement instead of repeated broad reads or whole-file rewrites.                       | Small / A                          |
| 4 / AI-004 | Configure a few named RRE validation profiles using existing facilities. | Reuse the correct interpreter and test entry point; avoid repeated shell construction and incomplete suite selection. | Configuration only / B, configured |
| 5 / AI-005 | Add bounded multi-file reads using existing read logic.                  | Read source, tests, and instructions together with individual hashes and errors.                                      | Small extension / B, deployed      |
| 6 / AI-006 | Add project/path/state filters to `change_list`.                         | Find an uncertain edit or undo ID among unrelated worktree operations.                                                | Small / B                          |

### AI-001 — Discover existing jobs

Reuse stored records and the current service's live map; return compact summaries without raw logs or a new database. Canonicalize project filters, provide deterministic ordering/pagination, and bound scanning as well as response size. Report incomplete scans or unreadable records explicitly; an incomplete listing cannot establish that no jobs are active.

Acceptance: disposable jobs cover running, passed, failed, and interrupted states; filters and pages work; the live owner remains authoritative. Discovery neither restarts jobs nor treats six command slots as six AI agents. A resumed caller can recover a job ID and inspect its result.

### AI-002 — Tail retained command output

Extend `command_output` rather than introduce `command_result`. Preserve offset-based calls and existing stream selection. Define tail length in the same character units as current paging; reject conflicting explicit tail/offset requests. Return the actual start offset, stream length, status, exit code, and truncation information from one loaded job snapshot.

Acceptance: empty, short, running, completed, and capped output behave correctly; legacy combined-only output remains supported. A tail of capped output is the end of the retained buffer, not necessarily the real end of the process log. Do not claim to recover discarded output or introduce new streaming/storage in this change.

### AI-003 — Explain failed edits precisely

Retain existing error codes/messages and add structured fields identifying the failed replacement index, expected occurrences, and observed count. If matching stopped early, label the count as a lower bound. Distinguish stale-hash conflicts from missing or ambiguous replacement text. Keep successful exact-edit, newline, hash, and undo behavior unchanged.

Acceptance: the second replacement in a multi-edit request can fail without writing partial content; JSON identifies that replacement; stale hashes still require rereading. Error details reach the caller through existing serialization. No fuzzy matching, automatic hash substitution, or expanded source excerpts are needed.

### AI-004 — Reuse named validation commands

Implemented selection: `roadmap_validate` and `review_adapter_test`. The unified offline gate remains a documented `terminal_run` invocation because it requires a fresh evidence directory. Existing profiles and RRE files were preserved; no bridge runtime change was needed. The following criteria describe the intended scope.

At implementation time, inspect RRE's current entry points and runtimes. Select a small set: roadmap validation, an appropriate targeted suite, and the unified offline gate. Use existing profiles with explicit executable/working-directory selection; preserve unrelated profile entries. Profiles must propagate real exits and honor existing job/output limits.

Use unique output locations where the validator requires them. If a fixed profile cannot supply those safely, keep that invocation on `terminal_run` with literal arguments rather than building a new profile language. Prove the configuration on disposable inputs before authorized real-project use.

### AI-005 and AI-006 — Follow-up conveniences

AI-005 implementation: `read_files` returns up to 20 ordered file pages within a 60,000-character serialized JSON body, with independent batch and file continuation. Per-file errors preserve good results and produce a failing CLI exit. The existing reader is unchanged. See [contract, examples, and verification](multi-file-reads.md).

For multi-file reads, cap item count and total output, retain per-item versions/hashes where existing limits permit, and report individual errors, truncation, and continuation. Do not imply an atomic snapshot across files or compute unsupported large-file hashes. Existing single-file reads remain available.

For filtered change history, reuse the existing journal and summary format. Match canonical project/path boundaries, filter before pagination, and preserve guarded undo. No journal migration, retention purge, or new task database is included.

## Execution sequence

1. **Preserve and preflight:** Reconcile the dirty source checkout, current jobs, deployed build, and AI-001 through AI-005 evidence. Prepare an isolated candidate from the intended reviewed source state; do not silently omit or overwrite existing work.
2. **AI-007 shared service/CLI connection:** Complete and deployed in 0.8.0-dev. Browser and connected CLI share the verified owner and authoritative records. Retain the existing private-session CLI for isolated use; see the recorded acceptance scope and browser display limitation.
3. **AI-008 recoverable multi-file patching:** Complete and deployed in 0.8.0-dev. Shared mutation logic, durable state, conflict checks, combined diffs, resume, and guarded undo have release and cross-client evidence; crash/restart tests use disposable owners.
4. **AI-009 resumable validation:** Complete and deployed in 0.9.0-dev using existing patch journals, command supervision, and retained output. See [contract](resumable-workflows.md), [verification](wb008-validation.md), and [deployment acceptance](wb008-deployment.md). The browser display limitation remains separately recorded.
5. **AI-010 task context:** Complete and deployed in 0.10.0-dev: scoped instructions, project documentation, source/test excerpts with hashes, bounded searches, and exact-project workflow/patch IDs. CLI and MCP share the module. See [contract](task-context.md), [verification](wb009-validation.md), and [deployment acceptance](wb009-deployment.md). Browser/CLI continuation and expected failure cases passed; the browser display limitation remains separately recorded.
6. **AI-011 structured configuration edits:** Complete and deployed in 0.11.0-dev. JSON/explicit JSONC, pointer-based add/replace/remove/test, whole-set preflight, combined diffs, conflict checks, idempotent operation IDs, existing workflow validation, and patch recovery share the CLI/MCP module. See [contract](structured-config-edits.md), [verification](wb010-validation.md), and [deployment acceptance](wb010-deployment.md). AI-006 filtered history is deployed in 0.12.0-dev with passing browser/CLI tool acceptance.
7. **Release only when authorized:** Follow [WB-001](updates.md) for staged installation/recovery and perform fresh hosted verification on disposable fixtures. Source tests do not establish deployed behavior.

The new phase succeeds when an AI can begin a multi-file change in browser Chat, inspect and continue the same authoritative operation through the CLI after an interruption, run validation, review the result, and recover safely from a conflict or failure. Record the CLI path, tool-call sequence, operation IDs, outcomes, and limitations; do not promise an unmeasured percentage speedup.

## Explicitly deferred or out of scope

- AI-009 is deployed with passing browser/CLI tool acceptance. It provides explicit continuation and CLI-driven waiting; detached scheduling, automatic retries, and automatic commit/deployment are excluded. Earlier browser final-response failures remain historical evidence; current WB-010 acceptance rendered successfully without a product rendering change.
- Automatic conflict repair and silent rebasing. The planned multi-file workflow reports conflicts and preserves later work; it does not guess how to merge them.
- Mandatory preview before every edit. Planned patch support provides review and preflight capabilities without requiring an extra call for every existing exact edit.
- Full diff retention without bounds. Planned review and recovery data must have explicit size, paging, and retention behavior.
- Image transport, new evidence stores, lane locks, agent orchestration, persistent stdin sessions, independent daemons, and public listeners. AI-007's authenticated loopback management endpoint belongs to the existing owner.
- Native research, live game control, RRE implementation, and model/provider availability fixes.

These items may be reconsidered after demonstrated need and separate scoping. AI-001 through AI-011 are now implemented/configured and deployed. Keep future work tied to observed AI workflow gaps: use the existing catalogs, context tools, validation plans, and recovery contracts before adding another orchestration layer. Browser response rendering and hosted partial-error wrappers remain usability limitations to assess separately from tool correctness.

## AI-006 deployed follow-through

Deployed 0.12.0-dev adds project/path/recorded-state filters to change_list and patch_list, bounded metadata/output/time budgets, per-record errors, and cross-client continuation. Move endpoints and deleted paths remain discoverable. Single-file listing uses ascending operation IDs; old offsets must restart after upgrade. Known-ID status and guarded recovery are unchanged. See [contract](filtered-history.md), [verification](wb011-validation.md), and [deployment acceptance](wb011-deployment.md).
