# Host → VMware guest → application → proof: latency trace and benchmark plan

**Date:** 2026-11-04 (America/New_York)  
**Status:** DESIGN ONLY / NOT EXECUTED. No guest input, screen capture, VMware operation, OneDrive action, controller restart, daemon launch or production Workbridge change was performed to produce this plan.  
**Owner:** Workbridge Windows desktop automation investigation; coordinator controls later experiment approval and commits.  
**Goal:** Pin down **where time disappears** and whether an operation **really changed the intended application**, without conflating fast tool replies with confirmed GUI outcomes.

## 1. Measure five layers separately

| Layer | Example | Correct evidence and boundary |
| --- | --- | --- |
| A. ChatGPT → Workbridge → host orchestrator | Tool admission, serialization, host process/CLI startup | Host-side MCP request accepted, process identity and exact local request ID; includes approval/queue time if measured from user initiation. The interactive ChatGPT Allow delay is a separate **human wait** metric, never benchmarked as provider latency. |
| B. Host → VMware/guest transport | VMware Tools guest command/copy, existing RR2 outbound TCP, or a separately owned guest UIA provider | Exact VMX+running VM epoch, bridge connection/handshake, byte-sent acknowledgment, guest receipt and reply; separate VM encryption permission from Windows guest login. |
| C. Inside correct Windows interactive guest session | UIA root/selector lookup, modal ownership, native synthetic-app operation | Guest user/session/desktop identity, app PID/start/HWND, selector and target pre/post tree, timer spans measured **in the guest**; never infer guest accessibility from host VMware UIA. |
| D. Outcome proof and evidence return | Independent synthetic counter/OS state, guest screenshot BMP, host VMware-window PNG, digest/receipt | Fresh postcondition *from a distinct observation* plus capture acquisition, encoding, transfer, image hash, file flush, and replay/quarantine record. A screenshot's changed hash alone does **not** prove the requested state or RIFT game response. |
| E. Cloud/application follow-through | OneDrive sync resumes, transfers queued bytes, hydrates a file across devices | Long-running, externally affected convergence event; measure its own start/end/backlog trend after a **separate** approved OneDrive experiment, **not** as part of button/API reply latency. |

No general UIA operation has yet been implemented in the RR2 RIFT-specific control agent. This document specifies *new* instrumentation for a future separately owned guest-side provider; it is not a claim that these spans are currently exposed.

## 2. Exact source seams and implementation cost

