# Windows desktop automation investigation — SITREP 01

Date: Wednesday 2026-11-04 (America/New_York)
Coordinator: ChatGPT, for Joey
Scope: **investigation only**, while production Workbridge remains operational.
Evidence standard: read-only source reviews, bounded host observations and isolated synthetic tests; action acknowledgment is not an independently verified application outcome.

## Executive disposition

- **KEEP** Workbridge as MCP coordinator, shared job/agent authority and existing host tooling. Live instance at the time of this report: 0.16.4-dev, PID 43508, instance 9aa9b65f-b34f-49a7-8b92-c7954bd4dc9a, 36 command/worker slots.
- **EVALUATE** Microsoft WinApp CLI 0.7.1 as installed baseline and `sbroenne/mcp-windows` v1.3.28 as leading alternative semantic backend. Keep `eugman/FlaUI-MCP-Core` as modal/dialog engineering reference.
- **NO production deployment** and no competing unleased desktop input owner. Function-by-function replacement is permitted when faster/safer than custom engineering, but needs independent proof and WB-001 gate.
- Separate **host Windows**, **VMware host window**, **guest Windows session** and **RIFT DirectX rendering**. Host UIA is not evidence that guest input is working.

## M1 — Installed WinApp baseline

Microsoft WinApp CLI installed: 0.7.1 at `C:\Users\mrkoo\AppData\Local\Microsoft\WindowsApps\winapp.exe` (App Execution Alias). It supports status, inspect, search, property/value, screenshot/record, invoke, click, drag, hover, send-keys, set-value, focus, scrolling, wait, list-windows and get-focused operations. These verbs are **available**, not yet certified safe for production actions.

Workbridge currently exposes four guarded host GUI tools: `desktop_windows`, `desktop_inspect`, `desktop_capture_window`, `desktop_capture_vmware_host`. Current simple discovery uses two WinApp CLI subprocess startups (`--version` then list); inspect uses three (`--version`, list, inspect). Complete discovery+inspect starts five processes including two redundant version checks. Wrong PID/HWND was rejected; process start/session pinning should be strengthened.

Ten read-only cycles against the Explorer taskbar, each with fresh PID/HWND. No GUI focus, input, screenshots or game changes:

| Operation | Min ms | Median ms | Approx. P95 ms | Max ms | Mean ms | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `desktop_windows` | 1313 | 1544 | 3323 | 3687 | 1904 | 0/10 |
| `desktop_inspect` | 1665 | 1915 | 2980 | 3041 | 2216 | 0/10 |
| combined discovery → inspect | 3071 | 3677 | 5672 | 5702 | 4120 | 0/10 |

Interpretation: 3.7 s median for two read-only steps, **before** actions, independent postconditions or guest hops. N=10 is too small for a stable tail percentile; individual startup attribution remains pending. `winapp.exe` cannot be launched directly by Workbridge's file-only terminal executable resolver because this is an App Execution Alias; `cmd.exe /d /c winapp.exe ...` works. Investigate a direct installed binary/persistent backend only in an isolated pilot.

## M2 — sbroenne/mcp-windows source review

- .NET 10 MCP server plus `wincli` project with persistent process/daemon protocol, semantic snapshots and diff, process-start/HWND/runtime-ID-bound element refs, stale-ref rejection, modal behavior and bounded automation calls.
- Released v1.3.28 ZIP was found to contain MCP server, **not a packaged `wincli` executable**. A direct source build or private publish may be needed for apples-to-apples timing.
- Host `dotnet --list-sdks`: only SDK **10.0.302** in `C:\Program Files\dotnet\sdk`, while checkout `global.json` pins **10.0.401**. An isolated source clone at release v1.3.28 matched commit `655b9fc92d03ad52a270067c6844ea1231c90559`; self-contained `wincli.exe` published successfully on existing SDK 10.0.302 from a directory outside the pin (job `wda_sbroenne_dotnet_publish_v1328_20261104_m2p1`, 15.998 s, exit 0). Both `--help` and `--version` passed. Binary SHA256: `ecd1ad47a4e9d5e6bb4d55d53ed0119b42a3c1afd2e3a3e11f19afc4dbe46438`; embedded `1.0.0+655b9fc...` source version matches commit although release tag is v1.3.28. No daemon/UI operation/system SDK installation. Built artifact is **only in ignored temp**, not installed as a Workbridge provider.
- Dedicated UIA queue and configured connection/transaction timeout do **not** guarantee that a blocked COM call can be forcibly canceled. Its daemon appropriately treats lost acknowledgment as unknown instead of blindly retrying.
- Decision: **GO for isolated build/synthetic pilot**, **HOLD production**, **NO-GO to bypass Workbridge's global input lease**.

Sources: https://github.com/sbroenne/mcp-windows and https://learn.microsoft.com/en-us/dotnet/core/versions/selection

## M3 — FlaUI and optional specialist references

