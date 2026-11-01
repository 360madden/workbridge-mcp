# WB-010 — Structured-configuration candidate verification

Date: **2026-10-20**  
Candidate: **0.11.0-dev**, AI-011, **51 MCP tools**  
Deployment follow-up: this report preserves pre-deployment candidate evidence. **0.11.0-dev is now deployed**; see the separate [WB-010 deployment acceptance](wb010-deployment.md) for installed hashes, browser/CLI results, preservation, fixture restoration, and current browser rendering observations.

## Scope and preservation

The candidate adds `config_preview` and `config_apply` for JSON and explicit JSONC, exposed through the existing request-file CLI and MCP owner. Standard pointer paths select values for add/replace/remove/test operations. The shared patch engine retains whole-set preflight, combined diffs, durable IDs, snapshots, status/discovery, explicit resume, and guarded undo. Existing workflow validation accepts the same patch IDs. See the [contract and examples](structured-config-edits.md).

The attached `codex/ai-workflows` worktree was reused. All **139 main source files** were preserved; nine known deployment-documentation differences were synchronized into the candidate after preserving their previous versions. Both Git indexes, saved configuration, and live runtime remain separate from candidate changes. No commit, staging change, source integration, deployment, or real RRE mutation was performed.

The baseline passed **190 tests**. The final candidate passed **214 tests**, including **24 new configuration cases**: twenty module cases and four connected CLI/MCP cases. All seven sealed-release gates and four production-dependency-only runtime tests passed. Deployment and fresh browser acceptance remain pending.

## Design decisions

Microsoft `jsonc-parser` **3.3.1** is pinned in the package and lockfile. It supplies localized edits and syntax trees; Workbridge adds strict parser-error handling, duplicate-key refusal, exact pointer/index semantics, bounded preparation, comment-loss protection, and raw-digit numeric tests. JSON is the default; JSONC is explicit. Other formats, move/copy, file creation, and implicit parent creation are outside this phase.

Structured request identity is bound before reading files again. Retry after apply, undo, or owner restart therefore discovers the original journal instead of failing against its own already-modified bytes or duplicating array insertions. Nonterminal records still require explicit patch resume/undo. Existing unified-patch request identity remains unchanged.

The initial focused test harness needed three corrections: a missing `async` on a helper, expected existing validation/junction error names, and omitting `--input` during CLI tool discovery. No production behavior was changed to satisfy those assumptions. Review added a comment-loss guard for JSONC structural edits and an output-byte check for UTF-16 growth before the full suite.

Evidence is retained under `.local/wb010-ai011-20261020-01/`, including `baseline.json`, `source-before/`, `candidate-docs-before/`, baseline/focused/full logs, and the final candidate/release preservation report. Fresh normal browser Chat acceptance remains a deployment gate; the known browser response-rendering issue is not claimed fixed.

## Verified behavior

- JSON Pointer decoding, empty/root keys, ordered object/array operations, append versus replace, explicit parent existence, and prototype-like names handled as data.
- Strict JSON versus explicit JSONC, malformed input and duplicate-key refusal, comments outside replaced values protected, and ambiguous adjacent-comment removal refused.
- UTF-8 BOM, BOM UTF-16 LE/BE, CRLF/tabs, exact original-byte undo, untouched large numeric literals, and raw-decimal comparison without rounding source values.
- Whole-set stale-hash preflight, exact file/operation error indices, failed tests without leaking compared values, no journal on failure, no-op refusal, and protected/root/junction boundaries.
- Input, operation, nesting, token, time, file, and UTF-16 output-byte bounds; generated patch and inherited recovery bounds remain active.
- Shared serialization, changed-request and cross-tool ID-reuse refusal, replay after owner restart or undo, guarded refusal to overwrite later edits, and crash recovery after the first file replacement using ordinary patch status/resume/undo.
- Complete CLI discovery, previews, apply, JSONL failures and exit 1, stop-on-first-error, cross-client review/undo, explicit workflow validation with a real JSON assertion, and unchanged Git staging.

The existing patch regression suite also passed after the shared-lock adapter was added. Earlier unified-patch operation hashes retain their original representation. No new patch-record schema or migration is required.

## Sealed release and runtime verification

Release **`wb010-20261020-review01`** passed pinned dependency installation, **214 tests**, startup, **21 updater cases**, formatting, generic acceptance, and the **51-tool** release probe. The real Workbridge command runner executed release preparation as job **`wb010-seal-release-20261020-01`**, finishing with exit 0 at **23:15:57 UTC**. No service stop or deployment occurred.

Release path: `C:\Users\mrkoo\.codex\worktrees\workbridge-ai-workflows\workbridge-mcp\.local\releases\wb010-20261020-review01`  
Manifest SHA256: `A10433F0E33327A4910819D07AAE415757454A6574B20DA7F1ACFAA385090D89`

`validated.json` records all seven gate exits as zero and `hostedVerified: false`. The sealed payload remains unchanged. A separate fixture copied its exact compiled runtime, CLI, package/lockfile, and configuration CLI tests, then installed production dependencies offline with scripts disabled. All **four runtime-only integration tests passed**, without source files, TypeScript, or other development dependencies. They include shared preview/apply/review/undo, workflow validation, failure exits, and restart/replay/conflict protection.

Final preservation checks verified **2,944 sealed payload files**, **105 implementation/test/script/package files** matching the release, and **69 runtime-only compiled files**. All **139 main source files**, **2,780 installed runtime files**, six saved configuration files, and both Git indexes remain unchanged. The live service still reports **0.10.0-dev**, owner `d5b6bed8-ce90-4adc-a211-591a3975d2db`, started at `2026-10-20T22:54:17.057Z`. Release preparation added only its normal job record to live state.

`final-verification.json` records these checks. `ai011-changes.diff` isolates this phase's **22 changed/new files** from inherited work; `source-before/` preserves the complete starting source. This report and final roadmap status were completed after sealing, so their source copies can differ from the immutable release documentation while implementation bytes remain identical.

## Deployment handoff

The next step is authorized [WB-001 deployment](updates.md) of this tested release, followed by normal browser Chat and connected CLI acceptance on disposable JSON/JSONC files. Preserve the main source/configuration/index baseline before integrating the 22 reviewed files. Verify both clients identify the same 0.11.0-dev owner and see 51 tools.

Hosted acceptance should preview/apply through browser Chat, inspect the same patch via CLI, run an explicit validation workflow, and undo across clients. Include a stale hash, a failed value test, protected comments, replay without duplicate array insertion, and guarded undo refusal after a later edit. Restore deliberate fixture changes and record independent byte/staging checks. Keep tool results separate from the unresolved browser final-response display limitation. No further capability phase has started.

## Subsequent deployment acceptance

The authorized deployment completed at 2026-10-20 23:59:31 UTC. Browser Chat and the connected CLI passed configuration preview/apply, replay, workflow validation, guarded undo, and expected failure checks. All six disposable originals and their staged index were restored. New browser replies rendered successfully; no product rendering fix was made. The separate [deployment report](wb010-deployment.md) records the corrected stale-hash test sequence and retains all original evidence.
