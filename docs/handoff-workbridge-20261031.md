# Workbridge-MCP operational handoff — 2026-10-31

**Owner:** Joey  
**Repository:** `C:\work\workbridge-mcp`, Git branch `main`  
**Scope:** Workbridge MCP infrastructure, Git reconciliation, guarded release, and real AI reasoning-agent test. Ordinary ChatGPT and Workbridge only; no Codex CLI or paid external model API.

This document supersedes dated service/capacity assumptions in `docs/handoff-workbridge-current-20261027.md` for this workstream. It does not overwrite the earlier handoff or change RIFT API project ownership.

## 1. Current live state — directly verified at handoff

- Workbridge service `0.16.4-dev`, instance `6b9008e9-990b-4078-a6fd-6fc0214b24bd`, PID `24984`, started `2026-10-31T17:57:41.783Z`.
- Primary workspace: `C:\work`. Also authorized: `C:\rift modding`, the OneDrive RIFT AddOns directory, and the OneDrive RIFT Screenshots directory. Re-read `workspace_info` for exact root strings before using them.
- Tunnel `available=true`, `ready=true`, control plane `ok`; local CLI enabled.
- Diagnostics at handoff: **12 total command slots, 0 occupied, 12 available, 0 in-progress, 0 retained results, closing=false**. Inventory complete, with no reported scan error.
- The preceding checkpoint confirmed 64/64 ChatGPT Workbridge tools, including eight `agent_*` coordination tools. This is an earlier verified catalog result, not a newly repeated 64-tool enumeration.
- **12 command/coordination slots are not 12 simultaneously reasoning AI agents.** A reasoning-worker limit belongs to the ChatGPT environment, not to the Workbridge service.

## 2. Git identity and reconciliation

- Git `main` HEAD **before this handoff**: `210b595c473465507b19c7f94adf6bf1918977c1` (roadmap ledger update). If this handoff is committed, that commit becomes the new HEAD; check `git_history` on resume.
- The worktree remains extensively modified and untracked across manifests, `src`, `test`, `scripts` and older documentation. At this handoff, no unrelated files were staged or cleaned. **Preserve all of them.**
- Nine small code/config checkpoints already committed:
  - `3700955` Git audit/planner: 24/24 tests.
  - `edef6a0` screenshot receipt: 6/6 tests.
  - `66e12a3` offline desktop policy: 44/44 tests.
  - `c2d1de8` read-only retention preview: 18 passed, 1 skipped.
  - `e6331a4` JSON LF checkout attribute.
  - `62fa545` command-risk advisory: 17/17 tests, TypeScript and formatting.
  - `183cbe2` read-only baseline repair planner: 36/36 tests.
  - `ef3dee7` bounded PNG evidence reader: 18 passed, 1 Windows symlink-privilege skip; TypeScript and formatting.
  - `73d3b22` bounded command-result evidence reader: 10/10 tests; TypeScript and formatting. Exact test job `wb-command-result-focused-tests-20261031-01`, exit 0.
- Roadmap commits: `4766a7b`, `54bef54`, `0bbeb1f`, `eb3e5bf`, `210b595`. Authoritative current plan: `docs/workbridge-12-agent-roadmap-20261031.md`.
- **Dependency review boundary:** `src/history.ts` calls `Workspace.historyPath`, which exists in the dirty `src/workspace.ts` but not in the committed baseline. Do not commit history alone. `src/desktop-cli-runner.ts` references four sibling prototype `.mjs` assets that require the integrated staging/build closure; do not checkpoint the runner alone as if deployable.
- The committed manifest still identifies `0.6.0` while the working/live source identifies `0.16.4-dev`. Do not commit `src/server.ts` or package files in isolation without the coherent imported runtime/test/build cohort.
- Commits are **local**; no remote push or off-machine backup is implied.

## 3. Artifact-verification release — completed

- Artifact verification is deployed on the healthy `0.16.4-dev` instance above, separate from the updater-race guard below.
- Sealed candidate `artifact-verify-20261031-01`, manifest SHA-256 `1DD6D4457B3182A695EB8C4AC3E51BEEAB1C87724B841A69BF6B8CAED21B4A5B`.
- WB-001 updater journal operation `artifact-verify-update-20261031-01` completed. Nine recorded release checks exited 0. Five changed compiled `dist` files matched sealed payload; dependency manifests and 2,731 dependency files remained identical; disposable compiled-runtime artifact mismatch/recovery checks passed 2/2.
- Do not deploy the same artifact fix again merely because source documents still contain their original predeployment baseline paragraphs.

## 4. Release admission-race guard — sealed, **not deployed**

