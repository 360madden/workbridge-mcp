# Interactive Windows desktop and VMware control — GUI-001 onward

Status: implementation in progress, October 24, 2026. This is a new feature lane, not an authorization to restart or replace the deployed Workbridge owner.

## Baseline (observed through running Workbridge 0.16.3-dev)

- Primary root: `C:\work`; additional root: `C:\rift modding`.
- Workbridge command jobs and VMware processes all run in Windows session 2; `UserInteractive=True` and one screen is enumerated. An interactive session alone does not prove input delivery or valid screenshot content.
- VMware Workstation's `vmrun.exe` exists under `C:\Program Files\VMware\VMware Workstation`. A read-only `vmrun -T ws list` reported `C:\rift modding\VMs\RIFT-Lab\RIFT-Lab.vmx` running.
- Microsoft WinApp CLI 0.7.1 is installed for the current Windows user (it was absent at the initial inventory). Its public-preview UI Automation CLI offers window enumeration, UIA patterns, targeted input, screenshots, and a desktop-turn coordination mechanism.
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

- GUI-001: complete, committed as `ad6107f` (Oct 24). Read-only inventory and optional vmrun enumeration passed both tests.
- GUI-002: WinApp CLI 0.7.1 installed for the current Windows user. The read-only `scripts/desktop-ui.mjs` backend validates version, PID/HWND, optional exact title/process, bounded output, and UIA inspection. It successfully enumerated and inspected the live VMware host window; all five isolated unit tests passed. Validation: five GUI-002 unit tests plus two GUI-001 tests passing, Prettier clean, live WinApp enumeration and UIA inspection passed.
- Important live observation: `RIFT-Lab-1 - VMware Workstation` was minimized (160x28 host HWND; UIA root offscreen and child geometry near -32000). Inspection worked, but no capture, restoration, input, or guest control is claimed.
- GUI-003a capture backend: validated with a real, non-minimized Windows taskbar HWND. The adapter checked PID/HWND/process/class, rejected absent or offscreen targets, wrote a 2560x48 PNG under ignored `.tools/desktop-evidence`, verified size/dimensions/SHA-256, saved an exclusive JSON receipt, and replayed the identical request without another screenshot. Five GUI-003 tests passed; twelve targeted GUI-001..003 tests pass.
- GUI-003b disposable GUI and MCP image transport: pending. A short-lived WinForms probe launched from Workbridge's hidden command runner was not visible to WinApp; the existing interactive-user task helper was tried but returned exit code 1 before the probe's early diagnostic marker. The temporary scheduled task was removed. The test form and diagnostic tooling are retained in source for investigation; no live VM input was attempted.
- GUI-004 through GUI-006: pending. Explicit lease/focus checks, synthetic-app input acceptance, VMware guest receiver verification and staged owner rollout are still required.

## Read-only WinApp CLI adapter

- `node scripts/desktop-ui.mjs windows --app vmware` — list matching window identities.
- `node scripts/desktop-ui.mjs inspect --pid PID --hwnd HWND --process vmware --depth 2` — revalidate the discovered PID/HWND before inspecting its UIA tree.
- `--title` is an optional *exact* title guard. Numbers and identities must come from recent enumeration, not a saved PID across restarts.
- Output is compact JSON with `ok`, `readOnly`, backend version and typed failure code. The adapter exposes **no focus, input or screenshot verb** in this phase.
- WinApp CLI 0.7.1 is a user-scope optional prerequisite, not a bundled Workbridge dependency. An unexpected version fails closed.

## Screenshot CLI prototype (GUI-003a)

- First enumerate with `node scripts/desktop-ui.mjs windows --app explorer` and select one HWND from fresh output.
- Example using an observed taskbar target: `node scripts/desktop-capture.mjs --pid PID --hwnd HWND --process explorer --class Shell_TrayWnd --request-id UNIQUE_ID`. Substitute the current PID and HWND; never reuse old numeric identities.
- Evidence stays under ignored `.tools/desktop-evidence/capture-UNIQUE_ID.png` and an exclusive receipt `.json`. Reusing an exact completed request ID returns the same verified result. An image without a receipt halts for recovery rather than silently retaking or overwriting it.
- Never use `--capture-screen` or `--focus` in the adapter. WinApp may nevertheless briefly foreground the target when its native capture fallback is necessary. Do not capture minimized or offscreen windows.
- This is a developer script, not yet an MCP tool or a deployed interactive-control service. Screenshot output proves host-window capture only, not VM guest graphics or input.
