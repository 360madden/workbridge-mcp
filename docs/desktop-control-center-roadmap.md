# Workbridge Desktop Control Center — Roadmap
Date: 2026-11-02
Status: M0 architecture and implementation planning
Owner: Workbridge project
Scope: personal Windows 11 application; existing MCP server remains authoritative.

## Goal
Deliver a WPF/.NET 10 desktop GUI as Workbridge's primary human interface, with a system tray icon, optional sign-in launch, CLI/MCP independence, accurate live monitoring, and no visible console windows attributable to Workbridge at sign-in.

## Non-negotiable invariants
- Preserve the running Node.js/TypeScript MCP server, tunnel, DPAPI credentials, local CLI, 36 command slots, 36 coordination assignments, and WB-001 updater/rollback.
- No competing owner of the live .local directory or live MCP server.
- Closing or hiding the GUI must not stop the engine or its jobs.
- Keep command jobs, MCP clients, coordinated assignments, and independently reasoning AI agents visibly distinct.
- No modifications to Windows startup until its actual installed task, console flashing, and process lifetime have been inspected.
- Follow AGENTS.md, autonomous-investigation-policy, and WB-001 for live runtime changes.
- Review and verify each milestone; commit only focused validated changes.

## Architecture decision
- GUI: C# WPF targeting net10.0-windows, with UseWindowsForms for NotifyIcon; Windows desktop subsystem (no console).
- Integration: connect as a client to the existing authenticated local MCP endpoint using its documented private descriptor/CLI authentication path; do not assume the HTTP port alone grants access.
- Backend: existing Node.js MCP server and local CLI remain authoritative. No duplicate scheduler, persistence database, or ASP.NET server.
- GUI operations: read-only initially. Poll diagnostics with cancellation/timeouts and stale/offline states; introduce push only if profiling justifies it.
- Startup: existing sign-in scheduled task remains unchanged until a separately validated windowless-launcher milestone.
- No Windows service conversion by default; existing user-bound credentials and interactive desktop workflows favor the current user-session architecture.

## Workstreams for parallel independent investigation
A. WPF tray and single-instance UX; owner desktop GUI.
B. Existing MCP client authentication, local descriptor, endpoint lifecycle; owner integration design.
C. Scheduled task, hidden PowerShell startup, Windows Job Object and updater; owner startup design.
D. Validation strategy, tests and acceptance; owner testing.
E. Independent code review; reviewer must not author reviewed changes.
These are proposed roles. Workbridge agent assignments alone do not launch AI reasoning agents. Only claim real subagents when a spawning tool actually creates them.

## Milestones
### M0 — Baseline and design
- [x] Inspect live workspace/version/capacity and current Git state.
- [x] Inspect README, AGENTS.md, autostart scripts, local CLI and local-service implementation.
- [x] Confirm WPF/WinForms NotifyIcon support in Microsoft documentation.
- [x] Inspect private DPAPI descriptor and authenticated connectService lifecycle (src/local-service.ts lines 450-499). Verified existing client transport, owner identity and ready endpoint checks.
- [x] Verify installed `Workbridge MCP` scheduled-task action (wbdesktop-startup-audit-20261102-v1, exit 0): state Running, powershell.exe, Start-BackgroundTunnel.ps1, -WindowStyle Hidden, PT20S delay, Limited run level. Source of observed sign-in console flash NOT independently captured; keep this distinct.
- [ ] Obtain genuinely independent reviewer sign-off. Coordinator inspection identified shutdown-race risk in the second-instance signal handler; added dispatcher-shutdown guard in source (2026-11-02) and compiled. Formal independent review remains pending.
Gate: explicit data-flow, trust-boundary and process-lifecycle review.

### M1 — Desktop shell
- [x] Create desktop/Workbridge.ControlCenter WPF .NET 10 project; dotnet build passed with zero warnings/errors (job wbdesktop-build-20261102-02).
- [x] Implement single-instance mutex plus named auto-reset restore event. Interactive verification passed 2026-11-02: second launch wbdesktop-second-launch-smoke-20261102-v1 exited 0; desktop_windows observed exactly one original window and it became foreground.
- [x] Implement tray icon, double-click restore, close-to-tray, explicit Exit GUI (compiled; interactive smoke test pending).
- [x] No service termination from UI: shell has no backend process control code.
Gate: build passed (zero warnings/errors). Actual Windows launch wbdesktop-ui-smoke-20261102-v1 yielded one 900×740 WPF window with healthy live readings, confirmed via desktop_inspect UIA. Test command cancelled intentionally; desktop_windows confirmed zero remaining windows. Second-instance restore passed. A separate close-to-tray test attempted capture wbdesktop-tray-presmoke-20261102-v1, but UI_TURN_BUSY refused the shared desktop resource. Cancelled only wbdesktop-tray-smoke-owner-20261102-v1, confirmed zero remaining GUI windows and healthy Workbridge tunnel; other REA-Lab1 jobs were running. Do not retry UI input during shared desktop contention. Tray and menu remain untested; M1 not accepted.

