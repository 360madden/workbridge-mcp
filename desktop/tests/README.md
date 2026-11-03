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

## Bounded monitor regression tests

Run from `C:\\work\\workbridge-mcp` in Windows PowerShell:

```powershell
dotnet run --project .\\desktop\\tests\\BoundedLineReaderTests.csproj -c Release --nologo
.\\desktop\\tests\\Run-OversizeMonitorFixture.ps1
```

The unit harness tests the incremental 64,000-character line limit, CRLF, EOF, cancellation and oversized messages. The integration fixture creates a new disposable folder under the repository's `temp` directory, copies the already-built GUI there, configures that copy to use its own fake monitor, and verifies oversized output -> offline -> recovery -> offline. It refuses to run when the dashboard already exists, cleans up only its own fixture/process, and **does not stop the live MCP server**. Test success is not independent code-review sign-off.

## Synthetic tray callback regression

From `C:\work\workbridge-mcp` in Windows PowerShell, after building the desktop application:

```powershell
.\desktop\tests\Run-TrayCallbackSmoke.ps1
```

This test refuses to run over an existing Control Center instance. It starts an isolated `--tray` process, enumerates **only windows owned by that process**, sends simulated WinForms notification callback messages to its hidden notification window, verifies double-click restoration and close-to-tray behavior, then opens its context menu and invokes **Exit Control Center** through UI Automation. It also calls the read-only Windows `Shell_NotifyIconGetRect` API using only its own notification HWND and identifier to confirm Explorer registered the icon, even when hidden in overflow. It verifies shutdown and removes only the owned process. No global mouse/keyboard input is sent.

**Scope limitation:** This proves the application's notification callbacks and actual WinForms context-menu item work. It does **not** prove that clicking the icon through Windows Explorer's taskbar or overflow UI works. That remains a separate M1 acceptance gate.

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
