# DesktopProbe host preflight — quarantined desktop turn and safe operation boundary

**Date:** 2026-11-04 (America/New_York)  
**Observation interval:** Approximately 22:30–22:37 UTC; dynamic snapshots, not durable readiness guarantees.  
**Status:** ✅ Two approved read-only Windows process inventories; 🔴 desktop action/GUI launch **not authorized by this report**. No helper build/start, focus change, screen capture, OneDrive action, RIFT/VM guest input, service change, process kill or lock cleanup was performed.

> **⚠️ SUPERSEDED RECOVERY SEQUENCE (later 2026-11-04):** The guard-first archival idea originally described in Section 4 Step 5 is **unsafe and must not be executed**. Workbridge legacy callers only test the guard filename, while the watchdog also rejects an orphan quarantine sidecar. The authoritative future design is [manual-gui-turn-archive-protocol-2026-11-04.md](manual-gui-turn-archive-protocol-2026-11-04.md) (Git commit `ebe17b9`): under an **enforceable cross-producer GUI admission freeze**, preserve and verify both artifacts, relocate the **sidecar first while the guard still blocks old callers**, then relocate the **guard last as the admission-release commit point**; keep the freeze through postchecks. That shared freeze has **not been implemented or authorized for live recovery**. The lock/sidecar remain quarantined.

## Executive decision

**The shared host desktop GUI turn is not free.** The exact file C:\work\workbridge-mcp\.tools\desktop-evidence\desktop-input-turn.lock exists and has a November 2 matching quarantine sidecar declaring DESKTOP_TREE_UNSETTLED, processTreeSettlement unknown, automaticRetryAllowed false. This is an intentional safety latch, **not** an ordinary abandoned file to delete by age.

Two current read-only Windows process snapshots found **no running descendant created at the November 2 capture time**, and the historical RIFT target PID was absent. That is valuable negative evidence for *present* descendant activity; it is **not historical Job Object settlement proof** and cannot establish original screenshot success. Owner PID43508 is the persistent Workbridge service and the lock stamp lacks owner process start/session.

**Recommendation:** Existing no-focus/no-input/no-screenshot Microsoft WinApp read-only discovery and exact UIA inspect of a **pre-existing host window** can continue while the lock is held (it uses no GUI turn; Windows enumeration already succeeded). **A newly appearing DesktopProbe GUI, screen capture, focus/restore, WinApp input, and any wincli daemon/UI benchmark should wait** until a reviewed reconciliation of the lock and the independently owned watchdog/daemon gates. Joey's permission for temporary focus does not itself establish a free shared GUI turn.

## 1. Passive Workbridge and host desktop baseline

| Item | Verified observation | Limitation |
| --- | --- | --- |
| Workbridge owner | workspace_info: **0.16.4-dev**, root C:\work, 36 command slots, live owner PID **43508**, instance **9aa9b65f-b34f-49a7-8b92-c7954bd4dc9a**, started 2026-11-01T09:24:27.344Z | MCP endpoint responds; not a complete all-service health test or startup authorization. |
| Targeted host window enumeration | Lab1 VMware frame PID **26500**, HWND **199442**, 974×1039, foreground=false; Lab2 VMware frame PID **43992**, HWND **790250**, 974×1039, foreground=false. Also a Windows RIFT jump list. | Only VMware *host frame* metadata, not guest user session/game/OneDrive. IDs are stale after enumeration. |
| Broad host window enumeration | 43 top-level windows; foreground **Chrome PID28720/HWND923906**, 1908×1333 (title redacted). No enumerated physical RIFT top-level window. | Momentary WinApp snapshot; no inference RIFT process terminated or that user will still be in Chrome. |
| Desktop lock | Present, 380 bytes, SHA256 **635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0** | Exact lock cannot be claimed by a second desktop turn. |
| Sidecar | desktop-turn-quarantine-8aed4916-1cf3-4100-bc1b-d56f2308585f.json, 425 bytes, SHA256 **f1b37ebbeca97b4351d719786beb8c93dc678b76170f7e1a32b04bdecf0750a0** | Linked to the specific lock by lease ID and owner stamp hash. |
| Original capture receipt | Search by exact requestId within .tools/desktop-evidence returned **no matching file names**. | Negative within that folder only; does not establish the original call's success or failure. |
| Workbridge generated logs / helper registrations | Bounded Workbridge .local search and .local/helpers list returned **INVALID_ARGUMENT**. Stopped that route, no alternate file-access bypass. | Saved job details and scheduled-task namespace cannot be fully reconciled from this channel yet. A concrete Task HelperId has not been selected. |

