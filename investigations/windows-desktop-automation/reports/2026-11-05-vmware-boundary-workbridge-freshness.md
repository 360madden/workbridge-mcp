# Nov 5 Workbridge / VMware boundary freshness audit

**Audit date:** Thursday, 2026-11-05 (America/New_York), after 22:55 UTC. **Scope:** read-only Workbridge MCP inspection; no desktop focus/input, RIFT action, VM guest probe, OneDrive change, service restart, GUI guard mutation, or credential inspection. **Owner:** VMware / desktop boundary research lane. **Result:** the older Nov 2 physical desktop GUI quarantine was safely archived under maintenance admission and a later one-shot physical RIFT /reloadui was documented successful. Neither result constitutes VMware guest readiness.

## Executive status

| Area | Latest observed state | Confidence and boundary |
| --- | --- | --- |
| Workbridge daily operation | GREEN: diagnostics and workspace_info passed, 0 in-progress jobs, 36 available command slots, version 0.16.4-dev; local CLI instance be5f373a-8c98-4877-b5dd-dbea9e5728d5, PID 58580, started Nov 5 20:17:49.814 UTC, control plane OK | Direct read-only operational snapshot. Historical command inventory is INCOMPLETE at 20,000 records: never claim complete job history. |
| Old Nov 2 physical GUI guard | GREEN for recovery: active desktop-input-turn.lock absent; linked quarantine sidecar absent; both originals retained in exact-hash archives | Direct independent read-only directory checks and file hashes. Original Nov 2 capture outcome remains UNKNOWN, not retroactively successful. |
| New desktop admission | GREEN for deployment: scripts/desktop-turn-admission.mjs and dist/desktop-turn-admission.mjs have identical SHA-256; no current desktop-turn-admission filename in active evidence directory | New atomic gate is installed; absence merely means unheld at sample time, not a reservation or guarantee for future tasks. |
| Physical RIFT after archive | GREEN for one bounded /reloadui: independently documented same PID/HWND, fresh captured screenshot, RRECollector v0.4.11 init, SavedVariables audit; one-shot submit accepted | Operation executed at 22:21:00 UTC, not 22:32. Transport receipt has submitted:true, verified:false; game-side visual/postcondition verification was separate. Not reusable general click proof. |
| RIFT Lab1/Lab2 and guest OneDrive | YELLOW/UNKNOWN: no fresh guest probes this lane | Host clean guard does not prove VMware guest receivers, session identity, encrypted vmrun permission, guest OneDrive state, or cross-VM latency. |

## Exact evidence and chronology

1. **Handoff predates actual recovery.** The Nov 5 handoff JSON (last modified 20:38:34 UTC) describes the old guard present and game reload not yet performed. It was correct at that instant; later persisted evidence supersedes those two facts.
2. **Quarantine relocation was completed, not deletion.** Archive directory: workbridge-mcp/.tools/desktop-evidence/recovery-archives/manual_gui_live_archive_20261105a. Its journal records maintenance admission held 20:47:06.004 UTC, durable backups 20:47:06.033, durable manifest 20:47:06.039, sidecar relocated 20:47:06.045, guard-last commit 20:47:06.934, postchecks 20:47:06.950. Both backup and relocated copies of the guard hash to 635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0; both copies of the sidecar hash to f1b37ebbeca97b4351d719786beb8c93dc678b76170f7e1a32b04bdecf0750a0. Archive completion explicitly states originalActionOutcome:unknown_outcome and newActionPerformed:false. No RIFT screenshot was replayed as part of archive.
3. **Live active-name inventory:** independent non-recursive, non-truncated Workbridge list_directory filters for desktop-input-turn, desktop-turn-quarantine, and desktop-turn-admission returned ZERO active filenames in .tools/desktop-evidence. The direct old guard and old sidecar file_info lookups failed as nonexistent. This is a momentary read-only observation; any new turn must acquire its own atomic admission and verify target/focus.
4. **One physical /reloadui subsequently ran.** Read-only persisted report gives native Workbridge job physical_rift_reloadui_one_approved_20261105b, user-authorized one-shot ID physical_rift_reloadui_20261105_once02, target physical rift_x64 PID 32156 / HWND 462734, command submission 22:21:00.132 UTC. Preflight attempt ending CHAT_STATE_UNVERIFIED did not input. A one-shot receipt (SHA-256 a5599f78925776bb9bf8282d66031e03b82a7e5c28b842d749deab2217d52560) says submitted:true and verified:false; the later independent screenshot metadata (SHA-256 a65b730a1f3ecaf5da3a06be06add301aaf5ef1645dcade6af1fbc37200283d7) says capture time 22:21:20.214 UTC, same target, 1920x1032 frame and inputInjected:false. Actual PNG SHA-256 ca6bc136f6fda5198d6d392340632953e9d6684ad380f50c4010c46e2a1dda41. Source-hashed completion report says screenshot showed new RRECollector v0.4.11 init, game remained alive and SavedVariables only changed window geometry. **This auditor checked file metadata/hashes and the report, but did not independently decode the screenshot pixels or diff the SavedVariables.** No second reload recommended.
5. **Only physical host; VMware guest boundary still separate.** physical-rift-reloadui.mjs is target-bound to the physical RIFT window, WinApp-based host focus and exact Enter/command/Enter action. vmware-host-capture.mjs is a separate host-window capture mechanism; neither is a demonstrated guest-side UIA tool. RIFT Lab1's earlier queue/receiver issue, Lab2 desktop session and OneDrive stuck/paused root cause remain unobserved in this audit.

