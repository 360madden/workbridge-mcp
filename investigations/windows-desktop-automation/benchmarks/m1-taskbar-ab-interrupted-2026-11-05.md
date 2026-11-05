# M1 taskbar read-only A/B — interrupted, no paired results

**Date:** 2026-11-05 (America/New_York). **Verdict:** 🔴 ABORTED / UNKNOWN. **Completed A/B paired blocks: 0 of 10 maximum.** No p50/p95, speedup percentage, or provider regression conclusion is warranted.

## Approved boundary and source

- Coordinator approved at most 10 alternating A→B / B→A blocks, each with fresh exact Explorer `Shell_TrayWnd` PID/HWND/process, Workbridge `desktop_windows` and depth-one `desktop_inspect` only. No input, focus, screenshots, VM, RIFT or service changes.
- Read-only `scripts/desktop-ui.mjs` SHA-256 `29a34aba1780dedf4369cca17eb250c733187d5c6f98ee3dd5023eee13fff145`, lines 172–227, proves `desktop_inspect` internally runs `winapp --version`, `ui list-windows -a PID`, and `ui inspect -w HWND`. Thus A means **no extra caller-level list**, B means **extra caller-level `desktop_windows` + same inspect**; it is **not** a comparison with a true single WinApp CLI inspect, nor does it eliminate the internal version/list. Version pinned 0.7.1.
- Only redacted timing, target identifier and call-success metadata recorded; no taskbar UIA tree, other window titles, notifications or images saved in this note.

## Actual observed receipts before interruption

| Event | Verified result | Client wall time | Inclusion |
| --- | --- | ---: | --- |
| Standalone `desktop_windows` | WinApp CLI 0.7.1; 38 windows enumerated; exactly one Explorer `Shell_TrayWnd` PID `13824`, HWND `65884`, ownerHwnd 0 | **5,357 ms** | Preflight only; **not** paired |
| Standalone `desktop_inspect` | Depth1 read-only success; returned target PID/HWND match, one UIA tree window | **20,367 ms** | Unpaired warmup only; **not** paired |
| First intended paired A/B block | `functions.exec` returned **“aborted by user after 6.5s”**, without block receipt | **No valid per-leg timing** | Abort; count **0** |

After the interruption, a read of the session-side benchmark state `wda_m1_ab_pairs` returned **no stored array / 0 completed records**. The canceled script was configured to call a fresh `desktop_windows` first. Whether that inner MCP call was dispatched or settled before cancellation **cannot be established** from this response. No command job ID or process-tree settlement receipt exists for the canceled tool sequence. Treat the potentially in-flight WinApp child and caller as **UNKNOWN**, not verified terminated, pending independent owner/process reconciliation. No live observations were repeated.

## Narrow non-GUI health observations following interruption

- `workbridge_workspace_info` responded with workspace `C:\\work`, version **0.16.4-dev**; this establishes MCP responsiveness only, **not** the health of the canceled WinApp process or desktop target.
- Read-only directory listing of `workbridge-mcp/.tools/desktop-evidence` showed prior evidence files but no **currently listed** basename `desktop-input-turn.lock` or `desktop-turn-admission.lock`. This is non-atomic, not an owner identity/lock-free proof. Exact `workbridge_file_info` calls for those locks and a guessed sidecar name returned `INVALID_ARGUMENT`; do not interpret those failures as absence.
- `workbridge_command_list` reported no running jobs in its **incomplete first page** (`catalogTruncated:true`, 200 scanned); it cannot prove no background WinApp child or terminal jobs elsewhere. No terminal process-listing command was run.
- No further `desktop_windows`, `desktop_inspect`, focus, input, screenshot, Task Scheduler, service, or RIFT action followed the interruption.

## Resume gate

Do **not** infer latency improvements from two unpaired observations or reuse the possibly stale PID/HWND. Obtain a separate owner health/process/CLI-child settlement assessment and **new explicit coordinator approval** before any further live read-only A/B. Reconfirm exact target identity and idle/quiet foreground, perform fresh bounded blocks, preserve separate preflight/list/inspect timings, and abort on wrong or changed identity, foreground anomaly, service health change or repeated timeout. Production `scripts/desktop-ui.mjs` and deployed `dist` remain untouched.
