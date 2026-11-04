# Candidate research findings — 2026-11-04

Research began source-only. Since then, Workbridge read-only WinApp measurements, guest status probes and a synthetic process-lifetime test have been performed, and an isolated candidate source checkout has been verified. **No production runtime replacement or GUI actions**. Evidence: `reports/2026-11-04-investigation-sitrep-01.md`.

| Candidate | Role | Primary repository |
| --- | --- | --- |
| Microsoft WinApp CLI | First benchmark, already present at 0.7.1 | https://github.com/microsoft/winappCli |
| sbroenne/mcp-windows | Leading new .NET 10 MCP/CLI backend | https://github.com/sbroenne/mcp-windows |
| eugman/FlaUI-MCP-Core | Specialized FlaUI integration and modal/recovery reference | https://github.com/eugman/FlaUI-MCP-Core |
| ChrisPulman/UIInspect.MCP | Strict process/session-targeting reference | https://github.com/ChrisPulman/UIInspect.MCP |
| CursorTouch/Windows-MCP | Broad popular Python desktop MCP alternative | https://github.com/CursorTouch/Windows-MCP |
| trsdn/mcp-server-uiautomation | Deep UIA/legacy accessibility/event reference | https://github.com/trsdn/mcp-server-uiautomation |
| DigitalDog1/desk-mcp | UIA/MSAA/CDP/OCR fallback reference; inspect CI failures | https://github.com/DigitalDog1/desk-mcp |
| appium/appium-wincore-driver | WebDriver-based specialist for repeatable UI testing | https://github.com/appium/appium-wincore-driver |

Findings reviewed in the November 4 conversation:
1. WinApp CLI has UIA patterns, target selection and cooperative physical-desktop arbitration; direct library consumers do not automatically inherit the CLI's arbiter. Verify installed release behavior, not only main-branch documentation.
2. sbroenne's element registry retains identity including process start and runtime ID and refuses stale IDs; CLI daemon preserves observations between commands. Project-reported token/time benchmarks have **not** been reproduced against WinApp.
3. eugman's `ElementRegistry` no longer recycles snapshot refs. Its `ModalAwareInvoker` and pending-operation tracker are promising for hung dialogs, but a pending provider can still outlive a timeout.
4. UIInspect uses exact-process checks, limited semantic mutation and audit records but lacks screenshot/OCR and general keyboard/mouse fallback.
5. Games/custom DirectX controls may expose no usable accessibility tree. Host-side UIA sees VMware Workstation windows, not every application inside a guest OS.
6. The original `shanselman/FlaUI-MCP` is not the preferred direct integration candidate; previous review identified stale-reference and timeout/targeting concerns.

Primary docs:
- https://github.com/microsoft/winappCli/blob/main/docs/ui-automation.md
- https://github.com/sbroenne/mcp-windows/blob/main/FEATURES.md
- https://github.com/eugman/FlaUI-MCP-Core/blob/main/README.md

Open questions: actual comparative speed/reliability on Joey's host, multi-agent input serialization across different providers, VM guest deployment shape, and robust after-action evidence.

## Verified first-wave updates
- Workbridge WinApp full discovery+inspect median **3677 ms** and approximate P95 **5672 ms** over 10 read-only taskbar cycles; 0 errors, low N.
- Independent 15-call CLI startup timings found two avoidable `--version` calls in each full cycle; direct `desktop_inspect` with known PID/HWND still revalidates identity. Optimization not yet deployed.
- Only host .NET SDK **10.0.302** is installed; sbroenne v1.3.28 source pinned to commit `655b9fc92d03ad52a270067c6844ea1231c90559`, global.json pins SDK 10.0.401. Isolated publish compatibility unresolved as of initial checkpoint.
- Existing Workbridge `Desktop-JobLifetime.cs` synthetic smoke passed 1/1; this proves process-tree cleanup for the fixture, not cancellation of real COM UIA calls.
- Fresh Lab1 queue blocked with missing cleanup receipt and disconnected guest, whereas Lab2 queue clean and guest connected. RR2's RIFT-only cleanup watchdog cannot safely attest an independent UIA writer; design a separate integrated lease before guest input.
- UIA is not universal: Windows Graphics Capture cannot capture minimized windows; secure desktop requires user handoff; custom-rendered controls may need Win32/WGC plus image/OCR observation.
