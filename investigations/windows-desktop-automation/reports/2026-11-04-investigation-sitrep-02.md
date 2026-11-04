# Windows desktop automation — SITREP 02 / safe handoff

Date: 2026-11-04 (America/New_York). Coordinator: Workbridge desktop investigation.
Scope: first coordinated research wave after M0 setup. **No production provider change or live GUI/VM input.**

## Outcome at handoff

| Area | Evidence | Status |
| --- | --- | --- |
| Workbridge operational owner | 0.16.4-dev, PID 43508, instance `9aa9b65f-b34f-49a7-8b92-c7954bd4dc9a`, 36 slots, unchanged after protocol test | **GREEN** |
| Installed WinApp 0.7.1 | 10/10 read-only taskbar discovery/inspect cycles; combined median 3677 ms, approximate P95 5672 ms; 15/15 native CLI startup samples | **GREEN baseline; not an action benchmark** |
| Immediate WinApp optimization | Known exact PID/HWND can go directly to `desktop_inspect`, which revalidates identity internally; `--interactive` is an output filter, not a persistent REPL | **Recommended, not deployed** |
| Sbroenne v1.3.28 source | Exact Git commit `655b9fc92d03ad52a270067c6844ea1231c90559` verified; MIT license; release tag unsigned | **GREEN source pin** |
| Sbroenne `wincli` | Self-contained publish SDK 10.0.302 passed, 0 build warnings/errors; static 18-tool catalog and `guidance` retrieved; `service status` stopped | **GREEN build/static; daemon GUI route HOLD** |
| Sbroenne MCP stdio server | Self-contained publish SDK 10.0.302 passed; EXE/DLL/runtimeconfig hashes pinned in isolated harness | **GREEN build** |
| MCP protocol-only test | Workbridge job `wda_sbroenne_stdio_protocol_20261104_001`, exit0, 1.107s wall/640ms harness; exactly `ui_snapshot` exposed, 0 tool calls, child PID42064 close observed | **GREEN protocol only** |
| Process-hang synthetic fixture | Job Object smoke 1/1; hardened effect-before/after-hang prototype 1/1, Job members=2 and child alive before kill, synthetic `verified_success`/`verified_failure` | **GREEN synthetic only** |
| VMware guest readiness | Lab1 running but guest disconnected and queue blocked/no cleanup receipt; Lab2 connected, disarmed, queue clean but `responseVerified=false` | **MIXED; no guest input** |
| Candidate replacement | Per-function keep/wrap/pilot/defer matrix written; all four current Workbridge `desktop_*` tools retained | **DRAFT / no rollout** |

## Source-reviewed candidate decisions

1. **Prefer the direct MCP stdio server** as a controlled Sbroenne pilot. It avoids `wincli` hidden daemon auto-start, shared named-pipe stop and caller-ownership uncertainty. The server is not registered with production Workbridge.
2. Restrict future pilot registration to `--tools ui_snapshot` **only**. The `ui_read` tool can fall back to `CopyFromScreen` OCR, risking overlapped-window pixels. `ui_snapshot` source shows no explicit activation/input/OCR with an explicit HWND, but its UIA tree fetch can still hang and reveal sensitive values. The completed protocol test called **no UI tool**.
3. Microsoft's WinApp CLI 0.7.1 has no true interactive REPL/server mode. Avoid a custom persistent WinApp sidecar until a fair benchmark warrants it. The installed WinApp result remains a *different* measurement from the new candidate's MCP handshake.
4. Keep `eugman/FlaUI-MCP-Core` as the modal/pending-operation design reference; `trsdn` for legacy UIA/MSAA/events, `UIInspect` for process identity, CursorTouch for alternate desktop UX; do not adopt `desk-mcp` unattended because source review found false-success/batch-result defects. Source-review grades are not on-host comparative proof.
5. For custom-rendered/RIFT and black/minimized windows, use native Win32 geometry/state diagnostics and a carefully scoped WGC/DXGI+OCR fallback when UIA is unavailable. Minimized WGC capture and secure-desktop UAC are platform boundaries.

## Protocol-only test receipt — exact limits

