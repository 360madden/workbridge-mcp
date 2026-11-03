# Desktop smoke-test instructions

The repeatable acceptance script is `Run-DesktopSmoke.ps1`.

It tests the real WPF window using Windows UI Automation and a targeted `WM_CLOSE` message. It does **not** modify the Workbridge MCP server, Windows scheduled task, VMware, or project files.

## Run locally

In **Windows PowerShell 5.1**, from `C:\work\workbridge-mcp`:

```powershell
dotnet build .\desktop\Workbridge.ControlCenter\Workbridge.ControlCenter.csproj --nologo -warnaserror
.\desktop\tests\Run-DesktopSmoke.ps1
```

To additionally verify the details button for a known *currently running* Workbridge job, pass its real ID:

```powershell
.\desktop\tests\Run-DesktopSmoke.ps1 -ExpectedJobId '<actual-running-job-ID>'
```

To also test the on-demand coordination assignments view for the default `workbridge-mcp` repository, run:

```powershell
.\desktop\tests\Run-DesktopSmoke.ps1 -CheckAssignments
```

You can combine `-CheckAssignments` with `-ExpectedJobId`. When invoked through Workbridge's `terminal_run`, its own running job ID can be passed as `-ExpectedJobId`.

## Acceptance checks

- Displays a live authenticated version/status.
- Selects a real job and invokes the details button when a matching job ID is supplied.
- Optionally invokes the **Load assignments** button and verifies that it displays coordination records separately from genuine AI sessions.
- Sends `WM_CLOSE` to the exact window handle of the test process. Verifies the window hides but the process survives.
- Starts a second instance. Verifies it exits and restores exactly one original instance.
- Stops only the process created by the test, including on failure.
- Returns bounded JSON test results and a nonzero exit on failure.

The script **refuses to start** when any Workbridge Control Center is already running. This protects a dashboard already in use; do not bypass that check. It does not attempt to click the actual taskbar notification icon or its context menu. Those remain separate M1 acceptance requirements.

The test assumes the built app can find its `workbridge-control-center.json` configuration and that the installed Workbridge engine is healthy. Run offline/reconnection acceptance with a disposable fixture, never by stopping the live Workbridge service.
