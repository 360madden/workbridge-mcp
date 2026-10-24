# Interactive Windows desktop and VMware control — GUI-001 onward

Status: implementation in progress, October 24, 2026. This is a new feature lane, not an authorization to restart or replace the deployed Workbridge owner.

Standing autonomous blocker policy: `docs/autonomous-investigation-policy.md` (also referenced by repository `AGENTS.md`). After a failed adapter, investigate supported alternatives and keep making scoped, evidence-backed progress; escalate only irreducible credential or material-action dependencies.

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
- GUI-003b synthetic visible-window proof: completed with a native .NET 10 WinForms helper launched using the existing Limited/Interactive scheduled-task manager. WinApp detected its HWND/PID in Windows session 2; targeted screenshot yielded a validated 702x442 PNG. A PowerShell Form launched from the hidden command runner was not visible, and the PowerShell scheduled-task experiment exited 1 before creating its diagnostic file. Native .NET helper resolved the test-window delivery question. Direct MCP image response is still pending.
- GUI-004a bounded UIA action: successfully invoked the helper's `IncrementButton` through `InvokePattern` and independently confirmed count 0→1 in the native process log. The guarded pilot `scripts/desktop-probe-act.mjs` holds an exclusive local input lease, confirms fresh PID/HWND/title/UIA selector and expected counter, journals intent before the action, verifies timestamped counter change, and replays completed requests without reinvoking. One live action and one replay produced **exactly one** increment. All temporary scheduled tasks were removed afterward.
- GUI-004b disposable-keyboard and mouse input: complete in the guarded pilot. Explicit UI focus, observed focused selector, foreground and geometry revalidation, targeted `post-message` Enter, mouse click, and independent counter evidence all worked. A read-only Win32 ancestry/PID helper verified that WinApp's keyboard response reports the *button's child HWND*, not necessarily the target top-level HWND. No arbitrary keys, coords or apps are exposed. See validation details below.
- GUI-004c and GUI-005/006: pending. Verify locked-desktop rejection and cancellation/races; add a shared cross-adapter turn coordinator, after-action screenshot, VM guest-specific identity/receiver and graphics proof, MCP registration, release gates and staged rollout via WB-001. Do not treat the isolated pilot as production desktop or game control.

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

## Disposable .NET desktop action test (GUI-004a)

- Build isolated helper: `dotnet publish scripts/helpers/DesktopProbe/DesktopProbe.csproj --configuration Release --output .tools/desktop-probe-bin --artifacts-path .tools/desktop-probe-artifacts --nologo`. This never builds or restarts `dist/server.js`.
- Start the on-demand helper through existing `scripts/Manage-HelperTask.ps1` with `Executable` pointing to the published `DesktopProbe.exe`, `Argument` to the ignored `.tools/desktop-evidence` directory, and no `AtLogon` trigger. Inspect exact task identity before registration.
- Discover the *fresh* `DesktopProbe` PID/HWND. Invoke once with `node scripts/desktop-probe-act.mjs --pid PID --hwnd HWND --request-id UNIQUE_ID --expected-count 0`; replay with identical arguments returns a prior receipt. It cannot invoke other windows or selectors.
- The action record and native counter evidence stay in `.tools/desktop-evidence`; uncertain outcomes preserve an intent record and block automatic resending. Close the disposable helper and remove only its owned scheduled task after validation.
- This proof used accessibility-pattern invocation, **not** global key injection, mouse positioning, game focus, VMware guest credentials or guest input.

## Guarded keyboard and mouse validation (GUI-004b)

- Optional input mode for the disposable helper only: `node scripts/desktop-probe-act.mjs --pid PID --hwnd HWND --method keyboard --expected-count 0 --request-id UNIQUE_ID`; `--method mouse` uses the same guards and journal. Default remains UIA `invoke`. Fresh PID/HWND and expected count are required for each separate action.
- WinApp 0.7.1 used `ui focus IncrementButton`, `ui get-focused`, and re-enumeration to confirm keyboard focus and foreground. A second UIA inspection checks nonminimized dimensions and button geometry before input. Each real action has a durable intent and receipt, with replay-safe behavior and a filesystem input lease.
- Discovered live failure: `ui click` can return success at roughly `(-31877,-31771)` when the WinForms target has been minimized; the native counter did not change. `isOffscreen=false` alone was insufficient; the pilot now rejects 160x28 minimized windows and off-window geometry before simulation, and it never trusts a tool success without native state change.
- Keyboard post-message replies can carry the focused **child** HWND. `scripts/Check-DesktopWindowHandle.ps1` calls Windows `IsWindow`, `GetAncestor(GA_ROOT)`, and `GetWindowThreadProcessId` without injecting input; the pilot requires reported child HWND ancestry and PID to match the selected top-level window. A returned unrelated HWND fails closed.
- Live proof, fresh native test helper in Windows session 2: process PID `21700`, top-level HWND `5770006`. Guarded keyboard Enter produced counter `0→1` with verified child HWND `4461278`. Guarded mouse click produced counter `1→2` with matching top-level HWND. Replaying both request IDs returned prior receipts without another action. Independent native probe journal contained exactly two `incremented` events. All 27 targeted GUI-001..004b tests passed; no guest input occurred.
- The WindowForms helper and scheduled test task are disposable, do not use system-wide shortcuts, and auto-close within 120 seconds. Uncertain action IDs remain as intent evidence and are never automatically resent; inspection and a distinct, state-verified request are required for further testing.
- Still outstanding: real locked-session test, independent multi-client input lease, automatic cancellation, screenshot-after-input, arbitrary app support, and live VM receiver/display authentication. No deployed MCP tool currently exposes this pilot.

## VMware guest-display capture gate (GUI-005)

Observed on October 24, 2026:

1. `vmrun.exe -T ws list` still returned exactly one running VM: `C:\rift modding\VMs\RIFT-Lab\RIFT-Lab.vmx`.
2. Installed `vmrun` help lists `captureScreen` for a VM, so VMware provides a direct candidate for guest pixels without foregrounding Workstation.
3. A single target-verified, output-nonoverwriting `vmrun -T ws captureScreen` attempt returned `A password is required for this operation` and exit -1. No screenshot was reported. This is not proof that Windows guest autologin failed.
4. A later read-only inspection of **key names only** in the exact `.vmx` confirmed `encryption.data`, `encryption.keySafe` and `vtpm.present`. VMware documents encrypted-VM authorization separately from Windows guest credentials; do not demand a guest sign-in to repair the wrong layer.
5. WinApp reported the main `RIFT-Lab-1 - VMware Workstation` host window minimized (160x28). A separate, target-verified host-window capture may require restoration and foreground coordination. Treat it as a different supported display path, not as a way to evade VMware encryption authorization.

Next independent gates: (a) re-enumerate the running target and legitimate WinApp host window, then test a deliberate, bounded Workstation host-window capture while ensuring the guest/game remain untouched; (b) inventory existing RiftReader2 guest receiver/display transport without changing credentials, VM power or VMX configuration; (c) determine whether another documented VMware API supports capture in the existing authorized session. If native `vmrun` still requires the VM encryption password, leave that path blocked without obtaining or exposing credentials; continue the other paths. Prove real guest pixels before any guest input or receiver deployment.