### Exact lock/quarantine correlation

**Lock stamp** (read-only): kind workbridge.gui-turn; leaseId **8aed4916-1cf3-4100-bc1b-d56f2308585f**; producer **desktop-capture-window**; requestId **rc18-physical-rift-screenshot-20261102-postinstall-b1**. Acquired 2026-11-02T20:46:12.574Z. Owner pid **43508**, owner processStartUtc=null and sessionId=null. Target historical process **rift_x64**, PID **17412**, HWND **1382178**.

**Quarantine sidecar**: same requestId/leaseId, ownerStampSha256 **635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0** matching the current lock; reasonCode **DESKTOP_TREE_UNSETTLED**; processTreeSettlement **unknown**; automaticRetryAllowed **false**; intentSha256 null; created 2026-11-02T20:46:28.188Z.

**Source reason:** Workbridge src/desktop-registration.ts:36–140 takes desktop-input-turn.lock with create-new (wx), rejects EEXIST as UI_TURN_BUSY, and deliberately retains lock + quarantine record if child process-tree settlement is uncertain. src/desktop-cli-runner.ts:109–183 classifies timeout/forced kill and **some nonzero or invalid Node wrapper replies** as DESKTOP_TREE_UNSETTLED even when a wrapper may have exited. Thus this error code is a conservative **uncertainty** classification, not proof that a process actually survived. No TTL-based release is implemented.

## 2. Exact read-only process jobs and measured outcomes

Both jobs used Workbridge's normal host approval gate, a bounded Windows PowerShell Get-CimInstance Win32_Process query, and emitted **only Name/PID/ParentPID/SessionId/CreationDate UTC**. No process command lines, tokens, credentials, raw files, guest commands, Job termination or GUI actions.

| Workbridge job ID | Result | Timestamp | Findings |
| --- | --- | --- | --- |
| **desktopprobe-readonly-process-lineage-20261104-01** | ✅ PASSED, exit **0**, output not truncated | 2026-11-04T22:35:27.9636272Z | Filtered current node/winapp/wincli/dotnet/DesktopProbe/powershell processes created since 2026-11-02T20:40Z, plus owner PID43508. Three matches: persistent owner node.exe **43508**, created Nov1 09:24:27Z, and **this diagnostic job** Node **14528** + its PowerShell **70436**, both created Nov4 22:35Z. No matching process from the old Nov2 20:46 capture. |
| **desktopprobe-readonly-owner-subtree-20261104-01** | ✅ PASSED, exit **0**, output not truncated | 2026-11-04T22:36:49.2975080Z | Recursive **all-name** current ParentProcessId closure from exact owner PID43508 had seven descendants: two baseline Nov1 descendants PowerShell **12304** → conhost **68684**, and five freshly started Nov4 diagnostic descendants command-host **66304** → conhost **71752**, node **70068** → conhost **48224** and PowerShell **15096**. **No Nov2 20:46 descendants**. Exact historical target PID **17412 absent** from the full current process inventory. |

No evidence in these current snapshots of a currently lingering old WinApp/Node descendant linked to the Nov2 20:46 turn. But ParentProcessId is a **current** relationship, not a historical process-ownership database; detached/exited processes disappear and PIDs can be reused. No exact old Job Object handle, process-tree settlement receipt, old process creation epoch or independent original image-proof receipt was found. Thus **quarantine remains the correct state**.

## 3. Explicitly separate safe read-only pilot from a GUI launch

