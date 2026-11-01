# Workbridge 1–6 improvement program — execution ledger

Started October 26, 2026. Parent coordinator owns integration, reviews, release and exact-path commits. User authorized substantive autonomous work and requested >=5 live subagents, immediate reassignment when an agent completes, and production desktop/VM control first. Code ownership is exclusive per file; the deployed Workbridge owner and user worktree stay untouched until separate WB-001 acceptance.

## Baseline (observed)

- Git HEAD `c8f21570f1ea49e361bb82ddf8b2a308a300279c`; 180 pre-existing modified/untracked status entries; staging empty.
- Running Workbridge **0.16.3-dev** with 52 tools and 6 available job slots; local tunnel connected, control plane healthy.
- GUI-006 sealed **0.16.4-dev** with 56 tools, 600 passing Node tests, 1 expected skip and all seven release gates passed. A private MCP demonstrated authentic, byte-hash-verified VMware host screenshots.
- GUI-006 production activation `gui006-activate-20261026-01` failed **before runtime changes**: on-disk candidate 0.16.4 disagreed with running owner 0.16.3. No deployment journal. Existing updater correctly refused; do not ignore its preflight.
- Important new inventory: `.local/update-operations/wb022-activate-20261021-01/candidate` contains preserved exact 0.16.3 runtime candidate, even though no separate 0.16.3 sealed release entry was in `.local/releases`. Verify hashes before using; this is **not** permission to overwrite live files.
- New desktop adapter uses `scripts/desktop-ui.mjs`, `scripts/desktop-capture.mjs`, `scripts/vmware-host-capture.mjs` and `scripts/desktop-probe-act.mjs` at runtime; old WB-001 replaces only `dist`, `node_modules`, `package.json`, and `package-lock.json`. Solve this versioning/bundling gap before calling the GUI release portable.

## Guardrails

No ChatGPT tab scraping or auto-approvals, no VM gameplay input, no broad UI automation before dry-run/identity/lease acceptance, no unknown credential access, no force-restart of healthy 0.16.3, no blanket Git staging or reset/stash/recursive deletes, and no unapproved remote push. Use per-file hash guards and unique durable IDs. Production screenshot and UIA input are separate acceptance gates, and a VMware window screenshot is not proof of guest receiver control.

## Workstream ownership — first five real Codex workers

All started concurrently through Workbridge at approximately 11:38 UTC. Each worker has its sole code/test paths and an ignored completion receipt under `.tools/wb-six-priorities-20261026-01`.

1. **GUI control preparation:** `src/desktop-action-guard.ts`, `test/desktop-action-guard.test.mjs`; exact-identity, nonexecuting UIA action readiness, no live input.
2. **VMware capture recovery:** `scripts/vmware-host-recovery.mjs`, `test/vmware-host-recovery.test.mjs`; read-only intent/receipt reconciliation.
3. **Release preflight:** `scripts/Inspect-WorkbridgeInstallation.ps1`, `test/inspect-workbridge-installation.test.mjs`; source/live mismatch and missing bundled script diagnostics.
4. **Agent lifecycle:** `src/agent-coordination.ts`, `test/agent-coordination.test.mjs`; durable one-writer ownership, task dependencies and replay-safe completion metadata, not an independent command runner.
5. **Operations:** `src/operations-summary.ts`, `test/operations-summary.test.mjs`; bounded token-safe health and blocked-job reporting.

Parent reserves sixth command slot, inspects results, runs integration gates serially and reviews actual diffs. When a worker completes, immediately assign a new meaningful independent task (runtime script bundling, independently verifiable preflight, command policy, history retention preview, UIA action test hardening, multi-agent CLI integration). Full release gates occur only after no conflicting writers or active development jobs.

## Milestone acceptance criteria

A. **Production desktop/VM:** exact target selection, verified recent UIA and screenshot evidence, exclusive cross-client turn/intent/replay, locked/offscreen rejection, independently evidenced state restoration. Disposable test window before any broad app scope. No unverified VM guest input.
B. **Build and deployment:** immutable candidate includes its entire runtime closure, snapshot/backup of matching last-known-good installed version, independent owner restart/rollback proof, fresh hosted Workbridge tool catalog. Never claim private MCP equals hosted deployment.
C. **Git/recovery:** bounded inventory and reviewed exact-path commits, preserve unrelated dirty files and original staged state.
D. **Multi-agent:** 5 active workers max with 1 coordinator slot, task ownership and dependencies journaled, workers replenished on completion, code review and scoped tests required before commit.
E. **Visibility:** live owner/capacity/last verified outcomes, partial catalog caveats, safe retention inventory, no unverified deletion.
F. **Command safety:** scoped warnings/allowlists, credential redaction and failure/incomplete evidence; do not treat validated `cwd` as an OS sandbox.

## Reporting protocol

For each milestone: evidence path, exact tests/exit, commit hash if made, code/source versus deployed state, known caveats, next task, and blocker resolution. Keep this file updated at durable checkpoints without mislabeling background work. No autonomous future execution after the current Chat session unless a supported scheduled task was explicitly created.
