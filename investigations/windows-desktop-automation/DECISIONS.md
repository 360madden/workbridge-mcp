# Durable investigation decisions — 2026-11-04

| ID | Decision | Rationale |
| --- | --- | --- |
| WDA-D001 | Keep Workbridge as the MCP coordination/orchestration layer. | Preserve day-to-day 36-slot work and existing deployments. |
| WDA-D002 | Third-party software may **replace individual desktop functions**, not merely become an adapter. | Joey explicitly prefers a working, reliable solution over slow custom integration. |
| WDA-D003 | Microsoft WinApp CLI 0.7.1 is the initial installed baseline. | Existing dependency and testing already present in Workbridge. |
| WDA-D004 | sbroenne/mcp-windows is the leading new backend candidate. | .NET 10, CLI+MCP, persistent CLI owner, semantic controls and observation IDs; validate locally. |
| WDA-D005 | eugman/FlaUI-MCP-Core is the primary FlaUI engineering reference. | Modal handling, no-ref-reuse, guarded input/drag; check compatibility and maturity. |
| WDA-D006 | Compare make/wrap/replace on each function rather than replacing an entire working subsystem by default. | Avoid unnecessary development cost and regressions. |
| WDA-D007 | Only one controller may physically inject input into a shared desktop at once. | Prevent multi-agent focus and input races. |
| WDA-D008 | Every meaningful mutation requires before/after evidence and an explicit outcome including `unknown`. | Input-dispatched is not target-state verified. |
| WDA-D009 | Host GUI inspection does not imply guest GUI inspection. | Windows UI Automation is scoped by session; guest-side capability must be verified. |
| WDA-D010 | Production code/service changes remain separately gated by WB-001. | This folder is an investigation lane, not a production switch. |

Open choices: actual per-function backend winner; how guest-side helpers are hosted/restarted; what evidence to capture when UIA and screenshots disagree; target-specific timeout budgets.

Reference: `../../docs/autonomous-investigation-policy.md`.