| Current verified source | Seam / existing contract | Trace addition to consider later |
| --- | --- | --- |
| riftreader2/scripts/control_client.py: ControlClient.request, _capture | Loopback HTTP client; POST to /api/capture; 10-second HTTP timeout; BMP base64 parse, SHA256 check and fsync of saved image/capture JSON | Host collector span H0/H1 and H11/H12, response byte count and decode/hash/fsync breakdown. A 16 MiB response cap is already enforced. Do **not** record bearer/operator tokens or raw images in committed metrics. |
| riftreader2/scripts/control_host.py: ControlRequestHandler.do_GET/do_POST, AgentGateway.command/capture | Authenticated operator HTTP; gateway/VM epoch guard; guest command route; capture returned as base64 BMP; 8-second guest request timeout and 2-second send timeout | Mark HTTP accepted, admission wait, VM epoch guard, transport submit and response parse. The current EvidenceJournal.append("control-command-request/1") occurs **after** _send_frame; a future durable *intent-before-send* trace is a needed design change, not an existing guarantee. |
| riftreader2/scripts/control_host.py: AgentSession._request/_send_frame/_read_responses and EvidenceJournal.retain_capture | Guest-command ID/sequence, concurrent pending map, nonblocking socket I/O, timeout closes connection; host capture retains BMP and fsyncs, then journals; no blind replay | Correlate host transport send start/end, guest frame ID, host response received, response journal/fsync, independent target state. Current timing cannot isolate one-way network latency without guest stamps. |
| riftreader2/src/RiftReader2.Live/Control/ControlAgent.cs: RunConnectionLoopAsync, HandleCommandAsync, HandleActionAsync, ReplyAsync | Outbound interactive guest TCP agent, hello instanceId, unique monotone sequence; uses Stopwatch for action elapsed, 45-second screenshot review and 15-second arm; action writes pending.json before input; reply writes command-ID JSON **before** sending network response; responseVerified=false for status | Instrument guest receive/validate, app target inspect, selector lookup (new provider), input insertion, release, observer/postcondition, screenshot capture, serialization, command receipt disk flush and response write separately. Preserve no-duplicate-ID and fail-closed behavior. |
| riftreader2/src/RiftReader2.Live/Control/WindowsControlDesktop.cs: Inspect, CaptureBmp | Verifies exact RIFT PID/process start/executable SHA/HWND/foreground, BitBlt client-window capture; BMP may be 10 MiB; GDI capture requires target foreground; **not** generic UIA | Capture phase timestamps + image identity/dimensions. **Do not reuse as OneDrive/Explorer inspector**: configuration explicitly requires ProcessName "rift_x64" and exact build. |
| riftreader2/scripts/capture_lab_hp_screenshot.py: capture_once, ready_epoch, await_release | Screenshot workflow with recent native HP review, queue lease, exact epoch, independent status before/after, STOP and watchdog cleanup receipt; screenshot-only result explicitly not OCR/game-state proof | Reuse its *concept* of baseline→capture→independent review→cleanup receipt for benchmarks, but not its RIFT resource lease or its game-specific STOP/key-release cleanup. |
| riftreader2/scripts/nav_access_queue.py, nav_control_watchdog.py, nav_host_runtime.py | SQLite lease, supervisor, blocked-resource quarantine, monotonic wait fences and RIFT-specific cleanup | New guest UIA resource needs **UIA-specific** admission/cleanup and concurrent-UI discipline. Do not place generic dialog actions in vm:rift-lab-N and incorrectly claim RIFT STOP cleans UIA. Lab1 remains quarantined pending independent diagnosis. |
| riftreader2/scripts/vmware_guest_session.py: GuestSession.__enter__/run | Identity-pinned vmrun; validates VM-specific cached Windows credentials by listProcessesInGuest or prompts; separates VM-encryption -vp from guest -gu/-gp; each command rechecks VM identity. | Measure guest-session bootstrap, VMware Tools copy/invoke/return, validation gates separately; no diagnostic printing of credentials or raw process command lines. A successful VM inventory does not establish interactive guest desktop access. |
| riftreader2/scripts/Ensure-GuestAgentTask.ps1, lab_codex.py | Limited interactive-user scheduled-task pattern and pinned artifact staging; some guest commands may be run outside visible desktop if session is wrong | For a future generic guest UIA worker require exact logged-in user SID/session/desktop, owned task, verified synthetic exe SHA, and no service/Session 0 UIA assumption. Do not launch now. |
| workbridge-mcp/scripts/desktop-ui.mjs, desktop-capture.mjs, vmware-host-capture.mjs | Host WinApp 0.7.1, exact PID/HWND/re-list and PNG digest receipts. VMware capture uses VMUIFrame host window; may restore a minimized host window under exclusive desktop-input-turn.lock | Separate host-window UIA/capture timing from the **guest image freshness** and guest app/action proof. VMware host capture can touch window foreground; never use on active RIFT without specific approval. The script historically pins an older single Lab1 VMX: rediscover current VMX mapping rather than reusing old hardcoded path. |
| workbridge-mcp/scripts/desktop-probe-act.mjs and scripts/helpers/DesktopProbe | Disposable WinForms IncrementButton, independent native counter journal, exact fresh HWND; known minimization failure (-31877,-31771) caught by geometry + counter evidence | Best synthetic postcondition oracle: counter n→n+1 and a new observation with matching PID/session, no reliance on click success. Model guest fixture after it, with separate ownership and application-specific methods. |
| riftreader2/scripts/benchmark_guest_transfers.py | Prior synthetic vmrun vs HTTP transfer benchmark measures host perf_counter and guest Stopwatch, avoids arbitrary payloads, distinguishes command overhead vs wire transfer | Reuse **measurement method**, not its live guest commands or implicit permissions. File-transfer throughput is **not** UIA round-trip or application outcome proof. |

