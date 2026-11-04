# M5 provisional function/provider decision matrix — Windows desktop automation

**Date:** Wednesday, 2026-11-04 (America/New_York)  
**Owner:** Workbridge-MCP investigation / specialist C, coordinated by project lead  
**Status:** 🟡 Design decision draft; **not an implementation, action authorization, replacement, or performance comparison**  
**Scope:** Existing four Workbridge desktop MCP tools plus prospective host dialogs, UIA, clipboard, screenshots/OCR and VMware guest paths. Workbridge remains the scheduler, authorization boundary, evidence ledger and recovery coordinator. No live GUI, OneDrive, RIFT or VMware input was performed to produce this matrix.

## Executive decision

🟢 **Keep the four deployed Workbridge desktop tools operational.** The current host WinApp 0.7.1 read-only path has an observed narrow taskbar baseline; historic synthetic GUI and capture workflows provide additional but narrower proof.

🟡 **Pilot sbroenne/mcp-windows v1.3.28 as a second, interchangeable host provider** after the read-only exact-HWND test and private-daemon ownership gates. It exposes useful native file-dialog, conditional-wait and UIA operations; its newly published executable has only been statically interrogated, **not used for UI/daemon actions on Joey's host**.

🔵 **Reference eugman/FlaUI-MCP-Core for modal-aware pending operations**, ChrisPulman/UIInspect.MCP for exact-process/UIA inspection, trsdn/mcp-server-uiautomation for legacy accessibility, and CursorTouch/Windows-MCP for timeouts, human takeover and screenshot UX. None can directly bypass Workbridge admission, target identity, input lease, bounded provider process and independent effect proof.

🔴 **Defer general host/guest clicks, blind coordinate fallback, automatic UAC handling and cross-VM input.** RR2 is a protected RIFT-specific game/VM control pathway, not a generic Windows desktop provider; RIFT-Lab-1 is currently quarantined.

## Legend: recommendation versus actual evidence

| Mark | Meaning |
|---|---|
| 🟢 **K** | **Keep** deployed Workbridge function unchanged for now. |
| 🔵 **W** | **Wrap/adapt** behind Workbridge only **after** the stated gate; not currently exposed. |
| 🟡 **P** | **Pilot** a strictly scoped function, initially read-only/synthetic. Not production enablement. |
| 🔴 **D** | **Defer** while risk or ownership is unresolved. |
| **H** | **Host-observed**, 2026-11-04 read-only WinApp taskbar benchmark (10 cycles) or current running registration; limited surface. |
| **S** | **Prior synthetic fixture/capture evidence**, from existing Workbridge roadmap; does not establish arbitrary app reliability or candidate behavior. |
| **B** | **Build/static CLI interrogation**, sbroenne v1.3.28 isolated .NET 10 publish + tools/guidance catalog; zero daemon/UI calls. |
| **C** | **Source/docs/tests reviewed**, not exercised on Joey's Windows desktop in this investigation. |
| **U** | **Unverified/unsupported in inspected evidence**; do not read as proven impossible. |

A cell such as “P/C” describes a proposed experiment justified by reviewed source, **not measured capability**. “Reference/C” means design material rather than an install recommendation. Each observation source is named in the evidence section.

## A. Production Workbridge surface: four exact tools

