# Fair read-only comparison protocol: Microsoft WinApp CLI vs sbroenne wincli

> **PLAN ONLY — NOT RUN.** Prepared 2026-11-04 for the Windows Desktop Automation investigation. It authorizes no daemon startup, desktop interaction, process termination, installation, or production Workbridge changes. Any execution requires a separately approved gate and a private, fully owned test process lifecycle.

## Goal and comparison boundaries

Determine whether the candidate `sbroenne/mcp-windows` CLI offers materially lower latency and at least equivalent correctness/observability for **read-only** Windows desktop discovery and UI Automation inspection. Distinguish CLI process startup, provider/session bootstrap, persistent daemon cost, request processing, Workbridge transport overhead and independent after-state. No generic input, screenshot, scripted focus, window restore, RIFT or VMware guest automation is part of the **measured phase**. The disposable WinForms fixture launch is a separate, potentially foreground-changing maintenance stage requiring specific approval.

| Item | Evidence/selection |
|---|---|
| Existing provider | Microsoft WinApp CLI `0.7.1`, as installed and pinned in `scripts/desktop-ui.mjs`. |
| Candidate | `sbroenne/mcp-windows` annotated release tag `v1.3.28`, source SHA `655b9fc92d03ad52a270067c6844ea1231c90559`, isolated locally built `wincli.exe` SHA-256 `ecd1ad47a4e9d5e6bb4d55d53ed0119b42a3c1afd2e3a3e11f19afc4dbe46438`. Build and informative-help evidence: `benchmarks/sbroenne-build-2026-11-04.md`. |
| Version-label caveat | Candidate binary prints assembly version `1.0.0+655b9...`, not `1.3.28`; pinned source commit/tag is the correct identity. |
| Existing benchmark | `benchmarks/winapp-2026-11-04.md` contains 10 Workbridge end-to-end cycles and 15 direct informational/read-only CLI operation timings. These are seed measurements only, **not** head-to-head candidate data. |
| Live owner | Preserve existing Workbridge `0.16.4-dev` owner, process and instance. Do not modify `src/`, `dist/`, `.local/`, service registrations, PATH, registry, Startup tasks or existing app state. |

**Critical candidate side effect:** tagged `wincli` dispatches normal `window`/`ui` commands through `DaemonClient.EnsureRunningAsync`, which can start a hidden CLI daemon. Informational `--help`, `--version`, `tools`, `commands` and `guidance` return before that path. Thus **a read-only UI query is still a process-start mutation** requiring its own explicit approval and verified ownership/teardown design. An isolated build in `temp/` does not by itself isolate the daemon or its IPC endpoint.

## Target and independent identity oracle

**Choose the existing disposable, titled WinForms fixture** `scripts/helpers/DesktopProbe/Program.cs` / `DesktopProbe.csproj`, process `DesktopProbe`, window title `Workbridge GUI-004 Native Input Probe` (source `Program.cs:10,68-78`), in the interactive Windows session. Pinned sbroenne `WindowEnumerator.ShouldSkipWindow` excludes `Shell_TrayWnd`, secondary taskbars and untitled windows, so the Explorer taskbar is **NOT** a valid cross-provider discovery target. The older WinApp-only taskbar baseline remains valid as historical WinApp evidence, not a head-to-head candidate result. No stored PID or HWND is reusable; the earlier Explorer sample `13984` / `65948` is historical only.

**Staged fixture gate:** a separately authorized, limited on-demand launch of the existing published `DesktopProbe.exe` in the **correct interactive Windows session** must occur before timing. The existing `scripts/Manage-HelperTask.ps1` procedure is documented in `docs/interactive-desktop-vm-roadmap.md:77-93`; starting this WinForms UI can naturally take foreground. Warn Joey and arrange a quiet maintenance window. Record the fixture `shown` event and let focus settle before any measured requests; do **not** script foreground changes during measurement. Fixture auto-closes after **120 seconds** (`Program.cs:136-150`). Plan multiple bounded five-block A/B/B/A batches with a fresh, approved owned fixture each batch, rather than assuming 120 primary calls fit one lifetime. Never relaunch silently after expiry.

