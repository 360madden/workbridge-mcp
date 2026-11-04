# DesktopProbe GUI-004 — exact identity, privacy and no-focus source audit

**Date:** 2026-11-04  
**Role:** Independent UI-identity / output-projection reviewer for the limited **host-only disposable DesktopProbe** WinApp 0.7.1 vs sbroenne v1.3.28 evaluation.  
**Status:** 🔴 **HOLD for GUI launch**; source review only. No probe launch, candidate UIA snapshot, screenshot, focus, input, VM operation, RIFT interaction, service change or performance measurement by this reviewer.

## 1. Hard prelaunch blocker: existing live-owner quarantine

A fresh Workbridge read-only file observation found:

| Evidence | Fact |
| --- | --- |
| Lease path | `workbridge-mcp/.tools/desktop-evidence/desktop-input-turn.lock` |
| Lease SHA-256 | `635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0` |
| Lease ID | `8aed4916-1cf3-4100-bc1b-d56f2308585f` |
| Producer / request | `desktop-capture-window` / `rc18-physical-rift-screenshot-20261102-postinstall-b1` |
| Owner | PID 43508; process start and session fields null |
| Prior target | Physical `rift_x64` PID 17412, HWND 1382178 |
| Acquired | 2026-11-02 20:46:12.574 UTC |
| Linked quarantine | `desktop-turn-quarantine-8aed4916-1cf3-4100-bc1b-d56f2308585f.json` |
| Quarantine SHA-256 | `f1b37ebbeca97b4351d719786beb8c93dc678b76170f7e1a32b04bdecf0750a0` |
| Classification | `DESKTOP_TREE_UNSETTLED`, `processTreeSettlement=unknown`, `automaticRetryAllowed=false` |
| Proven correlation | Quarantine's `ownerStampSha256` equals the exact lease hash |

This is a **confirmed retained safety quarantine**, not a lease that can be deemed expired from age or the owner's PID alone. The owner can be the persistent Workbridge process: `src/desktop-registration.ts:55-69` stores the service's `process.pid` but `processStartUtc:null`, and `src/desktop-registration.ts:84-140` intentionally retains a lock for an unsettled child process tree. The capture runner expressly notes that killing a Node wrapper alone does not settle WinApp grandchildren (`src/desktop-cli-runner.ts:109-116`). The VMware capture path follows the same preserve-on-uncertainty pattern (`scripts/vmware-host-capture.mjs:474-537`). The read-only recovery inspector classifies active, foreign or quarantined locks, but does **not** unilaterally release them (`scripts/vmware-host-recovery.mjs:159-223`).

**Decision:** no DesktopProbe GUI launch or focus-affecting operation until an owner-authorized, independently evidenced recovery resolves the old lock without masking an unsettled action. Do not unlink, overwrite, rename, expire, or clear a lock automatically. Reading it and the linked quarantine performed no mutation. Any input test requires a separate approval after a clean read-only pilot.

## 2. Verified fixture and tool contracts

| Source and SHA (read-only) | Verified property | Risk |
| --- | --- | --- |
| `scripts/helpers/DesktopProbe/Program.cs` `509662a61284ce50a0c056d5fb78fc35ad0d71173e95c9972f49a17c777db6d6` | WinForms .NET10 synthetic 700×410 client, title `Workbridge GUI-004 Native Input Probe`, controls `IncrementButton`, `ResetButton`, `CounterDisplay`; event JSONL `starting`→`shown`, optional `incremented`/`reset`/`closed` | Journal has PID, session and HWND, but **no process start time, owner SID, binary SHA or class**. They require an independent native observer. |
| `scripts/desktop-ui.mjs` `29a34aba1780dedf4369cca17eb250c733187d5c6f98ee3dd5023eee13fff145` | WinApp adapter verifies pinned version; `list-windows -a PID` exact HWND/PID, optional exact process/title; `ui inspect -w HWND --depth 2 --json`; checks tree HWND | Raw `tree` forwarded inside internal return (`172-227`), can include private UIA `name`, text/value and other unrelated elements. Do not invoke existing `desktop_inspect` publicly for privacy-preserving test receipts. |
| `src/desktop-windows.ts` | Workbridge `desktop_inspect` validates inputs and returns adapter result, no semantic privacy projection (`57-83`) | Upper output byte bound ≠ privacy filter. |
| `test/desktop-ui.test.mjs` | Fake WinApp inspect JSON shape: `{windows:[{hwnd,elements:[...]}]}`; tests exact version/PID/HWND/title and no inspect on mismatch | Synthetic shape is **not measured DesktopProbe UIA coverage**. |
| `benchmarks/sbroenne-stdio-protocol-2026-11-04.md` | Pinned v1.3.28 isolated stdio handshake listed only `ui_snapshot`, actualToolCalls **0**, direct child closed; full descendant Job settlement unproven | No observed vendor `ui_snapshot` payload, control coverage, screenshot absence *at runtime*, or latency yet. |

