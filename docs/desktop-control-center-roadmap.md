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
- [ ] Inspect private local descriptor authentication and current client connection lifecycle in detail.
- [ ] Verify installed scheduled-task action and observed console process source.
- [ ] Record reviewer findings and resolve critical architecture concerns.
Gate: explicit data-flow, trust-boundary and process-lifecycle review.

### M1 — Desktop shell
- [x] Create desktop/Workbridge.ControlCenter WPF .NET 10 project; dotnet build passed with zero warnings/errors (job wbdesktop-build-20261102-02).
- [x] Implement single-instance mutex plus named auto-reset restore event; second process signals existing window. Compiled; interactive verification pending.
- [x] Implement tray icon, double-click restore, close-to-tray, explicit Exit GUI (compiled; interactive smoke test pending).
- [x] No service termination from UI: shell has no backend process control code.
Gate: dotnet build passed again (wbdesktop-build-20261102-03, 0 warnings/errors). Prior missing second-instance restore addressed in source; interactive smoke test still required before M1 completion.

### M2 — Read-only live monitoring
- [ ] Authenticated local MCP connection using existing supported mechanism.
- [ ] Version, tunnel/control-plane health, 36-slot capacity, active/retained jobs, assignment status.
- [ ] Distinct counters, offline/stale states, cancellation and timeout handling.
- [ ] Logs with bounded paging, no credential display.
Gate: values cross-checked against live diagnostics; disconnect/reconnect test.

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

## Next executable task
Inspect the local-service private descriptor and CLI connection code; design the smallest safe GUI client boundary, then scaffold M1 without touching live startup or runtime.
