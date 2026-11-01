# WB-009 — Task-context candidate verification

Date: **2026-10-20**  
Candidate: **0.10.0-dev**, AI-010, **49 MCP tools**  
Deployment follow-up: this report preserves the pre-deployment candidate evidence. **0.10.0-dev is now deployed**; see the separate [WB-009 deployment acceptance](wb009-deployment.md) for installed hashes, browser/CLI results, preservation, and the unresolved browser display limitation.

## Scope and preservation

The candidate adds read-only `task_context` through the existing MCP server and complete CLI. It combines scoped instructions, root documentation/manifests, explicitly selected source/test excerpts and hashes, bounded search hits, and exact-project workflow discovery with linked patch IDs. Outer section pagination uses a selection hash; individual sections retain existing file/search/catalog continuations. Partial errors keep successful context and propagate a failing CLI exit. See the [contract and runnable request format](task-context.md).

The attached `codex/ai-workflows` worktree was reused. All **133 main source files** were compared with the candidate, and only the nine expected WB-008 deployment-documentation differences were synchronized after preserving their prior versions. Both Git indexes, live runtime, saved configuration, and all main source files were captured for final preservation checks. No new worktree, dependency, database, daemon, or source-to-live integration was required.

The baseline passed **172 tests**. Existing changes and sealed releases remain intact. AI-011 has not started.

## Implementation and regression checks

All **190 tests passed**, including **18 new context tests**: thirteen module cases and five connected CLI/MCP cases. The tests cover:

- Parent-to-child instruction scope, sibling exclusion, root documents, explicit source/test reads, Unicode/spaces, UTF-16, raw-byte hashes, and large-file null hashes.
- Section ordering and pagination, changes to selected/discovered paths, live content changes, stale read cursors, output escaping, oversized sections, explicit time/ancestor/request bounds, malformed search, protected paths, missing files, junctions, and partial results.
- Exact-project workflow and linked patch discovery without launching checks, preserved staging, unreadable catalog records, binary/clipped instructions, and actionable nested continuation.
- Tool/schema discovery, structured/text parity, CLI exit behavior, cross-client section continuation, and owner restart. Context selection hashes survive unchanged selections after restart; file cursors require a fresh read.

Testing exposed a pre-existing ripgrep argument-order issue: positive caller globs could override generated-directory exclusions. The candidate places protected/generated exclusions after caller globs and verifies both default exclusion and explicit `includeGenerated=true` through MCP. Documentation also clarifies that explicit positive globs can override Git ignore matches under ripgrep semantics.

The first focused run correctly failed on generated-folder inclusion. After fixing it, a test assumption about traversing an entirely ignored directory was corrected to use an ignored-file pattern; this demonstrates the documented positive-glob behavior without assuming traversal. All focused and full tests then passed. Logs are retained under `.local/wb009-ai010-20261020-01/`.

## Release gates and handoff

Release **`wb009-20261020-review01`** passed all seven gates: pinned dependency installation, **190 tests**, startup, **21 updater cases**, formatting, generic acceptance, and the **49-tool** release probe. Workbridge ran the preparation as job **`wb009-seal-release-20261020-01`**, completing with exit 0 at **22:48:10 UTC**. No service stop or deployment occurred.

Release path: `C:\Users\mrkoo\.codex\worktrees\workbridge-ai-workflows\workbridge-mcp\.local\releases\wb009-20261020-review01`  
Manifest SHA256: `2E906F75EF302845E928A80D9280B0E20061344855D6E050AFA503C952AABDAA`

`validated.json` records all seven exit codes as zero and `hostedVerified: false`. The sealed payload remains unchanged; this source verification report was completed afterward. A production-dependency-only fixture copied the exact sealed `dist` files, package/lockfile, CLI, and context CLI tests. All **five runtime-only integration tests passed** without source files, TypeScript, or other development dependencies. Their log is `runtime-only-tests.log`; dependencies were installed offline with scripts disabled.

Final checks verified **2,916 sealed files** and **102 implementation/test/script/package files** matching the release. At this pre-deployment checkpoint, all **133 main source files**, **2,777 installed runtime files**, six saved configuration files, and both Git indexes remained unchanged. The live service reported **0.9.0-dev**, owner `a0e5ddee-f385-4a68-9002-b97d2bd17185`, started at `2026-10-20T22:18:04.118Z`. No real RRE files or live runtime/configuration were changed; release preparation added its own normal Workbridge job record.

Evidence is in `.local/wb009-ai010-20261020-01/`: `baseline.json`, preserved `source-before/` and `candidate-docs-before/`, baseline/focused/full test logs, runtime-only logs, `final-owner-identity.json`, and `final-verification.json`. `ai010-changes.diff` isolates this phase's **21 changed/new files** from inherited work. The verification script checks every changed document's local links and compares candidate implementation bytes to the sealed manifest.

Subsequent normal browser Chat acceptance passed the planned context gathering, cross-client continuation, hashes/instructions, stale-plan, partial-failure, and no-side-effect checks. The previously observed final-response rendering failure remains unresolved. See the separate [deployment report](wb009-deployment.md); local and hosted results remain distinct evidence.

The authorized WB-001 deployment and disposable browser/CLI acceptance are now recorded. AI-011 has not started.
