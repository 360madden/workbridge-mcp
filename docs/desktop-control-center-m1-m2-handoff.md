# Workbridge Desktop Control Center — M1/M2 Handoff
Date: 2026-11-02
Initial baseline HEAD: 844195e4af2f46da4277d09759c37a3835607764
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

## Later regression checkpoint (2026-11-02)
- Created a repeatable, isolated PowerShell smoke test at `desktop/tests/Run-DesktopSmoke.ps1` with usage notes at `desktop/tests/README.md`. It refuses to run when a Control Center instance already exists and cleans up only the instance it starts.
- Positive job `wbdesktop-repeatable-smoke-run-20261102-v1` exited 0: live UIA version/status, selected matching running-job detail, targeted close-to-tray, restored existing window, and cleanup all passed.
- Negative safety job `wbdesktop-smoke-guard-refusal-20261102-v1` exited 1 because a pre-existing test dashboard was running. That owner remained alive and was then explicitly cancelled (`wbdesktop-smoke-guard-owner-20261102-v1`).
- The standard no-job-ID run `wbdesktop-repeatable-smoke-nojob-20261102-v1` also passed exit 0 after `wbdesktop-smoke-suite-build-20261102-v1` passed with zero warnings/errors. The test runs independently of any one-off inline test command.
- Added `docs/desktop-control-center-review-brief.md` for a genuinely independent Extra High reviewer when such a worker is available. This brief is not a completed review.
- Added a bounded read-only per-repository coordination assignments view, never AI agent spawning. `scripts/desktop-assignments.mjs` uses authenticated `agent_list`; WPF provides Load assignments. Valid repository and invalid out-of-root tests passed; `wbdesktop-assignments-ui-smoke-20261102-v1` passed all regression checks including `-CheckAssignments`. Follow-up error-state cleanup was implemented and verified with a fresh zero-warning build (`wbdesktop-assignments-finalbuild-20261102-v1`) and a repeated comprehensive smoke test (`wbdesktop-assignments-finalsmoke-20261102-v1`, exit 0).
- A read-only notification-area inspection found 'Show Hidden Icons' in the shell but no Workbridge icon while overflow was closed; no shared desktop input was injected.
- This is deterministic regression evidence for M1/M2; actual taskbar notification icon clicks and genuinely independent Extra High code review remain unverified.

## Bounded-stream reliability checkpoint (2026-11-02)
- Fixed a concrete reliability risk: previously the GUI checked line length **after** `StreamReader.ReadLineAsync`, so an enormous line could be buffered before rejection. `BoundedLineReader.cs` enforces a 64,000-character limit while incrementally reading with a 4,096-character reusable buffer.
- Unit harness `desktop/tests/BoundedLineReaderTests.csproj`: `wbdesktop-bounded-reader-unit-20261102` passed all 15 assertions. WPF `-warnaserror` build job `wbdesktop-bounded-reader-wpf-build-20261102` passed.
- `wbdesktop-bounded-wpf-smoke-20261102` passed complete real GUI smoke test, including selected job/assignments and cleanup.
- Isolated oversized output fixture `desktop/tests/Run-OversizeMonitorFixture.ps1`: `wbdesktop-oversize-fixture-run-20261102` exited 0, verifying oversize rejected, offline status, recovery, subsequent offline, and cleanup. The live Workbridge service was not stopped.
- Follow-up: on-demand job and assignment probes now consume at most one 64,000-character JSON line using the same bounded reader and terminate their child process on all read/limit errors. `wbdesktop-ondemand-build-20261102` (0 warnings/errors), `wbdesktop-ondemand-unit-20261102` (15 assertions), and `wbdesktop-ondemand-smoke-20261102` (full GUI acceptance, exit 0) passed.
- Test scripts/documentation are committed with the source change; independent code review and actual tray icon/menu interactions remain pending.

