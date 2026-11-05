# Known host GUI producers: legacy-guard and admission invariant audit

**Date:** Thu 2026-11-05 (America/New_York), source snapshot plus bounded Windows census at 2026-11-05T23:16:14.997Z. **Scope:** READ-ONLY; no GUI, input, task/service lifecycle, RIFT/VM guest, lock, or OneDrive changes. **Question:** Can a future crash-only orphan admission be handed to maintenance while the old GUI guard continuously prevents any known producer from acting?

## Bottom line

**GREEN for the examined known host writers' code paths:** every directly identified host GUI writer uses atomic desktop-turn-admission.lock **before** attempting create-new desktop-input-turn.lock, or (standalone screenshot child) authenticates a live parent that already owns both. An existing canonical GUI guard therefore blocks these known writers even during a proposed orphan-admission handoff.

**YELLOW for the stronger operational claim:** the source audit and the current filtered census cannot prove that *every historical, ad-hoc, external-provider, unpublished prototype, or future Task Scheduler launch path* obeys either guard. Workbridge terminal_run can run user-authorized executables, native WinApp CLI can be called independently, and exported low-level captureWindow() has no guard of its own. Until these entrypoints are inventoried/quiesced, **do not execute orphan recovery from code coverage alone**. Source/deployment parity is proven for the WB-001 staged six-file closure, not every direct script or published watchdog binary.

## Entry-point matrix

| Known host entrypoint | Admission before legacy guard? | Proof paths (line numbers) | Scope / caveat |
| --- | --- | --- | --- |
| GREEN **MCP desktop_capture_window** | **YES**: compiled dist withDesktopAdmission, then open(desktop-input-turn.lock, wx), orphan-sidecar veto | src/desktop-registration.ts 36–55, 64–118, 244–304; compiled dist/desktop-registration.js 21–84; src/desktop-capture-tool.ts 26–70 | Production WB-001 source and installed compiled file inspected. Outer parent owns both; child capture is not a second independent turn. |
| GREEN **MCP desktop_capture_vmware_host** | **YES** in staged native script: withDesktopAdmission → open wx → sidecar veto before potentially focusing/restoring VMware HOST window | src/desktop-registration.ts 306–315; src/desktop-vmware-tool.ts 35–41; scripts/vmware-host-capture.mjs 306–380 | dist/vmware-host-capture.mjs matches source hash. HOST chrome only, not guest Windows UIA. |
| GREEN **DesktopProbe action prototype** | **YES**: withDesktopAdmission wraps invokeProbeOnceOwned; owned method opens old guard wx and vetoes orphan sidecar | scripts/desktop-probe-act.mjs 240–249, 256–319 | dist and source SHA identical. Direct standalone calls to this guarded export are covered, but arbitrary WinApp tools are not. |
| GREEN **Standalone desktop-capture CLI child** | **PARENT-VERIFIED**, not independent acquisition: refuses unless exact producer-mode parent admission and GUI-turn stamps match parent PID, request, target | scripts/desktop-capture.mjs 245–335, 338–359; src/desktop-cli-runner.ts 4–11, 91–100; src/desktop-registration.ts 289–299 | Parent holds both names throughout child lifecycle. Raw module export captureWindow() (different function) does not itself validate them; see bypass boundary. |
| GREEN source; YELLOW deployed **DesktopProbeWatchdog .NET 10** | **YES**: native CreateFileW(CREATE_NEW) admission, then native CreateFileW(CREATE_NEW) GUI guard, before Job attach/child | prototypes/desktopprobe-watchdog/DesktopTurnLease.cs 61–132, 303–343; Program.cs 132–189 | Current source has updated normal-uncertainty sidecar schema; no proof current published EXE/DLL were republished after this update. A crash/abnormal Dispose can retain BOTH names with NO sidecar. |
| GREEN **Physical RIFT reload / focus-only** | **YES**: withDesktopAdmission wraps createTurn() wx and quarantine veto; prior submitted intent keeps no-replay | scripts/physical-rift-reloadui.mjs 304–325, 344–445, 453–488 | Direct source script (not WB-001 six-file dist closure). One physical /reloadui previously documented; not a generic game GUI action permit. |
| GREEN source; YELLOW evolving **Physical RIFT /rre candidates stage/submit** | **YES**: withDesktopAdmission 245–248 before createTurn() at 284; createTurn() opens wx 139–160; sidecar veto | scripts/physical-rift-candidates.mjs 13, 139–160, 227–359 | Newly authored/changeable direct script, not part of the prior WB-001 five-producer census. Its CLI intentionally lacks a trusted post-capture chat-focus bridge for submit; do not equate a staged action with submitted. Re-pin source hash before use. |
| GREEN source **ChatInputProbe disposable pilot** | **YES**: withDesktopAdmission, sidecar/guard precheck, then open wx before native focus/send-keys | scripts/chat-input-disposable-pilot.mjs 60–72, 83–108 | Direct one-off experiment; an exception can leave guard while finally releasing admission, another orphan shape. Not a general host input provider. |
| BLUE **Read-only observation** | **No GUI turn necessary for read-only calls** | MCP desktop_windows/desktop_inspect src/desktop-registration.ts 244–272; scripts/physical-rift-status.mjs 354–359; scripts/vmware-host-recovery.mjs 255–295; read-only WinApp/Sbroenne DesktopProbe samplers | Not independent GUI writers in their documented paths. Their observers should still validate target session/foreground and must not be promoted to input without new ownership wrapper. |
| YELLOW **Task Scheduler Workbridge MCP / generic helpers** | **No gate in Task Scheduler manager itself**; launched executable must enforce its own | scripts/Install-Autostart.ps1 11–26; scripts/Manage-HelperTask.ps1 44–81, 89–126 | Manager verifies SID, task action and Limited/Interactive settings but accepts an arbitrary registered EXE. It is not a desktop mutex. Enabled tasks and direct external launches require per-incident census. |
| RED **Low-level or external direct calls** | **Not proven / potentially bypassable** | scripts/desktop-capture.mjs exports captureWindow() (unwrapped internal helper); scripts/desktop-ui.mjs 81 onward exports generic runWinapp(); terminal_run accepts allowlisted user-authorized binaries | A future module importer or external WinApp/Sbroenne MCP client could operate outside these wrappers. No claim of universal enforcement. Require bounded provider API and launcher inventory, or full GUI-producer offline phase. |

