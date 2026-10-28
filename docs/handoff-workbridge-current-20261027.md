# Workbridge-MCP — operational handoff (2026-10-27, 22:13 EDT)

**Repository:** `C:\work\workbridge-mcp` (Git `main`)  
**Purpose:** Resume Workbridge infrastructure, maintenance, and PC/VMware automation without losing the verified RIFT AddOns workspace-root change. This handoff supersedes stale version/roots statements in older roadmap files.

## 1. Owner decisions and project boundaries

- **RIFT API deployment and live addon testing belong in the separate RIFT API project** (`C:\work\Rift API`). Joey will resume that project separately. **Do not deploy, alter, or test RiftApiCollector in-game from the Workbridge-MCP conversation.**
- **Agent-count expansion is deferred.** No new 25-agent swarm, four-chat scaling pilot, concurrency expansion, or major scheduler architecture unless Joey explicitly resumes it. Existing coordinated development and normal command jobs are not automatically prohibited; do not mistake six Workbridge command slots for six simultaneous independent model agents.
- Keep Workbridge-MCP focused on service health, configured workspace access, desktop/VMware automation, reliability, release engineering, and recovery when requested.
- Preserve existing source files, unrelated modified/untracked files, service state, private journals, and backups. Small, reviewed commits only. No remote push by implication.

## 2. Latest directly verified live state

A fresh connected `workspace_info` call on October 27 returned:

| Item | Observed value |
| --- | --- |
| Workbridge runtime | **0.16.4-dev**, responsive over connected MCP |
| Local CLI | enabled |
| Service process | PID **4872** |
| Instance ID | `21c53ffb-acd6-4388-a74c-4f013dc61ad9` |
| Start UTC | `2026-10-27T17:21:35.318Z` |
| Primary workspace root | `C:\work` |
| Additional root 1 | `C:\rift modding` |
| Additional root 2 | `C:\Users\mrkoo\OneDrive\Documents\RIFT\Interface\AddOns` |
| Bounded command job capacity | **6** |
| Working directory and private state | `C:\work\workbridge-mcp`; private state at `.local` |

**Important:** The current `0.16.4-dev` observation supersedes October 26 documentation describing a live `0.16.3-dev` owner. Version equality alone **does not prove** that the currently loaded bytes match sealed candidate #07 or that the four proposed GUI-006 tools have passed fresh hosted acceptance. Reinspect catalog/runtime identity before claiming those deployment milestones. PID and port identities must also be rechecked on every new session.

## 3. Installed RIFT AddOns root — BLOCKER RESOLVED

Earlier, file access to the real addon directory failed with `OUTSIDE_ROOT` because only `C:\work` and `C:\rift modding` were configured. The actual Documents directory is OneDrive-redirected, and the destination is:

`C:\Users\mrkoo\OneDrive\Documents\RIFT\Interface\AddOns`

On October 27, the existing `scripts\Manage-WorkspaceRoots.ps1` configuration utility added **only that precise directory**, using a temporary limited-user Windows scheduled helper to avoid the service command's shared configuration lease. The saved `scripts\Restart-Workbridge.ps1` path restarted the established Workbridge service. No competing owner was launched.

**Proof and recovery evidence:**

- After restart, `workspace_info.roots` reported all **three** exact roots, and version remained `0.16.4-dev`.
- A Workbridge `file_info` call read existing `RiftReader2\RiftAddon.toc`, SHA-256 `b622aa296b4a909de01ddc30b9b11949e2d97f34deac4c3dd00e8fa3a918a34d`.
- Workbridge created `WorkbridgeRootWriteProbe_20261027_01.txt` in AddOns, independently reread its **109-byte** contents by SHA-256 (`b8bad752b406170b380624051a119f12e9f1ea33d4f084a081d6f3ceb575a6b5`), used guarded `undo_change`, and confirmed `ENOENT` afterward. **No existing addon was edited.**
- Automatic previous-config backup: `C:\work\workbridge-mcp\.local\root-config-backups\1793121689769-0c4e1b86-bb28-450c-a9eb-b8c355040b35.json`.
- Durable completed receipt: `C:\work\workbridge-mcp\.tools\workbridge-rift-addons-root-20261027-result.json`; reports `changed=true`, `restartVerified=true`, `rollback=not-needed`, `error=null`.
- One-time task `Workbridge Helper rift-addons-root-20261027` was unregistered. No startup trigger is retained.
- Related Git milestone: **`6ccd891c0d65488de87df26650b08fc26ca57320`**, `docs(workbridge): record verified RIFT addon root access`.

This proves scoped Workbridge file read/write and recovery. It **does not** authorize this project to deploy a RIFT API addon or establish Windows Clipboard/in-game behavior. The actual addon folder has OneDrive Cloud Files/reparse metadata, so inspect path and hydration before any future addon deployment **in the RIFT API project**.

## 4. Git baseline and recent commits

Before writing this handoff, `main` HEAD was `6ccd891c0d65488de87df26650b08fc26ca57320`.

Most recent ten commits, newest first:

| Short SHA | Subject |
| --- | --- |
| `6ccd891` | docs(workbridge): record verified RIFT addon root access |
| `193eda0` | docs(workbridge): hand off RIFT pivot and defer agent scaling |
| `f9955c3` | docs(workbridge): confirm V23 supervisor cleanup via passive status |
| `adb1038` | docs(workbridge): record independently verified legacy rollback startup |
| `bf46442` | docs(workbridge): checkpoint validated native Job candidate and V23 receiver |
| `5eec212` | test(gui): gate grandchild lifetime deterministically across schedulers |
| `e378da9` | feat(gui): prove native Windows desktop Job lifetime in synthetic process tree |
| `a2dda0d` | docs(workbridge): checkpoint GUI release seal and verified WB-022 rollback files |
| `671da19` | fix(release): validate GUI runtime metadata types at update boundary |
| `36cbba2` | feat(gui): seal VMware host-turn owner leases and inspect quarantine offline |