Vendor source-only finding: pinned sbroenne `UISnapshotTool` → `WindowsToolsBase.CaptureSnapshotAsync` → `SnapshotStateService.CaptureAsync` → `UIAutomationService.Tree.GetTreeAsync` on an **explicit** `windowHandle` uses UIA element-from-HWND, with no focus, activate, screenshot or OCR calls in the inspected snapshot path. Null/omitted HWND instead targets foreground; forbid omission. Snapshot can still include `Name` and editable `Value`, and UIA COM can block despite requested depth/caps. Expose only `--tools ui_snapshot`, not `ui_read` (which has OCR fallback), `ui_batch`, input or window-management tools. This is **source inference, not a runtime no-focus guarantee**.

Microsoft WinApp CLI's official UI automation documentation confirms `inspect --json` includes nested `windows[].elements[]` and typed geometry in physical screen pixels; `--interactive` is an actionable-elements output filter, not a persistent process. **Keep version-specific behavior pinned to the installed 0.7.1 binary** rather than assuming the evolving upstream main docs match it: https://github.com/microsoft/winappCli/blob/main/docs/ui-automation.md .

## 3. Fresh exact identity contract for *each* provider observation

Capture and compare, in this order:

1. **Owned launch provenance:** unique ignored `temp/desktopprobe-<runId>`; exact .NET10 publish EXE, managed DLL and runtime dependencies hashes; watchdog process PID and *creation time*; known limited interactive user SID and session; owned child Job-membership; 110s monotonic supervision. Do not use the shared `.tools/desktop-evidence` folder for the new fixture.
2. **Native fixture birth:** await fresh native `starting`→`shown` in *this run's private journal*, event count exactly 2, counter 0; make sure PID/session/HWND/title match the watchdog's independently observed child identity. A prior PID/HWND/title, cached journal or a filename from another run is never acceptable.
3. **Independent Win32 identity:** exact child PID+process creation UTC ticks+session+executable canonical full path+hash+owner SID; `IsWindow`; `GetWindowThreadProcessId(HWND)`=child PID; top-level root/owner relationship; class; exact fixed title; `IsWindowVisible` true, `IsIconic` false; monitor-intersecting finite screen rect, display DPI; unlocked `WinSta0/Default` desktop. Reject any reparse/junction escape in run artifacts.
4. **No-focus baseline:** after `shown` (which may itself take focus), capture `GetForegroundWindow` HWND/PID and session, plus child and monitor state. Each read-only provider call must begin/end with independent identity and foreground snapshots. If the foreground changes unexpectedly or native counter/events change, classify **failure/uncertain**, do not call another provider under an assumed clean state.
5. **Provider request:** WinApp only `--version`, scoped `ui list-windows -a <PID> --json` and `ui inspect -w <HWND> --depth 2 --json`. Sbroenne MCP only `ui_snapshot` with explicit decimal `windowHandle=<HWND>` and bounded `maxDepth`; verify tool allowlist exactly one before and after session. Neither should enumerate all desktop windows, use OCR, call window activation or operate RIFT/VM. Preserve raw evidence only inside bounded private process memory for projection; never echo it to Workbridge tool receipts or command-job logs.
6. **After check:** the *same* PID+creation time/HWND/class/path/session, unchanged counter 0 and exactly two initial native events; unchanged foreground since baseline; child still held by the same private Job. On any timeout, tree uncertainty or stale HWND, no retry and settle/teardown only the owned child Job.

**Do not use title alone as identity.** HWND and PID can be recycled; a process-start-time comparison is required. Multiple matching windows or an owned popup must be treated as ambiguous, not silently substituted.

## 4. Strict minimal projection (both providers)

The comparison runner must parse vendor responses internally, validate structure and schema, then return **only**:

