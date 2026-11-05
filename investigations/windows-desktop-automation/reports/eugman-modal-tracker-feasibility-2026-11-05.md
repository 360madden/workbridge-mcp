# M4 eugman/FlaUI-MCP-Core modal tracker — pinned source and integration feasibility

**2026-11-05 | 🟢 Worth reusing its modal-state algorithm; 🟡 optional isolated provider pilot; 🔴 do not replace Workbridge or import its server wholesale.** Source-only GitHub inspection, no Windows build/install/GUI/UIA execution.

## Exact upstream pin and dependency cost

- GitHub repository: https://github.com/eugman/FlaUI-MCP-Core
- Reviewed default-branch commit **f372899044d6b8ca9f466cb07b146bb6ff7be579** (author 2026-10-29, latest observed on 2026-11-05). The upstream commit specifically improves handling of launch windows coexisting with owned startup dialogs.
- global.json at that commit pins **.NET SDK 9.0.300**, rollForward latestFeature (within that SDK major); FlaUI.Mcp.csproj targets **net8.0-windows** with UseWindowsForms=true, version 0.2.0, MIT. Package references: FlaUI.Core **5.0.0**, FlaUI.UIA3 **5.0.0**, System.Drawing.Common **10.0.2**, System.Text.Json **10.0.2**.
- README requires SDK 9.0.300+ and **.NET 8 Desktop Runtime**; Joey's confirmed Windows .NET 10 SDK alone does not guarantee either legacy component. Retargeting to net10.0-windows may be feasible but requires its own build/test/dependency review, not presumed drop-in.
- GitHub Actions Build workflow at this SHA shows **success** on 2026-10-29, but the push path executes the **build only**. The check.ps1 full offline unit/analyzer gate runs on PR/manual, and interactive WinForms/WPF integration tests are explicitly excluded from CI. Do not claim passing modal integration on that CI receipt.

## Exact reusable algorithms

| Component | Source behavior and best Workbridge use |
| --- | --- |
| 🟢 WindowBaseline.cs (GitHub blob SHA fb29078...) | Before action take native process-scoped EnumWindows list: HWND, PID, owner HWND, enabled state, tool/cloaked/class/title. A real modal signature is a **previously enabled owner now disabled**, plus a **new non-tooltip/non-menu/non-tool/non-cloaked owned window**. A new popup without disabled owner is not marked modal. Minimal native read-only detection algorithm is practical without referencing FlaUI or MCP libraries. |
| 🟢 ModalAwareInvoker.cs (blob SHA 70fb356...) | Take native baseline **before** dispatch; run synchronous provider pattern call on tracked background task; poll native HWND/owner state every **50 ms**, up to **2 seconds** (bounded iteration count as well as clock). Classify Completed, ModalDetected or StillPending. After completed calls, watch another **300 ms** for late modal (and downgrade earlier state proof). This is a useful pattern for M4, but the Task can remain blocked beyond the call's reply. |
| 🟢 PendingInvokeTracker.cs (blob SHA 4b195992...) | Store operation ID, parent operation ID, PID **and process start ticks**. While a call occupies a provider, fail fast on other UIA tools rather than stacking blocked reads; expose a separate operation-status endpoint and clear on eventual task completion. Reused PID with a different start is not confused with stale pending state. |
| 🟡 OperationStatusTool.cs / OperationContext.cs | Separate state from dispatch evidence: an action may be pending even after a request returns. Status reports pending IDs, inputsSent and action outcome, not implicit success. Workbridge has command journals and request IDs already; adapt semantics to those, not this entire MCP server's type graph. |
| 🟡 ModalDialogTests.cs | Upstream WinForms test clicks a button whose handler shows ShowDialog; asserts early modal detection, UIA snapshot fail-fast while provider blocked, native window enumeration, then recovery after modal dismissal. A separate ellipsis-button test uses physical click. These are integration tests requiring an interactive desktop, not evidence from a CI build. |

## Fit to our disposable M4 modal fixture

Our isolated, compile-verified prototypes/modal-dialog-probe/ source at commit 6583553 has fixed WinForms owner + ShowDialog(this) modal, stable OpenModalButton/OwnerStatus and ModalStatus/DismissModalButton UIA names, native JSONL stages and GetWindow(GW_OWNER) ownership proof. A later **quiet passive read-only pilot** can compare WinApp/sbroenne enumeration against the journal as the modal opens/closes; it cannot yet validate blocked InvokePattern handling because the fixture auto-opens the modal without a provider action.

A future, separate **approved synthetic input** trial can invoke only OpenModalButton under the one shared GUI-turn lease and a child-owning watchdog. Read native owner IsWindowEnabled and child owner HWND from a small read-only Win32 observer during the 30-second modal interval; feed before/after windows to the WindowBaseline algorithm, note provider status before and after, never double-invoke. Required outcomes: owner exact PID/start/session/HWND, real native child owner relationship, no unrelated window, pending action marked pending not success, independent modal disappeared, provider recovered, Job empty, no duplicate dispatch. Do not use real OneDrive, VMware or RIFT dialog targets in this proof.

## Concrete recommendation

1. **Keep WinApp 0.7.1 and pinned Sbroenne v1.3.28 as current head-to-head candidates**. First finish read-only semantics/latency and provider process containment using the disposable fixture.
2. **Reuse only the small native modal detector and pending-status semantics** behind Workbridge's existing request/lease/watchdog boundary if and when real modal failure is reproduced. This avoids requiring SDK 9 + Desktop Runtime 8, a separate FlaUI 5 dependency graph, full generic window/input tools and another uncoordinated desktop owner.
3. **Defer adopting eugman's whole MCP server** pending distinct isolated testing and .NET8 runtime verification. Its private DesktopLease mutex is not automatically coordinated with WinApp or Workbridge's shared desktop-turn lock. Background task timeouts do not kill a hung COM/UIA provider; the child process's Job remains the hard recovery boundary.

Primary pinned source links:
- [WindowBaseline](https://github.com/eugman/FlaUI-MCP-Core/blob/f372899044d6b8ca9f466cb07b146bb6ff7be579/src/FlaUI.Mcp/Core/WindowBaseline.cs)
- [ModalAwareInvoker](https://github.com/eugman/FlaUI-MCP-Core/blob/f372899044d6b8ca9f466cb07b146bb6ff7be579/src/FlaUI.Mcp/Core/ModalAwareInvoker.cs)
- [PendingInvokeTracker](https://github.com/eugman/FlaUI-MCP-Core/blob/f372899044d6b8ca9f466cb07b146bb6ff7be579/src/FlaUI.Mcp/Core/PendingInvokeTracker.cs)
- [Modal integration tests](https://github.com/eugman/FlaUI-MCP-Core/blob/f372899044d6b8ca9f466cb07b146bb6ff7be579/tests/FlaUI.Mcp.IntegrationTests/ModalDialogTests.cs)
- [Workflow](https://github.com/eugman/FlaUI-MCP-Core/blob/f372899044d6b8ca9f466cb07b146bb6ff7be579/.github/workflows/build.yml)