| Current MCP function | Actual deployed scope and evidence | Provider map and disposition | Gate / next decision |
|---|---|---|---|
| **desktop_windows** | 🟢 **K/H**. Up to 50 Windows host window identities, optional process/app filter; no input. 10/10 taskbar cycles succeeded; median **1,544 ms**, approximate P95 **3,323 ms**, small sample. | **WinApp 0.7.1 K/H**; **sbroenne P/B+C** via window_management, but its normal list omits shell taskbar and untitled windows; **CursorTouch P/C** as alternate desktop snapshot; **eugman / UIInspect / trsdn reference/C** for UIA identity; **RR2 U/out of host scope**. | Keep current discovery. For later candidate compare the same disposable titled HWND, not misleading Explorer-taskbar listing. Require PID/HWND/class + process-creation/session oracle for any future action. |
| **desktop_inspect** | 🟢 **K/H**. Exact PID/HWND/process and optional title; depth 1–4; internally re-enumerates before UIA inspect. Median **1,915 ms**, approximate P95 **2,980 ms**, 10/10. No new app input. | **WinApp K/H**; **sbroenne P/B+C** via ui_snapshot/ui_find/ui_read direct known-HWND path; **eugman, UIInspect, trsdn P/C or reference/C** per exact element semantics; **CursorTouch P/C** UIA tree; **RR2 U** host UIA. | Immediate efficiency experiment: for a previously discovered exact target, call desktop_inspect directly rather than always preceding with desktop_windows; on stale identity rediscover. No version-pin removal without new tests. |
| **desktop_capture_window** | 🟢 **K/S**. Exact visible host-window PNG; dimension/hash evidence; may change foreground; uses shared host GUI turn, despite being a capture operation. Existing synthetic/capture pathway, **not** measured in November 4 taskbar benchmark. | **WinApp K/S**; **sbroenne screenshot_control P/B+C**; **CursorTouch visible-screen capture P/C**; **eugman/UIInspect/trsdn U** as dedicated screenshot replacements; **RR2 U** host generic. | Preserve existing focus/restore evidence and lock. Compare only disposable visible window with independent frame nonblank/hash, DPI/geometry, foreground before/after. No claim that minimized/GPU content will be captured. |
| **desktop_capture_vmware_host** | 🟢 **K/S** as a **VMware Workstation host-console frame**; currently scoped to RIFT-Lab-1 VMX/HWND, not guest UIA or a guest screenshot receiver. Prior GUI-005 host-frame PNG 1215×878 and restoration receipts. **Do not call against quarantined Lab1 now.** | **WinApp host capture K/S**; **sbroenne/CursorTouch P/C only as visible-console host alternatives**; **eugman/UIInspect/trsdn U** for guest pixels; **native RR2** separate guest capture/telemetry, **not** a drop-in replacement. | Preserve current provider. Require exact VMX/host PID/start/HWND/monitor, host capture lease, foreground restoration and separate guest-vs-host provenance. No Lab1 GUI test while blocked. |

The 10-cycle observed discovery+inspect workflow median was **3,677 ms**, approximate P95 **5,672 ms**; these are NOT action or screenshot timings. The current Node adapter invokes WinApp five times per two-tool cycle. Avoidable duplicate enumeration is an optimization hypothesis, not a completed A/B win.

## B. Prospective host UIA, dialogs and input

