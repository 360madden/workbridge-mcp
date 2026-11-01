# WB-011 — Filtered recovery-history candidate verification

Date: **2026-10-20** (local)  
Candidate: **0.12.0-dev**, AI-006, **51 MCP tools**  
Deployment follow-up: this report preserves pre-deployment candidate evidence. **0.12.0-dev is now deployed**; see the separate [WB-011 deployment acceptance](wb011-deployment.md) for installed hashes, browser/CLI results, preservation, restoration, and the recurring browser display limitation.

## Scope and preservation

The candidate extends existing `change_list` and `patch_list` with project, exact-path, and recorded-state filters. Bounded metadata scanning, per-record issues, explicit completeness, and shared CLI/MCP continuation let an AI recover operation IDs among unrelated work. Moves match either endpoint; patches match any file; combined project/path filters must match the same path. Deleted paths and missing parents remain discoverable without being recreated. See the [contract and CLI examples](filtered-history.md).

The existing attached `codex/ai-workflows` worktree was reused. All **145 main source files** were backed up; nine deployment-documentation differences were synchronized after preserving their previous candidate bytes. Both Git indexes and six saved configuration files are recorded in the new baseline. No staging, commit, reset, real RRE change, or live deployment is part of this candidate checkpoint.

The fresh baseline passed **214 tests**. The candidate passed **236 tests**, adding **17 history module cases and five connected CLI/MCP cases**. The timer-budget case was then made deterministic with a controlled clock; all 17 focused cases passed again. The sealed release will rerun the full suite and remaining gates against its own copied payload.

## Design and compatibility

Both catalogs use ascending operation IDs. This retains patch ordering and replaces single-file history's previous newest-time ordering, which required reading every journal before pagination. Restart old single-file offsets after upgrading. Existing summary fields, journal representations, IDs, status, and guarded recovery remain intact. No schema migration, retention purge, persistent database, or automatic recovery was added.

A shared catalog module bounds directory entries, metadata record reads, individual file size, elapsed preparation, and output independently. Partial metadata errors retain good summaries while marking MCP failure and CLI exit 1. Normal bounded pagination without errors remains successful but incomplete. Empty pages may have a continuation; null continuation does not erase catalog truncation or earlier page errors.

Path validation reuses Workspace's existing component/root/link rules through a separate read-only historical-path method. Write resolution still requires its established existing-parent checks. Matching records validate all their paths before returning a summary, including paths outside a selected project. Nonmatching records do not require filesystem traversal. Saved state is explicitly labeled as recorded; discovery does not read file contents, backup files, or saved diffs to claim fresh validity.

## Verification coverage

- Segment-aware project matching, platform case, exact paths, state intersections, lexical ordering, move source/destination, and patch any-file matches.
- Deleted files/parents, additional roots, revoked-root refusal without file-label leakage, protected/Git-internal/device/stream paths, and directory junction boundaries.
- Sparse matching pages, corrupt/oversized/disappearing metadata, partial errors, deterministic continuation, entry/record/output/time limits, and an oversized summary that advances with an explicit issue.
- Empty history creates no journal directory; later source edits and missing snapshots do not falsely change recorded state or trigger recovery.
- Actual MCP-to-CLI and CLI-to-MCP continuation, filtered discovery of structured configuration patches, owner restart, known-ID guarded undo, direct structured errors, CLI exit 1 and stop-on-first-error, and unchanged staged/dirty fixture files.
- Existing single-file, patch, configuration, context, service, workflow, command, and source-access regressions remain in the 236-test suite.

Evidence is retained under `.local/wb011-ai006-20261020-01/`, including baseline/source backups, previous candidate docs, baseline/full/focused/CLI logs, and the implementation plan. Test setup corrections used the declared `write_file.content` field and normalized Windows paths in unified patch headers; no product behavior was weakened to satisfy those assumptions.

## Release and deployment gates

Release **`wb011-20261020-review01`** passed all seven gates: pinned installation, **236 tests**, startup, **21 updater cases**, formatting, generic acceptance, and the **51-tool** release probe. The real Workbridge command runner prepared the release as job **`wb011-seal-release-20261020-01`**, finishing at **2026-10-21T00:25:51.211Z** with exit 0. No service was stopped or deployed.

Release path: `C:\Users\mrkoo\.codex\worktrees\workbridge-ai-workflows\workbridge-mcp\.local\releases\wb011-20261020-review01`  
Manifest SHA256: `6B5169BA260F63C7FA13A4BC61259CD557EB63ABB30D30CB11FDB4CCF05AAF91`

The sealed receipt correctly retains `hostedVerified: false`. A separate runtime-only fixture copied the exact sealed compiled runtime, CLI, package/lockfile, and history CLI tests, then installed only production dependencies offline with scripts disabled. All **five runtime-only CLI/MCP integration tests passed** without source files, TypeScript, or development dependencies. These prove cross-client filtered paging, configuration-patch discovery and undo, restart, structured/partial error exits, and staging/dirty-file preservation against the release bytes.

Final verification checked **2,953 sealed files**, **108 implementation/test/script/package files** matching the release, and **72 runtime-only compiled files**. All **145 main source files**, **2,802 installed runtime files**, six configuration files, and both Git indexes were preserved. The live owner still reported **0.11.0-dev**, instance `e85636bf-5999-4dee-9d5c-088fe94ff4fe`. This phase changes **21 source/documentation files**, including five new files; its isolated diff retains inherited work.

Source changes alone do not alter the running owner. Fresh normal browser Chat acceptance must follow installation and verify both handoff directions, filtered discovery, sparse continuation, partial results, recovery by discovered IDs, and disposable fixture restoration. Local checks and actual browser evidence remain separate claims.

The known WB-010 browser run rendered successfully; that observation is not evidence about rendering in this future deployment. Hosted wrappers may retain partial history inside `INVALID_ARGUMENT`/`TextContent`; acceptance must inspect the full nested result and independently verify files/state.

This release report was completed after sealing, so its source copy may differ from immutable release documentation. Implementation, test, script, and package bytes must still match the sealed manifest. `.local/wb011-ai006-20261020-01/final-verification.json` records the final preservation checks and `ai006-changes.diff` isolates this phase from inherited changes.

## Subsequent deployment acceptance

The authorized independent update completed at 2026-10-21 00:29:09 UTC. Browser/CLI tool acceptance passed sparse continuation, discovered-ID recovery, moved-file discovery, recorded-state conflict protection, partial-result retention, and restoration. All six fixture originals, their pre-existing dirty edit, and staged index were preserved/restored; the temporary malformed test record was removed after verification. Browser response display failed again. See the separate [deployment report](wb011-deployment.md).