| Activity | Recommendation | Evidence/risk |
| --- | --- | --- |
| desktop_windows on an existing host taskbar/Explorer frame, no screenshots/menus/focus | 🟢 Continue if useful | Successfully returned metadata with lock present; source src/desktop-windows.ts:48–55 does not acquire a desktop input turn. |
| desktop_inspect on the **fresh** exact PID/HWND/process, depth 1, UIA structural projection only | 🟢 Design-compatible, not directly retested here | src/desktop-windows.ts:57–83 has no focus/input verb or shared turn; stop if target changed, UIA hangs or a hidden provider changes focus. Do not infer guest UIA from VMware host chrome. |
| sbroenne wincli UI/window query | 🟡 Hold pending daemon ownership gate | Its normal queries may autostart a persistent daemon via EnsureRunningAsync. Separate owned PID/start/IPC/private Job, teardown and quiet desktop proof required; read-only semantics must be demonstrated. |
| DesktopProbe host GUI launch, capture, foreground/restore, UIA button invoke/click, any keyboard/mouse | 🔴 NO-GO while quarantine remains | Current shared GUI-turn admission would reject input/capture; launching a centered test app itself can alter user focus and should not race this unresolved turn. Do not create another lock to bypass this one. |
| Guest OneDrive / RIFT / VMware input | 🔴 Outside this lane | No guest side action or receiver state was verified. |

A later DesktopProbe run is additionally gated by the documented **external <=120-second watchdog**: Program.cs uses a WinForms 120000ms UI-thread Timer starting on Shown; Manage-HelperTask.ps1 currently sets Scheduled Task ExecutionTimeLimit=PT0S (unlimited). Neither alone proves bounded exit. The proposed independent interactive-session launcher must own the child in a private kill-on-close Job and verify exit within an approved finite deadline. Its existence is **not yet proven**.

## 4. PROPOSED RECOVERY (NOT EXECUTED) — owner decision and proof gates

This is **not an instruction to remove the lock now**. An automatic stale-age cleanup would contradict the designed quarantine. The task coordinator must obtain a **specific user-authored decision** accepting that the November 2 physical RIFT screenshot remains **unknown_outcome**, with **no replay and no synthetic success receipt**, before any exact-guard archival could be implemented and reviewed.

**Historical planning discussion only; not an executable recovery runbook.** Section 4's steps are preserved for context, but where their order/wording differs, the later [manual GUI-turn archive protocol](manual-gui-turn-archive-protocol-2026-11-04.md) supersedes them. In particular, do **not** use the original Step 5 guard-first suggestion. A future recovery requires the shared admission gate, independent process/receipt reconciliation, and a separate exact-scope Joey decision.

Originally proposed steps (*superseded where inconsistent*):

1. **Freeze admission of competing desktop capture/input operations** using a coordinated reviewed maintenance gate. A mere JavaScript file rename cannot atomically protect a multi-file state if another worker can claim the newly freed lock between operations. Do not disable Workbridge globally or substitute another lock as a workaround.
2. **Reconcile provenance, not age:** retrieve the original Workbridge capture request and exact runner/job receipt where legitimately available; compare requestId, process/agent epoch, target PID/HWND and expected image path. Prove old descendant exit/Job settlement with owned process handles or another trustworthy receipt. The current negative process snapshots are corroboration, **not** substitutes. If these records cannot be obtained, preserve quarantine and ask Joey about the evidence gap before designing a recovery path.
3. **Revalidate exact immutable evidence under the maintenance gate:** C:\work\workbridge-mcp\.tools\desktop-evidence\desktop-input-turn.lock must still be an ordinary file with original file ID and **SHA256 635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0**; sidecar exact **SHA256 f1b37ebbeca97b4351d719786beb8c93dc678b76170f7e1a32b04bdecf0750a0**, both with matching leaseId/requestId/ownerStampSha256. No other active desktop turn or new descendant may have appeared.
4. **Prepare a new unique ignored archive directory** containing byte-exact copies of guard and sidecar, source checksums, relevant original result/intent and a signed-off incident note: original screenshot **unknown_outcome**, automaticRetryAllowed false, not evidence of successful image capture. Verify archive hashes and write its manifest durably **before** any live guard move. Do not touch other .tools/.local files.
5. **SUPERSEDED — DO NOT EXECUTE THE OLD GUARD-FIRST IDEA.** The old suggestion to rename the guard while leaving the sidecar at the original top-level path creates conflicting admission behavior: legacy Workbridge `wx` capture callers can claim the now-free guard even while the watchdog refuses the orphan sidecar. Follow **only** the later [manual-gui-turn-archive-protocol-2026-11-04.md](manual-gui-turn-archive-protocol-2026-11-04.md), which requires a genuinely enforceable **shared GUI admission freeze across all producers**, immutable backup/manifest of both artifacts, **sidecar-first relocation while original guard still blocks capture**, **guard-last relocation as the intentional release point**, and verification with the freeze still held. There is **no implemented or approved recovery action now**. If a shared gate or exact ownership/settlement cannot be proved, STOP; preserve both live guards and all evidence.
6. **Postcondition:** verify no different owner unexpectedly acquired a new turn during release, archived hashes and manifest are intact, original request remains terminal **unknown_outcome**, Workbridge original owner/health unchanged. Do not retry original request or send any RIFT input. Release the maintenance gate only after a clean, documented handoff.
7. **Then**, and only then, evaluate the independent DesktopProbe watchdog, unique Task Scheduler helper ID, candidate wincli daemon ownership and separate user-approved centered host GUI test.