## Tray callback acceptance checkpoint (2026-11-02)
- Enumerated the hidden WinForms notification-window HWND **inside the owned Control Center process**. Synthetic `WM_USER+1024` / `WM_LBUTTONDBLCLK` restored a hidden dashboard. A synthetic right-button notification exposed the actual context menu; UI Automation invoked its `Exit Control Center` item and observed the GUI exit.
- The first exploratory menu test returned exit 1 after the GUI had exited successfully, apparently due cleanup of an already-exited PID. The repeatable `desktop/tests/Run-TrayCallbackSmoke.ps1` fixes that cleanup path; `wbdesktop-tray-synthetic-full-20261102-v1` completed exit 0, with all tests passed.
- MainWindow tray handler now guards against UI dispatcher shutdown races. `wbdesktop-tray-handler-build-20261102` passed with zero errors/warnings, `wbdesktop-tray-handler-unit-20261102` passed 15 assertions, `wbdesktop-tray-postfix-menu-20261102-v1` passed the synthetic callback/menu/Exit test, and `wbdesktop-tray-postfix-full-smoke-20261102-v1` passed complete live GUI smoke.
- Explorer icon registration was independently checked using the read-only `Shell_NotifyIconGetRect` API: `wbdesktop-shell-tray-registration-20261102-v2` found uID=1 for the owned notification HWND. The repeatable tray harness now includes registration verification; `wbdesktop-tray-shell-combined-20261102-v1` passed all checks with exit 0.
- This test is synthetic and targets only our process. **The physical Windows taskbar icon or overflow interaction is still unverified.** No shared desktop mouse/keyboard input was injected.

## Monitor heartbeat recovery checkpoint (2026-11-02)
- Fixed a stale-health failure: a live Node monitor with permanently silent stdout could previously leave the GUI displaying the last healthy status. WPF now links a per-message 25-second cancellation timeout; after the timeout it marks the connection offline and kills/restarts **only its own monitor child**.
- `wbdesktop-heartbeat-fixture-20261102-v1` passed the disposable silent-monitor fixture: initial healthy sample, stalled process identified as offline, automatic monitor restart and recovery, test-owned process/fixture cleanup (exit 0). No live service changes.
- `wbdesktop-heartbeat-build-20261102` passed with zero warnings/errors, `wbdesktop-heartbeat-reader-unit-20261102` passed 15/15 assertions, and both `wbdesktop-heartbeat-tray-regression-20261102` and `wbdesktop-heartbeat-full-smoke-20261102` passed (exit 0).
- Independent reviewer sign-off and physical Windows taskbar click remain unverified.

## Physical Explorer tray acceptance harness checkpoint (2026-11-02)
- Added `desktop/tests/Run-PhysicalTrayAcceptance.ps1` with two modes: `-ValidateOnly` checks the Windows Shell icon registration and process cleanup automatically; full mode waits for an actual user double-click and context-menu Exit, while merely observing the owned GUI and PID.
- `wbdesktop-physical-tray-validator-20261102-v1` exited 0 (`iconRegistered=true`, `cleanedUp=true`, uID=1, `validateOnly=true`). `wbdesktop-physical-tray-preexist-guard-20261102` intentionally failed with exit 1 because the test GUI was already running; that owner remained alive and was explicitly cancelled.
- Actual physical input has **not** occurred. Do not mark the M1 physical-click gate passed until the non-validation mode returns an observed pass.

## Connection-state accuracy checkpoint (2026-11-02)
- The GUI previously printed `Connected · Tunnel ready: False` when the MCP service was reachable but its tunnel or control plane was degraded. It now distinguishes **engine reachable with degraded tunnel/control plane** from a fully connected system and a disconnected service.
- `desktop/tests/Run-TunnelHealthFixture.ps1` passed isolated healthy -> degraded -> recovered UI-state observation (`wbdesktop-tunnel-health-fixture-20261102`, exit 0). Build job `wbdesktop-tunnel-health-build-20261102` passed zero warnings/errors, unit tests passed 15/15, tray and oversized-monitor regressions passed, and full GUI smoke job `wbdesktop-tunnel-health-full-smoke-20261102` passed.
- No live Workbridge engine changes; physical tray click and independent code review remain pending.

## Job detail selection consistency checkpoint (2026-11-02)
- Identified a local UI correctness issue: after viewing one command job's log, selecting another job could leave the first job's output visible. `MainWindow.xaml.cs` now clears stale output on actual selection changes but suppresses clearing during the five-second list reconstruction when the same job remains selected.
- `desktop/tests/Run-JobSelectionFixture.ps1` passed (`wbdesktop-job-selection-fixture-run-20261102`, exit 0): job A details displayed and retained across refresh, cleared immediately on selecting job B, and job B output displayed on demand. Fixture/process cleanup passed.
- WPF build `wbdesktop-job-selection-build-20261102` passed without errors/warnings, unit tests `wbdesktop-selection-regress-unit-20261102` passed 15 assertions, tray test `wbdesktop-selection-regress-tray-20261102` passed, full live GUI test `wbdesktop-selection-full-smoke-20261102` passed. No Workbridge service or startup changes.
- Independent reviewer sign-off and physical taskbar acceptance remain open.

