# WB-026 — Coordinated six-lane continuation checkpoint

Updated: 2026-10-26 (America/New_York). Repository: `C:\work\workbridge-mcp`.
This is a continuation of the existing Workbridge development program, **not a restart or a separate RiftReader2 project**. User authorizes sustained multi-agent work, narrow verified commits, autonomous blocker investigation and reuse of existing tools. Production Windows desktop/VM control is the highest feature priority, subject to exact identity/lease and rollback checks.

## Live invariant

- Workbridge production remains **0.16.3-dev / 52 tools**. Independent `diagnostics` shows a healthy tunnel and live local CLI. The shared command pool has six slots; **six slots do not mean six AI workers**. Do not launch a competing owner against `.local`.
- Candidate GUI-006 `0.16.4-dev / 56 tools` was privately MCP tested with real VMware host PNG and preserved host-window state, sealed at `.local\releases\gui006-20261026-01`, all seven WB-001 release gates passed. **NOT deployed**. Existing `gui006-activate-20261026-01` activation was refused BEFORE runtime changes (no journal) because the active process reports 0.16.3 while the on-disk `dist/server.js` reports 0.16.4. Never force-start, bypass the gate or rerun this operation with a new identity.
- The original last-known-good **0.16.3-dev / 52-tool release has now been LOCATED AND VERIFIED**, despite earlier notes saying none was in the local release catalog. Origin: `C:\work\workbridge-wb022-20261021-01\candidate\.local\releases\wb022-20261021-review01`. Its `validated.json` records seven successful gates; its manifest has **3,010 entries**, SHA-256 `04b5caafb9f2e91552fce1d2a91c02456b7e43073e8c60dc3e217dde6a7c9a26`, and its `payload/dist/server.js` matches 0.16.3. `.local\update-operations\wb022-activate-20261021-01\journal.json` confirms completed 0.16.3 activation.
- New read-only `scripts/Diagnose-WorkbridgeRelease.ps1 -LiveHealth -OperationId gui006-activate-20261026-01` executed against the actual installation: exit **1 because expected identity mismatch**, with `liveToInstalled=match`, `liveToBuild=mismatch`, `installedToBuild=mismatch`, ready=true, no guest/GUI changes. This is a useful diagnostic, **not a failed live server**.
- WB-001 updater currently replaces only `dist`, `node_modules`, `package.json`, `package-lock.json`; GUI-006 starts separate `scripts/*.mjs` prototypes from the developer tree. Solve packaging/source-runtime isolation before claiming a fully independent, reproducible production GUI installation. Avoid modifying runtime files or rebuilding the active checkout to fix the mismatch without independently validated baseline repair/rollback.

## Reviewed and committed narrow work

All commits were selected-file commits using the repository-local Git identity; unrelated modified/untracked files, index and credentials were preserved.

| Commit | Improvement | Independent verification |
| --- | --- | --- |
| `8a155f4` | Read-only installed/built/live release diagnosis | 24/24 focused tests, safe loopback and bounded metadata |
| `abd72bf` | Pure bounded job/capacity/alert classifier | 16/16 focused tests, no execution or secrets |
| `a78d5c8` | DesktopProbe-only exact-session/approval/lease **dry-run preflight** | 67/67 combined focused tests, no real input |
| `76c078c` | Pure scoped command risk/permission/path preview | 14/14 focused tests; fixed Windows UNC above-share traversal |
| `f16c79a` | Status and per-file ownership view over EXISTING `AgentCoordination` | 32/32 combined coordination tests, verified-task ownership release |

**None of the pure review/preflight modules should be described as a production actuator.** The desktop preflight result explicitly says `executed=false` and is not transferable input authorization. Command policy says `previewOnly=true` and is not an OS sandbox. The agent wrapper shares the pre-existing durable coordination ledger; it is not a new AI process scheduler.

## Worker ledger (actual external coding agents)

Initial workers (Codex CLI) had exclusive file ownership for desktop preflight, release diagnostics, agent status, operational alerts, command preview and Git audit. Workers 2/4/1 passed their focused checks; partial workers 3/5 stopped on provider-capacity errors, and their code was reviewed/fixed/tested by coordinator. First Git audit worker received repeated 429 errors and produced no verified result.

Follow-on run (as of this checkpoint), under `.tools\wb26six-20261026\`:

- `wb26-git-audit-codex-resume-20261026-02`: read-only scoped Git baseline planning; note the agent may propose a Node script outside its original PS-only task. Inspect exact files and scope before accepting or committing.
- `wb26-followon-codex-7-20261026-01`: read-only, manifest-verified last-good baseline repair PLAN with synthetic tests only.
- `wb26-followon-codex-8-20261026-01`: independent desktop action POSTCONDITION verifier from synthetic evidence only.
- `wb26-followon-codex-security-review-9-20261026-01`: independent security review of desktop session/approval/lease/replay implementation, receipt only.

Treat a live job as running only after fresh `command_status`; on completion inspect its final exit AND owned file receipt, then rerun tests separately. A 429 or a worker saying completed is not proof of verified code. Assign independent follow-on tasks as capacity permits; never have multiple writers for one file. Shared input/VM actions require separate owner/fencing.

## Next gates, in strict order

1. Wait/reconcile the four follow-on jobs; independent review of desktop security and real code/test coverage.
2. Commit reviewed, independently tested owned slices with exact hashes/current HEAD; reject scope violations, flaky tests and permission bypasses. Protect pre-existing dirty files and stage only named paths.
3. Build/test new desktop capability in a **separate sealed candidate**, not the active Workbridge installation. Native source preflight and postcondition code have no general arbitrary desktop/VM input permission.
4. Prepare and verify an independent WB-001 baseline repair/cutover plan from the original 0.16.3 seal. Rehearse startup/readiness/failure rollback in disposable installation first; do not patch deployed runtime in place merely to make a version check pass.
5. Stage and validate full runtime dependencies including the WinApp/VMware scripts; use independent update supervisor and fresh hosted app tool discovery after update.
6. Extend agent coordination, monitoring and command safety only via versioned, tested tool contracts; ChatGPT-hosted approval-card detection is not an MCP server feature.

## Current safety and product limitations

ChatGPT's approval card may be hidden under **Previous activity**; issue one visible preflight warning before an approval-prone phase, respect host decisions, and do not attempt browser UI monitoring around a protected browser gate. Guest VMware credentials, VM encryption and Windows logon remain different scopes. Don't change VM/host session or inject game input to qualify read-only code.

`C:\work\workbridge-mcp\docs\gui006-desktop-vmware-2026-10-26.md` is the earlier sealed GUI-006 evidence. Original WB-022 baseline evidence is in `docs\wb022-deployment.md`. Preserve all old `.local` operations, manifests, journal and rollback data; there is no automatic pruning.
