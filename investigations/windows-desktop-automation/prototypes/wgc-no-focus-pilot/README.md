# WGC-only disposable-window pilot (P3.2)

Status: **source-only and synthetic testing**, until the coordinator independently
authorizes one disposable GUI run. This prototype is deliberately not a RIFT
client capturer or a general HWND screenshot tool.

## Evidence/reuse

Uses official Microsoft NuGet:
- `Microsoft.Windows.SDK.BuildTools.WinApp.UIAutomation` **0.7.1**.
- `IWindowCapture.StartFrameGrabber` / `IFrameGrabber.WaitForFirstFrameAsync`.
- In the pinned **v0.7.1**, `StartFrameGrabber` directly invokes
  `WgcCapture.StartGrabber` -> `CreateItemForWindow` ->
  Direct3D11 frame pool `CreateFreeThreaded`. There is **no PrintWindow
  fallback** in that method/release.
- GitHub main has newer APIs and fallback behavior. Do **not** silently
  upgrade; v0.7.1 `IFrameGrabber` has no `RootCaptureBackend` property.
- `System.Drawing` from Windows desktop framework encodes raw BGRA into PNG.
  `GetForegroundWindow` observes only; it never moves focus.

Release-specific primary source:
- https://github.com/microsoft/winappCli/blob/v0.7.1/src/winapp-CLI/WinApp.UIAutomation/Capture/IWindowCapture.cs
- https://github.com/microsoft/winappCli/blob/v0.7.1/src/winapp-CLI/WinApp.UIAutomation/Capture/WgcWindowCapture.cs
- https://github.com/microsoft/winappCli/blob/v0.7.1/src/winapp-CLI/WinApp.UIAutomation/Capture/WgcCapture.FrameGrabber.cs
- https://github.com/microsoft/winappCli/blob/v0.7.1/src/winapp-CLI/WinApp.UIAutomation/PACKAGE.md

## Explicitly excluded

No generic `--hwnd` or `--pid` targeting; no physical RIFT/VM/game capture;
no WinApp CLI generic screenshot; no `CaptureWindowPixels`; no
`SetForegroundWindow`, `SetFocus`, `ShowWindow`, `PrintWindow` or
`BitBlt` calls; no picker, input injection, service/registry changes, or
fallback. Existing apps should retain foreground.

## Source build/synthetic tests (Windows PowerShell in this directory)

1. `dotnet restore .\WgcNoFocusPilot.csproj --packages .packages`
2. `dotnet build .\WgcNoFocusPilot.csproj --no-restore -c Release`
3. `dotnet run --no-build --project .\WgcNoFocusPilot.csproj -c Release -- --self-test`

The self-test validates BGRA->PNG pixel channels, dimensions, signature and
invalid buffers. It starts **no GUI** and makes **no capture**.

## GUI capture — NOT AUTHORIZED YET

Only after an explicit coordinator/user checkpoint, launch a disposable
synthetic local top-level window:
`dotnet run --no-build --no-restore --project .\WgcNoFocusPilot.csproj -c Release -- --capture-disposable`

Expected: foreground HWND unchanged, WGC-only release API, one color-varying
frame, PNG with SHA-256, and no overwrite. The output is a fixed
`bin/Release/net10.0-windows10.0.19041.0/pilot.png` inside this prototype;
there is no caller-supplied output path. All GUI lifetime and the bounded
message-pumping wait stay on the originating STA thread. A failed/unsupported
capture stops without another backend. The synthetic fixture may briefly
appear at the top left; it uses ShowWithoutActivation and WS_EX_NOACTIVATE
to avoid stealing focus. **Never run this command against the physical game.**

## Reversibility

Only this directory's own `.packages/bin/obj` and optional `bin/.../pilot.png` are affected.
Cleanup requires validated exact paths and separate authorization.