**Historical encryption correction:** Workbridge docs/autonomous-investigation-policy.md and docs/interactive-desktop-vm-roadmap.md:95-113 record vmrun captureScreen returning "A password is required" exit -1 in an older VM. VMX key names indicated an encrypted VM/vTPM. This is a *VMware authorization* layer, not evidence of bad guest Windows credentials or a failed guest receiver. No new native capture is planned here.

**As-of 2026-11-04 historical status:** Lab1 controller guest disconnected and vm:rift-lab-1 queue blocked without a verified cleanup receipt; exclude Lab1 from tests. Lab2 controller previously connected/idle but RIFT PID 11572 was foreground; exclude live Lab2 until separate maintenance and input/console handoff. These were prior read-only observations, **not** present readiness claims.

## 3. Trace protocol: ordered event markers and what they measure

Each future request has one immutable requestId, a traceId shared across wrappers, one target epoch, and an ordered span event list. Only a **new non-RIFT guest UIA service** may emit hypothetical UIA spans (marked with an asterisk); existing RR2 code does not expose them yet.

| Event | Clock | Definition | Correct interval |
| --- | --- | --- | --- |
| H0 | host monotonic | Workbridge receives/accepts request after external approval | Start end-to-end technical timer; optional human approval wait measured separately |
| H1 | host | Validated exact host/VMX and target epoch; admission/lease acquired | H1−H0 = validation + queue/lease wait |
| H2 | host | Backend process/daemon and authenticated bridge ready | H2−H1 = bootstrap/connection overhead |
| H3 | host | Guest command frame send begins, with durable intent already committed | start of measured round-trip; include socket writes |
| H4 | host | Final command bytes sent / transport write accepted | H4−H3 = local serialization + write (not guest receipt) |
| G0 | guest monotonic | Full frame received and decoded | Host cannot precisely subtract H4 from G0 without clock alignment |
| G1 | guest | Identity, session and request replay guards accepted | G1−G0 = protocol validation |
| G2* | guest | UIA provider begins exact target/window/selector discovery | G2−G1 = admission-to-UIA delay |
| G3* | guest | UIA lookup resolved and before-state captured | G3−G2 = UIA/COM/tree query cost |
| G4* | guest | Exactly one reviewed synthetic action begins (if authorized) | G4−G3 = post-lookup guards |
| G5* | guest | API/input reports delivered and any buttons/keys released | G5−G4 = insertion/hold/release, **not application response** |
| G6* | guest | Independent app-state/postcondition read begins | G6−G5 = transition wait/observer scheduling |
| G7* | guest | Fresh postcondition n→n+1 (or explicit failure/unknown) observed | G7−G6 = application response + observation |
| G8 | guest | If screenshot permitted: image acquisition begins | G8−G7 = proof-channel scheduling |
| G9 | guest | Pixels captured; image hashed/encoded with identity | G9−G8 = capture + encoding (subspan each) |
| G10 | guest | Durable response/result intent written and response send starts | G10−G9 = local journal/serialization/fsync |
| G11 | guest | Response bytes flushed to transport; record monotonic stop | G11−G10 = guest network send (not host receipt) |
| H5 | host | Full guest response received and parsed | H5−H3 = combined host/transport/guest round-trip |
| H6 | host | Response/image digest verified, artifact persisted (if requested) | H6−H5 = decode/hash/disk flush |
| H7 | host | Independent host-side state/target observer completed | H7−H6 = additional proof overhead; compare observer timestamps to guest evidence |
| H8 | host | Postcondition + cleanup settled, lease release verified, MCP response emitted | H8−H0 = **verified technical completion**; if no proof, status remains unknown |