### P0 separate invariant: owner-checked Node pathname unlink has a swap gap

**RED source-level finding, not an observed incident:** the deployed shared admission helper verifies lstat/read/lstat dev+ino, size, mtime/ctime and SHA at scripts/desktop-turn-admission.mjs 117–140, but then calls **unlink(lease.filename)** by pathname at line 143, after all comparisons. Because there is no held original file handle across the delete, a rename/replacement between the last check and unlink can make the unlink target a different owner. Windows file-share rules may instead reject deletion; that is still not an atomic proof of correct ownership. The installed dist helper is byte-identical to this source (SHA 2d07155795c6766ea2adbff96907e523b0550f9ab3df7fc7020dfa2b3f941f21).

The **older GUI-turn release paths have analogous check-then-pathname-delete windows**:

| Writer | Source evidence of independent check then pathname unlink |
| --- | --- |
| MCP host window capture | src/desktop-registration.ts 153–176; current installed dist/desktop-registration.js uses same pattern |
| VMware host capture | scripts/vmware-host-capture.mjs 541–564 (same installed dist SHA) |
| DesktopProbe action | scripts/desktop-probe-act.mjs 536–552 (same installed dist SHA) |
| Physical RIFT reload / focus | scripts/physical-rift-reloadui.mjs 289–301 |
| New RIFT candidates | scripts/physical-rift-candidates.mjs 124–136 |
| ChatInput disposable | scripts/chat-input-disposable-pilot.mjs 99–102; only checks bytes hash, even narrower |
| Native watchdog and PowerShell maintenance archiver | **Different**: watchdog DesktopTurnLease / DesktopAdmissionLease use SetFileInformationByHandle on an originally opened file object; Archive-DesktopQuarantine.ps1 Admission.ReleaseOwned 178–195 uses the same handle-bound model, and source relocation uses handle-bound FileRenameInfo with no replace |

This **does not invalidate the admission-before-guard acquisition order**, but it limits what an operator can conclude about continuously correct ownership and release under races. The paired-orphan recovery helper must not assume a verified pathname still names the same file on its next statement. Priority before general provider promotion: synthetic Windows replacement-race tests for each Node release class; design a retained native creation-handle owner deletion or equivalent atomic identity-bound operation; preserve uncertainty on failure; deploy only through a separately approved WB-001 maintenance release. No live race test or current lock change is authorized here.

### Source vs deployed distinction