| Function / desired result | Preferred provider and fallback map | Provisional decision | Mandatory proof / stop condition |
|---|---|---|---|
| **Known-HWND UIA snapshot / element find** | **WinApp K/H** current inspect; **sbroenne P/B+C** ui_snapshot/ui_find, known HWND avoids its window-enumerator taskbar filter; **UIInspect P/C** identity diagnostic; **eugman/trsdn/CursorTouch reference/C**. | 🟡 **P** compare read-only tree parity, completeness, error classification and timing. | Same fresh PID/start/HWND/session, same depth, known typed control IDs and payload cap; never substitute title-only target. Candidate daemon start requires separate approved ownership. |
| **Semantic property read / edit field read-only** | **WinApp C** read primitives; **sbroenne P/B+C** ui_read; **UIInspect/eugman/trsdn P/C** pattern diagnostics; **CursorTouch C**. | 🟡 **P** read-only property benchmark. | PII/redaction filter; declare stale/unsupported patterns, do not interpret absent UIA value as blank UI text. |
| **UIA InvokePattern button** | **WinApp S** prior DesktopProbe counter test (NOT production); **sbroenne W/B+C** ui_click; **eugman reference/C** ModalAwareInvoker; **UIInspect/CursorTouch/trsdn reference/C**. | 🔵 **W after synthetic pilot**, no general current MCP tool. | Exclusive common input lease, exact PID/start/HWND/session, foreground/visibility/on-screen target; durable intent, one action, independent native fixture counter 0→1, fresh after-tree, no unknown retry. |
| **UIA ValuePattern / typing and selection** | **sbroenne W/B+C** ui_type/ui_select; **WinApp C** UIA/input path; **eugman/UIInspect/trsdn reference/C**; **CursorTouch C** broad input. | 🟡 **P** only disposable field/list; 🔴 **D** production. | Use semantic patterns before keyboard injection; verify actual field value/selected state independently, focus continuity, release all held keys; no credential fields or active OneDrive settings. |
| **Find owning modal / third-party dialog** | **WinApp C** inspect plus **sbroenne P/B+C** UIA window/dialog search; **eugman reference/C** pending/modal tracking; **trsdn/UIInspect reference/C** legacy/window identity; **CursorTouch C** snapshot. | 🟡 **P** modal *detection* read-only, then synthetic close/confirm later. | Check top-level + owner chain, process start/session, native HWND/class, UIA role, new modal lifetime, foreground. Do not assume original application's HWND remains the target. |
| **Blocked / hung UIA provider and late response** | **eugman reference/C** modal-aware invoker and pending tracker; **sbroenne C** private daemon + per-process action gate; **CursorTouch C** UIA connection/transaction limits; **WinApp C** bounded children. | 🔵 **W** provider supervisor policy; **not** solved by any one backend. | Kill/settle only verified owned helper/daemon, not app; preserve unknown outcome and input lease/quarantine if COM call remains in flight. Never auto-retry a possibly dispatched action. |
| **Wait until element/window condition** | **sbroenne P/B+C** ui_wait; **CursorTouch P/C** WaitFor polling; **trsdn reference/C** UIA events; **WinApp C** fresh repeated inspect. | 🟡 **P** synthetic wait/read-only event report. | Monotonic deadline, hard cap/poll interval and cancellation; distinguish “event arrived” from “application state reached”. Timeout=unverified, not success. |
| **Read a data table / virtualized list** | **sbroenne P/B+C** ui_read_table; **trsdn reference/C** virtualization/legacy API, **Appium WinCore reference/C** for specialized QA; **UIInspect reference/C** pattern interrogation. | 🟡 **P** only if existing inspect misses row semantics. | Bounded row/column count and virtualization paging; require independently known fixture dataset; no broad traversal of private user data. |
| **Native File Open / Save dialog** | **sbroenne P/B+C** file_open/file_save; **WinApp C** standard UIA path; **eugman/UIInspect/trsdn reference/C** legacy/modal semantics; **CursorTouch C** generic input. | 🟡 **P** read-only recognition first; 🔵 **W** explicit synthetic path operation later. | English-only helper labels in candidate source; verify exact dialog owner, canonical path and resulting file hash or app receipt. Distinguish preview versus actual destructive overwrite/Save confirmation. |
| **Move / restore / focus host window** | **WinApp S+C** existing capture/restore helper; **sbroenne P/B+C** window_management; **CursorTouch C**; native Win32 diagnostics reference. | 🟡 **P** disposable window geometry only; 🔴 **D** unguarded foreground takeover. | Exclusive host GUI lease, monitor/DPI and window-placement readback; historical minimized click at x≈−31877 succeeded nominally but did **not** change fixture counter. |
| **General mouse / keyboard hotkeys or drag** | **sbroenne W/B+C** keyboard_control/mouse_control; **CursorTouch P/C** takeover UX; **WinApp C** input commands; **RR2** game-specific bounded actions only. | 🔴 **D** outside synthetic controlled fixture. | Every operation must pin process+start, exact interactive session, visible unminimized window, stable geometry/foreground, one-shot hold/release attestations and independent application postcondition. Never cross-provider race. |
| **Clipboard read / clipboard write** | **sbroenne P/B+C** clipboard family; **WinApp/eugman/UIInspect/trsdn U** as audited standalone clipboard tools; **CursorTouch U** as replacement; native Win32 helper possible. | 🟡 **P** synthetic clipboard *read* under explicit scope; 🔴 **D** generic writes. | Clipboard is global to an interactive session and may contain passwords/private text. Require request-scoped access, no raw logging, snapshot/revalidate sequence, explicit expected content; clipboard restoration is conditional, not assumed. |
| **App launch/close/process termination** | **sbroenne B+C** app/process, **WinApp C** CLI process/window options; Workbridge existing terminal job controls separate. | 🔴 **D** from desktop provider migration. | Retain Workbridge existing allowlisted command/process ownership; never let GUI adapter invent process management or kill a hung target application. |
| **Input ownership / effect verification** | **Workbridge native offline policy/C** desktop-session-policy, desktop-action-guard, desktop-action-postcondition; **WinApp C** separate workflow arbiter; **sbroenne C** local gate; **CursorTouch C** local human takeover. | 🔵 **W is compulsory for ALL future mutators**; none is a universal existing cross-provider lease. | One exclusive host GUI-turn, durable fencing/owner process start/session, fresh target and foreground, intent before send, outcome classes verified/failed/pending/unknown/blocked, independent after-state. No “tool returned success therefore effect occurred”. |

