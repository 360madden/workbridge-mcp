# WB-007 — Multi-file patch candidate verification

Date: 2026-10-20  
Candidate: **0.8.0-dev**, AI-008, 42 MCP tools  
Deployment: **0.8.0-dev is deployed.** See the separate [deployment and browser/CLI acceptance record](wb007-deployment.md), including the browser response-rendering limitation. This document retains candidate verification evidence.

## Delivered scope

Seven CLI/MCP operations provide patch preview, application, discovery, status, combined diff paging, explicit resume, and guarded undo. The patch module shares the existing mutation queue and uses the pinned `diff` and `zod` dependencies; no dependency was added. It retains the AI-007 shared-service foundation. See the [contract and examples](multi-file-patches.md).

Recoverable text creation, updates, and deletion are included. Multi-file atomicity, directory/rename/binary/mode patches, automatic external-editor locking, power-loss certification, and AI-009 edit/test/review orchestration are not claimed.

## Preservation and evidence

The attached `codex/ai-workflows` worktree was reused. All 121 nonignored main source files matched the candidate before work and were copied with SHA256 hashes. The main Git index and compiled server hashes were recorded. No staging, reset, commit, service configuration change, RRE source edit, deployment, or restart was performed.

Evidence is retained in the candidate's `.local/wb007-patches-20261020-01/`, including `baseline.json`, `source-before/`, and test logs. The previous 0.7.0-dev sealed release remains unchanged.

## Development verification

All **28 new patch and connected-CLI tests passed**. They cover:

- Read-only preflight, whole-set conflict reporting, combined diff paging and artifact integrity.
- Create/update/delete, empty files, UTF-8 BOM and both UTF-16 byte orders, CRLF, missing final newlines, Unicode/spaces paths, and additional roots.
- Duplicate targets, unsupported patch forms, malformed hunks, protected paths, root escapes, junctions, binary/mixed-EOL input, and byte/work bounds.
- Idempotent replay, conflicting ID reuse, shared mutation serialization, and read-only status during an active writer.
- Real disposable child-process exits after plan publication, after file replacement/create/delete, and during undo; recovery reconstructs state from durable hashes.
- Partial I/O failure, later independent edits, corrupt forward/undo snapshots, workspace identity binding, final whole-set verification, and preservation of unrelated Git staging.
- CLI discovery and schemas, structured failure exits, cross-invocation status/diff/undo, and partial-patch recovery after restarting the disposable service owner.

The first full regression run passed 148/149 checks; its sole failure was a test expecting literal Unicode in diff headers. The existing diff library correctly emits quoted UTF-8 octal paths. The assertion now parses the generated unified diff and verifies the decoded filename; all three CLI cases then passed. No application behavior was weakened.

## Sealed release verification

Release **`wb007-20261020-review01`** passed all seven gates from a clean copied payload: pinned dependency install, **151 tests**, startup, **21 updater cases**, formatting, self-contained acceptance, and the **42-tool** release probe. Workbridge ran the release job as `wb007-seal-release-20261020-01`; it exited 0 without output truncation.

Release path: `C:\Users\mrkoo\.codex\worktrees\workbridge-ai-workflows\workbridge-mcp\.local\releases\wb007-20261020-review01`  
Manifest SHA256: `FDB28CEAD43E6B76944102181AC2D93F8E47E29773038016BBF7889FFD7E3888`

`validated.json` records version `0.8.0-dev`, all check exits 0, 42 tools, and `hostedVerified: false`. Its immutable payload retains documentation captured before sealing; source documentation was subsequently updated with the final results. No source code, tests, scripts, or dependency bytes changed after the release copy.

A separate runtime-only fixture installed production dependencies using `npm ci --omit=dev --ignore-scripts --offline`, without source files or TypeScript. All **3 patch CLI integration cases passed**, including partial application, service restart, resume, and undo. Logs are `runtime-only-install.log` and `runtime-only-tests.log` under the evidence directory.

Source integration copies only the 18 reviewed changed/new files into the main checkout after checking the original 121 source hashes again. The receipt records copied hashes, the 108 untouched original files, preserved Git index, and unchanged compiled server. Runtime installation and service restart remain separate from source integration.

## Subsequent deployment acceptance

Local tests and running verification through Workbridge do not establish fresh normal browser Chat acceptance by themselves. Authorized operation `wb007-activate-20261020-01` subsequently deployed this sealed release. The [separate acceptance record](wb007-deployment.md) covers browser-to-CLI and reverse patch workflows, conflicts, recovery, preservation, and the observed browser display limitation. The sealed receipt remains unchanged.