- Frozen server: `temp/sbroenne-stdio-publish/Sbroenne.WindowsMcp.exe`; SHA256 `c74dfc9e46ee8e4db765561aa8c4b2eb5c7b7ce22b33b1300fffd3f17e47f0f9`.
- Managed DLL SHA256 `99d3a37d98452f9b1d2f0ee44664ebdd0a422fcdf9f56fc869cd6fa38b6a9900`.
- Harness: `prototypes/sbroenne-stdio-harness.mjs`, SHA256 `31ffeabf203676196bfe611b8d1eec22df685ac2f1a5d9ab9fcda8357cceb393`.
- Output: `protocol_passed`, reason `PROTOCOL_AND_ALLOWLIST_VERIFIED`, `toolNames=['ui_snapshot']`, `actualToolCalls=0`, `ownedChildExited=true`, stderr content discarded.
- **Not proven**: Windows Job Object membership/descendant extinction for this exact .NET MCP child, any UIA snapshot, target/process session matching, semantic app outcome, WinApp-vs-Sbroenne speed comparison, VMware interaction.
- Do not auto-repeat an unknown action; this trial was a no-action protocol probe.

## Guest boundary and OneDrive

- Reuse RR2 per-guest control and staging knowledge, but **do not let an independent Windows UIA writer borrow the existing RIFT-specific movement lease**. RR2 watchdog cleanup can attest RIFT STOP/release, not arbitrary UIA effects.
- Lab1 input remains **quarantined** (blocked queue, no valid cleanup receipt); do not clear, replay, restart guest or infer a credential fault.
- Lab2 can be considered for a *future read-only guest* pilot after identity/session verification. RIFT was foreground during the last check. No guest UIA worker is installed.
- OneDrive's paused state, backlog, Files On-Demand hydration, actual metered-network cost, power policy and guest clock are separate hypotheses. The root cause of recurring pauses remains **unknown**. A read-only triage report is saved; `addon_sync.py` can independently deliver addons after approval but is not a root-cause fix.

## Next practical approval gates

1. **Containment**: independently verify exact Windows Job/process-tree ownership and cleanup for the direct MCP server, including bounded COM/UIA hang behavior. An MCP direct-child close is not full descendant settlement.
2. **Disposable window hard stop**: existing `scripts/helpers/DesktopProbe` is titled, has a native counter journal, and WinForms `Timer` configured to close at 120s, but that UI-thread timer is not a hard cap; the current task manager uses unlimited execution time. Require a separate owned monotonic watchdog or hard Task Scheduler execution limit with verified teardown before launch.
3. **Ask Joey before possible foreground change**: a visible DesktopProbe may briefly take focus from active RIFT. Until approved, no GUI launch, clicks or focus.
4. **Fair read-only comparison**: do NOT compare sbroenne full window discovery on `Shell_TrayWnd` (source filters taskbars). Use the same newly launched titled DesktopProbe for WinApp vs Sbroenne, fresh PID/start/HWND/session, one confirmed snapshot each, no inputs, then 10 safety pilots and 30 paired trials. Redact raw control names/values and record before/after foreground + native counter.
5. **Only after evidence**: choose per-function keep/wrap/replace, add cross-provider input lease and independent outcome receipts, then staged WB-001 validation/rollback. No production change is preauthorized by this report.

## Durable artifacts

- `benchmarks/winapp-2026-11-04.md` and `benchmarks/winapp-vs-wincli-comparison-plan.md`
- `benchmarks/sbroenne-build-2026-11-04.md`, `benchmarks/sbroenne-cli-tools-2026-11-04.md`, `benchmarks/sbroenne-stdio-server-build-2026-11-04.md`, `benchmarks/sbroenne-stdio-protocol-2026-11-04.md`
- `prototypes/desktop-job-lifetime/`, `prototypes/sbroenne-stdio-harness.mjs`, `prototypes/sbroenne-stdio-harness.md`, `prototypes/provider-interface-design.md`, `prototypes/desktopprobe-comparison-runbook.md`
- `reports/guest-uia-boundary-2026-11-04.md`, `reports/onedrive-vm-readonly-triage-2026-11-04.md`, `reports/non-uia-fallback-2026-11-04.md`, `reports/other-desktop-backends-2026-11-04.md`, `reports/function-provider-decision-matrix-draft.md`

All committed investigation artifacts are source/research/prototype work only. Unrelated user change `scripts/freebuff-conpty-probe.py` is preserved and must never be included in an investigation commit.