- Previous WB-001 Apply had an actual admission race. RiftReader2 job `rr2-lab1-bind-final-execute-20261031-a` started `2026-10-31T17:57:26Z` after the idle snapshot, before the service stop at about `17:57:32Z`; its result became `interrupted` without retained output.
- **Do not rerun, recover or infer success/failure of that job in this Workbridge conversation.** Its RiftReader2 owner must inspect possible external partial effects and choose a safe recovery path.
- New source jointly guards the admission and stop boundary: `src/jobs.ts` uses `.local/updater.lock` for durable command admission; the updater has stop-time `CheckIdle`; controller asks the live CLI diagnostics and refuses busy, retained, closing or incomplete states.
- Sealed candidate `updater-quiescence-20261031-03`, manifest SHA-256 `B5E61D7204E8294376C55EC719AF8A891EC48193A401F9E4810B0CF78F9B23A8`. All nine release checks passed, including 37 updater fixtures, two adversarial Windows cross-process lock tests, TypeScript/formatting, and compiled runtime tests (1,030 passed, 0 failed, 3 skipped).
- **Still not deployed.** The live binary predates the new admission lock. Even an observed 12/12 idle service does **not** reserve a future quiet interval. Initial guarded rollout requires an **exclusive maintenance window agreed with all Workbridge command clients** (including RiftReader2) so no fresh jobs arrive during stop/Apply.
- During that agreed window only: recheck candidate versus source, validate full dependency closure and stage/Apply through **WB-001**, check fresh diagnostics immediately before and during the release, then verify new instance, tunnel and synthetic held-lock admission refusal. No competing service owner, forced stop, blind replay or bypass of the guarded update workflow.

## 5. Actual reasoning-agent test — partial operational success

- Twelve **distinct independent reasoning workers** previously made live Workbridge read-only calls in **two waves of six** and returned separate reviews.
- The observed ChatGPT environment exposed up to **six simultaneous reasoning subagents plus the lead**, not twelve simultaneous inference workers.
- Workbridge `MAX_CONCURRENT_JOBS=12` and coordination-worker capacity 12 are command/assignment limits, not proof of twelve independent concurrent AI inference sessions.
- Full acceptance gate remains open: use a runtime genuinely exposing twelve simultaneous reasoning-worker slots, then measure overlapping sessions, each worker's distinct call, ownership and completion. Do not relabel two sequential waves as one 12-agent concurrent run.
- Previous 25-agent swarm/four-chat scaling experiments remain deferred; do not expand the architecture without a new Joey instruction.

## 6. Next executable roadmap

1. **Continue Git reconciliation without service changes.** Inspect `AGENTS.md`, `docs/autonomous-investigation-policy.md`, this handoff and the roadmap. Refresh `workspace_info`, `git_status`, `git_history`, and, before shared-service actions, `diagnostics`.
2. **Review the integrated `0.16.4-dev` dependency closure**: package manifests/lock, `src/core.ts`, `src/workspace.ts`, `src/jobs.ts`, `src/changes.ts`, `src/command-worker.ts`, `src/schemas.ts`, `src/server.ts`, `src/operational-alerts.ts`, local CLI, release scripts and their direct tests/imports. Group only coherent, buildable, reviewable slices; prefer synthetic focused tests and TypeScript/format checks.
3. **Commit each verified slice** with exact file paths, fresh SHA-256, expected full HEAD and a unique durable Workbridge operation ID. Check status/history after each. No blanket stage, stash, reset, delete, push or rewrite of unrelated edits.
4. **Prepare but do not execute the guarded release** until the exclusive maintenance window is explicitly established. WB-001 only; sealed candidate must still match selected source/dependencies.
5. **Continue toward a real twelve-simultaneous-reasoning-agent test** when the host environment can actually supply twelve inference sessions; keep command capacity and model session concurrency distinct.
6. Keep RIFT API addon deployment in its separate project; do not touch RiftReader2 files/VM/input or its interrupted job as a side effect of Workbridge maintenance.

## 7. Operational caveats and user preference

- Practical functionality first; relevant targeted tests instead of exhaustive unrelated benchmark loops. Commit at verified milestones and show progress indicators.
- **Never run `npm run build` inside the installed live Workbridge repo merely for verification**: it writes `dist` that may be used by the live service. Use `tsc --noEmit`, targeted Node tests against known built artifacts, or disposable isolated release/test copies.
- Before the first approval-prone `terminal_run` in a fresh phase, tell Joey ChatGPT may show **“Allow ChatGPT to use Workbridge?”**; he can inspect **Previous activity** if needed. Never claim an approval or job completion without a tool result.
- Keep source commits, live deployments and off-machine backups distinct. Check service identity rather than trusting an old PID/version assumption.
- If a file write, patch or commit result is uncertain, inspect its durable status and current exact hash/HEAD **before** retrying with the same operation ID. Do not invent a fresh request ID to duplicate uncertain work.

## Copy/paste resume prompt

> Resume Workbridge-MCP from `C:\work\workbridge-mcp\docs\handoff-workbridge-20261031.md` and `docs\workbridge-12-agent-roadmap-20261031.md`. Read `AGENTS.md` and `docs\autonomous-investigation-policy.md`. Recheck live Workbridge diagnostics, Git status and recent commits. Preserve every unrelated dirty/untracked file. Continue safe, narrowly tested, SHA-guarded Git reconciliation; prioritize the coherent 0.16.4 runtime dependency closure. Artifact verification is already deployed, the 64-tool catalog is verified, and twelve reasoning workers were tested in two waves of six. Do **not** deploy the sealed updater-race guard until all clients agree on an exclusive maintenance window; do not replay the interrupted RiftReader2 job. Never equate twelve command slots with twelve simultaneous AI reasoning sessions. Report concrete milestones and commit hashes.
