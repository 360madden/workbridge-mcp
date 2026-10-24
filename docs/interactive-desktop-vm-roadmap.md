# Interactive Windows desktop and VMware control — GUI-001 onward

Status: implementation in progress, October 24, 2026. This is a new feature lane, not an authorization to restart or replace the deployed Workbridge owner.

## Baseline (observed through running Workbridge 0.16.3-dev)

- Primary root: `C:\work`; additional root: `C:\rift modding`.
- Workbridge command jobs and VMware processes all run in Windows session 2; `UserInteractive=True` and one screen is enumerated. An interactive session alone does not prove input delivery or valid screenshot content.
- VMware Workstation's `vmrun.exe` exists under `C:\Program Files\VMware\VMware Workstation`. A read-only `vmrun -T ws list` reported `C:\rift modding\VMs\RIFT-Lab\RIFT-Lab.vmx` running.
- Microsoft's `winapp` command is not installed. WinGet currently indexes `Microsoft.WinAppCli` version 0.7.1. Its public-preview UI Automation CLI offers window enumeration, UIA patterns, targeted input, screenshots, and a desktop-turn coordination mechanism.
- The repository contains substantial older unstaged and untracked changes from the 0.16.x workstream. Preserve those files and Git index, do not blanket-stage or overwrite them. The installed owner is not changed by source edits.

## Scope and architecture

Prefer maintained Windows/VMware tooling to a custom keyboard/mouse driver. Workbridge remains the generic, recoverable MCP transport; a bounded desktop-control adapter selects a specific desktop session, process/window or VM identity. Never assume that an active VMware process proves the guest receiver is usable.

All interaction is target-specific, observable and serialized across Workbridge callers. Read-only discovery precedes screenshot; screenshot precedes focus/input. Each input request must state its target and identify its expected state, include a durable request ID, reject stale targeting and conflicting leases, and return evidence of the actual outcome. No arbitrary global key injection, secure-desktop bypass, or unattended VM power operations.

## Milestones and acceptance gates

| Milestone | Deliverable | Acceptance | Commit gate |
| --- | --- | --- | --- |
| GUI-001 — Inventory | Read-only `scripts/Inspect-DesktopVm.ps1` returning compact JSON; tests | Windows session, monitors, VMware and WinApp availability; optional vmrun inventory; missing dependencies tolerated; no desktop/guest changes | Commit only this helper, its tests and roadmap after checks |
| GUI-002 — Tool backend | Pin/verify Microsoft's WinApp CLI as an optional installed dependency; wrap supported inspect/list-windows JSON and target selection | Known-version CLI, structured failures, target selection by PID/HWND; no foreground/input side effects | Tests and small commit |
| GUI-003 — Capture and transport | Bounded target-window/VM screenshot with metadata, host-safe path and optional MCP image response | Evidence from a disposable test window, real nonempty image, monitor/DPI dimensions, occluded/minimized limitations, storage/transport bounds | Tests and small commit |
| GUI-004 — Targeted input | Explicit lease, focus check, scoped keyboard/mouse UIA action, cancellation and after-action screenshot | Disposable test app: correct target only; locked screen/stale PID/focus mismatch fail without injection; no competing caller races | Tests and small commit |
| GUI-005 — VMware integration | Read-only VM enumeration and running-state checks, then guest-specific display/input adapter if a verified integration exists | Selected .vmx matches observed guest and current window; VM receiver and graphics evidence independently verified | Tests and small commit |
| GUI-006 — MCP and rollout | Register narrow tools, type-checked schemas, fixed permissions, usage docs, staged release via WB-001 | Isolated build/test/release gates, rollback exercise, fresh hosted capture/inspection and explicitly approved target input | Deploy separately; commit observed evidence |

## Implementation rules

1. Preserve existing roots, tunnel authentication, local protected bearer descriptor, shared owner/job state, command journal and WB-001 recovery controller. Do not launch a second server against `.local`.
2. Use Microsoft WinApp CLI UIA verbs for accessibility-friendly apps; use screenshot/foreground input only if UIA cannot express the action. Workstation graphics may require Windows Graphics Capture or a verified VMware API; validate rather than assuming `PrintWindow` works on accelerated output.
3. Prefer `vmrun -T ws list` for initial VMware inventory. Do not stop, reset, snapshot, reconfigure or log into a running VM to test discovery.
4. Only use synthetic test applications for input validation. Live Rift inputs require guest control and screenshot evidence plus explicit test scope.
5. Bounded outputs: no unrestricted screen streaming, no whole-desktop secrets in textual logs, avoid recording clipboard or keystroke contents, and clean up only identified disposable artifacts.
6. Commit selected verified files after each successful milestone. Do not blanket-stage the existing dirty repository. Reconfirm HEAD and hashes immediately before each commit. A source commit is not a deployed Workbridge release.
7. Before any production update use WB-001 staged validation and independent rollback. If the current user session is locked or unavailable, report the blocker and do not try to bypass it.

## References and near-term commands

- Microsoft WinApp CLI and UI automation: https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/ and https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/ui-automation
- VMware Workstation Pro API: https://developer.broadcom.com/xapis/vmware-workstation-pro-api/latest/
- Inventory: `powershell.exe -NoProfile -NonInteractive -File scripts/Inspect-DesktopVm.ps1`
- Opt-in read-only VM list: `powershell.exe -NoProfile -NonInteractive -File scripts/Inspect-DesktopVm.ps1 -IncludeRunningVMs`
- Tests: `node --test test/desktop-vm-inventory.test.mjs`

## Progress

- GUI-001: implementing and validating.
- GUI-002 through GUI-006: pending, blocked from live input by missing tested capture/targeting path.
