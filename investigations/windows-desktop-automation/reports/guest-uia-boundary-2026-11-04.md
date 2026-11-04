# Guest-side UI Automation boundary and minimal pilot — 2026-11-04

**Status:** Design-only research note. No guest UIA worker has been launched, no new input path is authorized, and no production Workbridge/RR2 source has been changed. Owner: desktop-automation investigation within Workbridge-MCP.

## Purpose and operating boundary

Joey wants reliable Windows/third-party dialog control, OneDrive-state observation, VMware guest interaction and before/after proof without interrupting day-to-day Workbridge or active RIFT. Keep these distinct targets:

| Surface | Appropriate mechanism | What it does **not** establish |
|---|---|---|
| Host Windows applications | Deployed Workbridge desktop enumeration/inspection/capture through WinApp CLI 0.7.1 | Guest UIA accessibility or RIFT game control |
| VMware Workstation host chrome | Exact VMX/HWND host-frame adapter and its host desktop turn | Authenticated guest agent or game response |
| Guest Windows UI/dialogs | **Proposed** interactive-session guest UIA provider, read-only first | RIFT-rendered HUD semantic controls |
| RIFT game renderer/input | Existing RR2 bound guest agent, native capture, protected action protocol and telemetry gates | OneDrive sync cause or generic Windows dialog handling |
| OneDrive file delivery | Existing per-installation hash-verified `addon_sync.py` | Why OneDrive Personal enters paused state |

## Verified existing seams (source inspection)

- Workbridge `src/desktop-registration.ts` registers `desktop_windows`, `desktop_inspect`, `desktop_capture_window`, `desktop_capture_vmware_host`. `scripts/desktop-ui.mjs` pins WinApp CLI 0.7.1 and offers read-only `windows`/`inspect`. Host captures share `.tools/desktop-evidence/desktop-input-turn.lock`, with durable uncertain-operation quarantine. The guest UIA provider should be a separate versioned implementation, not an extension of `desktop_capture_vmware_host`.
- Workbridge `src/desktop-action-guard.ts` and `src/desktop-session-policy.ts` explicitly reject generic VMware host/guest input (`VMWARE_SEPARATE_PATH_REQUIRED`). Preserve this distinction.
- RR2 `scripts/vmware_guest_session.py` and `scripts/lab_codex.py` provide VM-specific, identity-pinned VMware Tools staging/results. Guest authentication is a separate Windows login from encrypted-VM authorization; cached guest credentials must be revalidated by the existing mechanism each attempt, not copied, printed or silently substituted.
- RR2 `scripts/Ensure-GuestAgentTask.ps1` demonstrates a limited interactive-user Scheduled Task with zero auto triggers, `IgnoreNew` and exact launcher/identity checks. A future *separately named* generic guest UIA task can reuse its lifecycle pattern without reusing its RIFT-specific launcher.
- RR2 `scripts/control_host.py`/`control_client.py` and `src/RiftReader2.Live/Control/ControlAgent.cs`/`WindowsControlDesktop.cs` implement a game-specific protocol. `ControlAgentConfiguration.Validate` requires `ProcessName == "rift_x64"`, a fixed executable SHA, and a bounded RIFT window; host protected operations are only `capture`, `arm`, `action`, `recover`.
- RR2 `scripts/nav_access_queue.py`, `nav_host_runtime.py`, `nav_supervisor_bootstrap.py` and `nav_control_watchdog.py` own the canonical per-VM queue/resource/STOP cleanup. Host-only read-only telemetry receivers (`ensure_receiver.py`, ports 49813/49923) are **not** the guest input agent.

### Critical compatibility correction

**Do not give an independent UIA input worker the existing `vm:rift-lab-N` lease and assume the RR2 supervisor will clean it up.** The current `LeaseWatchdog.tick()` observes queue state and `_cleanup()` attests STOP/release using the **RIFT guest control session only**. It cannot prove a separate UIA worker released keys/buttons, finished a modal operation or exited. A shared-queue grant without UIA-specific cleanup could therefore be marked free on invalid evidence. `QueueDispatchPolicy` also only understands the established RIFT protected operation set.

For a future mutating UIA pilot, choose one of two explicit designs:

1. **Small/reversible pilot:** obtain a verified *maintenance handoff*—RR2 controller/console/input fully quiesced and cleanup proved; then a separately owned, strictly bounded synthetic UI action under an exclusive desktop turn; verify its own release and after-state before RR2 resumes. This is not appropriate while either game is actively being operated.
2. **Production integration:** extend common admission, guest protocol, watchdog and trusted cleanup to recognize UIA-specific outstanding actions, owner identities, cancellation and release receipts. Only then permit shared resource coordination and concurrent read-only workers. Requires negative tests for disconnected guest, stale epoch, hung UIA provider, late response and uncertain release.

Independent UIA *read-only* element inspection can be prototyped before either mutating design, provided no focus/menu-open/screenshot fallback or desktop-input operation occurs.

## Proposed minimal safe pilot (not launched)

