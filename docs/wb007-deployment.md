# WB-007 deployment and browser/CLI acceptance

Date: 2026-10-20  
Installed release: **0.8.0-dev**, 42 tools  
Operation: **`wb007-activate-20261020-01`**  
Result: **Deployment and cross-client tool workflows passed. Browser response rendering remains an observed limitation.**

The user authorized deployment of the tested release and disposable browser Chat/CLI acceptance. AI-009 implementation has not started. The [candidate verification](wb007-validation.md) records the pre-deployment 151 tests, 21 updater cases, and seven release gates.

## Deployment and preservation

The independent [WB-001 updater](updates.md) installed sealed release `wb007-20261020-review01`, manifest SHA256 `FDB28CEAD43E6B76944102181AC2D93F8E47E29773038016BBF7889FFD7E3888`. It completed at `2026-10-20T21:22:26.7726247Z` (5:22 p.m. EDT), replacing runtime 0.6.3-dev. No active jobs were reported by the old owner's live job view before dispatch.

Preflight verified all 2,898 sealed payload files and matched all 96 source implementation/test/script/package files against the validated release. After installation, all 2,774 runtime files and 2,562 retained backup files passed checksums. All 126 existing nonignored source files and the Git index were unchanged before this documentation update. No application implementation, tests, dependencies, RRE source, staging, or commits changed during deployment acceptance.

The updater retained the previous runtime, source, Git metadata, configuration, and service task under `.local/update-operations/wb007-activate-20261020-01/`. Its journal and the sealed `validated.json` retain `hostedVerified: false`; they certify local checks. The separate acceptance receipt below records later hosted evidence. No rollback was needed.

## Normal browser Chat and connected CLI

[Browser acceptance conversation](https://chatgpt.com/c/6ad7dbb6-098c-83ea-ac08-fa9c824e4ddf) ran in normal Chat mode using Workbridge tools directly. The existing **Refresh tools** control refreshed the hosted definitions; plugin permissions were unchanged. The connected CLI discovered 42 tools, and the browser exercised all seven patch tools.

Both clients reported version 0.8.0-dev and owner instance `c2c74e3f-79d4-4276-8b15-aab8ff879503`. This is a recorded acceptance-time identity, not a value to hard-code after service restarts.

Only `C:\work\workbridge-wb007-hosted-20261020-01` was used for project-file mutations. Its six original text fixtures are restored byte-for-byte; request/report files and recovery journals remain as evidence.

| Check                                    | Evidence and result                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser apply, CLI review/undo           | Browser read fresh hashes, previewed and applied `wb007-hosted-browser-20261020-01`. Separate CLI invocations discovered it, verified both current hashes and the complete two-file combined diff, undid it, and confirmed idempotent undo replay.                                                 |
| CLI apply, browser review/undo           | CLI previewed and applied `wb007-hosted-cli-20261020-01`. Browser inspected status/diff, confirmed completed `patch_resume` returned `replayed: true`, undid it, and read the restored hashes. A fresh CLI invocation independently confirmed `undone`.                                            |
| Whole-set stale-hash rejection           | CLI application with a deliberately stale hash on the second file exited 1 with `PATCH_PREFLIGHT` and per-file `CONFLICT`. Neither file changed.                                                                                                                                                   |
| Guarded undo from both clients           | After `wb007-hosted-conflict-20261020-01` was applied, the harness made a deliberate later edit to one disposable file. Browser and CLI undo both returned `PATCH_BLOCKED` with cause `PATCH_CONFLICT`; the later edit and the other file's patched content were preserved.                        |
| Explicit recovery                        | After verifying those unchanged bytes, the harness restored only its deliberate later edit to the saved patch result. CLI undo then restored both originals. All three patch operations ended `undone`; all six original files matched their initial bytes.                                        |
| CLI job launch, browser discovery/output | CLI launched `wb007-hosted-job-20261020-01` and exited while it was running. Browser discovered the completed job without relaunching it and read stdout tail `WB007_SHARED_JOB_OK\n`, status `passed`, exit 0, without output truncation. A fresh CLI wait/output call confirmed the same result. |
| Installed-runtime interruption recovery  | All three `test/patch-cli.test.mjs` cases passed against the installed runtime, including a partial patch, disposable owner restart, explicit resume, and undo. The live owner was not deliberately crashed.                                                                                       |

The acceptance harness initially expected `direction: undo` after a whole-set undo preflight rejection. Inspection of the sealed implementation confirmed direction changes only after preflight succeeds. The harness now asserts `direction: apply`, all file progress still `applied`, and the recorded conflict. No deployed code or safety assertion was relaxed.

## Browser display limitation

The browser showed **“This response couldn’t load”** for final responses even while its tool calls completed. Reloading did not resolve it; a separate plain-text turn with no tools reproduced it. This does not establish the underlying cause, and clean browser response rendering is not claimed.

To preserve actual outcomes, browser Chat wrote `browser-results.json` through Workbridge in the disposable fixture. It contains observed tool results, operation IDs, owner identity, hashes, and errors. Independent CLI results, saved journals, and file bytes corroborate the report. Accessibility snapshots and screenshots retain the browser's visible tool-sequence summaries and rendering failure.

Hosted failing MCP calls appeared inside an `INVALID_ARGUMENT` wrapper containing the original structured `PATCH_BLOCKED`/`PATCH_CONFLICT` JSON. The browser could inspect and record the nested diagnostics; the CLI returned JSONL with exit 1 directly.

## Evidence and next phase

Main-checkout evidence is under `.local/wb007-deployment-20261020-01/`:

- `baseline.json`, `preflight.json`, and `integrity.json`: original source/index hashes, sealed-release identity, and installation/backup checks.
- `cli-tools.jsonl`, phase-specific `.input.json`/`.jsonl` files, and `acceptance.mjs`: noninteractive requests and observed CLI outcomes.
- `browser-results.json`, `browser-job-results.json`, `hosted-acceptance.json`, browser accessibility snapshots/screenshots, and the linked conversation: hosted tool evidence and explicit rendering limitation.
- `installed-runtime-patch-cli-tests.log` and `fixture-restoration.json`: disposable restart/recovery verification and restored file bytes.
- `docs-before/`: original bytes of documentation updated after acceptance.

Final checks confirmed 118 original files remained byte-identical, all eight intentionally updated documents had verified original backups, six configuration files and the Git index were unchanged, and the only new source-tree file was this report. Formatting, scoped whitespace checks, and 91 local documentation links passed. `final-verification.json` records these checks.

AI-009 remains the next coding phase in the [roadmap](ai-workflow-improvements.md): durable edit, validation, and review state using the existing patch and job owners. These recorded results precede that phase. Browser display troubleshooting can proceed separately from the verified bridge operation contract.
