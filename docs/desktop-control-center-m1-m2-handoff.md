# Workbridge Desktop Control Center — M1/M2 Handoff
Date: 2026-11-02
Baseline HEAD: 844195e4af2f46da4277d09759c37a3835607764
Status: M1 and M2 functionally demonstrated; formal acceptance pending.

## Objective and boundaries
Build a personal Windows 11 WPF/.NET 10 dashboard with system-tray lifecycle and read-only authenticated MCP monitoring. Keep existing Node.js Workbridge server, CLI, 36 command slots, DPAPI user credentials, scheduled task, and WB-001 deployment unchanged. Never treat 36 command slots as 36 AI reasoning agents.

## Implemented
- Desktop project: desktop/Workbridge.ControlCenter/
- System tray, close-to-tray, hidden startup (--tray), single-instance activation with named event and bounded startup retry.
- Live engine health, version, control plane, slot occupancy, running jobs, retained results, bounded job list.
- On-demand selected job status/output tail (4,000 characters) with ID validation and selection-staleness guard.
- Persistent authenticated Node monitor at scripts/desktop-monitor.mjs; parent stdin EOF triggers monitor exit; reconnect/offline states.
- Installation-root config workbridge-control-center.json, copied to output for running outside the repository.

## Verified evidence
- dotnet build -warnaserror: zero warnings and errors.
- Three two-process startup trials: exactly one surviving GUI process each time.
- Hidden startup and second launch restore the existing window.
- WM_CLOSE targeted test: process survives hidden and can be restored.
- UI Automation selected real running job, invoked details button, verified matching job ID and status.
- Isolated offline/online/offline streaming fixture: passed; no live Workbridge service interruption.
- Persistent monitor emitted repeated live health samples; parent-pipe EOF test exited 0.
- Baseline one-shot status process measured 817/736/744/746/842 ms (average 777 ms); persistent client avoids 720 new processes/hour at five-second cadence.
- Separate-directory deployment smoke test: config resolved C:\work\workbridge-mcp and UI showed v0.16.4-dev.
- Final baseline at handoff: Workbridge v0.16.4-dev, tunnel ready, control plane ok, 36 slots, Git clean.

## Remaining acceptance gates
1. Test actual Windows notification-area icon double-click and context menu Exit. Shell_TrayWnd UIA name lookup did not expose icon; do not claim pass.
2. Obtain genuinely independent code review, ideally Extra High reasoning, through an environment that actually exposes native AI subagents. Workbridge agent assignments are metadata, not spawned reasoning agents.
3. Review lifecycle corner cases, parent-pipe orphan prevention, JSON streaming bounds, retry behavior, and output secrecy. Correct defects, rerun targeted tests.
4. Only after M1/M2 acceptance, plan M3 job controls. Do not introduce destructive job controls prematurely.
5. M4 sign-in console flashing still unproven: scheduled task confirmed to launch hidden PowerShell with 20-second delay; capture actual flash source before modifying task. Use WB-001 for any live runtime changes.

## Resume procedure
1. Read AGENTS.md and docs/desktop-control-center-roadmap.md.
2. Check git status/history and Workbridge diagnostics before edits.
3. Inspect the latest WPF and monitor code, then prioritize tray menu acceptance and independent review.
4. Keep GUI test processes isolated; clean up only those created by the current test.
5. Update roadmap with precise receipts and commit focused validated changes.

## Honest agent status
No native ChatGPT subagents or independent Extra High reviewer were launched in this chat. Parallel MCP operations were used but are not reasoning agents.
