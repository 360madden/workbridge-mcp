# Independent reviewer brief — Workbridge Control Center M1/M2

**Status:** Review requested, not performed. This brief is for a genuinely independent AI reviewer (Extra High reasoning where configurable) or another code reviewer. It must not be counted as reviewer sign-off.

## Scope

Review only the Workbridge desktop Control Center and its integration scripts, not the running MCP owner or unrelated RIFT projects.

- `desktop/Workbridge.ControlCenter/App.xaml.cs`
- `desktop/Workbridge.ControlCenter/MainWindow.xaml.cs`
- `desktop/Workbridge.ControlCenter/MainWindow.xaml`
- `desktop/Workbridge.ControlCenter/Workbridge.ControlCenter.csproj`
- `desktop/Workbridge.ControlCenter/workbridge-control-center.json`
- `scripts/desktop-monitor.mjs`
- `scripts/desktop-status.mjs`
- `scripts/desktop-job-detail.mjs`
- `desktop/tests/Run-DesktopSmoke.ps1`

## Required review questions

1. **Single-instance correctness:** Inspect mutex and restore-event initialization, concurrent startup, dispatcher shutdown, and the 15-attempt retry boundary. Check for potential lost activations or exceptions.
2. **Tray lifecycle:** Examine hide-on-X, notification icon creation/disposal, restore on double-click, and explicit Exit GUI. The actual notification-area click/menu path is *not yet runtime-verified*.
3. **Background monitoring:** Check whether the long-lived Node.js monitor can survive unexpected GUI death, hang on a stalled MCP connection, leak processes, or retry too aggressively.
4. **Streaming bounds:** Review line length and buffering **before** parsing; a post-read 64K check is not a hard memory bound. Assess whether malformed/oversized output can affect the UI. Evaluate stdout backpressure.
5. **UI correctness:** Review live/offline state, inventory-completeness label, selection restoration during five-second refreshes, and stale job-detail response rejection.
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
- Earlier Shell_TrayWnd UI Automation read found no exact Workbridge notification icon; **do not infer actual icon/menu usability from that check**.

## Output contract for independent review

Provide a severity-ranked defect list with exact file and line references, concrete failure scenarios, and actionable fixes. Separate verified bugs from hypotheses. Identify which test gate must pass for each fix. If no defects are found, report explicitly which files and paths were reviewed and which acceptance tests remain unverified.

**Do not silently modify files.** If changes are authorized in a follow-up, assign narrow ownership, apply exact hash-guarded edits, run focused tests, and commit only the reviewed files. Never restart or redeploy the live Workbridge MCP service as part of this review.