The WB-001 deployment report documents authorized rollout at 20:17:50Z under owner PID 58580, instance be5f373a-8c98-4877-b5dd-dbea9e5728d5. Fresh read-only Workbridge diagnostics still show version 0.16.4-dev, same owner, controlPlane OK, 34/36 available with two unrelated RR2/AutoFight command jobs running (the inventory is bounded at 20,000 historical entries; not an exhaustive absence proof). The exact installed dist/desktop-registration.js SHA is e96950ce5ddf2781fe7ea6af8469ee96011b2e98fc851c2b28c01d94e3671fb5 and its current code imports the staged admission helper before old guard creation. The installed dist/desktop-turn-admission.mjs SHA is 2d07155795c6766ea2adbff96907e523b0550f9ab3df7fc7020dfa2b3f941f21, identical to scripts source.

Installed dist/desktop-runtime-manifest.json SHA 651b8471c7ae4a82ef92bfa739dcfc2ca1b172a219addbdd24cc52248f3c5f8a pins all six files. We independently compared these source/installed pairs at inspection: desktop-capture.mjs SHA 4c40821002442b35ec464644dc10d49db23b82ee7b85e3e33a2ac3bbbec91fc6, vmware-host-capture.mjs SHA 62129b79713feb25c611b076710c90a0d5f441cdad8828b45233f113868522b3, desktop-probe-act.mjs SHA 18a0f0aff2a4b4f3df4870883e5cce62555aa670b35a0e372f4d5c012053fe5d, desktop-turn-admission.mjs SHA 2d07155795c6766ea2adbff96907e523b0550f9ab3df7fc7020dfa2b3f941f21. Current direct scripts outside the sealed closure need separate source/runtime pin checks.

The source-only audit is evidence of what these files would do **if invoked as inspected**, not a blanket statement about earlier builds, arbitrary local scripts, or a future independently launched provider.

## Bounded filtered native host census (one corrected execution)

- First attempt: Workbridge job wda_gui_producer_native_census_readonly_20261105a, PowerShell 5.1 parser failed safely on a label expression, exit 1; no census data and no host changes.
- Corrected single retry: job **wda_gui_producer_native_census_readonly_20261105b**, launched 23:16:12.898Z, ended 23:16:15.089Z, **PASS exit 0**. It read Win32_Process and ScheduledTasks only, classified selected script names internally and redacted raw command lines, unrelated task identifiers, arguments and account values.
- Exactly **409 processes** and **238 tasks** inventoried; **0 uninspectable script-host command lines** in that snapshot. Matching process identities: VMware host application PID23940, parent31892, session1, start 15:30:35.847Z; VMware host PID31976, parent23940, session1, start 15:30:58.283Z; physical/guest-nature unresolved RIFT PID32156, parent8472, session1, start15:31:50.642Z. Prior independent physical RIFT proof identifies PID32156 as the physical client; the process filter itself does not distinguish physical vs guest solely by name.
- **No matched** DesktopProbeWatchdog, DesktopProbe, ChatInputProbe, WinApp/WinAppCli, or named Node/PowerShell GUI-launcher process. This proves only absence from this **filtered snapshot**, not historical process-tree settlement or no external input tool.
- Six selected Task Scheduler registrations: **Workbridge MCP Running**, **Workbridge Helper pc-health Running**, **Workbridge Helper rr2-controller-lab1 Ready**, **rr2-controller-lab2 Ready**, **rr2-receiver-lab1 Ready**, **rr2-receiver-lab2 Ready**. All six enabled, one task action each; **zero action strings matched the known host GUI script pattern**. The generic task wrapper can still hide indirect guest-controller work, and a Ready helper might launch later; do not treat this as guest VM quiet.
- A fresh nonrecursive Workbridge .tools/desktop-evidence listing, individually filtered for desktop-input-turn, desktop-turn-admission and desktop-turn-quarantine, returned **zero active names** (all nontruncated). This is a separate momentary observation; no admission reservation was acquired.
- **NO GUI, Task Start/Stop/Enable/Disable, service restart, input, VM guest or RIFT operation occurred**. The census consumed an ordinary bounded Workbridge job, leaving daily 36-slot coordination otherwise intact.

## Practical invariant decision for a future orphan-pair archive