Before each trial block (and again before an exact-HWND inspect), a separate trusted, read-only Windows observer records:

1. Current **owned** `DesktopProbe.exe` process: numeric PID, **process creation time UTC**, verified executable path/hash and Windows session ID. Match the corresponding unique on-demand helper task/launch receipt.
2. Exact top-level titled WinForms HWND from the source's native `shown` journal entry and independent `GetWindowThreadProcessId`; window title `Workbridge GUI-004 Native Input Probe`, class from live observation (do not assume class string), owner HWND if any, visible and nonminimized flags.
3. `GetWindowRect` bounds, monitor intersection, monitor layout and per-monitor DPI; reject zero/tiny/offscreen windows and ambiguous multiple matches.
4. Current `GetForegroundWindow` PID/HWND and user session lock/secure-desktop status **after staged fixture launch settles**; no focus/window-state changes are permitted **during measured read-only requests**.

The oracle is independent of either candidate's UI tree output. After each operation, re-read the same facts and require unchanged PID/HWND/process start/session/class/bounds and no provider-attributable foreground change. Also independently read the fixture's **owned** `native-probe-PID.jsonl` (Program.cs:40-55) and require `shown` identity, counter **0**, and **no `incremented`/`reset` events** during the read-only campaign; after planned close, confirm the `closed` event. If the user intentionally changes desktop focus, discard that trial rather than attributing it to a provider. If the 120-second fixture timer closes normally, end the batch and relaunch only under the staged approval; never mark natural fixture expiry as provider failure. If PID/HWND identity changes or a provider cannot target/bind the exact window, mark the operation **not equivalent** and stop rather than silently selecting another window.

## Equivalent operations and output projection

| Stage | WinApp CLI 0.7.1 | sbroenne wincli v1.3.28 | Comparison rule |
|---|---|---|---|
| Static startup/version | `--version` | `--version` (already verified informational) | Parse-only startup baseline. Do **not** use this as a proxy for candidate first UI request, which may start a daemon. |
| Window discovery | `ui list-windows -a DesktopProbe --json` | Verified read-only `window find` equivalent filtered by exact titled disposable WinForms fixture | Filter to owned PID/start, exact title, class and HWND; report list/selector cost and ambiguity. Confirm syntax/schema before running. |
| UI root inspection | `ui inspect -w <fresh DesktopProbe HWND> --depth 1 --json` | Verified equivalent `ui snapshot` with exact titled fixture/window reference and depth restriction (if supported) | Same owned WinForms target and normalized root structural fields; include required `window find`/ref-resolution time in end-to-end workflow. |
| Optional property read | UIA `get-property`/`get-value` | Candidate equivalent only if verified | Query a stable structural property such as ControlType/BoundingRectangle, not names/document text. If unsupported, mark N/A. |
| Optional wait-for | `ui wait-for` | Candidate equivalent only if verified | Read-only wait for already-true stable property; equal timeout/polling policy. Report method and unsupported differences. |

Define normalized success as: command status success; valid parseable output/schema; exact owned DesktopProbe PID/HWND/process-start/session/title binding; expected WinForms root/control type; native journal counter remains 0 with no input events; independent unchanged after-state; no unexpected foreground/focus event or other visible mutation **during measurement**. A provider acknowledgment by itself does **not** prove correctness. The fixed disposable fixture title may be included as target identity; redact/omit unrelated window titles, automation IDs, application labels, filenames, user text, screenshot bytes and raw UIA trees from files/logs. Retain only safe structural counts, hashes of bounded normalized projections, timing/resource/error metadata and identities necessary for engineering diagnosis.

