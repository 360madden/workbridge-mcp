# Initial research findings — 2026-11-04

Source-only review; no on-host installation, comparative performance run or production modification is claimed.

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