| Permit to Workbridge receipt | Must never forward |
| --- | --- |
| `runId`, provider ID and pinned version/source SHA, normalized opaque request ID, monotonic elapsed milliseconds, output byte count, timeout/error *code* | Raw vendor stdout/stderr, tool `content[].text`, exception messages/stack traces, full executable paths, environment |
| Independent PID+creation-time digest (or exact synthetic PID), decimal HWND, session, stable identity booleans, foreground-unchanged and native-counter-unchanged flags | Other process/window inventories, unrelated titles/classes, clipboard, filenames outside private temp, user names |
| Whether exactly one root `Window` and one known `IncrementButton`, one `ResetButton`, one `CounterDisplay` are found, control types, enabled/InvokePattern flags; bounded element count/depth, complete/truncated/unknown | UIA `Name`, `Value`, `Text`, labels' dynamic string values, editable text, document text, browser contents |
| `status` = passed/failed/blocked/unknown and a stable enumerated reason code; whether exact owned processes exited | Screenshots/base64 PNG, OCR output, arbitrary element IDs or selectors outside the four fixed fixture names |

If candidate output lacks expected fields, return **unknown/incomplete**, not guessed true. Do not aggregate raw subtrees into a hash for public results; internal diagnostic hash may be stored privately if approved, but its content and original bytes must not be exposed. Always record `rawResponseBytes` before redaction and `projectedBytes` afterward. A 512 KiB size limit by itself does not sanitize text.

## 5. Source-review of new watchdog and native observer

### Owned watchdog, `prototypes/desktopprobe-watchdog/Program.cs`

At latest read, SHA-256 `f839745a2ba69a9d868c8779a81ded1230286e047a2b6ef37a2ea56a5ab49679`:

- ✅ Launch mode verifies interactive non-Session-0 user, **refuses if shared desktop lock exists**, resolves dedicated `temp/desktopprobe-<runId>/publish/DesktopProbe.exe` and evidence folder, checks EXE/DLL SHA (`78-97`). This fixes an earlier mismatched shared-path draft.
- ✅ Uses private kill-on-close Windows Job by attaching watchdog itself **before child Start**; verifies owner's active count 1 and post-start active count 2, confirms child session, avoids a post-spawn assignment race; newer revision emits bounded early-crash/membership diagnostics (`123-173`).
- ✅ From entry stopwatch enforces a 110s deadline, waits at most 5s for exact child kill and 2s active count settlement; reports uncertain if not settled (`153-226`).
- 🟡 Source-only, no verified synthetic Windows job/Task Scheduler run yet; `IsProcessInJob(child, IntPtr.Zero)` proves membership of **some** Job, but `ActiveProcesses()==2` provides stronger corroboration that this private Job contains child. No hard guarantee if initialization is blocked before watchdog's timed Wait.
- 🟡 EXE/DLL hash-pinned but runtimeconfig/deps and transitive DLLs are not fully pinned; enforce private signed/pinned artifact manifest and no reparse directory escape. Own unique run ID to avoid inherited probe journal.
- 🟡 `File.Exists(sharedLease)` at `83-85` is only a prelaunch check; without an **atomic shared-GUI-turn acquisition held across launch**, another desktop capture can acquire that lock between check and the fixture stealing focus. This needs a source-level lease reservation/ownership fix or an equivalent externally verified exclusive gate before launch. Do not clear the old RIFT lock.
- 🟡 This new code is not a production service update or approval for GUI launch; current RIFT quarantine is intentionally a hard block.

### Native observer, `prototypes/Observe-DesktopProbeReadOnly.ps1`

Revised SHA-256 `52d88949de768caa9e9df129840bcb28a39b1dc05263d511cacd209ccdfc72de` (the source was strengthened while this audit was running):

- ✅ No focus/input/capture calls; independently checks PID/start UTC ticks/session/exe path/hash and the process-token **owner SID**, HWND→PID/root/unowned class/title, `WinSta0/Default`, visible/not iconic, monitor geometry, stable foreground, bounded two-event journal and counter 0, and a second process-lifetime check before returning (`101-219`).
- ✅ Restricts evidence to a unique `temp/desktopprobe-<runId>/evidence` and rejects reparse of evidence/run directories (`34-47`).
- ✅ Updated observer additionally verifies **observer's own SID/session against the intended target** and returns `ownerSidVerified=true` rather than a raw SID; this removes a privacy leak and fixes a paired sampler schema mismatch. `ClassName`, `ForegroundHwnd`, `OwnerSid` still must originate from independent native preflight, not vendor text. Watchdog run-ID validator allows underscores and one-char values while observer folder regex requires at least six chars with hyphens only; choose common 8–40-character lowercase-hyphen run ID.
- 🟡 The journal's required count=2 is appropriate for strictly read-only snapshots. A human clicking the fixture or timer closing it midtrial should produce a controlled failure, not an automatic rerun.

