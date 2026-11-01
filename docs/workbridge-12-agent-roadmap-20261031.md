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

## Progress ledger — verified deployed and isolated gates

- M1: scoped Git gate advanced to nine narrowly reviewed code/config commits: `3700955` (Git audit/planner, 24/24 tests), `edef6a0` (screenshot receipt, 6/6), `66e12a3` (offline desktop policy, 44/44), `c2d1de8` (read-only retention preview, 18 passed/1 skipped), `e6331a4` (JSON LF checkout rule), `62fa545` (standalone command-risk advisory, 17/17 tests, TypeScript and format passed), `183cbe2` (read-only baseline-repair planner, 36/36 synthetic tests, format passed), `ef3dee7` (bounded PNG evidence reader, 18 passed/1 skipped, TypeScript and format passed), and `73d3b22` (bounded command-result evidence reader, 10/10 tests, TypeScript and format passed). Separate roadmap commits: `4766a7b`, `54bef54`, `0bbeb1f`, `eb3e5bf`. No service restart, remote push or blanket staging. The broader 0.16.4 integration cohort and historical documents remain uncommitted pending dependency review.
- M2: deployed. Sealed candidate `artifact-verify-20261031-01`, manifest SHA-256 `1DD6D4457B3182A695EB8C4AC3E51BEEAB1C87724B841A69BF6B8CAED21B4A5B`, all nine recorded checks exit 0. WB-001 operation `artifact-verify-update-20261031-01` journal phase `completed`, new instance `6b9008e9-990b-4078-a6fd-6fc0214b24bd`. Five changed `dist` files match the sealed payload; native command-host source/compiler input digest unchanged; 2,731 dependency files and both package manifests identical. Disposable compiled-runtime MCP artifact mismatch/recovery test 2/2 passed. Healthy tunnel and 12 free command slots.
- M3: achieved. After Joey refreshed Workbridge's catalog, a fresh ChatGPT turn exposed all 64 tools including all eight `agent_*` coordination tools. Direct ChatGPT calls to `agent_list` and `agent_status` passed: 12 worker assignments available, zero running assignments and zero file owners. Live diagnostics show `0.16.4-dev`, the postdeployment service instance, a ready tunnel and healthy command capacity. No permissions reset or service restart was needed.
- M4: twelve distinct independent reasoning agents each made live Workbridge calls and returned separate reviews, in two waves of six. The current runtime permits only six simultaneous subagents plus the coordinator; the full twelve-simultaneous inference gate is not yet demonstrated. Twelve command/metadata slots must not be called twelve AI sessions.
- M5 release-race guard: source updated but **not deployed**. `src/jobs.ts` shares `.local/updater.lock` across durable command admission; `Workbridge-Update.ps1` requires a stop-time `CheckIdle`; the controller queries live diagnostics through the local CLI and refuses busy, retained, closing, incomplete or unavailable states. All 37 updater fixtures passed; both adversarial Windows cross-process lock tests passed. Fresh sealed candidate `updater-quiescence-20261031-03` passed all nine release checks, including full compiled-runtime tests (1,030 passed, 0 failed, 3 skipped), TypeScript and formatting. Manifest SHA-256 `B5E61D7204E8294376C55EC719AF8A891EC48193A401F9E4810B0CF78F9B23A8`. No service stop, deployment, Git push or new instance; the old deployed binary remains in service.
- M6 live twelve-lane stress (2026-11-01): initial diagnostics 12/12 free; twelve separate `terminal_run` Node synthetic jobs (`wb-capacity-stress-20261101-01-lane-01` through `lane-12`) were simultaneously **running and occupying all 12 slots** in an independent diagnostics snapshot. Each printed distinct start/end PID/timestamps and exited 0 with `passed` status; recorded all-twelve overlap **7.055 seconds**, mean hold **20.011 seconds**. After settlement diagnostics returned to 12/12 free, zero in-progress/retained, complete inventory, unchanged healthy tunnel/instance. The attempted thirteenth live command was admitted only after at least one earlier job had completed, so it is **not** evidence of a live full-pool rejection. Focused isolated `test/job-capacity.test.mjs` **14/14** passed, including `JOB_LIMIT` at 12 retained slots and recovery; `test/agent-coordination.test.mjs` **28/28** passed, including atomic twelve-worker dispatch and thirteenth-assignment `AGENT_CAPACITY` rejection. This validates command capacity and coordination metadata, **not** twelve simultaneous AI inference sessions; no code/deployment/service changes.