## C. Visual non-UIA and VMware guest boundaries

| Function / surface | Provider placement | Provisional decision | Specific boundary / evidence |
|---|---|---|---|
| **Blank UIA tree, old Win32/MFC dialog** | **WinApp/sbroenne** first; **trsdn P/C** MSAA/legacy reference; **UIInspect P/C** strict target; native **CsWin32 + AccessibleObjectFromWindow** fallback. | 🟡 **P** read-only legacy semantics if standard UIA truly empty. | Capture native child HWND/owner/class and IAccessible role/name, compare to known synthetic dialog, no blind click. |
| **Custom-drawn/GPU window screenshot** | **WinApp K/S** for existing visible HWND; **CursorTouch P/C** dxcam/mss screenshot; **sbroenne P/B+C** screenshot_control; **WGC/DXGI + OpenCvSharp/Tesseract** optional native fallback. | 🟡 **P** visible synthetic GPU/window case, later. | WGC minimized-window capture is not supported; DXGI sees monitor composition, not hidden surfaces. Hash/timestamp and nonblank checks; no automatic click based solely on OCR match. |
| **OCR or image matching** | No current Workbridge OCR desktop tool. **CursorTouch C** snapshot image pipeline; **native OpenCvSharp5.Windows + Tesseract C** more controllable .NET/CLI helper; **desk-mcp C** only as reference due false-verification code paths. | 🔵 **W** optional read-only observer after synthetic benchmark; 🔴 **D** coordinate action by default. | ROI, DPI/theme, localization, multiple candidates, confidence threshold, two fresh frames and independent semantic or app-state proof; never infer action from “visual looked right.” |
| **Minimized/black/offscreen window diagnosis** | **WinApp S+C** placement/restore; native **CsWin32/DWM/Win32 C** for IsIconic/cloaking/bounds and responsiveness; WGC/DXGI cannot reconstruct missing hidden frame. | 🟡 **P** read-only placement/diagnostic helper; any restoration needs own GUI lease. | Distinguish wrong HWND, occlusion, display move, stale frame, GPU reset and truly non-rendering window; report unavailable/unknown honestly. Relevant to prior RIFT display-3 incident but no live RIFT test now. |
| **UAC secure-desktop consent** | No ordinary WinApp, sbroenne, FlaUI, CursorTouch, RR2 generic provider. | 🔴 **D / human handoff**. | A separate secure desktop/privilege boundary, no automatic manipulation or change of Windows protections. Resume normal desktop observations after human completes prompt. |
| **VMware host console window** | **Workbridge desktop_capture_vmware_host K/S**, host WinApp capture. sbroenne/CursorTouch only alternative visible host frame; no guest semantic element access. | 🟢 **K**, no Lab1 call now. | Must label screenshot origin “host-rendered VMware console,” not “guest native desktop.” Exact VMX/host HWND/epoch and foreground restoration. |
| **VMware native guest screenshot / guest receiver image** | **RR2 C** distinct protected game capture; VMware Tools/vmrun native capture may be separately researched. Host WinApp/sbroenne/FlaUI do **not** cross OS UIA boundary. | 🟡 **P** separate read-only design only; not to quarantined Lab1. | Proven VMX/VM epoch, guest user/boot/session, capture origin, authenticated Tools/agent and guest credential revalidation. The VMware screenshot path has separate encryption/auth uncertainty; never assume working. |
| **Guest Windows UIA tree / OneDrive tray/dialog** | **New versioned guest interactive-session provider** proposed; reuse Workbridge host architecture and RR2 task-lifecycle *pattern*, not its RIFT agent/protocol. WinApp/sbroenne candidate could run **inside** guest later. | 🟡 **P** read-only Lab2 **after safe maintenance window**; 🔴 **D** input. | Guest cannot be treated as host HWND. New limited no-auto-start task, identity-pinned VM boot/session/process, no Session-0 service, no focus, no OneDrive Resume Sync. Lab2 currently game foreground; do not test without coordination. |
| **Guest dialogs / keyboard / UIA mutating action** | Future guest-specific input provider; **native RR2** currently only RIFT-protected action/capture/recover. | 🔴 **D** until guest lease/watcher design. | RR2 current queue/watchdog STOP cleanup validates RIFT-only operations. A generic UIA worker sharing resource without its own cleanup receipt is unsafe. Must either prove maintenance handoff or extend canonical queue protocol, watchdog and cleanup verifier. |
| **RIFT in-game HUD, movement and telemetry** | **Native RR2 K/C** existing game-specific input/telemetry agent; standard host WinApp/sbroenne/eugman UIA likely has no semantic game HUD. | 🟢 **K existing RR2 only**; 🔴 **D** generic desktop replacement. | Fixed rift_x64 identity/hash, per-lab control queue, protected capture/arm/action/recover, native game readback. No touch in M5. |
| **Lab1 / Lab2 readiness** | RR2 status/queue snapshots (Nov4), not a desktop-provider feature. | 🔴 **Lab1 blocked**; 🟡 **Lab2 future candidate** only. | Nov4 Lab1: guest disconnected, queue blocked=1, cleanup receipt absent. Lab2: connected, disarmed, zero keys and free queue, but RIFT foreground; this is not permission for UIA input. |