| Obligation | Assessment | Next safe gate |
| --- | --- | --- |
| All *known current source* host GUI writers honor canonical old guard | GREEN: yes in exact audited entrypoints | Freeze exact source/runtime hashes; make synthetic competitor create-new collision tests. |
| All those writers honor atomic new admission before legacy guard | GREEN for scripted paths; parent-authenticated screenshot child | Verify deployed WB-001 parity and direct producer flags immediately before operator maintenance. |
| All possible historical/external desktop GUI actions honor both | RED: not provable from repo/source alone | Disable or independently settle nonparticipating Task/CLI scripts; producer-wide maintenance window or NO-GO. |
| Orphan guard continuously protects admission-handoff gap | YELLOW: plausible only while original named guard remains and above all-producer invariant holds | Native same-volume test with old admission handle-bound rename, racing contender and maintenance CREATE_NEW; guard must remain until maintenance wins. |
| Known Node guard/admission release deletes exact original file object | RED: pathname unlink has check/use swap gap; no exact-handle binding | Before live recovery/promotion, synthetic replacement-race proof and reviewed native handle-bound release |
| Admission-only orphan | RED: no old guard means no covered handoff | Separate offline-only/operator design; do not silently use paired helper. |
| VM guest sessions and OneDrive UI | UNKNOWN: source and host census do not inspect inside VMware guests | Separate exact Lab1/Lab2 receiver/session/lease checks, no implicit guest input. |

**Recommendation:** Do not modify Workbridge's functioning desktop providers to solve the future orphan right now. Use the independent synthetic two-lock admission-handoff harness and a fresh registered-task/producer census before even considering an operator-approved archival helper. Continue normal Workbridge jobs. Promote a new provider into GUI input only after it owns the same admission+legacy turn and independent before/after evidence.

## Source hashes (SHA-256, pinned snapshots)

| Source | SHA-256 |
| --- | --- |
| src/desktop-registration.ts | ca5787db0e16e28ccf93f2d103d55f21fba1b31ed51afe36592de8bfb63297b7 |
| dist/desktop-registration.js | e96950ce5ddf2781fe7ea6af8469ee96011b2e98fc851c2b28c01d94e3671fb5 |
| src/desktop-capture-tool.ts | c8ad30cf30d856a6d954ada2450b5483e99c86dc37effd3c6815c0ba51da5574 |
| src/desktop-vmware-tool.ts | 09d81c4eccc02835738bcc73379ea42b3da88284508a0f71bce2759a8661af3c |
| src/desktop-cli-runner.ts | 6f933a8b3d16aeb84867e09af5120618241ad033f35058089e05bf6abe4050fb |
| scripts/desktop-capture.mjs | 4c40821002442b35ec464644dc10d49db23b82ee7b85e3e33a2ac3bbbec91fc6 |
| scripts/vmware-host-capture.mjs | 62129b79713feb25c611b076710c90a0d5f441cdad8828b45233f113868522b3 |
| scripts/desktop-probe-act.mjs | 18a0f0aff2a4b4f3df4870883e5cce62555aa670b35a0e372f4d5c012053fe5d |
| scripts/desktop-turn-admission.mjs | 2d07155795c6766ea2adbff96907e523b0550f9ab3df7fc7020dfa2b3f941f21 |
| scripts/desktop-ui.mjs | 29a34aba1780dedf4369cca17eb250c733187d5c6f98ee3dd5023eee13fff145 |
| prototypes/desktopprobe-watchdog/DesktopTurnLease.cs | 00e67f7f0721f2a139a39c3e799f666fc3577d68830142a674e99cd82ae54b3f |
| prototypes/desktopprobe-watchdog/Program.cs | 2431c49f3257e219c3d839a309d9f10c96dc25e8b4d17b92d5289b9c8fcd8ecb |
| scripts/physical-rift-reloadui.mjs | a182308782aa1b89b0c619eccd7a538e074ce947c8ce9ab9182dd1666ccf495f |
| scripts/physical-rift-candidates.mjs (evolving at inspection) | 73ca41a6e7aab120b7bfb0493d32fa63802edc4bf5a1c1ede9a9f81e03f7fc83 |
| scripts/chat-input-disposable-pilot.mjs | 0a32e7705c59c68963212a5c21b822e6ab5986bad043d5eaeea7df12afccf697 |
| scripts/Manage-HelperTask.ps1 | d9bbf232e440e0c591cd3715630babec1e238dfadec3f901b72babb26504afd7 |
| scripts/Install-Autostart.ps1 | ef42fecdcb2152a9e12ee5561294e0d28bcee9643cdd42da218b192b1bdae6f4 |
| dist/desktop-runtime-manifest.json | 651b8471c7ae4a82ef92bfa739dcfc2ca1b172a219addbdd24cc52248f3c5f8a |
| reports/wb001-gui-clean-release-preparation-2026-11-05.md | aa2d424ec26c34e0f16ee7ae566475ae6758c0e0b06ac46d8ee1764d2b51ddc7 |
| scripts/Archive-DesktopQuarantine.ps1 | 5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0 |

**No code or active runtime state changed by this audit.** All results are source-hashed snapshots and a single bounded Windows read-only census; no admission was taken.