## Asynchronous job-detail ABA race checkpoint (2026-11-02)
- A job request for A could still return late after the user selected A -> B -> A. The old job-ID comparison would mistakenly accept A's obsolete response because the ID matched again. WPF now tracks a monotonically increasing selection revision and refuses responses from earlier revisions, including across disconnect/reconnect.
- The expanded `desktop/tests/Run-JobSelectionFixture.ps1` now delays A's result and asserts that an A -> B -> A sequence cannot display that stale output. Job `wbdesktop-aba-selection-fixture-20261102` passed (`staleAbaResponseRejected=true`, exit 0). Previous selection tests also passed.
- Build `wbdesktop-aba-build-20261102` passed 0 errors/warnings; `wbdesktop-aba-tray-regression-20261102` and `wbdesktop-aba-full-smoke-20261102` passed. The live service and other Windows workflows remained unchanged.

## Stale assignments after disconnect checkpoint (2026-11-02)
- Fixed an M2 race: a pending coordination-assignment request could complete after the monitor went offline and replace `Assignments unavailable while Workbridge is offline` with obsolete data. The GUI now increments `_statusRevision` on disconnect and accepts a lookup result only from its original status generation.
- Isolated `desktop/tests/Run-AssignmentDisconnectFixture.ps1` job `wbdesktop-assignment-disconnect-fixture-20261102` passed all five checks (exit 0): healthy status, offline during delayed assignment query, rejection of old reply, new post-reconnect query works, and fixture/owned-process cleanup.
- Build `wbdesktop-assignment-disconnect-build-20261102` (0 warnings/errors), reader tests `wbdesktop-assignment-disconnect-units-20261102` (15/15), tray `wbdesktop-assignment-disconnect-tray-20261102` (exit 0), full GUI `wbdesktop-assignment-disconnect-fullsmoke-20261102` (exit 0), and test script syntax all passed. No MCP server/VM changes.

## Repository input A -> B -> A checkpoint (2026-11-02)
- Fixed a second stale-assignment scenario: a request for repository A could be accepted after the field changed A -> B -> A because only final string equality was checked. TextChanged now increments `_assignmentInputRevision`, clears old visible results, and invalidates any earlier request even if the repository name matches again.
- Extended `desktop/tests/Run-AssignmentDisconnectFixture.ps1` passed (`wbdesktop-assignment-input-aba-fixture-20261102`, exit 0), verifying prior offline/reconnect cases plus project-change clearing, delayed A -> B -> A result rejection, subsequent successful lookup and cleanup. Build `wbdesktop-assignment-input-aba-build-20261102` passed with no warnings/errors. Tray and full desktop regressions passed (`wbdesktop-input-aba-tray-regression-20261102`, `wbdesktop-input-aba-full-smoke-20261102`).
- Independent reviewer and physical Explorer tray-click acceptance still outstanding.

## Parent-EOF orphan prevention checkpoint (2026-11-02)
- Coordinator lifecycle inspection found that parent stdin EOF could abort the monitor but leave Node alive when an MCP call or `client.close()` never resolves. `scripts/desktop-monitor.mjs` now arms an unref'd 2-second forced-exit fallback *only after shutdown is requested*; ordinary diagnostics cadence is unchanged.
- New `desktop/tests/desktop-monitor-parent-eof.test.mjs` copies the real monitor source into an isolated temporary fixture, replaces imported MCP client/service with stubs, intentionally stalls `diagnostics` with an active event-loop handle and closes actual parent stdin. `wbdesktop-eof-parent-fixture-20261102` passed exit 0: monitor self-terminated cleanly in 2,024 ms despite the hanging client. Node syntax `wbdesktop-eof-node-syntax-20261102` passed.
- Real read-only client `wbdesktop-eof-live-status-20261102` passed with v0.16.4-dev, healthy tunnel and 36-slot capacity. WPF `-warnaserror` build, 15 reader assertions, tray callback regression and full GUI smoke all passed (`wbdesktop-eof-build-20261102`, `wbdesktop-eof-reader-unit-20261102`, `wbdesktop-eof-tray-smoke-20261102`, `wbdesktop-eof-fullsmoke-20261102`). Live owner/VM and startup task unchanged.
- Independent reviewer sign-off and actual Explorer notification-icon click remain open.

