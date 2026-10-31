# Workbridge-MCP: Git and 12-agent operational roadmap (2026-10-31)

Repository: `C:\work\workbridge-mcp`. Owner: Joey. Scope: ordinary ChatGPT + Workbridge; no Codex CLI or external model API.

## Initial baseline (before deployment and tool refresh)

- Live service `0.16.4-dev`, instance `595ecff2-578d-4767-9aaa-ed5da32b23f8`; 12 command jobs and 12 coordination assignments, distinct from AI reasoning sessions.
- Initial Git HEAD `d2c97e7f237b6e16533d0413c1a31fe9cf975332`, branch `main`, no staged files or recovery markers.
- Read-only Git audit `wb-roadmap-git-audit-20261031-01` passed: 31 tracked modifications, 178 untracked files, 82 candidate groups, 105 entries withheld for review. These are metadata suggestions, not approved commits.
- Artifact-hash verification source fix and focused regression are saved under durable Workbridge operations `wb-agent-artifact-verify-fix-20261031-01`, `wb-agent-artifact-regression-20261031-01`, and `wb-agent-artifact-doc-20261031-01`. All 28 focused tests, TypeScript no-emit and Prettier checks passed. The fix is not deployed.
- Live CLI successfully discovered `agent_list`, but this ChatGPT connector's cached catalog omitted eight `agent_*` tools.

## M1 — Reconcile Git into reviewed commits

1. Preserve HEAD/index identities and review exact paths; never blanket-stage, stash, reset, or delete unreviewed files.
2. First commit independent Git audit/planner scripts plus their tests after a focused test and explicit source review.
3. Inventory shared integration dependencies. HEAD's manifest is still 0.6.0, while working source/runtime is 0.16.4-dev; a partial `src/server.ts` commit alone would be nonbuildable.
4. Form coherent dependency cohorts for runtime/jobs, CLI/workflow/history, coordination, desktop/VM adapters, PC health, and historical documentation. Commit exact reviewed file sets only, with SHA-256 and expected-HEAD guards.
5. Record remaining dirty paths and why they cannot yet be committed. Do not call a filename-only suggested group safe without reviewing its imports and tests.

Gate: one or more self-contained exact-file local commits with passing focused checks and unchanged unrelated Git staging; broader baseline still requires review.

## M2 — Guarded artifact-fix deployment (WB-001)

1. Before staging and again before Apply, confirm diagnostics has no occupied jobs, retained results, closing owner, or concurrent work; preserve other projects. This snapshot does not reserve admission. Future releases need an updater-owned quiescence/stop-time recheck or an agreed maintenance window so newly arriving jobs cannot be interrupted.
2. Compare current source with the release payload. The release builder copies broad source folders; do not assume it packages only the artifact fix.
3. Build a fresh sealed candidate through `scripts/New-WorkbridgeRelease.ps1`, inspect `validated.json` and all eight prescribed gates.
4. Apply only a reviewed immutable candidate with `scripts/Update-Workbridge.ps1` and a unique operation ID. Retain exact rollback receipts; never force a competing owner against `.local`.
5. Verify new instance, tunnel, source behavior, 12/12 limits, and connector-independent tool calls. A failed preflight must leave the live owner unchanged.

Gate: passing sealed release, completed update journal, hosted checks, and rollback evidence. No version-number shortcut.

## M3 — Refresh ChatGPT Workbridge tool catalog

1. First verify server-side availability of all eight coordination tools through the shared-service CLI.
2. Use Workbridge plugin Settings > Refresh tools, as documented in `docs/updates.md`. Do not reset permissions or restart the service to force discovery.
3. Check a fresh ChatGPT turn for `agent_list`, `agent_status`, `agent_owner_of`, `agent_assign`, `agent_dispatch`, `agent_dispatch_next`, `agent_finish`, and `agent_verify`.
4. If the host still caches 51 legacy entries, document the client-side limitation and keep server-side evidence separate.

Gate: eight direct ChatGPT tools available, or an explicit externally controlled catalog blocker.