## Function selection hierarchy and integration gate

1. **Classify target**: host UIA / host legacy MSAA / host rendered pixels / VMware host chrome / guest desktop / RIFT-specific content / secure desktop. Never silently cross class boundaries.
2. **Observe with least disruptive incumbent first**: Workbridge desktop_windows/desktop_inspect for host; RR2 status-only for guest when separately authorized; native Win32 placement facts for blank/offscreen. Existing Workbridge remains primary.
3. **Try a candidate only inside its measured scope**: start sbroenne with a fresh known-HWND **read-only** synthetic snapshot and exact owned daemon provenance. In a separate fixture, compare results with WinApp and log cold/warm p50/p95/max, failures, tree completeness, response bytes and foreground change. CursorTouch is a second host read-only pilot, not a simultaneous input participant.
4. **Upgrade to mutating backend only after shared policy**: Workbridge owns one per-host input turn and per-guest coordinated turn, target PID/start/HWND/session/epoch, explicit user/scope approval, durable intent, bounded process/daemon ownership, release receipts and independent postconditions.
5. **Handle unknown without duplicate side effects**: if action dispatched but provider hangs or reply lost, mark **unknown**, retain lease/quarantine, investigate via fresh independent read before deciding any continuation. Return blockers for secure desktop, minimized GPU or unverifiable visual matches.
6. **Preserve rollback**: provider choice must be **per function**, version/hash pinned, configurable, with existing WinApp and RR2 paths untouched until a separately approved promotion. No blanket replacement of four Workbridge tools.

### Proposed experimental priority by value and risk

| Order | Pilot | Why first | Stage |
|---:|---|---|---|
| 1 | Known-HWND host UIA compare (WinApp current vs isolated sbroenne snapshot) | Measures first candidate without input; tests daemon identity and stale target | 🟡 Read-only, separate authorization for owned private daemon |
| 2 | WinApp inspect-only fresh target orchestration | Likely removes redundant enumeration without changing adapter policy | 🟢 Read-only workflow/controlled A-B |
| 3 | Disposable native modal + field/table fixture | Directly targets Joey's recurrent Windows/third-party dialog problem | 🟡 Initially read-only; one bounded synthetic Invoke only after gate |
| 4 | Visible custom-rendered synthetic window screenshot + OCR | Defines when semantic automation fails and exact image fallback value | 🟡 Read-only and privacy scoped |
| 5 | Guest read-only UIA inspector in controlled Lab2 maintenance | Addresses OneDrive/VMware observability with actual guest semantics | 🟠 Requires separate plan, user availability and authenticated guest lane |
| 6 | Production dialog operations / guest input | High benefit but requires common lease, watchdog, postcondition and failure recovery | 🔴 Not authorized at M5 |

### Minimum synthetic acceptance and promotion contract

For **each provider/function** produce an evidence row: exact source tag/commit/binary SHA, version/runtime, Windows build/session/monitor/DPI, target PID/start/HWND/class, modality, 20+ paired cold/warm trials where practical, per-step time (dispatch, provider, wait, independent after-observer), p50/p95/max, output bytes, CPU/memory, error/timeouts, foreground/focus change, and no leftover helper processes/keys. This is the proposed benchmark standard, **not work performed**.