## 6. Minimal pilot acceptance matrix

| Gate | Pass | Hold / fail |
| --- | --- | --- |
| Shared GUI lease | No old lock, orphaned quarantine or unsettled operation after explicit recovery | 🔴 Currently confirmed old RIFT quarantine |
| Build & supervision | Same clean per-run path and hashes, synthetic owned-Job timeout test green, independent 110s watchdog armed | Missing process-tree settlement, unbounded task or shared path |
| Identity | Unique PID+start+session+SID+exe SHA/HWND/root/class/title, stable before/after | Recycled handle, two candidates, wrong session/secure desktop, minimized/offscreen |
| UI semantics | Snapshot reveals exactly the fixed synthetic controls; result marked complete with provider error diagnostics bounded | Missing controls, raw document text, truncation treated as successful |
| No focus/input | No `focus`, `activate`, `click`, `invoke`, mouse, keyboard, OCR, capture; foreground unchanged after `shown`; native count stays 0 | Any unexpected foreground, counter/journal or screen change |
| Lifecycle | Both vendor children/direct descendants and watchdog+DesktopProbe settle under verified owner Job; no leaked daemon/IPC | Child-exit callback alone without descendent proof |
| Results | One **redacted**, small JSON comparison record; all error states explicit; no raw tree/vendor stdout in Workbridge receipts | Sensitive output, "success" based only on API ack, no receipt |

**Scope:** Neither provider has yet performed a controlled DesktopProbe snapshot in this review, so no claim of functional superiority, reliability percentile, or lower latency is established. The next milestone is source-review of the new comparison runner, a separate synthetic watchdog containment check, resolved GUI-turn quarantine, then a coordinator-approved quiet host-only read-only observation. **No arbitrary Windows app, RIFT, ChatGPT browser or VMware guest is in scope.**

## 7. Review of comparison runner

### WinApp isolated reader — source ✅, runtime 🟡

`prototypes/winapp-desktopprobe-sample.mjs` SHA `696eb7d837fc4cf13e9e374cb92eaece43ea944c11802024c8eee1ce6508cec3`. The runner validates per-run manifest and exact watchdog lease, executes a read-only PowerShell native observer **before and after**, requires stable geometry/foreground/native journal and exact PID/start/session/HWND; then calls only the pinned WinApp version, exact `list-windows -a PID`, and exact `inspect -w HWND --depth 1` arrays. Its `projectTree` now whitelists exactly one `IncrementButton` Button, one `ResetButton` Button and one `CounterDisplay` Text/Label; it discards dynamic names, values and click coordinates and publishes structural-only counts/hash (§159-197§, §234-277§). It never dispatches focus, activation, invoke, click, screenshot or keyboard input. The independent observer SHA `52d889...` now supplies the required `ownerSidVerified` field. **Remaining caveat:** `winapp.exe` is resolved by the installed PATH with version check rather than verified absolute binary SHA; capture the live binary hash/path in the preflight and don't claim binary identity solely from a version string. Depth 1 may omit controls in some UIA providers; if incomplete, mark coverage unknown and rerun only after reviewed scope change. No GUI test occurred in this lane.

### Sbroenne supervisor — source 🟡 HOLD

`prototypes/Sbroenne-Provider-Host.cs` SHA `6dc2da5e2d37cb6a50e3ccb29f0c90d27b96cceaec03d319baa521e398b66b23` now uses `Sbroenne-JobLifetime.cs` SHA `048ab7c0ed177981f2e61fe535a4aa9fbc73105b7713f2b43f6f79e8039a82ad`, and checks exact three Job-member PIDs (host, Node sampler and MCP server), settling to the host before publishing (§129-163§). This is better than active process count alone, but remains **not exercised against GUI**. **Blocking flaws remain:** `IsOwnedScript` and Node binary allowlisting still check basenames only (§64-85§), allowing wrong-path executables; and the host forwards unparsed `RESULT:{...}` lines to Workbridge (§116-163§), potentially leaking raw UIA `Name`/`Value`/`Text` if the child violates expectations. Pin canonical full paths plus hashes; parse and reserialize a strict small metadata schema, not arbitrary child JSON. `ReadLine()` allocates a full line before its 8 KiB check (§43-51§); bound reads before allocation. The dedicated `sbroenne-desktopprobe-sample.mjs` source **does not yet exist** at this checkpoint. Its author has acknowledged HOLD and will finish it under another lane. Do not run Sbroenne GUI sampling until independently reviewed.

