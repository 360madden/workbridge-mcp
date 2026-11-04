# eugman/FlaUI-MCP-Core — specialized engineering reference

Repo: https://github.com/eugman/FlaUI-MCP-Core
Origin: substantially expanded derivative of shanselman/FlaUI-MCP.
Requirements per README: .NET 9 SDK plus .NET 8 Desktop Runtime.

Source findings:
- `ElementRegistry.BeginSnapshot` removes old references but never recycles their increasing IDs.
- `ModalAwareInvoker` can report modal-detected or still-pending operations while tracking unresolved invocations.
- `DesktopLease` uses a named machine-wide mutex across its own cooperating FlaUI hosts.
- Guarded input checks foreground, target geometry, drag destination and screenshot/DPI mismatch.
- Recent checked CI build completed successfully.

Risks:
- Small adopter base; extra SDK/runtime requirements compared with native .NET 10 candidates.
- Its mutex does not automatically coordinate with WinApp or another external helper.
- A stranded UI Automation provider can still hold a background thread; test hard recovery.

Status: source reference and optional isolated candidate; no installation.
