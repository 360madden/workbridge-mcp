# Non-UIA fallback strategy for Workbridge desktop automation
**Research date:** 2026-11-04  
**Lane:** Independent read-only source investigation; no installation, desktop input, VMware action, or live-game test performed.  
**Owner:** Specialist C (FlaUI / alternate automation and imaging research)  
**Status:** Research recommendation, **not** a verified Workbridge deployment. Existing Workbridge production coordination and desktop integration remain in service.

## Executive recommendation

Keep Workbridge as coordinator, identity/ownership authority, and audit trail. Keep the Microsoft WinApp CLI and the leading candidate [sbroenne/mcp-windows](https://github.com/sbroenne/mcp-windows) for first-line Windows accessibility automation. Add an **optional, read-mostly visual fallback** only when a target is demonstrably inaccessible via UI Automation (UIA) or legacy accessibility APIs. Prioritize:

1. **Small Win32 diagnostics adapter:** use [microsoft/CsWin32](https://github.com/microsoft/CsWin32) to bind strongly typed Win32 APIs for exact window/process identity, state, geometry, occlusion clues, and bounded responsiveness checks in a .NET 10 helper.
2. **Native screen capture:** use Windows.Graphics.Capture (WGC) for a visible host HWND; compare DXGI Desktop Duplication monitor capture if a suspect application renders blank in window capture.
3. **Vision analysis:** use [shimat/opencvsharp](https://github.com/shimat/opencvsharp) for bounded template/feature matching and [tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract) to identify text on rendered dialogs. Vision results are **observations**, never permission to click blindly.
4. **Specialized last resorts:** consider OBS capture for a GPU game whose ordinary capture path fails, only in a separately approved non-production test. Check VMware Workstation’s own screenshot support instead of installing a broad VM-management MCP server by default.

Do **not** promote screenshots/OCR into a generic replacement for semantics, trust any one match as identity, claim minimized GPU windows are capturable, automate UAC secure desktop, or launch guest capture against quarantined RIFT-Lab-1 without new explicit scope.

### Decision chart

| Symptom / observed class | Primary path | Fallback or stop | Evidence to retain |
| --- | --- | --- | --- |
| Standard Windows dialog with UIA elements | WinApp or sbroenne; bounded action with fresh lookup | Win32 child window and MSAA / IAccessible if UIA incomplete | Owner HWND, PID plus process start, modal HWND, element and outcome snapshots |
| Old Win32/MFC/installer dialog, no useful UIA | Child HWND/class enumeration and MSAA | Read-only screenshot/OCR; escalate unsupported controls | Control class, accessible name/role, screenshot and dialog transition |
| Custom-drawn/GPU surface, no UIA semantics | WGC capture of visible HWND | DXGI monitor duplication, then separately reviewed OBS Game Capture | Frame timestamp, hash, target HWND, client size, DPI, nonblank checks |
| Minimized, cloaked, offscreen or black window | Diagnose placement, DWM cloaking, device/monitor status before acting | Surface meaningful **unavailable** result; do not invent hidden frame | Window placement, IsIconic, DWM flags, capture method and frame validity |
| UAC on secure desktop / higher-privilege inaccessible surface | **Stop for human handoff** | No secure-desktop circumvention or policy change | Blocker event without sensitive prompt contents |
| VMware guest content | Reuse already-approved guest receiver / native VMware screenshot capability where available | Capture visible VMware console from host; isolate guest ownership | VMX/VM instance identity, Tools status, guest/host clocks, screenshot origin |
| Ambiguous OCR, moving layout or low-confidence icon match | Request another observation and independent confirmation | No input; return uncertain | Matcher confidence, ROI, DPI, stale-frame detection, competing matches |

## 1. Read-only window diagnosis before capture

For every physical host window, identify a **specific instance**, not merely a title string:

- Enumerate top-level/child windows (EnumWindows / EnumChildWindows), HWND, class, owner/parent/modal relationship, and GetWindowThreadProcessId.
- Record PID **and process creation time** to avoid identity confusion after a process restart; record process executable path where accessible.
- Sample GetWindowPlacement, IsIconic, DwmGetWindowAttribute (including DWMWA_CLOAKED and extended frame bounds), GetClientRect, monitor geometry (MonitorFromWindow / GetMonitorInfo), foreground ownership and per-monitor DPI.
- Use IsHungAppWindow and a bounded SendMessageTimeout with WM_NULL / SMTO_ABORTIFHUNG for *diagnostic* responsiveness; never use a synchronous unbounded provider call as a health test.
- When capture returns black, separate a minimized/cloaked/non-rendering surface from wrong-HWND selection, display/driver differences, protected output, a stale screenshot, and UIA provider failure. No single black image proves a specific root cause.
- Store before/after screenshots with exact capture method, monotonic timestamp, frame ID/hash, dimensions, scale factor, process identity, and reason codes. Treat screenshots of a stale process/window as unusable.

The relevant Microsoft API references are [window features](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features), [GetWindowThreadProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid), [GetWindowPlacement](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowplacement), [DwmGetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetwindowattribute), and [SendMessageTimeout](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeouta). CsWin32 is the maintainable route for generated .NET P/Invoke declarations; the helper should not write Windows settings.

### Legacy accessibility

Windows’ MSAA [AccessibleObjectFromWindow](https://learn.microsoft.com/en-us/windows/win32/api/oleacc/nf-oleacc-accessibleobjectfromwindow) and IAccessible can expose semantics that UIA omitted in traditional Windows applications. [pywinauto](https://github.com/pywinauto/pywinauto) illustrates the practical division between a **win32** backend and a **uia** backend. For Joey’s .NET 10 Workbridge environment, prefer a small P/Invoke or existing UIA provider over adding a Python runtime solely to inspect a dialog. Legacy and owner-drawn controls can still expose no usable semantic tree; screenshot/OCR remains a conditional fallback.

## 2. Capture: what works and what does not

### Windows.Graphics.Capture (WGC)

Microsoft documents [Windows.Graphics.Capture](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture) and [CreateForWindow(HWND)](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow). The active MIT-licensed [robmikh/Win32CaptureSample](https://github.com/robmikh/Win32CaptureSample) demonstrates HWND and monitor capture from a classic Win32 application and free-threaded frame capture. This is the most direct native host capture basis for a Windows helper.

**Limit:** WGC is **not** a remedy for minimized/non-rendering surfaces. Microsoft’s own [ScreenCaptureforHWND example](https://github.com/microsoft/Windows.UI.Composition-Win32-Samples/blob/master/cpp/ScreenCaptureforHWND/README.md) explicitly states that minimized windows are enumerated but not captured. Protected content can be restricted or excluded (see [SetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)). Pilot code must detect blank/stale/no-frame states rather than report capture success.

### DXGI monitor duplication

[DXGI Desktop Duplication](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api), illustrated by Microsoft’s [DXGI sample](https://github.com/microsoft/Windows-classic-samples/tree/main/Samples/DXGIDesktopDuplication/cpp), captures the composited output of a display. It can help when window-specific capture returns black but a game is visibly rendered on a monitor. It is **not** a way to see behind overlapping windows, reconstruct hidden minimized client content, or evade protected-content policy. Duplication may need restart after display mode changes or output loss.

### PrintWindow, OBS, and GPU games

[PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow) is synchronous; the target app participates in drawing the image. It is unreliable for GPU/custom surfaces and presents a hang risk if a provider does not respond. A bounded helper process would be required if experimented with at all; exclude it from the first pilot.

[OBS Studio](https://github.com/obsproject/obs-studio) provides Window Capture, Display Capture, and [Game Capture](https://obsproject.com/kb/game-capture-source). The OBS WebSocket protocol supports screenshot operations such as **GetSourceScreenshot** and **SaveSourceScreenshot** ([protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md)), making it an optional alternative capture engine. But Game Capture introduces a game hook; compatibility issues and game/application crashes can occur (see [OBS troubleshooting](https://obsproject.com/kb/game-capture-troubleshooting)). Never inject or hook a live RIFT client during a read-only pilot; seek explicit separately scoped approval and use a disposable/synthetic GPU application first.

For a custom all-.NET capture engine that truly requires low-level Direct3D, [amerkoleci/Vortice.Windows](https://github.com/amerkoleci/Vortice.Windows) has C# DXGI/Direct3D bindings; this is technically viable but higher maintenance than relying on Microsoft’s WGC sample.

## 3. Optical recognition and coordinate caution

- **Image matching:** [OpenCvSharp](https://github.com/shimat/opencvsharp) is an actively maintained Apache-2.0 .NET wrapper. For modern .NET 8+ Windows x64 applications, its project points toward **OpenCvSharp5.Windows** and a slim variant for image processing. Validate actual package/runtime compatibility in a synthetic .NET 10 pilot before packaging a Workbridge helper. Templates must be normalized for DPI, display scaling, theme, font changes, hover/pressed state, animation and localization.
- **OCR:** [Tesseract](https://github.com/tesseract-ocr/tesseract) is a mature Apache-2.0 offline OCR engine, usable as a CLI without introducing Windows app package identity. Capture a confined region of interest; log text, boxes, recognition scores, image size, engine language and trained data. Short/low-resolution text requires quality checks.
- **Windows.Media.Ocr:** Microsoft’s [Windows OCR API](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr?view=winrt-26100) documentation states desktop app usage requires package identity (such as MSIX); this adds friction for an unpackaged .NET 10 Workbridge helper. It is not the first choice here.

**No blanket coordinate click rule:** a screenshot match is not an input authorization. Require two fresh observations (pre-action and post-action); exact HWND/PID/start time; target active/visible in correct session; dimensions and DPI stable; no competing matches; high-confidence position only within the correct ROI; owner-of-input lease acquired; bounded action/retry budget; independent semantic/window/state verification. A failed/uncertain check returns a clean blocker rather than repeated clicks.

## 4. Secure desktop, elevated dialogs and integrity boundary

Microsoft explains that UAC normally switches to a distinct [secure desktop](https://learn.microsoft.com/en-us/windows/security/identity-protection/user-account-control/how-user-account-control-works). An ordinary Workbridge UIA or window-capture helper running in the interactive standard desktop should **not** claim it can inspect or operate that desktop. UIAccess and cross-integrity assistance in ordinary user sessions are different issues; neither licenses indiscriminate automated secure-desktop control. Route UAC secure-desktop prompts to **human handoff**, then verify the normal desktop state after the user returns. Do not disable UAC or security policies as an automation workaround. If a third-party permission/consent dialog runs on the normal desktop, handle it as an ordinary modal with identity and explicit user-approved action scope.

## 5. VMware capture: host, guest, and trust boundaries

There are three distinct screenshot origins:

1. **Guest receiver:** existing Workbridge/VMware guest agent path, if running and approved for that specific VM; the resulting image describes the *guest’s own desktop*. This is normally preferable for guest UI automation.
2. **VMware-native host screenshot:** Workstation’s **vmrun captureScreen** capability has been documented by VMware/Broadcom community discussions (e.g. [Broadcom technical document](https://community.broadcom.com/vmware-cloud-foundation/viewdocument/how-to-answer-the-guest-question-ab?CommunityKey=c24ac095-2065-4261-a4b5-6de9dade8734&tab=librarydocuments), [support thread](https://community.broadcom.com/vmware-cloud-foundation/communities/community-home/digestviewer/viewthread?CommunityKey=fb707ac3-9412-4fad-b7af-018f5da56d9f&GroupId=7171&MessageKey=b592b716-5f06-40ab-af55-cb742318f972)). Current Workstation, Tools and guest credential requirements are **unverified in Joey’s installation**; treat as a capability probe, not a working assertion.
3. **Host capture of the VMware console HWND:** WGC or DXGI can observe only what the host is actually rendering in the console; occluded/minimized/blank console limitations still apply.

The young [omichelbraga/vmware-mcp](https://github.com/omichelbraga/vmware-mcp) exposes a broad Workstation interface including a vmrun screenshot wrapper (see [tools](https://github.com/omichelbraga/vmware-mcp/blob/main/src/vmware_mcp/tools_vmrun.py) and [vmrun implementation](https://github.com/omichelbraga/vmware-mcp/blob/main/src/vmware_mcp/vmrun.py)). Its large tool surface, additional management service, and limited adoption do not justify installing it merely for screenshots when Workbridge can invoke supported native VMware operations with existing permissions. It is a source reference, **not** the recommended new controller.

**Explicit boundary:** RIFT-Lab-1 has a reported quarantine/operational hold in the current coordinator lane. No screenshot, guest credential interaction, console input or other probing against that VM is implied by this report. First assess help/version/capability read-only, and pilot guest screenshots only on a **separately approved isolated non-quarantined disposable VM** with the coordinator’s scope.

## 6. Workbridge integration contract (proposal)

| Layer | Responsibility | Workbridge invariant |
| --- | --- | --- |
| Coordinator / scheduler | Owns job IDs, task logs, paths, workers, per-desktop/per-VM locks | Existing production Workbridge remains authoritative |
| Window identity and diagnostics provider | HWND/PID/process creation, owner/modal tree, state, DPI, bounded responsiveness | Read-only by default; detect stale/reused identities |
| Accessibility provider | Existing WinApp / sbroenne / FlaUI or legacy MSAA semantic operations | Query semantics before vision; bounded UIA provider calls |
| Capture provider | WGC HWND or DXGI output, tagged origin and validity | Never treat no-frame/black/stale as good image |
| Vision provider | OpenCvSharp ROI matching and Tesseract OCR | Confidence + multiple observations; no direct input |
| Input provider | Existing guarded Workbridge / approved automation tool | Exclusive desktop/VM lease, exact target, explicit actions, verified result |
| Audit / recovery | Before/after snapshots, timestamps, failure reason and rollback-capable operations | Actions not auto-replayed across state changes |

Expected provider outcome shape: **success / unavailable / stale-target / ambiguous / blocked-by-UI / protected / timed-out / unsupported**. Each outcome includes timestamps, exact target identity, capture source or semantic provider, and evidence IDs. Never collapse a timeout or blank window into “button absent.”

### A bounded interaction sequence

1. Resolve target identity and snapshot its current state.
2. Query semantic providers; if they fail/return empty, classify why rather than immediately click.
3. Capture a fresh frame using a supported surface, check freshness/blackness, and locate target region by geometry.
4. Match multiple anchors or OCR content and confirm a unique, stable target under consistent DPI.
5. Acquire the correct host/VM input lease, revalidate HWND/PID/start and frame freshness, perform **one** explicitly scoped bounded action.
6. Observe a fresh independent outcome (control state/window closure/changed text), release lease, write audit result. If invalid/uncertain, stop with evidence and no automatic blind retry.

## 7. Synthetic pilot checklist (future work, **not performed**)

| Pilot | Synthetic target / method | Pass evidence | Abort / unsafe evidence |
| --- | --- | --- | --- |
| D1 classic modal | Disposable WinForms owner + child #32770-style modal and inert controls | Correct owner/modal HWND, UIA vs MSAA classification, identity retained | Wrong-process title match; modal missed |
| D2 hung provider | Deliberately nonresponsive dummy window; bounded WM_NULL health check | Positive timeout returns quickly and records timeout status | Unbounded SendMessage/PrintWindow/STA join |
| D3 GPU capture | Disposable hardware-rendered window, WGC by HWND and DXGI monitor | Tagged fresh nonblack frame, size/DPI, stale-frame detection | Claims hidden/minimized content is visible |
| D4 DPI/layout | Synthetic monitor scaling at 100/150/175%, moved/resized window | Correct logical-to-physical position and ROI, no incorrect click | Template remains at old coordinates |
| D5 unavailable content | Minimized/cloaked/occluded synthetic window, protected-content test stub | Differentiates captured output, unavailable and stale; emits no action | Black image misreported as completed action |
| D6 OCR/matcher | Long/short labels, localization, dynamic icons, competing matches | Confidence threshold, multiple anchors, retry bound, no-action ambiguity | Single misleading image triggers click |
| D7 guest boundary | **Only a newly approved isolated non-quarantined disposable VM**; compare guest receiver, vmrun, visible console | Origin-tagged frames, guest clock, Tools/credential constraints, unique VM identity | Any unapproved Lab1 touch or host/guest mixup |
| D8 UAC boundary | Design review / simulated blocker, no real elevation prompt automation | Manual handoff state and resumption audit | Proposed secure-desktop bypass or unattended approval |
| D9 concurrency | Six simultaneous read-only snapshots + serial host/VM actions on synthetic apps | Fair lease, no overlap of input, bounded latency and stale-target failure | Agent input collision or retries after state drift |
| D10 OBS last resort | Approved disposable GPU test only | Observe WGC/DXGI vs OBS differences and side effects | Live RIFT hook, game instability, unsupported assumption |

The first pilot should remain a **read-only synthetic-host exercise** (D1–D6), with no package installations or live desktop actions until the coordinator approves the implementation lane. Pilot and production acceptance should measure median/P95 detection and action latency, no-frame rate, wrong-window rate, false-positive match rate, timeout recovery, and successful independent before/after confirmation.

## 8. Recommendation boundaries and open questions

**Green / next:** carry forward CsWin32 identity diagnostics and WGC as possible small helper modules; exploit installed WinApp before adopting a new provider; make capture/vision read-only and opt-in.  
**Yellow / experimental:** OpenCvSharp/Tesseract after synthetic tests; native vmrun capture capability only on authorized disposable guests; MSAA fallback for old dialogs.  
**Red / prohibited for this effort:** blind mouse clicks, stale frame retries, unbounded synchronous HWND/provider calls, secure-desktop automation, modifying UAC, OBS hooks in a live RIFT session, unauthorized RIFT-Lab-1 guest probing.

Open questions to test separately: actual installed Windows build/API support and capture permissions; GPU/game rendering behavior; current Workstation/vmrun support and Guest Tools readiness; how current Workbridge obtains and tags host vs guest frame evidence; exact latency of semantic calls and capture under six concurrent agents; .NET 10 package publishing and native runtime deployment profile. None of these are claimed resolved by repository research.

### Primary-source index

1. [Microsoft CsWin32 repository](https://github.com/microsoft/CsWin32) — strongly typed Win32 interop generation.
2. [Windows.Graphics.Capture](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture) and [Win32CaptureSample](https://github.com/robmikh/Win32CaptureSample) — visible HWND/monitor capture architecture.
3. [Microsoft minimized-window sample caveat](https://github.com/microsoft/Windows.UI.Composition-Win32-Samples/blob/master/cpp/ScreenCaptureforHWND/README.md) — minimized windows enumerated but not captured.
4. [Microsoft DXGI Desktop Duplication API](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api) — monitor-frame capture.
5. [Microsoft PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow) and [SendMessageTimeout](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeouta) — synchronous/hung-window diagnostic caveats.
6. [OpenCvSharp](https://github.com/shimat/opencvsharp), [Tesseract](https://github.com/tesseract-ocr/tesseract), [Windows.Media.Ocr API](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr?view=winrt-26100) — vision and deployment tradeoffs.
7. [Microsoft UAC operation](https://learn.microsoft.com/en-us/windows/security/identity-protection/user-account-control/how-user-account-control-works) — secure-desktop boundary.
8. [OBS source documentation](https://obsproject.com/kb/game-capture-source) and [WebSocket screenshots](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md) — optional last-resort visual capture.
9. [Broadcom vmrun documentation discussion](https://community.broadcom.com/vmware-cloud-foundation/viewdocument/how-to-answer-the-guest-question-ab?CommunityKey=c24ac095-2065-4261-a4b5-6de9dade8734&tab=librarydocuments) — screenshot feature context; current host capability remains unverified.