The working tree has **extensive older modified and untracked files** across `src`, `test`, `scripts`, `docs` and package files. Preserve them. Never `git add -A`, blanket-stage, stash, reset or delete them; review exact file ownership, hashes and diffs before each milestone commit. This handoff is documentation-only.

## 5. GUI-006 development and deployment distinction

Historical sealed release candidate:

`C:\work\workbridge-mcp\.local\releases\pcvm-gui006-20261026-07`

- Version: `0.16.4-dev`; **desktop/VMware tooling**, *not* the deferred 25-agent expansion.
- Proposed four added tools: `desktop_windows`, `desktop_inspect`, `desktop_capture_window`, `desktop_capture_vmware_host` (historical private catalog 56 versus former live 52).
- Isolated candidate #07 tests: **1,023 passed, 0 failed, 3 skipped**; nine reported release gates passed. Candidate manifest SHA-256 `DD44607FEE488963BC3276764CCD550D6F4F776A734D7F9929169E08898C0240`.
- Candidate's private stdio probe explicitly had `hostedVerified=false`. At that earlier checkpoint it was **not deployed**. The currently running service has since advanced to the same version, but **the exact installed release provenance and hosted GUI-006 acceptance were not established by this handoff**.
- Generic desktop keyboard/mouse and game/VM guest input were **not** part of the GUI-006 four read-only/capture tools.
- Windows native Job Object lifetime prototype is source-committed with deterministic synthetic tests, but actual production desktop-command integration and complete process-tree settlement still require verification.
- October 26 passive V23 guest receiver PID `26412` was host-identified with a healthy supervisor, but `guest.responseVerified=false`; that is **stale historical evidence**, not authorization for live VM control.

Keep Windows desktop screenshot control, VMware *host-frame* capture, guest receiver communication, and in-game control as separate capabilities and acceptance gates.

## 6. Deferred maintenance/work queue (not active autonomous tasks)

| ID | Next useful work | Constraint |
| --- | --- | --- |
| MNT-001 | Read-only service/loaded-runtime identity, tool discovery, installation receipt, journal, roots/backup audit, full job catalog | Do not restart a healthy owner unnecessarily |
| MNT-002 | Reconcile release identity and verify GUI-006 hosted catalog/capture with isolated/target-specific acceptance | No claim that `0.16.4-dev` alone proves all four tools |
| MNT-003 | Native process-tree desktop supervisor integration and synthetic two-client GUI/VM lease/quarantine tests | No unverified live input |
| MNT-004 | Isolated WB-001 update/rollback controller exercise using preserved 0.16.3 baseline | Never bypass version/identity preflight |
| MNT-005 | Child-readiness fixture reliability and coherent reviewed dirty-tree checkpoints | No broad reset/cleanup |
| CAPACITY | 25-agent swarm/concurrency scaling and four-chat pilot | **Deferred by Joey** |

Workbridge's October 26 historical 0.16.3 baseline remains verified in a separate private startup test (2,808 copied runtime files, 52 MCP tools, exit 0). This is recovery evidence, not a blanket authorization to reinstall.

## 7. Project ownership and resumption boundaries

- **Workbridge-MCP (this repository/conversation):** Workspace permissions, MCP service health, file/command/git capabilities, release/recovery, PC desktop/VMware automation, developer tooling.
- **RIFT API (`C:\work\Rift API`, separate ChatGPT project):** `RiftApiCollector` source, `.toc`, Lua logic, addon installation, live game test, exports/clipboard. Joey explicitly said he will resume RIFT API deployment **there, not here**.
- **RiftReader2 / REA:** Independent workstreams; coordinate cross-project changes, do not edit them as a side effect of a Workbridge maintenance task.

## 8. Restart/approval/safety checklist

1. Re-read `AGENTS.md`, `docs\autonomous-investigation-policy.md`, this handoff, and `docs\pc-vm-automation-agent-queue-20261026.md`. For desktop/VMware work, also consult `docs\interactive-desktop-vm-roadmap.md`.
2. Call `workspace_info`, fresh `git_status`, and `git_history(limit=10)`. Distinguish active version from the older historical notes.
3. Avoid launching a duplicate Workbridge owner or running `npm run build` over a live-installed `dist`; use isolated test/build outputs.
4. If an actual ChatGPT Workbridge permission prompt appears, tell Joey to inspect **Previous activity**. Do not claim approval until host reports the tool response.
5. Preserve all preexisting uncommitted work and recovery receipts; stage only hash-verified files. Commit clean milestones with exact paths.
6. **No RIFT API deployment from this conversation**; route it to the separate API project.
7. Do not restart the deferred agent scaling experiment without a new instruction.

## Copy/paste resume prompt

> Resume Workbridge-MCP from `C:\work\workbridge-mcp\docs\handoff-workbridge-current-20261027.md`. Recheck live `workspace_info`, Git status and latest 10 commits; preserve all dirty files. RIFT API addon deployment belongs to the separate RIFT API project. Agent scaling to 25 and four-chat experiments remain deferred. The RIFT AddOns root was added and its read/write/undo test passed. Focus only on the Workbridge maintenance or PC/VMware automation task I give next, committing narrow verified milestones.