- `eugman/FlaUI-MCP-Core`: generation-safe snapshot references, `ModalAwareInvoker` that observes owned dialogs while an invoke remains blocked, pending tracker, guarded input and native WinForms test patterns. Its mutex only covers its own clients; not a Workbridge-wide input arbiter. Not yet established as distributable/fully tested production binary. **KEEP as reference**.
- `ChrisPulman/UIInspect.MCP`: exact process creation time/path/session checks, semantic sessions and multi-framework fixtures; useful security/identity design, but narrower control and no screenshot/OCR. **OPTIONAL semantic reference**.
- `trsdn/mcp-server-uiautomation`: LegacyIAccessible/MSAA, virtualized item realization and UIA event waits useful for legacy installer/list introspection; its STA `thread.Join()` has no timeout, so a hung provider may hang indefinitely. **OPTIONAL read-only diagnostic only after external containment**.

Sources: https://github.com/eugman/FlaUI-MCP-Core ; https://github.com/ChrisPulman/UIInspect.MCP ; https://github.com/trsdn/mcp-server-uiautomation

## M4 — Fresh VMware boundary check (16:17–16:21 ET)

| State | RIFT-Lab-1 | RIFT-Lab-2 |
| --- | --- | --- |
| VM observed running | yes, host VMX PID 44308 | yes, host VMX PID 20020 |
| Host controller responding | yes | yes |
| Authenticated guest connection | **no** | yes |
| Coordination / input queue | **waiting; blocked=1** | ready; blocked=0 |
| Canonical cleanup receipt | **missing** | present and matches supervisor epoch |
| RIFT process | unverified | PID 11572, foreground in guest |
| Guest armed / response proof | unavailable | disarmed, idle, keysDown=[], `responseVerified=false` |
| Live addon/reader freshness | unverified | unverified |

All four Workbridge RR2 managed scheduled tasks reported running, but that does **not** imply an authenticated guest connection. Lab-1 has holder=null, no cleanup receipt and is quarantined; **do not reset or replay queue**. Lab-2 may be a future test pilot after a separate risk gate and independent response verification. Existing RR2 `addon_sync.py` offers hash-verified PC/Lab1/Lab2 addon deployment that can reduce OneDrive dependence, without explaining OneDrive pause root cause.

Checks: read-only vmrun/task/controller status plus SQLite `mode=ro`/`PRAGMA query_only`; no VM input, service starts, focus, screenshots or queue writes. Example IDs: `gui-vmread-t1-lab1-noautostart-status-20261104-d1`, `gui-vmread-t1-lab2-noautostart-status-20261104-d1`, `gui-vmread-t0-readonly-queue-flags-20261104-d1`.

## Reliability finding

Workbridge **already contains** `scripts/Desktop-JobLifetime.cs` with Windows Job Object `KILL_ON_JOB_CLOSE` and active-descendant settlement checks, plus `test/desktop-job-lifetime.test.mjs` and `test/Desktop-JobLifetime-Smoke.cs`. Ordinary Workbridge command jobs already have related native Job Object control. Reuse this code for an **isolated desktop helper**, not a new process-control framework or a live production modification. An existing isolated Windows smoke test **PASSED** (job `reliability_joblifetime_20261104_001`, exit 0, 1/1 tests, suite 957.36 ms). It verified grandchild accounting and kill-on-close for a synthetic sleeping descendant. This **does not yet prove** containment of hung COM/UIA or independent action effects.

Required outcome classifications: `blocked`, `pending`, `verified_success`, `verified_failure`, `unknown_outcome`. Evidence should include immutable target identity (PID+start+session+HWND), lease generation, before-state, one bounded action, after-state, child-process settlement and ambiguous-outcome quarantine. A provider response or an acknowledged click is **not sufficient**.

Historical native regression: an action reported click success on minimized/offscreen coordinates while independent counter state did not change. Preserve this as a mandatory adversarial synthetic case. A timed-out UIA COM operation may have effected change after the caller gives up; never auto-retry an unknown mutation.

## Next milestones, sorted by priority

1. **P0 — CLI startup timing attribution** (in progress); the existing isolated containment smoke has **PASSED**. Next extend to synthetic hang/effect-then-hang with independent journal.
2. **P1 — isolated sbroenne source build/publish** from pinned v1.3.28, verify provenance/license/SDK compatibility, measure same deterministic synthetic fixture. No checkout under live `dist/` or `.local`.
3. **P1 — prove action outcomes** on disposable WinForms/WPF fixture: stale ref, modal, minimized/offscreen, effect-then-hang and before/after independently logged. Single cross-provider lease.
4. **P2 — guest UIA design** with a read-only guest-side probe first. RR2's current guest agent and input queue are **RIFT-specific**: its 100 ms watchdog can only attest RIFT STOP/release, so simply sharing that queue with an independent UIA writer is unsafe. A later input pilot requires UIA-aware cleanup protocol or explicitly separate maintenance handoff. Preserve Lab-1 quarantine; do not assume OneDrive root cause. Include screenshots/OCR/native fallback where semantic UIA absent.
5. **P3 — per-function keep/wrap/replace scoring**, then WB-001 separately for any release. Default recommendation is incremental replacement of GUI functions, not coordinator retirement.

## Caveats and preservation

This document records **first-wave investigation** rather than a finished comparative benchmark or replacement. Workbridge active owner and service unchanged. Unrelated user modification `scripts/freebuff-conpty-probe.py` must not be staged or touched. No unrequested RIFT/VM desktop input or Windows setting changes occurred.