## Bounded monitor transport checkpoint (2026-11-02)
- Found that Node serialized diagnostic job metadata without enforcing WPF's 64,000-character input limit, so sufficiently large or escape-heavy metadata could repeatedly force a healthy GUI offline. Added `scripts/desktop-monitor-format.mjs`, capped serialized samples at 60,000 characters, bounded individual text fields and at most 36 jobs, and marks shortened/dropped inventories partial while preserving capacity counters.
- `desktop/tests/desktop-monitor-format.test.mjs` passed 23 assertions (`wbdesktop-format-boundary-tests-20261102`) including oversized/escaped metadata and bounded fallback. Node syntax tests, `wbdesktop-format-parent-eof-20261102`, reader unit tests (15/15), `wbdesktop-format-wpf-build-20261102` (0 warnings/errors), `wbdesktop-format-full-gui-20261102` and `wbdesktop-format-tray-gui-20261102` all passed exit 0. Existing parent-EOF harness was updated to copy the new pure formatter into its disposable fixture.
- User explicitly requested **no Ollama** for this workflow. Cancelled the CPU-only local reviewer job (`wbdesktop-local-deepseek-review-20261102-v2`) and its temporary localhost Ollama server (`wbdesktop-ollama-review-temp-server-20261102`); neither yielded review findings or sign-off. Continue using ChatGPT Chat mode and Workbridge only.

## Partial-counter telemetry acceptance (2026-11-02)
- Reproduced an M2 correctness defect: Node's monitor status contract explicitly permits `null` when `occupied`, `limit`, and `runningJobs` are unknown, but WPF's unconditional `GetInt32()` raised an exception and displayed a false disconnect. Added a standalone `NonnegativeIntOrUnavailable` helper for null/missing/invalid/nonnegative counters and preserved the connection's true health.
- Extended the disposable `desktop/tests/Run-TunnelHealthFixture.ps1` with unknown-counters and numeric-recovery phases. Before the source correction `wbdesktop-null-counters-baseline-20261102` failed (expected exit 1, fixture cleaned up); afterward `wbdesktop-null-counters-fixture-postfix-20261102` passed all six fields, exit 0.
- WPF `wbdesktop-null-count-build-20261102` built with zero warnings/errors, Node format tests `wbdesktop-null-count-node-contract-20261102` passed 28 assertions, bounded-line tests `wbdesktop-null-count-reader-20261102` passed 15; full live GUI `wbdesktop-null-counts-full-smoke-20261102` and synthetic tray `wbdesktop-null-counts-tray-20261102` passed. Live MCP server, scheduled task and VMs unchanged.
- Physical Explorer tray clicks and independent reviewer acceptance remain pending.

## Remaining acceptance gates
1. Test actual Windows notification-area icon double-click and context menu Exit. Shell_TrayWnd UIA name lookup did not expose icon; do not claim pass.
2. Obtain genuinely independent code review, ideally Extra High reasoning, through an environment that actually exposes native AI subagents. Workbridge agent assignments are metadata, not spawned reasoning agents.
3. Review lifecycle corner cases, parent-pipe orphan prevention, JSON streaming bounds, retry behavior, and output secrecy. Correct defects, rerun targeted tests.
4. Only after M1/M2 acceptance, plan M3 job controls. Do not introduce destructive job controls prematurely.
5. M4 sign-in console flashing still unproven: scheduled task confirmed to launch hidden PowerShell with 20-second delay; capture actual flash source before modifying task. Use WB-001 for any live runtime changes.

## Resume procedure
1. Read AGENTS.md and docs/desktop-control-center-roadmap.md.
2. Check git status/history and Workbridge diagnostics before edits.
3. Inspect the latest WPF and monitor code, and read `docs/desktop-control-center-review-brief.md` before delegating independent review; prioritize tray menu acceptance.
4. Keep GUI test processes isolated; clean up only those created by the current test.
5. Update roadmap with precise receipts and commit focused validated changes.

## Honest agent status
No native ChatGPT subagents or independent Extra High reviewer were launched in this chat. Parallel MCP operations were used but are not reasoning agents.