Use an **isolated comparator harness** whose child-process stdout is captured in memory and projected to allowlisted structural fields *before* Workbridge developer-command logging. Plain `terminal_run(wincli ui ...)` may persist sensitive raw UI output and may autostart a daemon, so it is not a substitute for this guard. No screenshots or videos.

## Startup, cold/warm and persistent-daemon separation

All elapsed durations should use one host-side monotonic high-resolution clock (e.g. .NET `Stopwatch`), with separate wall-clock UTC for audit. Workbridge connector request/response wall time is a **separate** metric.

| Mode | What is measured | What must not be conflated |
|---|---|---|
| Informational process startup | Fresh executable process → version/help reply/exit | Does not include UIA provider initialization or candidate daemon startup. |
| One-shot read-only CLI, first launch | Fresh CLI process → discovery/inspect output → exit; measure first-byte, parsed reply and process exit | First-launch is not guaranteed OS cold-cache. Do not clear OS cache or reboot for the benchmark. |
| Warm fresh-process CLI | New process for every read-only command after two warmups | Includes executable launch each time; no reuse of prior command process. |
| Persistent candidate daemon startup | Candidate CLI call → newly **owned** daemon creation, verified ready IPC endpoint, first fully valid UI read | First UI call includes daemon bootstrap; independent start/ready costs must be recorded. Never silently attach to an unidentified foreign daemon. |
| Persistent daemon steady state | Request sent to already ready, verified-owned daemon → valid reply, after two warmups | Report resident CPU/memory/handle footprint as ongoing cost. Do not compare only this small steady-state duration with the rival's fresh-process total. |
| Amortized session | Daemon startup + N × steady request time + controlled shutdown | Compare against N full one-shot commands with equivalent target guards and output. Show break-even request count explicitly. |
| Workbridge end to end | Caller request → MCP reply through a future isolated adapter | Separate Workbridge transport, wrapper and policy costs from native provider/daemon costs; do not deploy either candidate for this initial study. |

The existing Workbridge WinApp adapter performs `--version` + `list-windows` for `desktop_windows`, then `--version` + PID-filtered `list-windows` + `inspect` for `desktop_inspect`: five WinApp starts in a naïve repeated two-tool workflow. A known target can be passed directly to `desktop_inspect`, which independently re-lists and validates PID/HWND/process/title, saving the caller-side duplicate list without weakening that internal check. Compare **both** common end-to-end workflows and equal primitive provider operations; list redundant version checks separately but retain the pinned-version safety guarantee.

## Sequencing and statistics

1. **Static preflight:** verify source commit, binary SHA, installed version, exact read-only command/flag mappings and response schemas. Run `wincli tools --json`/`guidance` only under a separately approved informational gate if needed; verify these do not invoke `EnsureRunningAsync` in the pinned source. Confirm no existing candidate daemon or foreign IPC owner before any GUI query.
2. **Ownership gate:** approve a private daemon isolation/teardown method before `wincli window`/`ui` runs. If cannot prove a newly owned process tree, session and IPC endpoint, **STOP** with `daemon_ownership_unverified`; do not invoke a normal wincli UI command.
3. **Ten-run safety pilot:** five read-only, exact-DesktopProbe operations per provider in alternating order, with independent before/after native journal/foreground checks and explicit timeout/cancel behavior. Staged launch/focus settling is outside timing. Stop on any target drift, provider-attributable focus, native counter event, unexpected daemon or unverified descendant.
4. **Primary comparison:** if pilot passes, run **30 paired A/B/B/A blocks**, each block performing two equivalent read-only operations per provider (120 primary operations, 60 per provider). Randomize whether A is WinApp or wincli for each block, without overlapping calls; alternate block order to balance JIT/OS caches and background load. Divide into **six planned five-block fixture lifetimes** (or shorter if conservative), respecting the existing 120-second automatic close. Track fixture identity and batch index in every sample; do not merge cold bootstrap samples into steady-state statistics. Fixture launch/relaunch requires separate consent/ownership evidence and is excluded from provider request latency.
5. **Separate campaigns:** run first-launch, warm fresh-process and owned persistent-daemon modes separately; never interleave daemon cold start with warm calls in the same latency distribution. The daemon first request is counted in bootstrap, not quietly discarded.
6. **Report:** count successful/bad-identity/errors/timeouts per mode; median, p95, min, max, trimmed mean and raw bounded timing vectors; startup-to-ready, ready-to-first-response, request-to-valid-parse, result bytes, CPU time, peak working set, handles and child count. Record provider revision, session, monitor/DPI, executor wrapper, cold/warm definition and measurement timestamps. With 10/30 blocks, p95 is suggestive, not a tight statistical bound.
7. **After-state and shutdown:** verify unchanged fixture PID/HWND/process-start/foreground and native journal counter/no-input-event proof after every operation; confirm planned fixture `closed` event and owned task/process teardown per batch. After the campaign, verify all uniquely owned temporary provider processes terminated and no candidate daemon/IPC endpoint remains unless an explicit persistent-owner policy was approved.