Mandatory negative fixtures:
- PID/HWND reuse and stale UIA runtime ID; title duplicate, renamed modal, third-party owner relationship.
- Offscreen/minimized geometry including **negative-coordinate false-success** case.
- Hung UIA provider and reply-lost-after-dispatch; no retry on unknown, lease remains quarantined until independently settled.
- Concurrent agents/cross-provider attempted inputs, user takeover, lock/session/UAC transition, cancellation midway.
- Screenshot blank/stale/occluded/DPI-scaled; ambiguous OCR confidence and no visual-only clicks.
- Guest boot epoch/user-session change, RR2 STOP cleanup unknown, disconnected controller; Lab1 exclusion until quarantine reconciled.

A candidate may become **W/adapted** only if it passes the exact relevant fixture set, reports correctly classified postconditions and remains reclaimable without an unowned daemon or held-input leak. Passing read-only UIA discovery **never** automatically promotes UIA click or VMware guest operations.

## Evidence and source index

**Workbridge concrete implementation and results**
- [Desktop tool registration, lease and quarantine](../../../src/desktop-registration.ts) — four production tool registrations; capture-turn exclusive file lock, stamp and uncertain-tree quarantine. Current stamp sets owner processStartUtc/sessionId to null: must strengthen before generalized mutating admission.
- [Read-only host adapter](../../../scripts/desktop-ui.mjs) and [desktop-windows wrapper](../../../src/desktop-windows.ts) — WinApp 0.7.1 pin and exact inspect behavior.
- [Offline action guard](../../../src/desktop-action-guard.ts), [session policy](../../../src/desktop-session-policy.ts) and [postcondition verifier](../../../src/desktop-action-postcondition.ts) — **offline only**, not exposed generic input.
- [WinApp measured narrow taskbar baseline](../benchmarks/winapp-2026-11-04.md) — live host only for discovery/inspection; see sampling limitations.
- [sbroenne static tools/daemon audit](../benchmarks/sbroenne-cli-tools-2026-11-04.md) and [candidate findings](../FINDINGS.md) — isolated self-contained publish, 18 tools, private daemon caveats; no GUI/daemon run.
- [Guest-side UIA boundary and Lab1 status](guest-uia-boundary-2026-11-04.md) — RR2 ownership, no generic guest control.
- [Non-UIA fallback review](non-uia-fallback-2026-11-04.md) and [alternate backend review](other-desktop-backends-2026-11-04.md) — source-level limitations, primary links.
- [Benchmark rubric](../benchmarks/README.md) and [interactive desktop/VM roadmap](../../../docs/interactive-desktop-vm-roadmap.md) — historical DesktopProbe action counter, capture and negative-coordinate issue. Historic roadmap version statements should not override Nov4 measured running Workbridge 0.16.4-dev.

**Primary external project sources**
- [Microsoft WinApp CLI](https://github.com/microsoft/winappCli) and [UI automation documentation](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/ui-automation)
- [sbroenne/mcp-windows v1.3.28 CLI](https://github.com/sbroenne/mcp-windows/tree/v1.3.28), [window enumerator](https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp/Window/WindowEnumerator.cs), [daemon identity](https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp.Cli/Service/DaemonIdentity.cs)
- [eugman/FlaUI-MCP-Core](https://github.com/eugman/FlaUI-MCP-Core)
- [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP), [control policy](https://github.com/CursorTouch/Windows-MCP/blob/main/src/windows_mcp/tools/control_policy.py)
- [ChrisPulman/UIInspect.MCP](https://github.com/ChrisPulman/UIInspect.MCP), [trsdn/mcp-server-uiautomation](https://github.com/trsdn/mcp-server-uiautomation)
- [Microsoft CsWin32](https://github.com/microsoft/CsWin32), [Windows.Graphics.Capture](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture), [OpenCvSharp](https://github.com/shimat/opencvsharp), [Tesseract](https://github.com/tesseract-ocr/tesseract)
- [Appium WinCore](https://github.com/appium/appium-wincore-driver) as specialty QA reference; [desk-mcp](https://github.com/DigitalDog1/desk-mcp) as **reference only**, due documented source false-success paths.

**Explicit exclusion:** No install, daemon launch, host/window focus or input, screenshot, VM operation, credential use, or production Workbridge/RR2 source change occurred in **this M5 drafting lane**. Existing daily Workbridge operations remain unaffected.