- M7 Edge dual-chat pilot (2026-11-01): documented a **hypothesis**, not a proven twelve-inference capability, in [the two-session Edge experiment](chatgpt-edge-two-session-12-agent-test.md). The connected Edge browser-control extension exposed tab/navigation APIs, but its host security policy **rejected automated navigation to `https://chatgpt.com/`**. No second ChatGPT tab or reasoning session was verified or created. Joey may manually open a second conversation for a guarded, read-only six-plus-six pilot; account-wide concurrency and overlap remain unverified. No browser-permission workaround, runtime modification, or service deployment was attempted.

- M7 follow-up (2026-11-01): Joey manually opened a new Edge `https://chatgpt.com/` tab, which the browser extension listed successfully. The browser host then **denied the attempt to inspect/control that newly opened tab**; no Session B prompt was submitted and no additional reasoning workers were started. The existing Workbridge tab was independently controllable, but that does not grant access to the new tab. Await Joey's manual Session B prompt/worker evidence; full twelve-way inference gate remains open. Details in [the Edge experiment](chatgpt-edge-two-session-12-agent-test.md).

## Release collision and recovery

- At the pre-Apply idle check all 12 command slots were free. The separate `riftreader2` job `rr2-lab1-bind-final-execute-20261031-a` started at `2026-10-31T17:57:26Z` after dispatch, while WB-001 was preparing. The updater stopped Workbridge at approximately `17:57:32Z`; that job is now `interrupted` with no retained output. Do not blindly replay; its owner should inspect partial external effects and issue a new recovery command only if safe.
- This was an admission race in the release workflow, not a failed release or rollback. The new source and sealed candidate cover both sides of the lock race, but the running binary still predates the guard. **Initial activation requires an exclusive maintenance window agreed with all Workbridge command clients**, not merely an observed idle snapshot. Do not replace this gate with a forced stop or replay the interrupted RiftReader2 job.

## Next actionable gates

1. Keep M3's verified 64/64 ChatGPT catalog; no additional refresh is needed.
2. Review, test and commit a coherent 0.16.4 runtime dependency closure (package manifests, shared server/jobs/schema, imported modules, local CLI), including the guarded release workflow. Preserve unrelated dirty paths, untracked files and Git staging; do not commit a partial nonbuildable runtime.
3. Agree an exclusive window with all Workbridge command clients for the **first** guarded rollout. Recheck the sealed candidate against current source, Apply through WB-001 only during that window, then verify the new instance/tunnel, admission refusal under a synthetic held lock and postrelease diagnostics. The existing running binary cannot honor an updater lock yet.
4. Leave the interrupted RiftReader2 command untouched until its owner inspects possible external side effects and chooses recovery.
5. Arrange an environment with twelve genuine simultaneous AI reasoning slots. One unverified path is the [manual two-ChatGPT-session Edge pilot](chatgpt-edge-two-session-12-agent-test.md): Joey opens a second conversation and tests six-plus-six read-only reasoning workers without bypassing blocked browser automation. Instrument overlapping per-agent calls, identity, and completion; a second tab alone, twelve command slots, or two waves of six do not satisfy this gate.

Use `AGENTS.md` and `docs/autonomous-investigation-policy.md` for scope, approval notices, and recovery. Source commits, live deployment and off-machine backups are separate outcomes.