## M4 — Independent reasoning-agent test

1. Count actual AI reasoning sessions separately from Workbridge's 12 command/metadata slots.
2. Have each available independent reasoning worker call Workbridge itself and return distinct, read-only review results; record overlap and coordinator control.
3. The current ChatGPT environment exposes at most six subagent slots alongside the lead. Six verified reasoning workers do not prove 12 simultaneous workers.
4. Run a full 12-worker simultaneous inference test only in a runtime that actually exposes 12 independent worker slots; no fabricated or serial substitution.

Gate: actual independently reasoning workers with traceable Workbridge responses and measured concurrency.

## Progress ledger — verified after deployment

- M1: scoped Git gate passed. Four exact-file local commits: `3700955` (audit/planner, 24/24 tests), `edef6a0` (screenshot receipt, 6/6), `66e12a3` (offline desktop policy, 44/44), `c2d1de8` (read-only retention preview, 18 passed/1 skipped). Uncommitted 0.16.4 integration dependencies and historical documents remain; no blanket staging or push.
- M2: deployed. Sealed candidate `artifact-verify-20261031-01`, manifest SHA-256 `1DD6D4457B3182A695EB8C4AC3E51BEEAB1C87724B841A69BF6B8CAED21B4A5B`, all nine recorded checks exit 0. WB-001 operation `artifact-verify-update-20261031-01` journal phase `completed`, new instance `6b9008e9-990b-4078-a6fd-6fc0214b24bd`. Five changed `dist` files match the sealed payload; native command-host source/compiler input digest unchanged; 2,731 dependency files and both package manifests identical. Disposable compiled-runtime MCP artifact mismatch/recovery test 2/2 passed. Healthy tunnel and 12 free command slots.
- M3: achieved. After Joey refreshed Workbridge's catalog, a fresh ChatGPT turn exposed all 64 tools including all eight `agent_*` coordination tools. Direct ChatGPT calls to `agent_list` and `agent_status` passed: 12 worker assignments available, zero running assignments and zero file owners. Live diagnostics show `0.16.4-dev`, the postdeployment service instance, a ready tunnel and healthy command capacity. No permissions reset or service restart was needed.
- M4: twelve distinct independent reasoning agents each made live Workbridge calls and returned separate reviews, in two waves of six. The current runtime permits only six simultaneous subagents plus the coordinator; the full twelve-simultaneous inference gate is not yet demonstrated. Twelve command/metadata slots must not be called twelve AI sessions.

## Release collision and recovery

- At the pre-Apply idle check all 12 command slots were free. The separate `riftreader2` job `rr2-lab1-bind-final-execute-20261031-a` started at `2026-10-31T17:57:26Z` after dispatch, while WB-001 was preparing. The updater stopped Workbridge at approximately `17:57:32Z`; that job is now `interrupted` with no retained output. Do not blindly replay; its owner should inspect partial external effects and issue a new recovery command only if safe.
- This is an admission race in the release workflow, not a failed release or rollback. Implement a quiescence gate covering the interval from preflight to stop, then add an adversarial test where another project launches a command during backup. Keep its fix separate from the deployed artifact-verification change.

## Next actionable gates

1. M3 complete: keep the verified 64/64 ChatGPT tool catalog and all eight direct coordination entries; no more refresh actions are needed.
2. Review, test and commit the full 0.16.4 runtime dependency closure (package manifests, shared server/jobs/schema, all imported modules) without staging unrelated dirty paths. Update stale deployment references before committing docs.
3. Add updater-owned job-admission/quiescence protection and test the cross-project launch race before any future production update.
4. Inspect the interrupted RiftReader2 command's external effects before its owner chooses recovery.
5. Arrange a runtime with twelve genuine simultaneous AI reasoning slots and instrument overlap, per-agent live calls, ownership and completion.

Use `AGENTS.md` and `docs/autonomous-investigation-policy.md` for scope, approval notices, and recovery. Source commits, live deployment and off-machine backups are separate outcomes.