Initial success threshold: **zero** wrong-target, unexpected focus/input, tree-uncertain or unexplained state-change events; **zero** foreign daemon takeover. A speed result is eligible for recommendation only after these correctness gates pass. Prefer a reproducible median/p95 improvement with comparable or lower error rate, not one anomalous fastest sample. Unsupported operations are N/A, never treated as speed wins.

## Process ownership, timeouts and cleanup

- Launch only a separately reviewed/approved isolated comparator harness in a new private investigation `temp` subdirectory. Separately stage the **existing** compiled `DesktopProbe.exe` through the documented on-demand interactive-session helper (no new fixture code) with a unique owned task/launch receipt and private journal directory. Its launch may focus the window; schedule this explicitly and capture a new baseline **after** it settles. Do not script focus during measured reads. Preserve the existing Workbridge process owner, `.local` runtime, tools and desktop input lock.
- Own each host process by an actual process handle, attach a private non-inherited Windows Job Object configured `KILL_ON_JOB_CLOSE` before any descendant is created, and verify Job membership/accounting and child process creation times. Do not assume a daemon that self-detaches or connects to a per-user singleton remains in the Job.
- Measure/cap startup, IPC readiness, each read-only request, daemon idle and final settlement independently. An expired or cancelled operation yields `unknown_outcome` until the process tree and post-state are re-observed. Never retry an uncertain operation blindly.
- Never terminate, unregister or `service stop` a daemon unless the harness can prove it created and exclusively owns that exact PID/process-start/IPC endpoint. Never kill a preexisting or foreign process. If ownership is ambiguous, stop and ask the coordinator.
- On cleanup, terminate only verified owned handles/Job, await host/daemon/descendant exits with bounded monotonic deadlines, confirm no remaining owned IPC or processes, and close/remove only the uniquely owned disposable helper task after checking PID/start/task identity. The `DesktopProbe` normally auto-closes within 120 seconds; verify `closed` journal and process exit instead of assuming it. Remove only exact validated private temp directories; if any settlement is unproved, **retain/quarantine** evidence and report manual recovery rather than recursively deleting it.
- Keep expected `Allow/Approve` prompts visible to Joey through the normal Workbridge tool gate; no automatic approval bypass.

## Stop triggers / no-go conditions

| Trigger | Required response |
|---|---|
| Unapproved daemon autostart, preexisting daemon or shared IPC endpoint | **STOP**; do not run UI query until explicit ownership design/approval. |
| Wrong/ambiguous fixture HWND, changed PID/process-start/session/class, minimized/offscreen target | **STOP** current trial. Normal 120-second auto-close ends that batch; re-launch only with fresh staged approval/identity and never count expiry as a provider error. |
| Foreground changed **during measured reads** or any provider focus/keyboard/mouse action observed | **STOP** benchmark; staged fixture launch may foreground before baseline, but providers must not change focus after settling. Save only redacted metadata and investigate. |
| Provider emits raw sensitive text to persistent logs or invokes screenshot/record/input | **STOP**; correct projection harness before resuming. |
| Timeout, cancellation, descendant not settled, unknown Job membership | **STOP**, quarantine private temp, report `unknown_outcome`; never auto-retry. |
| Existing Workbridge owner/health changes, file paths outside intended temp/report areas mutate | **STOP** and report to coordinator; no repair or service restart without separate authorization. |
| Third-party modal/UAC/consent or other protected system desktop appears | **STOP**; do not click or attempt to bypass. |

