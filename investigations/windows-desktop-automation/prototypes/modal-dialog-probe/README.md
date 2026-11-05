# M4 disposable owned-modal fixture

**2026-11-05 status:** 🟢 .NET 10 build-only PASS (0 warnings, 0 errors). 🔴 No GUI launched, no UIA/MCP action or desktop/VM input.

This standalone WinForms fixture is an optional research target, not a Workbridge desktop backend. It is inspired by existing scripts/helpers/DesktopProbe/Program.cs (STA, stable Name/AccessibleName, native JSONL and self-close) and eugman/FlaUI-MCP-Core's ModalAwareInvoker/pending-operation tracker. It adds a native owner-HWND modal timeline and native WinEvent notifications so future providers can be compared against independently logged state.

## Isolated behavior — only if launched in a separate approved trial

- .NET 10 Windows WinExe, no NuGet packages. Two positional args: absolute non-UNC private evidence directory and unique run ID (4–64 ASCII alphanumeric characters, underscore, hyphen).
- Creates a new nonoverwriting journal file named modal-probe-<run-id>-<PID>.jsonl. Every row has run ID, sequence, UTC/elapsed time, PID, process creation UTC ticks, Windows session, owner/modal/observed owner HWND as decimal strings, stage and optional native event ID. The journal never captures clipboard, arbitrary application titles, UIA values, screenshots or keystrokes.
- Owner window fixed title: Workbridge M4 Disposable Modal Probe. UIA Name controls: OwnerStatus, OpenModalButton. It automatically opens its own modal after 5 seconds; the button is reserved for a later independently authorized InvokePattern experiment.
- Owned modal fixed title: Workbridge M4 Owned Modal. UIA Name controls: ModalStatus, DismissModalButton. It uses explicit Form.ShowDialog(this) ownership. Modal auto-dismisses after 30 seconds; the owner remains for ~6 seconds, with a 75-second UI-timer fallback.
- Native oracle: explicitly records actual GetWindow(GW_OWNER) for the modal HWND; that observed HWND must equal the captured owner HWND. Same-process out-of-context SetWinEventHook (on the WinForms message pump) listens for EVENT_SYSTEM_DIALOGSTART/END and EVENT_OBJECT_DESTROY/SHOW/HIDE, with target filtering and a maximum 64 journal rows.
- Expected self-timer path: process_start → owner_shown → hook_ready or hook_unavailable → modal_intent → modal_shown → modal_timer_dismiss → modal_returned → owner_closed → process_done.
- Critical limitation: the 75-second UI timer is **not** a hard stop when the UI thread hangs. A separately validated **child-owning private Job watchdog** must enforce the real lifetime. No fixture code grabs or alters the existing desktop-turn lock.

## Completed compile-only receipt

Workbridge job ID: wda_modal_probe_offline_build_20261105_001, executable C:\Program Files\dotnet\dotnet.exe, args:

    build investigations/windows-desktop-automation/prototypes/modal-dialog-probe/ModalDialogProbe.csproj --configuration Release --output investigations/windows-desktop-automation/temp/modal-dialog-probe-bin --artifacts-path investigations/windows-desktop-automation/temp/modal-dialog-probe-artifacts --nologo

Observed job passed with OS exit0, 0 warnings, 0 errors, 2.70s reported by MSBuild. Build outputs are in ignored investigation temp. No built executable was run.

## Proposed M4 read-only benchmark — not executed

1. Supervisor admission: Joey's quiet desktop interval and explicit GUI permission; fresh SID/session/desktop, exact new runnable SHA, no conflicting desktop-turn lease; on-demand Limited/Interactive watchdog with private child-only Job and strict monotonic lifetime. No AtLogon or hidden-terminal GUI launch. The old DesktopProbe-specific watchdog/observer cannot be redirected by merely changing a PID.
2. Native identity: compare watchdog manifest PID/start ticks/session/EXE SHA/owner SID to new native journal owner_shown and fresh HWND/class. Reject stale, minimized, mismatched, reused or ambiguous HWNDs.
3. Before modal: use the existing WinApp CLI 0.7.1 read-only pattern: version check; UI list-windows bound to fresh PID; UI inspect bound to observed exact HWND and shallow depth. Native journal must be unchanged by observation, and background provider starts and output sizes should be bounded.
4. During modal: require modal_shown and GetWindow(GW_OWNER)==owner, then snapshot the exact dialog HWND (not arbitrary active window). Find exactly one ModalStatus and DismissModalButton. Compare returned semantic structure, elapsed time, pending/hang/error status and unchanged foreground; omit arbitrary UI text and screenshots.
5. After auto-dismiss: require modal_timer_dismiss and modal_returned, independently observe the dialog missing and owner continuing briefly; classify stale element, provider timeout, no postcondition, focus theft, owner mismatch and unknown outcome distinctly. Never retry uncertain input.
6. Teardown: full private Job empty and exact helper/child gone. Retain hashes and bounded receipts. An OpenModalButton InvokePattern trial is a separate, exclusively leased input milestone—not demonstrated by this auto-opening fixture.

## Caveats

- WinForms ShowDialog(owner) is a **custom modal**, not a system file picker, UAC, VMware host dialog or GPU-rendered RIFT window.
- Microsoft's EVENT_SYSTEM_DIALOGSTART/END is not guaranteed for every custom WinForms dialog; missing such an event is not proof that the provider failed. Use Form native journal stages and GetWindow ownership as mandatory, WinEvent notifications as supplemental.
- The first real GUI trial could steal foreground; no such trial has occurred.
- WinApp/Sbroenne's current comparison samplers specifically pin existing DesktopProbe.exe and controls; a narrowly typed new reader must be built/reviewed rather than weakening their allowlists.

Primary docs: Microsoft Form.ShowDialog(owner), SetWinEventHook, WinEvent constants; eugman/FlaUI-MCP-Core repository. Also see parent investigation roadmap and prototypes/desktopprobe-comparison-runbook.md.