For *read-only* trials, G4/G5 action spans are **not populated**; measure G2/G3 and an independent unchanged-after observer. For *non-screenshot* trials G8/G9 are N/A. A separate screenshot after action is a **fresh observation**, not an assumed continuation of the pre-action capture. Mark N/A explicitly so a missing phase cannot be misread as zero milliseconds.

**Important current-overhead traps:**
- A return from RR2 guest SendInput/action path is delivery/release evidence only; its own responseEvidence says to compare later independent frames/API observations. It already reports elapsedMilliseconds for guest action but not all transport/UIA/proof spans.
- C# ReplyAsync writes/flushed an on-disk command response before sending. Host EvidenceJournal append writes/flushed control-command records, EvidenceJournal.retain_capture fsyncs BMP, and Python ControlClient._capture fsyncs a second image. Those can dominate latency and must be separate, not blamed on VMware.
- Guest BMP and host PNG capture differ in route, process, payload size and precondition. Do not directly rank their raw elapsed time without identical semantic proof/target.
- A host VMware PNG may contain RIFT pixels, but never certifies *guest Windows UIA control*, *receiver connected*, or *game input response*. A synthetic guest-native counter is stronger for action proof.
- A transport timeout after H3 can mean delivery happened; record **unknown** and quarantine until an independent fresh state and release check. Never blindly resend a UI operation.

## 4. Clock alignment without fictitious microsecond precision

1. **Local elapsed times:** On the Windows host use process monotonic clock (Python time.perf_counter_ns/time.monotonic_ns or .NET Stopwatch; Node process.hrtime.bigint); in a Windows guest .NET Stopwatch.GetTimestamp with Stopwatch.Frequency. Preserve raw 64-bit counts as **decimal strings** (JS Number loses precision above 2^53) and convert within the producer/BigInt reader. Span deltas are valid **within the same OS clock domain and boot/clock epoch**.
2. **Absolute chronology:** Also attach UTC timestamps (prefer Windows GetSystemTimePreciseAsFileTime, otherwise clearly labeled DateTimeOffset.UtcNow) for human correlation and event logs. Windows wall clock may jump via time sync, restart, suspend or VMware Tools; do **not** derive elapsed duration from subtraction of UTC strings.
3. **Two-machine offset estimate:** If the later guest service supports a passive echo, perform five short timestamp handshakes before and after a trial block. Collect host (h0 send, h3 receive) and guest (g1 receive, g2 reply) UTC pairs, plus their local monotonic timestamps. Estimate relative UTC offset from the midpoint with transport round-trip **uncertainty**; use the minimum-RTT sample and store error/upper bound. Network direction can be asymmetric; **never advertise precise one-way H→G or G→H latency from an unsynchronized pair**.
4. **Clock-independent transport residual:** Host RTT between H3 and H5 **minus** guest monotonic (G11−G0) is an aggregate of both network directions, host socket/serialization/scheduling and clock-boundary effects. It can expose growth but cannot individually locate uplink vs downlink without synchronization/hardware traces. Clamp tiny negative values only as measurement noise and label them rather than inventing a zero.
5. **Epoch drift guard:** Re-sample UTC offset after the block. A guest clock correction/snapshot/VM restart, monotonic discontinuity, drift outside the measured uncertainty, or changed VMX/Windows boot epoch invalidates cross-clock ordering/offset for that block. Preserve local durations and mark cross-host alignment unknown. Reacquire exact identity before any new trial.

Microsoft documents QPC/Stopwatch as appropriate for **same-machine or same-VM** intervals; for multi-machine chronology, it recommends UTC clocks with synchronization. See primary references below. No assumption that VMware host and guest monotonic tick counts share an origin or frequency.