## New maintenance gate semantics

The deployed desktop-turn-admission.mjs uses atomic exclusive create of desktop-turn-admission.lock to arbitrate producer versus maintenance. Contention fails closed with UI_TURN_BUSY; it does not auto-break stale locks and does not implicitly clear desktop-input-turn.lock or orphan desktop-turn-quarantine sidecars. The active gate filename was absent at this read-only inspection. To start a new synthetic DesktopProbe/WinApp/sbroenne UIA experiment, first obtain a NEW admission in a quiet-window with exact PID/HWND/process creation/session checks, protect RIFT/VM foreground state and require independent before/after evidence. Do not infer permission to replay older actions.

## Source-hash index (SHA-256)

| Source artifact | SHA-256 | What it supports |
| --- | --- | --- |
| docs/RIFT-UI-PHYSICAL-WORKBRIDGE-QUARANTINE-INVESTIGATION-HANDOFF-2026-11-05.json | 6396edcd0d8ad852da0ed787d93878102f0e8cc5791678dd226cb8039cd54993 | Pre-recovery 20:38 UTC state; historically valid, now superseded in part |
| investigations/windows-desktop-automation/reports/wb001-gui-clean-release-preparation-2026-11-05.md | aa2d424ec26c34e0f16ee7ae566475ae6758c0e0b06ac46d8ee1764d2b51ddc7 | Nov 5 completed archive and preservation audit |
| Archive journal.jsonl | 43c6847426f1d0f9271768df503512de1cf9ddc2bc7dff244f6bf372cc7e0820 | Exact ordered maintenance and relocation timestamps |
| Archive completed.json | 76dd36552c9616dd7bc39e9e9a0235baff658552a682f90e280e9b8807c4bbcd | Original unknown outcome; no new action in archival |
| Archive manifest.json | 8f54330ff4f71b3035effcc6ffb14b47c830de5db0241f67f45d00ee531e4e34 | Exact archive ownership and entries |
| investigations/windows-desktop-automation/reports/2026-11-05-physical-rift-reloadui-v0411-success.md | 99cfa6fe35548d6d2da1b66a2b90e5dea35eda6267369f23f67412116da75037 | Bounded RIFT reload proof and independent postcondition audit |
| scripts/physical-rift-reloadui.mjs | a182308782aa1b89b0c619eccd7a538e074ce947c8ce9ab9182dd1666ccf495f | Physical-only action, preflight, and target identity |
| scripts/desktop-turn-admission.mjs AND dist/desktop-turn-admission.mjs | 2d07155795c6766ea2adbff96907e523b0550f9ab3df7fc7020dfa2b3f941f21 | Deployed source/distribution maintenance gate parity |
| scripts/vmware-host-capture.mjs | 62129b79713feb25c611b076710c90a0d5f441cdad8828b45233f113868522b3 | Separate VMware host capture implementation |
| investigations/windows-desktop-automation/reports/2026-11-05-desktop-provider-experiment-priorities.md | 3dbc4dad6b562d4e427f050a19c0b7654ab0bad0332777e9bf774308e8239ad5 | Latest read-only host provider pilot priorities |

## Safe next decision

Keep Workbridge and 36-slot coordinator running for daily work. Advance the investigation via a **disposable, synthetic host Windows dialog/UIA comparison** (WinApp CLI baseline, sbroenne candidate) only after fresh GUI-turn admission, process/session identity and non-disruptive foreground checks. Follow with a distinct **guest-side** read-only OneDrive/receiver latency pilot after each lab's health and lease quarantine are independently reconciled. Do NOT treat the Nov 5 physical success as a green light to operate VM guest dialogs or resume OneDrive; those are separate hypotheses and authorization boundaries.

**Report limitations:** This lane did not read live RIFT UI, authenticate VMs, focus desktop, start OneDrive, run tools inside a guest, or operate any GUI. Latest Workbridge git HEAD and unrelated dirty files may continue moving while other agents work; results above are evidence snapshots, not locks or warranties.