## Test readiness checklist — all conditions must be affirmatively met before any live comparison

- [ ] Coordinator explicitly approves the specific read-only UI query campaign and separate wincli daemon-autostart risk.
- [ ] Workbridge original owner PID/instance and ready state checked; existing unrelated worktree changes preserved.
- [ ] Candidate executable checksum and tag/commit verified against `sbroenne-build-2026-11-04.md`; WinApp version pinned `0.7.1`.
- [ ] Both providers' **actual** current command syntax and structured response semantics verified; unsupported operations documented N/A.
- [ ] Coordinator approves separate fixture launch/possible foreground change in a quiet maintenance window; existing `DesktopProbe` source/hash and unique on-demand task are pinned; no new fixture authored.
- [ ] Fresh exact **DesktopProbe** title-bearing WinForms PID/HWND/process-start/session, geometry/monitor/DPI/foreground and native `shown` event/counter=0 oracle ready.
- [ ] No preexisting candidate daemon/singleton is present, or a separately approved method explicitly isolates a new daemon/IPC name without touching the foreign one.
- [ ] Isolated read-only comparator harness audited for command allowlist, stdout redaction, no screenshot/input/focus, monotonic timing and bounded memory/output.
- [ ] Private Job Object/descendant ownership and teardown proven in a **separate disposable synthetic test**; candidate daemon inheritance/escape and IPC exclusivity independently verified.
- [ ] Timeouts, cancellation, `unknown_outcome` handling, quarantined-temp protocol and exclusive target handling tested without live GUI interaction.
- [ ] Workbridge tool approval prompts and observer/incident stop route agreed; no unattended retries after uncertainty.
- [ ] Pilot 10-run success criteria and 30 A/B/B/A block schedule approved; six bounded five-block fixture batches planned around 120-second per-instance auto-close; quiet interactive session available.
- [ ] Safe, non-destructive cleanup can confirm every owned host/daemon/descendant gone and leave live Workbridge unchanged.

## No-execution status

Nothing in this protocol has run as a head-to-head WinApp/wincli UI test or newly launched DesktopProbe instance. The candidate CLI's `--help` and `--version` **have** previously been run in an isolated build feasibility check, but any normal `wincli window`/`ui` action (even read-only) remains blocked pending the explicit daemon ownership gate. A DesktopProbe launch is a **separate approval/foreground-changing stage**; the source already exists and is not to be modified. The WinApp-only Explorer taskbar benchmark remains valid but is **not cross-provider comparable** because sbroenne intentionally filters taskbar windows. This plan intentionally keeps Workbridge operating day to day while candidate validation proceeds in an isolated lane.

References: `benchmarks/README.md`, `benchmarks/winapp-2026-11-04.md`, `benchmarks/sbroenne-build-2026-11-04.md`, `scripts/helpers/DesktopProbe/Program.cs`, `scripts/helpers/DesktopProbe/DesktopProbe.csproj`, `scripts/Manage-HelperTask.ps1`, `docs/interactive-desktop-vm-roadmap.md:77-93`, pinned sbroenne `Window/WindowEnumerator.cs` (`ShouldSkipWindow`), `scripts/desktop-ui.mjs`, `src/desktop-windows.ts`, `src/desktop-cli-runner.ts`, `scripts/Desktop-JobLifetime.cs`, and `investigations/windows-desktop-automation/prototypes/desktop-job-lifetime/README.md`.