## 5. Minimal trace receipt schema (proposed v1, no secret data)

One redacted JSONL event per state change plus one summary for each unique ID, with bounded output. Types below are illustrative, **not yet a production contract**:

    {
      "schemaVersion": "desktop-proof-trace/1",
      "traceId": "uuid", "requestId": "unique-durable-id",
      "lab": "synthetic-guest", "operation": "uia.increment",
      "provider": {"name": "candidate", "revision": "exact-hash", "mode": "warm"},
      "target": {
        "vmxIdHash": "sha256-path-id", "vmProcessEpoch": "decimal-string",
        "guestBootId": "opaque", "guestSessionId": 2, "userSidHash": "sha256",
        "appPid": 1234, "appStartUtcTicks": "decimal-string",
        "appExeSha256": "hex", "hwnd": "hex-string",
        "controlType": "Button", "automationIdHash": "sha256",
        "ownerModalHwnd": "hex-string-or-null", "dpi": 96,
        "foreground": false, "minimized": false
      },
      "spans": [
        {"event": "H0", "clock": "host-mono", "ticks": "decimal-string", "frequency": "decimal-string", "utc": "ISO8601"},
        {"event": "G0", "clock": "guest-mono", "ticks": "decimal-string", "frequency": "decimal-string", "utc": "ISO8601"}
      ],
      "proof": {"before": 0, "after": 1, "oracle": "native-counter", "fresh": true, "imageSha256": null},
      "transport": {"kind": "outbound-tcp", "payloadBytes": 0, "responseBytes": 0, "roundTripMs": null},
      "outcome": "verified", "cleanup": {"leaseReleased": true, "uiInputsReleased": true},
      "errors": [], "clockOffsetUncertaintyMs": null
    }

**Minimum required recorded fields** (even for failure/denial): date/time, requestId/traceId, tool/candidate exact SHA/version, host process/session, lab exact VMX and VM start/epoch, guest boot/user-session/agent instance, app PID+start/executable, root/child HWND owner and selector identity, precondition, operation name, per-domain event timestamps and timer frequency, timeout policy, returned status, independently observed result or **unknown**, release/cleanup evidence, image dimensions/bytes/digest if any, failure class, and whether focus/input occurred. Secret tokens, decrypted VMX values, user documents, raw OneDrive account data, and private screenshots are never committed; store only safe aggregates/hashes.

Outcome enum: verified, failed, blocked, timed_out_unknown, pending_proof, stale_target, quarantine_required. A tool success without a fresh independent postcondition is **pending_proof**, never verified. Enforce action idempotency by *request receipt* and current counter state, not blind replay of a click.

## 6. Proposed 10-pilot / 30-trial synthetic campaign — future only

**Prerequisite and authority:** separate approval for guest process staging, interactive-user synthetic fixture, any screenshot or input, possible CLI daemon bootstrap, and a verified maintenance window. First use a **disposable/synthetic Windows guest**; if none exists, a strictly read-only pilot in an explicitly idle Lab2 after independent readiness checks. **Do not test on Lab1 while blocked; do not focus or click a live RIFT or OneDrive window.** All Workbridge changes remain isolated from its running 0.16.4-dev owner and WB-001 deployment. New provider uses its own lease/cleanup and cannot inherit RIFT's protected control queue.

### Phase A — ten-run safety pilot (not yet launched)