**Absolutely forbid archival/release when any of these hold:**

- A new process matching the old capture runner/WinApp descendant, uncertain Job membership or process-tree settlement, or any current desktop action/claim is observed.
- Guard bytes/hash/file ID/leaseID/requestId drift; sidecar hash does not match; a different task/owner has touched the lock.
- The original owned request/runner/cleanup receipt is missing or cannot be independently tied to the lock, unless a **new, separately authorized manual recovery design** explicitly resolves that gap. The present receipt gap means **not ready for release**.
- An orphaned screenshot/intent/receipt cannot be classified, archive destination exists, the backup digest is wrong, or the maintenance admission gate cannot prevent concurrency.
- Joey has not approved the exact recovery choice, or a protected Workbridge/OS approval is denied.
- A RIFT/VM guest/window state is uncertain in a way that would make host actions hazardous.

The goal is a preserved historical incident **with no false successful capture assertion**, not silent resetting of a production exclusion mechanism.

## 5. Launch/teardown and focus-restoration rules for after recovery

Before a later test, recheck owner instance, shared desktop lease, current Windows interactive SID/session, unique task collision via an exact Task Scheduler query, source/binary hashes and synthetic watchdog process containment. Build only in the ignored investigation temp directory, with no AtLogon trigger. Starting DesktopProbe can overlay current applications; Joey has approved temporary focus, but only within a quiet maintenance window and with a fresh before-foreground HWND/PID/start snapshot.

During the eventual host-only benchmark, bind to fresh DesktopProbe process creation UTC, SID/session, exact top-level HWND/class/visible geometry and native-probe-PID.jsonl shown/counter 0. Read-only comparative UIA is distinct from separately approved one-button n→n+1 action and immutable intent/replay controls.

At teardown, prove exact synthetic process and watchdog/Job descendants exited, native journal and result correct, unique task removed after settlement, candidate daemon/IPC closed, and Workbridge/VM window state unaffected. If any owned cleanup fails, preserve its separate quarantine.

**Focus restoration is conservative:** record before-foreground PID/start/HWND and last user input indicator. Let Windows naturally return focus by default. **Do not actively restore Chrome** merely because it was foreground during our read-only snapshot. If Joey has switched windows during the pilot, preserve that choice. Programmatic restoration to the exact previously focused window needs its own approval, unchanged identity and proof that no intervening user activity occurred; otherwise leave focus untouched and report.

## Source links within the repo

- src/desktop-registration.ts:36–140 and src/desktop-cli-runner.ts:68–197
- src/desktop-windows.ts:48–83; src/desktop-capture-tool.ts:27–135
- scripts/vmware-host-recovery.mjs:149–223 (read-only classifier, no automatic release)
- scripts/helpers/DesktopProbe/Program.cs and scripts/Manage-HelperTask.ps1
- prototypes/desktopprobe-comparison-runbook.md
- benchmarks/winapp-vs-wincli-comparison-plan.md
- docs/autonomous-investigation-policy.md; docs/interactive-desktop-vm-roadmap.md

**No lock release, GUI launch, backend installation, focus restoration or host/guest input was attempted in this report.**
