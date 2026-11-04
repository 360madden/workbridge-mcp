# FlaUI + Workbridge handoff — November 4, 2026

Owner: Joey. Target: C:\work\workbridge-mcp. This is a handoff, not a claim that the adapter exists.

## Resume prompt for the new Workbridge project conversation

> Read AGENTS.md, docs/autonomous-investigation-policy.md, docs/interactive-desktop-vm-roadmap.md, and docs/handoff-flaui-workbridge-2026-11-04.md. Refresh workspace_info, Git status/HEAD and .NET SDK. Implement a small optional C#/.NET FlaUI UIA3 read-only adapter in the Workbridge repo, benchmark against the existing WinApp CLI, preserve unrelated changes and the live service, and do not deploy without WB-001 staged checks/rollback. Report measured speed, correctness, faults and exact next steps.

## Decisions made

- The FlaUI source clone belongs at C:\work\FlaUI and must remain clean upstream. It is not the location for Joey's custom adapter.
- The custom helper belongs in C:\work\workbridge-mcp, proposed under helpers/FlaUIBridge (first inspect existing helpers for naming conventions). MCP registration belongs in src alongside existing desktop tools.
- Suggested architecture: ChatGPT -> Workbridge Node MCP -> persistent C#/.NET helper -> FlaUI UIA3 -> supported Windows UI Automation controls.
- Use pinned compatible FlaUI NuGet packages. Updating the source clone must not silently rebuild or deploy the helper.
- Prefer .NET 10 if installed/compatible. A versioned bounded line-oriented JSON protocol over stdio is a proposal to validate, not an established implementation.
- Initial read-only milestone: list windows, inspect accessible controls, get properties. Add Invoke/SetValue only after exact PID/HWND, leases, timeouts, idempotency and postcondition tests.
- WinApp CLI 0.7.1 remains a fallback. FlaUI is not inherently faster than WinApp UIA: any expected win comes from a persistent helper avoiding repeated subprocess startup, and must be benchmarked.
- Target File Explorer, ordinary Windows dialogs, OneDrive, and possibly VMware host controls. Do not expect FlaUI to read RIFT custom DirectX buttons or capture game frames.
- No game input or focus changes without an appropriate explicit test scope. Use disposable/synthetic windows first; follow existing desktop-input turn locks and host/guest identity checks.

## Verified host state on November 4

- Workbridge MCP reports 0.16.4-dev, primary root C:\work, 36 command slots. Slots do not equal autonomous AI reasoning agents.
- Official FlaUI/FlaUI Git clone successfully created at C:\work\FlaUI. Git status: clean main tracking origin/main. HEAD fd7cc64, 2026-08-13, Fix tests in CI (#746).
- FlaUI adapter has NOT been created, built, tested, registered or deployed. No automatic FlaUI Git update task was configured.
- Existing backend includes Microsoft WinApp CLI 0.7.1, scripts/desktop-ui.mjs, scripts/desktop-capture.mjs, src/desktop-registration.ts, and guarded desktop screenshot/targeting capabilities.
- At this handoff, workbridge-mcp main has an unrelated modified file scripts/freebuff-conpty-probe.py. Preserve it; never blanket-stage, stash, reset or overwrite.
- Existing docs can contain outdated deployment-state assertions. Verify live owner/runtime before action; no npm build in live source if it changes deployed dist; use isolated tests and WB-001 for staged upgrades.

## First technical milestone and acceptance

1. Inventory existing helpers, .NET SDK version and NuGet/cached dependency availability. Check current AGENTS.md instructions.
2. Create an isolated, non-deployed FlaUI helper skeleton with bounded read-only request/response and error handling; no competing Workbridge service owner.
3. Test window enumeration/inspection/property reads against a disposable or harmless native Windows window. Ensure correct PID/HWND and no foreground change.
4. Compare equivalent WinApp vs FlaUI: cold/warm latency, 20-50 repeated queries, reliability, memory footprint, and stale-target handling. Report numbers, not assumed superiority.
5. If validated, implement a narrow Node adapter/tool registration with focused tests and review; commit only owned files. Defer production rollout to WB-001.

## Related but separate investigation: OneDrive pauses in two RIFT VMs

- Joey runs RIFT physically and in RIFT-Lab-1/2. He uses OneDrive Personal in both Windows guests for Lua addons/SavedVariables and experiences large backlogs of hundreds of MB after having to manually resume syncing.
- Screenshots of both guests confirmed OneDrive paused (Resume syncing available, Settings greyed out). The disabled Settings menu is consistent with paused state, not proof of VMware failure.
- Read-only vmrun list found both live VMXs: C:\rift modding\VMs\RIFT-Lab-1\RIFT-Lab.vmx and C:\rift modding\VMs\RIFT-Lab-2\RIFT-Lab.vmx.
- Existing RiftReader2 scripts/lab_guest_probe.py accessed both through cached, identity-pinned VMware Tools sessions; both RIFT processes were present, no gameplay or focus input.
- In both: OneDrive process running; startup enabled (AutoStartEnabled=1 and Run entry); personal UserFolder C:\Users\mrkoo\OneDrive; UserSettingMeteredNetworkEnabled=0.
- Both have Ethernet0 with working IPv4 and Public network category; this is NOT the metered network cost classification. No virtual battery. Balanced power plan. No selected System sleep/resume events ID 42/107 in checked period.
- Standard OneDrive startup/updater/reporting scheduled tasks were present. No named task or executable directly identified as pausing OneDrive; task arguments and unrelated scripts were not exhaustively audited.
- Both have OneDrive Personal diagnostic logs; readable SyncDiagnostics.log showed zero counted upload/download/hash/realizer errors, but no pause trigger. Binary ODL logs were not decoded.
- Root cause remains UNKNOWN. Do not claim VMware causes it, or that OneDrive was fixed. No OneDrive settings changed, clients resumed, game restarted, or VMs power-cycled.
- Next: verify actual metered cost, pause policy/task arguments; with Joey's go-ahead resume clients and monitor exact pause transitions, timestamps and logs. Consider a separate host-to-VM hash-verified addon sync design instead of cloud round trips.

## Operational rules

- Read AGENTS.md and the autonomous investigation policy before work. Distinguish host, VMware encrypted-VM, cached guest login, game, OneDrive process and OneDrive sync status.
- Preserve the live RIFT games and Workbridge owner; prefer read-only diagnostics and synthetic tests. Do not publish credentials or raw private logs.
- Follow Workbridge SHA-guarded patch journaling, focused tests, exact-file commits and the WB-001 release gate. Source commit is not production deployment.

Status: FlaUI clone verified; adapter only planned; OneDrive cause unresolved.