| Pilot calls | Surface | Operation / oracle | Gate |
| --- | --- | --- | --- |
| #1–2 | Host disposable DesktopProbe | Read-only PID/HWND/session and UIA root lookup twice | Same exact instance, unchanged counter, no focus/input |
| #3–4 | Host synthetic provider | Passive screenshot *only after capture-specific approval*, image size/hash/freshness; otherwise substitute read-only UIA state | Clear capture cost and no unexpected foreground/restore |
| #5–6 | Disposable guest, verified interactive session | Passive exact app process/UIA root inspection, cold then warm | Guest session/auth distinct from VMX inventory; no game/OneDrive |
| #7–8 | Disposable guest | Passive native counter before/after and, if approved, screenshot of synthetic test app | Known local oracle, snapshot bound to same PID/HWND and fresh timestamp |
| #9 | Fixture/mock, no guest input | Wrong guest session/changed PID/expired window identity | Fail closed with typed error; no dispatch |
| #10 | Fixture/mock, no guest input | Delayed/duplicate reply + timeout and replay receipt | Timeout→unknown/quarantine, same request never resent |

Pilot pass requires 10/10 correctly classified outcomes (including intentional denied cases), **zero** focus changes, wrong-target actions, unowned daemons, guest RIFT input, unlabeled screenshot effects, missing cleanup or orphaned process. If gate fails, **STOP** campaign and retain redacted intent/diagnostic receipt. A screenshot of host VMware chrome is a separate host route, not interchangeable with an in-guest screenshot.

### Phase B — controlled 30-trial timing campaign per comparable route (only after pilot passes)

- **First 5 “cold” trials**: first operation after *approved, owned synthetic helper/provider start* (not a VMware power cycle, Windows cache flush, or production Workbridge restart). Each fresh start has a unique verified owned PID/task/IPC endpoint and teardown. Cold start is not a claim about reboot-cold OS caches.
- **Next 25 “warm” trials**: same verified-owned provider remains ready; two warmup reads before measured runs, never simultaneous with another desktop input owner.
- For each compatible provider, run **30** end-to-end traces of a *semantically equivalent* operation: read-only exact tree lookup and/or independently proven single synthetic button n→n+1 (mutating arm requires a distinct explicit gate). **Never** put read-only and action trials in the same distribution.
- Compare **host-only WinApp**, guest-side selected UIA provider (e.g., sbroenne/FlaUI only if it can run inside the guest safely), and VMware Tools-based short-lived command **as separately labeled paths**; no falsely comparable host-only call vs full host→guest→proof call. If a provider lacks equivalent methods, mark N/A.
- Optional matched A/B comparison: use randomized, alternating A/B then B/A pairs of the *same synthetic request type* under one exclusive UI turn. Reset synthetic counter only through the fixture's independently reviewed reset contract, with distinct trace IDs; never auto-click reset in a live app.
- Optional **separate** payload campaign uses same image dimensions/content-size classes for guest BMP over TCP vs host PNG path and records encode/transfer/fsync. These are different capture semantics and may not yield equal pixels. Benchmark native app oracle as the primary truth.
- Never manufacture p95 from a few successes: publish raw bounded timing vector, sample sizes and invalid/discarded trials; median, p95 (nearest-rank), min/max, no-ack/timeout/unknown counts, cold and warm separately, stage-weighted distributions, input/focus side effects and CPU/working-set/daemon lifetime. **25 warm measurements make p95 indicative, not statistically tight**. Show before/after state and output bytes for each verified trial.

### Classification rubric and prioritization

| Symptom observed after a later benchmark | Likely layer to optimize (diagnosis, not proof) |
| --- | --- |
| High H1−H0 or H2−H1; guest roundtrip normal | Host admission, redundant CLI launch, queue contention or process/daemon bootstrap |
| High H5−H3 but low guest G11−G0; clocks unaligned | Combined bridge/network/host IPC scheduling overhead; do not claim direction yet |
| High G3−G2 and no action | UIA COM/provider tree traversal, selector depth, wrong session, hung provider; compare provider timeout and parent modal ownership |
| Low G5−G4 yet late G7 | Target application event loop or observer freshness; input acknowledgment is not action proof |
| High G9−G8 or H6−H5 | GDI BMP/PNG acquisition, encoding, base64 size, transfer, SHA256 and fsync |
| Early host reply but missing independent counter change | **Correctness failure** irrespective of speed; wrong target, minimized geometry, modal change or event not consumed |
| OneDrive tray resumes quickly, backlog clears minutes later | **Cloud synchronization time**, track as a separate eventual-consistency metric; don't inflate button latency |

