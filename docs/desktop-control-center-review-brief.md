# Independent reviewer brief — Workbridge Control Center M1/M2

**Status:** Review requested, not performed. This brief is for a genuinely independent AI reviewer (Extra High reasoning where configurable) or another code reviewer. It must not be counted as reviewer sign-off.

## Scope

Review only the Workbridge desktop Control Center and its integration scripts, not the running MCP owner or unrelated RIFT projects.

- `desktop/Workbridge.ControlCenter/BoundedLineReader.cs`
- `desktop/Workbridge.ControlCenter/App.xaml.cs`
- `desktop/Workbridge.ControlCenter/MainWindow.xaml.cs`
- `desktop/Workbridge.ControlCenter/MainWindow.xaml`
- `desktop/Workbridge.ControlCenter/Workbridge.ControlCenter.csproj`
- `desktop/Workbridge.ControlCenter/workbridge-control-center.json`
- `scripts/desktop-monitor.mjs`
- `scripts/desktop-status.mjs`
- `scripts/desktop-job-detail.mjs`
- `scripts/desktop-assignments.mjs`
- `desktop/tests/Run-TrayCallbackSmoke.ps1`
- `desktop/tests/Run-DesktopSmoke.ps1`
- `desktop/tests/BoundedLineReaderTests.cs`
- `desktop/tests/BoundedLineReaderTests.csproj`
- `desktop/tests/Run-OversizeMonitorFixture.ps1`
- `desktop/tests/Run-StalledMonitorFixture.ps1`

## Required review questions

1. **Single-instance correctness:** Inspect mutex and restore-event initialization, concurrent startup, dispatcher shutdown, and the 15-attempt retry boundary. Check for potential lost activations or exceptions.
2. **Tray lifecycle:** Examine hide-on-X, icon creation/disposal, double-click restore, ContextMenuStrip Exit, and new dispatcher-shutdown guard. A PID-targeted synthetic WinForms notification-callback test now exercises both DoubleClick and the actual Exit menu item; physical Explorer notification-area clicks remain unverified.
3. **Background monitoring:** Check monitor lifecycle, unexpected GUI death, stalled MCP connection and orphan risk. WPF now applies a per-line 25-second heartbeat timeout, marks the state offline, kills only its own stalled child, and restarts with a bounded delay. Review that cancellation and shutdown cannot race a recovery into recreating an unwanted process; assess the timeout under delayed host conditions.
4. **Streaming bounds:** Review `BoundedLineReader.cs` and deterministic tests. Confirm the 64,000-character ceiling is enforced **while reading**, including CRLF, EOF, buffered subsequent lines, cancellation and exceptional output. Verify the on-demand probes accept at most one 64K line and terminate the owned child for oversized or malformed output. Check for any remaining unbounded streams, malformed JSON handling, stdout backpressure, and child cleanup.
5. **UI correctness:** Review live/offline state, inventory-completeness label, selection restoration during five-second refreshes, stale job-detail response rejection, and on-demand per-repository coordination assignments. Ensure assignment state counts are never described as independently reasoning AI agents.
6. **Local authorization:** The service endpoint requires an authenticated DPAPI-protected descriptor. Confirm the GUI uses the existing `connectService` path and never logs or exposes its credential.
7. **Safety of displayed output:** Job logs can contain secrets. Confirm that sensitive output remains local and bounded; suggest appropriate operator-facing behavior without silently sending it elsewhere.
8. **Root/package behavior:** Review `workbridge-control-center.json` absolute root resolution when installed outside the repository, including malformed paths and fallback behavior.
9. **Automated test quality:** Confirm that the smoke script rejects existing running Control Center instances, targets only its own HWND/PID, and cleans up on failure. Identify missing negative tests.
10. **Scope and rollback:** No backend/service task updates should occur during desktop source tests. Preserve Workbridge v0.16.4-dev, 36 command slots, and the WB-001 updater.

## Verification baseline

- `dotnet build desktop/Workbridge.ControlCenter/Workbridge.ControlCenter.csproj --nologo -warnaserror` passed: zero errors and warnings.
- `desktop/tests/Run-DesktopSmoke.ps1` passed under Workbridge job `wbdesktop-repeatable-smoke-nojob-20261102-v1` (no job-detail selection).
- With `-ExpectedJobId wbdesktop-repeatable-smoke-run-20261102-v1`, the smoke test passed live status, selected-job detail, close-to-tray, second-launch restoration, and cleanup.
- Negative safety case: a pre-existing Control Center caused the script to refuse to run (exit 1), leaving its owner alive until deliberately stopped.
- Isolated offline/online/offline fixture tests passed without stopping the real server.
- Read-only Shell_TrayWnd UI Automation found 'Show Hidden Icons' but not the Workbridge icon while the overflow window was closed; **do not infer actual icon/menu usability from that check**.
- On-demand assignment lookup and WPF interaction passed in `wbdesktop-assignments-ui-smoke-20261102-v1`. A lookup outside configured roots (`C:\Windows`) was refused.
- Bounded streaming checkpoint: `wbdesktop-bounded-reader-unit-20261102` passed 15 assertions, `wbdesktop-bounded-reader-wpf-build-20261102` passed 0 warnings/errors, `wbdesktop-bounded-wpf-smoke-20261102` passed full GUI smoke, and `wbdesktop-oversize-fixture-run-20261102` passed oversize/offline/recovered/offline fixture with cleanup. Follow-up `wbdesktop-ondemand-build-20261102`, `wbdesktop-ondemand-unit-20261102`, and `wbdesktop-ondemand-smoke-20261102` passed after extending bounds to on-demand calls. Tray callback tests `wbdesktop-tray-synthetic-full-20261102-v1` and `wbdesktop-tray-postfix-menu-20261102-v1` passed via owned WinForms HWND, with no global mouse input; `wbdesktop-tray-postfix-full-smoke-20261102-v1` passed complete GUI checks. Read-only Explorer notification-icon registration was separately verified with `Shell_NotifyIconGetRect` (`wbdesktop-shell-tray-registration-20261102-v2`, matched uID=1), and then included in `wbdesktop-tray-shell-combined-20261102-v1` (exit 0). Additional stalled-monitor fixture `wbdesktop-heartbeat-fixture-20261102-v1` passed (offline detection/recovery/cleanup), with clean WPF build, 15/15 reader tests and both tray/full GUI regression checks. These are developer-run tests, not independent reviewer sign-off.

## Output contract for independent review

Provide a severity-ranked defect list with exact file and line references, concrete failure scenarios, and actionable fixes. Separate verified bugs from hypotheses. Identify which test gate must pass for each fix. If no defects are found, report explicitly which files and paths were reviewed and which acceptance tests remain unverified.

**Do not silently modify files.** If changes are authorized in a follow-up, assign narrow ownership, apply exact hash-guarded edits, run focused tests, and commit only the reviewed files. Never restart or redeploy the live Workbridge MCP service as part of this review.
