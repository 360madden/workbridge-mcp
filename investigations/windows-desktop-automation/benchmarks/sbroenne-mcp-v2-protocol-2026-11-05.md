# M3-P6 Sbroenne MCP stdio under isolated v2 Job — protocol-only evidence

Date: **Thursday, November 5, 2026 (America/New_York)**. Status: **🟢 direct MCP protocol-only + private Job settlement verified; 🟡 target-bound UIA snapshot remains intentionally DISABLED and UNTESTED.** This is an investigation artifact, not a production provider or desktop benchmark.

## Outcome first

One coordinator-approved Workbridge `terminal_run` launched an isolated native supervisor, which created a SHA-pinned Node protocol client **suspended**, attached it to a fresh child-only kill-on-close Windows Job, verified assignment before `ResumeThread`, and connected to the separate Sbroenne MCP **stdio** server (not wincli/daemon). The Node script performed only `tools/list`, required exactly **one tool named `ui_snapshot`**, and never called that tool. Native output was fixed, bounded status fields only; no raw MCP descriptions, UI text, names, values, screenshot, stderr, keyboard or mouse data was published.

The supervisor held its Job handle while the pinned Node client and .NET MCP server finished, required complete PID/accounting agreement and **three stable Job-active0/empty-list samples**, then returned OS exit0. No GUI fixture, WinApp, task scheduler, RIFT/VM, UIA tool, focus or input operation was invoked by this lane.

### Saved execution receipt

- Workbridge request/job ID: `wda_sbroenne_mcp_v2_protocol_only_smoke_20261105_m3p6`.
- Exact executable: `C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\Sbroenne-Mcp-Provider-Host-V2.exe` (ignored research-only publish).
- Literal arguments: `protocol`, `-`, `mcp_v2_protocol_case_20261105`; cwd `C:\work\workbridge-mcp`, timeout **60 seconds**.
- Workbridge result `status=passed`, true OS **exitCode=0**, no output truncation; native Job receipt:

```text
HOST:ASSIGNED_SUSPENDED:2488:ACTIVE:1
HOST:READY_MEMBERS:4:RUNNER:2488:SERVER:66784
RESULT:success:PROTOCOL_ONLY:none
HOST:SETTLED:0:RUNNER:2488:SERVER:66784:DURATION_MS:1291
```

- The four-member READY snapshot includes exact Node runner/server PIDs plus **two additional members which the host source accepts only after verifying known Windows system-path `conhost.exe` images, matching session and recent creation**; that classification follows from enforced source gates, not an independently published process-list dump. All members were absent from the private Job at SETTLED. This does **not** establish whether any Windows console auxiliary was created outside the private Job before suspended assignment.
- The 1291 ms is **one isolated protocol process-lifecycle observation**, *not* a WinApp-versus-Sbroenne speed result, not a p95 sample and not UIA latency.

## Provenance and isolated implementation

| File | SHA256 |
|---|---|
| `prototypes/Sbroenne-SuspendedMcpNode-V2.cs` | `96982e1b64dea6560827da3df309f40810cc2d90dc84352283b6029b7f3d5ce2` |
| `prototypes/Sbroenne-Mcp-Provider-Host-V2.cs` | `7bde2dc9cb9215141aa05ea4826fd29954549e0ee437b5dd9de9f09b0805115e` |
| `prototypes/sbroenne-mcp-v2-protocol-only.mjs` | `caef6ab7dc8a961371a840c8730776f4cdb00b36b864dbc86c7cbb0aacd02078` |
| Reused unchanged `prototypes/Sbroenne-PrivateJob-V2.cs` | `55a3571647fcb525c605d7f922e63885809ec01dffd9f3a88f00f882ff6f9b30` |
| Ignored `temp/Sbroenne-Mcp-Provider-Host-V2.exe` | `3e49bae520a901b3d628dab2e71cd2978d4e3160b29e83b3ca3afbffd5cf0b1e` |

Provider upstream `sbroenne/mcp-windows` tag **v1.3.28**, source commit `655b9fc92d03ad52a270067c6844ea1231c90559`, isolated self-contained server previously built on installed SDK10.0.302. Pinned server artifacts:
- `Sbroenne.WindowsMcp.exe` SHA256 `c74dfc9e46ee8e4db765561aa8c4b2eb5c7b7ce22b33b1300fffd3f17e47f0f9`.
- Managed `Sbroenne.WindowsMcp.dll` SHA256 `99d3a37d98452f9b1d2f0ee44664ebdd0a422fcdf9f56fc869cd6fa38b6a9900`.
- `Sbroenne.WindowsMcp.runtimeconfig.json` SHA256 `6df5b8a97420042ba676b33842afa9a19f9a4fbc2ab2c23fe5c80cec8c065e39`.
- `C:\Program Files\nodejs\node.exe` SHA256 `119d6fa70e6ae1b15b90688ab6bcc8e3a2819acea021af196895cab1843645af`.