1. **P0 host fixture:** reuse the existing disposable .NET 10 WinForms counter helper and benchmark read-only window/UIA inspection with installed WinApp CLI, candidate `sbroenne/mcp-windows` and FlaUI reference. Record exact tool/release hash, target PID/HWND/session, cold/warm duration, nonempty typed UIA output and no foreground change.
2. **P1 interactive guest observation:** after a separately reviewed safe maintenance window, stage a hash-pinned, no-input guest inspector through existing VMware Tools workflow. Launch by a **new uniquely owned** limited interactive-user Scheduled Task (not a service/Session 0 or an unverified `vmrun runProgramInGuest` process). Verify Windows user/session ID, boot and process identity independently before and after. Start with a bounded Explorer or disposable synthetic window UIA tree; do not change focus.
3. **P2 OneDrive observation:** inspect only OneDrive window/tray accessibility metadata and independently collect passive process uptime, pause indicators, actual connection cost classification, task policy/arguments and timestamped diagnostic events. Do not click **Resume syncing**, open a menu, modify sync settings or infer VMware caused the pause.
4. **P3 guest action later:** only after P1/P2 pass and exclusive maintenance ownership is proven, invoke exactly one button in a disposable guest test app with its independent counter `0→1` and a second fresh read. Then verify the other lab did not change. A synthetic app, not the live RIFT HUD or OneDrive tray, supplies initial action proof.
5. **P4 rollout decision:** benchmark persistent guest outbound provider versus short-lived VMware Tools calls (p50/p95/max and failure recovery); adopt a versioned Workbridge provider only if the evidence justifies integration. Preserve current provider toggle and WB-001 staged rollback.

**Lab choice:** Lab 2 is the better eventual guest trial candidate because the November 4 status showed connected/ready/disarmed and a free queue. Its RIFT was foreground, so **no guest test now** without a reviewed safe window. Lab 1 is excluded while quarantined.

## Evidence and modal/latency obligations

Every observation/action receipt should identify request ID, lab/VMX path and *lossless* VMX start ticks/log epoch, guest boot/user-session, exact app PID/start/executable path/hash, top-level and owner HWND, expected title/class, UIA `AutomationId`/`ControlType`/pattern, parent-modal chain, bounding rectangle/DPI, foreground/minimized/offscreen checks, and source revision. Keep 64-bit Windows ticks as decimal **strings** through JavaScript to avoid precision loss.

For a mutating operation, journal intent before dispatch; capture before-state (UIA semantic property and, when allowed, cropped screenshot hash); issue **one** bounded action; wait for a state-dependent event/poll with a deadline; compare a fresh after-state and independent application marker; record release and uncertainty. Result classes: `verified`, `failed`, `pending`, `unknown`, `blocked`. Tool success is not app success. Unknown actions are **not** automatically retried.

Modal handling must revalidate `GetAncestor(GA_ROOT)`, owner/window chain, actual PID and UIA role, not assume a modal inherits the original HWND. Reject ambiguity, offscreen/minimized geometry, unexpected process, focus theft and secure-desktop/UAC boundaries. The historical WinApp click returning success near `(-31877,-31771)` on a minimized window without incrementing its counter is a mandatory regression.

Record monotonic host dispatch, guest receipt, UIA discovery, action, postcondition and reply durations separately, with cold/warm p50/p95/max and timeout/unknown counts. RIFT's independent 4.5-second feedback and occasional scan gaps are **telemetry constraints**, not proof of UIA latency.

## November 4 live read-only checkpoint — Lab 1 quarantine

Authorized **status-only** Workbridge jobs at approximately **21:17–21:21 UTC** found both VMXs running. The two exact `control_client.py --no-auto-start status` calls exited 0 without starting services. All four RR2 managed controller/observation-receiver tasks were registered/running, but task state alone is not guest connection health.

| Gate | Lab 1 | Lab 2 |
|---|---|---|
| VMware PID | 44308 | 20020 |
| Controller/guest | Controller responds, `host.connected=false`, coordination `waiting` | Connected, coordination `ready`, supervisor running |
| Input/game | Guest status unavailable | Disarmed/idle/zero held keys; RIFT PID 11572; foreground true |
| Queue snapshot (`mode=ro`, `PRAGMA query_only=ON`) | **`blocked=1`, `holder=null`, `cleanupReceiptPresent=false`**, generation 5192 | `blocked=0`, no holder, cleanup receipt present, generation 2248, pending 0 |
| Strongest conclusion | Genuine cleanup/reconciliation evidence missing; **no input authority** | Authenticated idle state, but addon/player feed and game response remain unqualified |

Lab 2 guest `responseVerified=false` is reported by the existing `status` implementation; do not treat a responding status call as independent action-to-game proof. Native network listener enumeration gave contradictory metadata, consistent with known VMware/Windows diagnostics, so one missing `Get-NetTCPConnection` row is not a valid failure diagnosis.

**Separate, non-destructive Lab 1 follow-up:** inspect only current sanitized controller task process/exited receipt and supervisor/queue event summaries; correlate VMX, host instance, guest agent connection/handshake timestamps and queue generation via read-only SQL. Check per-VM guest credentials only through the existing scoped session helper **if later approved**. Determine whether the guest agent is absent, its handshake refused, the host epoch changed, or STOP/release remained uncertain—do not choose a root cause in advance. No forced kill, snapshot revert, VM restart, duplicate controller, queue reset, manual unblock or synthetic cleanup receipt.

## OneDrive is a separate investigation

`riftreader2/scripts/addon_sync.py` already supports `check`, `verify` and explicit `sync --target pc|lab1|lab2|all`; it hashes six canonical addon files per installation and handles Offline/reparse placeholders and local pinning. This **solves addon delivery consistency**, not OneDrive's recurring paused-sync root cause. `sync` is a write action and is not part of the read-only pilot. See `riftreader2/docs/workflows/addon-sync.md` and `workbridge-mcp/docs/handoff-flaui-workbridge-2026-11-04.md`.

**No new actions in this design phase:** no guest UIA process, focus, screenshot, OneDrive resume, receiver/controller restart, credential access, game input or VM power operation.