**Disposition:** Source design is promising for a **synthetic read-only**, host-only comparison after quarantined lease recovery and full owner Job proof. **No GUI GO at this checkpoint.** Coordinator may schedule a follow-up independent review when Sbroenne sampler and lease coordination code land. Commit only this report, leaving other lanes' files unmodified.

## 8. Final watchdog and GUI-turn lease second-pass audit (2026-11-04, source-only)

**Supersedes the earlier non-atomic `File.Exists` concern in Section 5.** Pinned final `prototypes/desktopprobe-watchdog/Program.cs` SHA `2431c49f3257e219c3d839a309d9f10c96dc25e8b4d17b92d5289b9c8fcd8ecb`; `DesktopTurnLease.cs` SHA `c35ee09a0610956201aa83979528ebe4955d8686eefa9d8638ef0e4955d7506ef`. No GUI or synthetic execution by this reviewer.

| Gate | Independent source finding |
| --- | --- |
| 🟢 Atomic acquisition before launch | `DesktopTurnLease.Acquire` uses Win32 `CreateFileW(CREATE_NEW)` for the shared GUI-turn lock, holding its unique safe handle throughout supervision. `Program.Supervise` acquires before attaching the private Windows Job or calling child `Start`. Collision fails closed. |
| 🟢 Exact ownership and deletion | Stamp includes run/request/lease IDs and owner PID, process start UTC ticks and session, fsynced. `Complete(true)` verifies immutable bytes from **the held file handle** with constant-time comparison, then applies Win32 `FileDispositionInfo` to that exact handle, closes it, and verifies path absence. No title-, PID-, age- or pathname-only unlink. |
| 🟢 Crash/unsettled preserve | `Complete(false)` retains lock and writes an immutable linked quarantine sidecar with stamp SHA, unknown tree settlement and `automaticRetryAllowed=false`. An exception/crash before `Complete` may leave lock **without** sidecar: never automatically recover it from PID or time. |
| 🟢 Orphan sidecar preflight fixed | Final `Program.RunDesktopProbe:102–110` fails if shared lock **or any `desktop-turn-quarantine-*.json`** exists. This is conservative and requires an explicit authorized reconciliation if old sidecars remain. The atomic acquisition closes the original check/start race. |
| 🟢 Synthetic containment | `RunSynthetic` selects ignored per-run `desktop-input-turn.mock.lock`; it never mutates the shared lock. Reported synthetic checks exercise collision and clean/retained disposition, not live GUI. |
| 🟢 Exact shown proof | `TryWriteTargetManifest:327–407` waits for child-native `shown` journal, checks PID/session/title/counter=0, validates live exact HWND/root/owner/PID/class/visibility, requires nonzero foreground, and writes private manifest with `FileMode.CreateNew`. No title-wide discovery, screenshot or input. |
| 🟢 Run ID, timeout | Final `SafeId` constrains 8–40 lowercase alphanumeric/hyphen run IDs, matching observer folders. 110s monotonic deadline plus bounded kill and Job settlement; child app timer is not the containment gate. |
| 🟢 No first input action | No `SetForegroundWindow`, `SendInput`, UIA action, click, keyboard, mouse or capture in watchdog/lease. Starting a disposable WinForms fixture **might itself take foreground**; read-only provider no-focus checks must compare pre/post **after** `shown`. |
| 🟡 Separate lifecycle vs GUI success | `Program.cs:288–324` requires `manifestWritten` for a successful **real** scenario. Missing manifest reports `no_gui_manifest` / `unknown_outcome` and nonzero exit. `lease.Complete(settled && !forceQuarantine)` can release the **process-tree** lease on independently proven child/Job settlement even if GUI postcondition is unknown; this is safe and truthful but never a successful GUI benchmark. |
| 🟡 Real workflow untested | Source/synthetic proof does not establish interactive Task Scheduler principal, provider hang behavior, foreground stability or real GUI latency. Existing old RIFT retained lock/quarantine still prohibits launch pending explicit recovery. |

**Verdict:** 🟢 **GO** for further no-GUI synthetics and code review. 🔴 **HOLD** real GUI until independent recovery of the old shared lease/quarantine plus a separately approved limited host-only read-only trial. No desktop actions, VM/RIFT access, input, service changes, or real measurements occurred in this review.