### M2 — Read-only live monitoring
- [x] Implement initial read-only scripts/desktop-status.mjs using existing connectService; verified job wbdesktop-status-test-20261102 (exit 0, version 0.16.4-dev, tunnel ready, 36 capacity). WPF integration pending.
- [x] Initial WPF read-only view: version, tunnel readiness, slot occupancy and running jobs via existing authenticated Node probe (build passed wbdesktop-live-build-20261102). Added bounded active/retained command-job inventory with completeness indicator (probe wbdesktop-jobs-probe-20261102, build wbdesktop-jobs-build-20261102). Assignment view remains pending.
- [x] Initial separate slot/job counters, disconnected state and bounded probe cancellation/timeout; interactive disconnect/reconnect testing pending.
- [x] Initial read-only on-demand job details and bounded output tail (4,000 chars), with job-ID validation; test jobs wbdesktop-detail-test-0-20261102 passed and wbdesktop-detail-test-1-20261102 rejected invalid input. Output may contain command secrets; GUI warns operator and does not save it. Paging beyond tail remains optional.
Gate: WPF detail view built successfully (wbdesktop-detail-build-20261102-v1; zero errors/warnings); Node syntax and positive/negative query tests passed. Review hardening: clear stale details on disconnect and reject a response after selected job changes (wbdesktop-stale-guard-build-20261102-v1, zero errors/warnings). Live UIA inspection confirmed engine version, slot occupancy, running job list and inventory completeness in the actual window; later WPF health smoke wbdesktop-health-ui-smoke-20261102-v1 confirmed new ControlPlaneText=ok and RetainedText=0 against live v0.16.4-dev, then cancelled only that test process and confirmed no leftover GUI windows. Build wbdesktop-health-build-20261102-v1 passed with zero errors/warnings; on-demand detail button and offline/reconnect acceptance remain pending. Probe run through Workbridge terminal_run temporarily occupies one slot, so its 1 occupied/35 available sample is expected. Review concern: process-per-poll adds startup overhead; profile before optimizing.

### M3 — Job controls
- [ ] Expose only existing supported cancel/status/retry actions.
- [ ] Explicit confirmation and durable job IDs for state-changing operations.
- [ ] No invented 'start AI worker' feature.
Gate: synthetic job tests; no duplicated actions after uncertain responses.

### M4 — Startup experience
- [ ] Identify actual source(s) of sign-in console flash.
- [ ] Prototype windowless launcher separately, preserving Windows Job Object lifetime.
- [ ] Test task stop, restart, tunnel reconnection, DPAPI access, battery behavior and failure recovery.
- [ ] Keep prior startup task rollback ready.
Gate: repeated real sign-in acceptance, no console flash, no orphan processes.

### M5 — Release
- [ ] Independent review, focused tests, clean Git commit.
- [ ] Staged release through documented WB-001 process where backend/runtime changes are needed.
- [ ] Verify hosted MCP after deployment; document user-facing startup behavior.
Gate: no unresolved critical regressions.

## Risks / decisions
1. GUI authentication: local MCP is authenticated; never send unauthenticated requests or duplicate secret handling.
2. Startup flash: -WindowStyle Hidden exists already; do not attribute every console flash to Workbridge without evidence.
3. Single-instance/tray lifecycle: avoid process ownership of backend and avoid disposing tray icon while hidden.
4. Dashboard accuracy: 36 slots are command capacity, not 36 genuine AI reasoning agents.
5. Deployment: source changes do not deploy automatically. Never restart live server as part of desktop scaffolding.
6. Shared desktop lease: capture wbdesktop-tray-presmoke-20261102-v1 returned UI_TURN_BUSY. Recheck when other desktop workflows are idle; do not route around the reservation.

## Next executable task
Complete isolated tray hide/restore and selected-job detail button UI tests; test offline/reconnection behavior, then obtain genuine independent code review before M1/M2 acceptance. Current code has extra control-plane/retained-result labels and dispatcher shutdown guard, verified by build and live read-only UIA. Current GUI test process has been removed; leave live startup/runtime unchanged.