## 7. Uncertain operations, retries, and recovery

- **Before dispatch:** append durable intent with exact target+lease+expected counter; only request IDs that never crossed the send boundary and have verified no side effect may be freshly retried within bounded approved scope.
- **After dispatch started:** host timeout, broken socket, guest crash, or missing postcondition → **timed_out_unknown**, block mutation replay, re-observe app state and input release with a separate read-only request. An action may have happened even if the reply was lost.
- **Guest pending journal:** RR2 already has pending.json for RIFT keys; a UIA worker needs its **own** operation journal and modal-specific cleanup receipt, not simply a reused RIFT STOP. If cleanup cannot be independently proven, quarantine the UIA resource. Never unblock Lab1's RIFT queue from UIA evidence.
- **Multiple agents:** one exclusive mutating desktop turn per guest interactive session; read-only observers may proceed concurrently only when provider/UI state is stable and they cannot focus, expand menus, hydrate OneDrive placeholders or hang UIA globally. Scheduler/monitor records owner, deadline, last event and blocked reason; handoff after inactivity requires fresh observation and explicit release, not a second caller taking over.
- **Late response:** correlate original requestId and boot/agent epoch; save as evidence only. Never apply it to a new request or assume the app still has the same HWND.
- **Watchdog:** bounded monotonic deadlines per hop; on timeout remove only confirmed owned synthetic processes after verified release. If ownership/cleanup is uncertain, preserve evidence and require human review rather than force-quit, clear leases or reboot.
- **Cold launch:** any wincli persistent daemon or guest helper may start a process even for a read-only UI query; prove exact ownership of PID/start/IPC/task and teardown before first launch. The prior host wincli comparison plan has its own daemon gate.
- **Security/identity:** do not log OneDrive file data, credentials, token-bearing control envelopes, VM encryption password or Windows guest login; UAC/secure-desktop prompt is stop/hand-off, not an automation target in these pilots.

## 8. Deliverable and acceptance summary for coordinator

The *benchmark implementation milestone* is successful only if it produces per-trial source-hashed, redacted machine-readable receipts that isolate local host/guest spans; lists clock offset uncertainty; shows independent n→n+1 (or unchanged state for read-only); categorizes all errors and no-action denials; proves cleanup; and leaves existing Workbridge, Lab1 quarantine, Lab2 RIFT session, OneDrive and VMware state unchanged. The provider choice should favor lower verified p50/p95 **at equivalent correctness**, not a faster unverified click.

**No timings, pass rates, empirical provider speedups or guest readiness results are claimed here.** Next dependency: coordinator selects and approves a disposable guest and scoped synthetic test lifecycle before execution.

### Primary technical references

- RR2 source paths and Workbridge source paths above, inspected as of this report.
- Workbridge docs/autonomous-investigation-policy.md and docs/interactive-desktop-vm-roadmap.md, including historical vmrun encrypted-VM password gate.
- Existing benchmarks/winapp-vs-wincli-comparison-plan.md; this plan is the distinct cross-guest/proof extension.
- Microsoft Learn, [Acquiring high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps): QPC/Stopwatch same-VM intervals and synchronized UTC for multi-machine event ordering.
- Microsoft Learn, [GetSystemTimePreciseAsFileTime](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getsystemtimepreciseasfiletime): precise UTC wall timestamps; not a substitute for monotonic elapsed timers.
- Microsoft Learn, [System Time](https://learn.microsoft.com/en-us/windows/win32/sysinfo/system-time): system UTC clock can be corrected forward/back; don't subtract wall clock for durations.
- Microsoft Learn, [Stopwatch.Frequency (.NET 10)](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.stopwatch.frequency?view=net-10.0): timer ticks-per-second conversion and precision.