Host `Sbroenne-Mcp-Provider-Host-V2.cs` uses a strong **compile-time feature gate** `#if !ENABLE_SBROENNE_UI_SNAPSHOT`: the current build returns `HOST:BLOCKED:UI_SNAPSHOT_NOT_AUTHORIZED` for `snapshot` before creating any child process. Future enabled mode would pass an exact canonical watchdog manifest path and unique `sampleId` to the existing SHA-pinned `sbroenne-desktopprobe-sample.mjs`, whose checks bind watchdog runId/requestId/leaseId, PID/process start/HWND/session/SID, native observer and 65-second/30-second/15-second admission. **That future dispatch path was not activated, tested or authorized here**. Re-enable requires separate source revision/build review and a result classifier for `READONLY_SNAPSHOT_VERIFIED`; current host deliberately recognizes only `RESULT:success:PROTOCOL_ONLY:none`.

The native child launcher is an isolated mechanical fork of the M3-P5 proven STARTUPINFOEX helper, preserving restricted two-handle inheritance, CreateProcessW suspended, AssignProcessToJobObject before resume, host outside the private Job, bounded stdout and authoritative nonzero OS exit on unknown. The old M3-P5 synthetic v2 source and its `fb479175` verified history remain untouched.

## Focused checks and independent review

| Check | Workbridge job/result |
|---|---|
| Native v2 MCP host compile (original) | `wda_sbroenne_mcp_v2_host_compile_20261105_m3p6`, exit0 with one unreachable-code warning, subsequently addressed by stronger `#if` gate |
| Node protocol-only script syntax | `wda_sbroenne_mcp_v2_protocol_syntax_20261105_m3p6`, exit0 |
| Final `#if`-gated native recompilation | `wda_sbroenne_mcp_v2_no_gui_recompile_20261105_m3p6`, exit0 with **no warnings** |
| Single protocol-only runtime | `wda_sbroenne_mcp_v2_protocol_only_smoke_20261105_m3p6`, exit0, `PROTOCOL_ONLY` and `HOST:SETTLED:0` |

Independent source reviewer assessed the pinned direct stdio path, SHA pins, explicit one-tool allowlist, zero `tools/call` path, suspended child Job ownership, exact server process image/session, and sanitized output before coordinator approved the one sample. The shared WinApp/Sbroenne target contract from November 4 remains the applicable future benchmark admission rule.

Workbridge operational owner stayed **0.16.4-dev, PID 58580, instanceId `be5f373a-8c98-4877-b5dd-dbea9e5728d5`**, before and after this isolated run. No `.local` owner, `dist`, PATH, registry, service, startup task, shared GUI-turn lock, desktop app, RIFT or VMware mutation.

## Remaining safety and performance gates

1. **Snapshot mode is disabled.** Before any UIA tool call, independently prove fresh exact watchdog/lease/manifest identity, scheduled-fixture readiness, and no concurrent GUI-turn owner; review the required source/compile-time change and the explicit result-normalization path. No production API or tool registration is authorized.
2. **Full .NET publish dependency manifest** is not yet sealed: EXE/DLL/runtimeconfig pins do not hash every transitive artifact in the multi-file publish directory. Hash the complete dependency set or use a sealed self-contained single-file build before a higher-trust pilot.
3. **Exterior auxiliary process/console ancestry and crash/hung-provider teardown** require independent inspection. Job0 proves observed private Job emptied, not that a vendor could never spawn a process outside the Job.
4. **Performance comparisons remain pending** until equivalent disposable DesktopProbe read-only samples for both providers have the same target freshness, no-input observer, depth, typed control validation and separately accounted cold/warm/observer costs.
5. **Workbridge remains active.** Any integration is opt-in per desktop function after the existing WB-001 production validation and rollback process, not part of this research milestone.

**Decision:** Preserve this exact pinned, read-only **protocol-only** success as a prerequisite for the next approved target-specific DesktopProbe pilot. Do not reinterpret it as actual window inspection or a production replacement.
