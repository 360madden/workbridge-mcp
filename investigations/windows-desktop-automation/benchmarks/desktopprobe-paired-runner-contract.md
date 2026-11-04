# DesktopProbe read-only paired benchmark: owner contract and run gates

**Status: SOURCE/TESTS ONLY (2026-11-04); NO GUI RUN.** Existing foreign GUI lease remains a blocker. Neither sampler starts DesktopProbe, takes focus, sends input, captures screenshots, touches VMware/RIFT, or modifies Workbridge service.

## One common disposable target

- Use the exact *newly launched* disposable WinForms DesktopProbe.exe from scripts/helpers/DesktopProbe. Never reuse historical PID/HWND.
- Sbroenne window enumeration skips the Shell_TrayWnd taskbar, so the same titled native DesktopProbe window must serve both providers.
- The **watchdog** owns an interactive Limited launch and private Windows Job, hard deadline 110 seconds, shared GUI turn lease, and private journal. The watchdog's own unchanging lock stamp must be checked before and after each sample. A missing/foreign/quarantined lock blocks all launches.
- Private target manifest: investigations/windows-desktop-automation/temp/desktopprobe-<runId>/evidence/target-manifest.json, completed by a fresh *native* observer only after the fixture's shown journal event. The watchdog pre-populates process fields but must **not guess** HWND/class/foreground.
- Required manifest fields: schemaVersion=1; runId, requestId, leaseId; watchdogPid and watchdogStartedAtUtcTicks **string**; pid, startedAtUtcTicks **string**, sessionId, ownerSid; hwnd and foregroundHwnd decimal **strings**; title='Workbridge GUI-004 Native Input Probe', className, exePath, exeSha256 and evidenceDir.

## Canonical shared-lease stamp

Path: .tools/desktop-evidence/desktop-input-turn.lock

Private immutable JSON format:

{ "schemaVersion":1, "kind":"workbridge.gui-turn", "producer":"desktopprobe-watchdog", "runId":"...", "requestId":"...", "leaseId":"...", "owner":{"pid":123,"processStartUtcTicks":"638...","sessionId":2}, "target":{"kind":"window","pid":null,"hwnd":null,"process":"DesktopProbe"}, "acquiredUtc":"..." }

Samplers do not acquire/rewrite/remove/release this lock. They require exact producer/runId/requestId/leaseId/watchdog PID+start/session identity matching the private target manifest. Only the watchdog may release it after Job settlement.

## Identical independent oracle before and after

Source: prototypes/Observe-DesktopProbeReadOnly.ps1. Arguments (all literal): -TargetPid -TargetHwnd -StartTicks -TargetSession -ExePath -ExeSha256 -OwnerSid -ClassName -ForegroundHwnd -EvidenceDir.

The script checks OS-native:

1. DesktopProbe PID and precise UTC process-start ticks, executable path/hash, owner token SID, expected session; observer itself must have same SID/session; observer station WinSta0 and target window thread desktop Default.
2. Exact top-level native HWND maps to target PID/class/fixed title, GA_ROOT equals HWND, GW_OWNER=0; visible, nonminimized, reasonable bounds and monitor intersection; unchanged expected foreground HWND. No SetForegroundWindow.
3. Exact native-probe-<PID>.jsonl in run-owned evidence directory: precisely starting then shown, counter zero, correct PID/session/HWND, no incremented/reset/error/closed. Recheck file SHA, size/timestamp and process identity.
4. Across one provider call, compare before/after rect, foreground HWND, journal SHA and identity. Error, unknown or changed state **blocks further trials**.

Observer projects boolean ownerSidVerified=true, not raw SID. Public benchmark receipts contain no raw arbitrary window title, UI text, screenshot, clipboard or full UIA tree.

## Provider operations and phase measurement

| Metric | Microsoft WinApp 0.7.1 | Sbroenne pinned v1.3.28 |
| --- | --- | --- |
| Process mode | Three one-shot CLI starts | One direct MCP stdio server, strictly owned child/Job |
| Version/session | --version pinned to 0.7.1 | Hash-pinned EXE/DLL/config; MCP connect |
| Fresh target resolution | ui list-windows -a PID --json | Same independent native oracle; exact HWND |
| Read-only tree | ui inspect -w HWND --depth 1 --json | ui_snapshot(windowHandle=decimal-string,maxDepth=1,mode=full,includeDiagnostics=false) |
| Allowed effect | UIA read only, no focus/input/capture | ONLY ui_snapshot tool exposed; one read-only tools/call, no screenshot/OCR/input |
| Normalized output | nodes, maxDepth, known 3 fixture controls, bytes, structural hash | Equivalent compact-tree structure; no names/values |
| Latency | version, discover, inspect, native before+after, total | connect, snapshot, close, native before+after, total |

The providers do **not** use identical UIA implementations. Report full cycle vs provider-only durations separately; a cached/persistent server time is not comparable to WinApp fresh-process total. Sbroenne's snapshot maxDepth may limit returned nodes without limiting internal traversal; record this as a limitation.

## Opt-in one-sample template — HOLD

Only after watchdog Job/lease, quiet desktop approval and native target manifest are verified, coordinator may submit one bounded Workbridge terminal_run:

- cwd: workbridge-mcp
- executable: node.exe
- literal args: investigations/windows-desktop-automation/prototypes/winapp-desktopprobe-sample.mjs, --target, <absolute evidence/target-manifest.json>, --sample-id, sample-001
- timeoutSeconds: 90; new unique Workbridge requestId, no shell

The sampler has per-WinApp child 7-second caps; observer PowerShell calls 8-second caps; the caller's outer Workbridge Job kills its private descendants on hard timeout. A fixture age above 65 seconds stops new samples to leave watchdog cleanup margin. Failure or uncertain process settlement is **not** an automatic retry. The script emits one sanitized JSON receipt and does not write benchmark output to the user desktop.

## Progression

| Gate | Size | Next step |
| --- | --- | --- |
| 🧪 First pilot | 1 read-only WinApp + (separate peer) 1 Sbroenne | Require same fixture identity and unchanged journal/focus; stop on first bad event |
| 🟡 Safety pilot | 10 total, five each | Sequential alternating order; per-provider first bootstrap separated |
| 🔵 Comparison | 30 A/B/B/A paired blocks, up to 120 requests | At least six separately consented, freshly owned fixture lifetimes; no overlap; stop early as watchdog budget dictates |

Report median, p95 (small-N uncertainty), min/max, error/timeout rates, startup/connect/inspect separately and CPU/child count where independently measured. Do not claim an improved provider from fastest samples without equal correctness and cleanup.

## Verified offline tests

- Observer PowerShell parser-only: job wb_observer_parser_20261104_a02, exit 0 (PARSE_OK).
- WinApp sampler Node syntax: wb_winapp_sample_check_20261104_a02, exit 0.
- WinApp six synthetic tests: wb_winapp_sample_test_20261104_a02, exit 0 (6/6).
- No DesktopProbe launch, WinApp inspection, Sbroenne UI snapshot, focus, input, screenshot or daemon command was performed in this preparation.

**Remaining HOLD:** watchdog/lease final source, a fresh native identity manifest, peer sampler signoff, and one authorized monitored GUI pilot. Nothing here authorizes production provider deployment.
