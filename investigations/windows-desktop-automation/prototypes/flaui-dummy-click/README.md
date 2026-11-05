# FlaUI disposable mouse-click validation harness

**2026-11-05 status: compile/pure-test only. No GUI launch, input, focus, or physical RIFT interaction is authorized in this milestone.**

## Purpose

Prepare one small, self-owned WinForms button with an independent click counter to validate FlaUI's existing `FlaUI.Core.Input.Mouse.Position` and `Mouse.LeftClick()` before any physical-RIFT Retry-button adapter is considered. This harness references Joey's existing `C:\work\FlaUI\src\FlaUI.Core\FlaUI.Core.csproj`; it does not reproduce Win32 mouse injection.

## Modes

- No arguments or `--dry-run`: pure JSON report; no Form or input objects constructed.
- `--self-test`: thirteen pure geometry, native ownership-witness and no-input assertions; no GUI, mouse or keyboard.
- `--dummy-live-once --confirm disposable-window-only`: **future explicit dummy test only**. Creates a self-owned test window, checks the exact foreground HWND, derives the button center (no arbitrary coordinates accepted), confirms `WindowFromPoint` hits its own button/descendant with `GA_ROOT`, PID/session and foreground witnesses, moves with FlaUI, rechecks the hit/cursor immediately before one FlaUI click, checks counter 0 → 1 and exits. **Do not run until separately approved; it can temporarily take desktop focus.**

**Live dummy gate:** The exact dummy-only mode must be invoked only after a separate Workbridge wrapper has acquired exclusive desktop admission/turn ownership, saved a durable one-shot intent, and verified explicit Joey approval. This standalone executable does not acquire those shared locks; an unwrapped invocation is NOT authorized even though the CLI can parse its confirmation.

Nothing supports arbitrary HWND, PID, screen coordinates, desktop applications, or RIFT. The executable is a disposable experiment and must never be registered in Workbridge's live server or scheduled at startup.

## Build isolation

Run from `C:\work\workbridge-mcp`, not the FlaUI source root (whose `global.json` pins a different SDK):

```powershell
& 'C:\Program Files\dotnet\dotnet.exe' build 'investigations\windows-desktop-automation\prototypes\flaui-dummy-click\FlaUIDummyClick.csproj' --configuration Release --framework net10.0-windows --artifacts-path 'C:\work\workbridge-mcp\.tools\flaui-dummy-artifacts' -p:GeneratePackageOnBuild=false --nologo
```

Build output belongs only to ignored `.tools\flaui-dummy-artifacts`. Do not run the live-dummy mode as part of build. Use the generated assembly with `--dry-run` and `--self-test` for synthetic verification. If package restore is unavailable, stop and report; don't change FlaUI's SDK pin or package settings.

## Next validation gate (not done)

1. Independent code review and compile/synthetic tests. Verify `C:\work\FlaUI` has no new tracked/untracked changes.
2. Ask Joey before the **disposable** GUI test, since it will take desktop focus and move the cursor briefly. Run the exact self-owned counter once; verify native event count and negative-monitor coordinate transform in separate supervised tests.
3. Only then design a separate Workbridge RIFT Retry one-shot adapter with fresh capture/ROI, exact RIFT HWND/start/session, virtual-screen DPI mapping, shared admission/turn lock, fsynced intent/receipt, quarantine/no retry and post-action game proof. This harness does **not** implement that adapter.
