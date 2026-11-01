# WB-008 — Resumable workflow candidate verification

Date: 2026-10-20  
Candidate: **0.9.0-dev**, AI-009, 48 MCP tools  
Deployment: **subsequently deployed as 0.9.0-dev**; see [WB-008 deployment acceptance](wb008-deployment.md). This report retains the pre-deployment candidate evidence.

## Scope and preservation

The candidate adds workflow creation, discovery, status, explicit continuation/retry, bounded review, and cancellation. The CLI exposes every operation through the shared MCP implementation and adds `runWorkflow` to advance/wait without retrying failed checks automatically. Existing patch and job owners provide edits, output, supervision, and guarded undo. No dependency was added. See the [contract and examples](resumable-workflows.md).

Work continued in the attached `codex/ai-workflows` worktree. Before implementation, all non-documentation source files matched the main checkout; only the eight known deployment-documentation updates differed. Those documents and the new WB-007 deployment report were copied into the candidate after preserving its prior documentation. The baseline passed **151 tests**.

The live source checkout, installed runtime, configuration, prior sealed releases, and Git staging are preserved. No service restart, deployment, commit, or real RRE edit is part of this candidate work. Evidence is retained in `.local/wb008-ai009-20261020-01/` in the candidate worktree.

## Development verification

All **172 tests passed**, including **21 new workflow tests** (15 operation tests and six connected CLI/MCP tests). Formatting passed. Tests cover sequential progress, saved launch intents, lost responses, replay identity, explicit retry tokens, stale file versions even after original bytes are restored, changed profiles, cancellation, partial-patch continuation, bounded discovery, corrupted/missing evidence, input/journal/attempt limits, and refusal to overwrite later edits. Real disposable service owners exercise separate CLI/MCP connections, literal arguments, failure exits, deadlines, restart, retained output, and profile execution. A CLI deadline leaves the owner and its current job running; a restarted owner retains passed steps and requires an explicit retry of its stopped step.

Normal browser Chat verification was pending at candidate completion. [Subsequent deployment acceptance](wb008-deployment.md) confirms the workflow tools passed; the browser display issue recorded for 0.8.0-dev persists.

The first release copy, `wb008-20261020-review01`, correctly failed validation: the added `workspace_info.workflows` guidance was absent from the strict output schema. Its 170/172 passing test result and failed receipt attempt are retained. The schema was corrected; no runtime deployment occurred. The fresh release copy passed every gate.

## Sealed release

Release **`wb008-20261020-review02`** passed all seven checks: pinned dependency installation, **172 tests**, startup, **21 updater cases**, formatting, self-contained acceptance, and the **48-tool** release probe. Workbridge ran this preparation as job **`wb008-seal-release-20261020-02`**; no installation or service restart was requested.

Release path: `C:\Users\mrkoo\.codex\worktrees\workbridge-ai-workflows\workbridge-mcp\.local\releases\wb008-20261020-review02`  
Manifest SHA256: `F547C34E712397AF7644FF454AD3A92DFBCC87518D300199709504202D5ABE50`

`validated.json` records every exit code as zero and `hostedVerified: false`. The sealed payload remains unchanged; this source report was completed after sealing. Implementation, test, CLI, and dependency files are compared with the sealed manifest before handoff.

A separate runtime-only fixture installed production dependencies with `npm ci --omit=dev --ignore-scripts --offline`. All **six workflow CLI integration tests passed** without source files or TypeScript, including cross-client continuation, literal arguments, explicit retries, deadlines, owner restart, cancellation, profile pinning, and preservation of later edits. The fixture used matching compiled runtime bytes. Logs are `runtime-only-install.log` and `runtime-only-tests.log` in the evidence directory.

The initial runtime-only run used the local build's native command host. Its binary checksum differed from the separate release build, so the fixture was replaced with the exact sealed `dist` files and all six integration cases were rerun successfully. Final runtime-fixture checksums match the sealed release.

## Handoff

At handoff, the candidate remained in the attached worktree, separate from the then-live 0.8.0-dev checkout and runtime. `final-verification.json` confirms **127 main source files** and **2,774 live runtime files** unchanged, both Git indexes preserved, **2,907 sealed files** verified, **99 implementation/test/package files** matching the sealed copy, and **88 local documentation links** valid. `ai009-changes.diff` isolates this phase's 20 changed/new files from inherited work. Prior source contents are retained in `source-before/` where they match the original baseline; prior candidate deployment documents are retained in `docs-before/`.

The subsequent authorized WB-001 deployment and disposable browser Chat ↔ CLI acceptance are recorded in [WB-008 deployment acceptance](wb008-deployment.md). They cover create/start, discovery/continuation/review, explicit failed-check retry, stale-input refusal, cancellation, and guarded undo. Browser response rendering remains separately unresolved. AI-010 and AI-011 have not started.
