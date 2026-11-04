# Sbroenne direct-MCP DesktopProbe sampler — offline M3 milestone (2026-11-04)

Status: **OFFLINE VERIFIED; GUI/UIA HOLD — private Job containment RED**. This is an investigation prototype, not a Workbridge production backend. No desktop focus, mouse/keyboard, VMware/RIFT input, GUI fixture launch, or MCP UI call was performed by this lane.

## Pinned provider and scope

- Upstream: `sbroenne/mcp-windows` v1.3.28, verified source commit `655b9fc92d03ad52a270067c6844ea1231c90559`, local SDK 10.0.302 isolated publish.
- Managed stdio server: ignored `temp/sbroenne-stdio-publish/Sbroenne.WindowsMcp.exe`, SHA256 `c74dfc9e46ee8e4db765561aa8c4b2eb5c7b7ce22b33b1300fffd3f17e47f0f9`.
- Actual implementation DLL SHA256 `99d3a37d98452f9b1d2f0ee44664ebdd0a422fcdf9f56fc869cd6fa38b6a9900`; runtimeconfig SHA256 `6df5b8a97420042ba676b33842afa9a19f9a4fbc2ab2c23fe5c80cec8c065e39`. Binary metadata version `1.0.0+655b9fc...` is not the release tag.
- `prototypes/sbroenne-desktopprobe-sample.mjs` runs direct MCP stdio with **only `--tools ui_snapshot`**; no hidden `wincli` daemon, `ui_read` OCR fallback, screenshot, input, focus request or generic tool invocation. MCP argument template: `{windowHandle:<fresh-decimal-HWND>,maxDepth:1,mode:"full",includeDiagnostics:false}` from independently verified disposable DesktopProbe identity only.
- Sampler requires exact watchdog shared GUI-turn lease, non-reparse bounded manifest in private `temp/desktopprobe-<runId>/evidence`, signed-in owner SID/session, PID plus UTC process creation ticks, HWND, WinSta0/Default desktop, top-level/ownerless window, exe SHA256, same probe event journal and unchanged foreground. The native `Observe-DesktopProbeReadOnly.ps1` runs before/after and once immediately before dispatch.
- Common paired admission: fixture process age at most **65 seconds**, watchdog deadline at least **30 seconds on entry**, at least **15 seconds immediately before dispatch**, and nonzero foreground HWND unchanged; fixture itself need not be foreground. The third observer's cost is isolated in `latencyMs.preDispatch`, so end-to-end and provider-only timings must be reported separately.
- Immutable watchdog `runId/requestId/leaseId` are checked for each trial. Distinct validated `sampleId` creates `sbroenne-<sampleId>.jsonl` using exclusive `wx`; reused sample ID is rejected, allowing multiple read-only trials under a single still-valid fixture lease.
- MCP snapshot must be full/not incomplete, structurally bounded, and contain **exactly one** `IncrementButton:Button`, `ResetButton:Button`, `CounterDisplay:Text`. Only structural element types, depth, node count, structural hash, payload byte count, selected verification flags and timings enter the private receipt. Raw UIA names, values and text are never copied to Workbridge. This is a future acceptance policy, not an observed UIA pass.
- `prototypes/Sbroenne-Provider-Host.cs` and isolated `prototypes/Sbroenne-JobLifetime.cs` own a private non-inheritable kill-on-close Job; neither production `scripts/Desktop-JobLifetime.cs` nor live Workbridge code was changed. Native host exact-pins Node path/hash, sampler path/hash; bounded stdout reader accepts only `RESULT:(success|blocked|unknown):CODE:(none|sha256)`. It must prove exact descendants settled before publishing a result.

## Bounded offline receipts

| Gate | Workbridge Job ID | Outcome |
|---|---|---|
| Node offline unit tests, five cases (lease, identity/age, multi-sample replay, PII-free shape, strict controls/error) | `wda_sbroenne_sampler_offline_tests_parity_v3_20261104_m3p3` | **5/5 PASS, exit 0** |
| Binary and managed DLL pin verification, no server launch | `wda_sbroenne_sampler_static_pins_parity_v3_20261104_m3p3` | **PASS, exit 0**, 4 ms |
| Native host .NET Framework compiler, isolated ignored output | `wda_sbroenne_native_host_compile_hardened_20261104_m3p3` | **PASS, exit 0**, no warnings |
| Final one synthetic-only private Job member forensic | `wda_sbroenne_synthetic_final_job_member_diagnostic_20261104_m3p3` | **RED: HOST:UNKNOWN:JOB_CHILD_COUNT_NOT_THREE** |

The final synthetic process list was:
- `28380 Sbroenne-Provider-Host`
- `63684 node` (synthetic sampler)
- `71868 node` (synthetic child)
- `31568 conhost` and `71776 conhost` (unexpected extra Job members).

`HOST:READY_ACTIVE:5` then `HOST:UNKNOWN:JOB_CHILD_COUNT_NOT_THREE:ATTACHED:1` is correct fail-closed behavior under the present exact-three-member contract. **The outer Workbridge job nevertheless reported `passed/exitCode:0`**, therefore Workbridge's exit code alone is not proof of containment or test success. Explicit `HOST:SETTLED` plus independently reconciled exact Job membership/settlement is mandatory; no such success was obtained. Earlier synthetic trials showed 4–5 transient members/accounting races; do not reclassify as pass.

## Decision and next gate

**HOLD all GUI, UIA and MCP snapshot execution.** An existing foreign/quarantined RIFT GUI-turn lock also independently forbids fixture launch. Do not stop or remove that lock, launch daemon, edit services, modify PATH or permit desktop input.

The immediate next step was one separately approved synthetic-only `/target:winexe` hypothesis, documented below; it did not pass. Further GUI/UIA pilot admission requires a new independently reviewed process-settlement design, shared-lock clearance, watchdog readiness, and explicit coordinator go-ahead. Do not treat an aborted synthetic attempt as a provider speed or UI reliability measurement.

## One additional isolated Windows-subsystem hypothesis (M3-P4)

The coordinator approved a single further **synthetic-only** test compiling the same reviewed native host source as Windows-subsystem `/target:winexe`, into ignored `temp/Sbroenne-Provider-Host-WinExe.exe`, with all strict Job admission and settlement conditions unchanged. `wda_sbroenne_winexe_synthetic_compile_20261104_m3p4` passed with no compiler diagnostics. `wda_sbroenne_winexe_synthetic_membership_20261104_m3p4` produced: `HOST:READY_ACTIVE:4`, PID-list five members: WinExe host `34896`, Node runner `49164`, Node synthetic descendant `51724`, and **two conhost processes `8532` and `20588`**. `HOST:UNKNOWN:JOB_CHILD_COUNT_NOT_THREE:ATTACHED:1` again; Workbridge reported misleading `passed/exitCode:0`. Thus **merely changing host subsystem does not eliminate extra console hosts**; exact-count no-go stands. No GUI launch, MCP server start, UIA query or desktop input occurred. Stop further synthetic Job iteration within this milestone; next design requires a separately reviewed process-settlement strategy and authoritative outcome classification.

## Post-review canonical-target hardening and final offline recheck

Watchdog owner confirmed immutable target exe path exactly `temp/desktopprobe-<runId>/publish/DesktopProbe.exe` and target manifest `jobActiveAfterSpawn===2`; Sbroenne now rejects other repo-local DesktopProbe-named binaries and any other Job count. Independent per-sample IDs remain separate from the watchdog lease request ID; unchanged nonzero foreground and common 65s/30s/15s age/deadline gates match WinApp peer. Latest pinned sampler source SHA256 `b49a70771b45f7504c8df06e627af3cf661d35712c011f39cdcccb2f7b1c6fd4`; native host source repinned SHA256 `90cf725679cf7d80d91bcf0524987d506a62d83e9c264f5cd7fca1619f13be70` (not a claim of native Job success).

Final no-GUI receipts: `wda_sbroenne_sampler_canonical_final_tests_20261104_m3p4` **5/5 PASS**, `wda_sbroenne_shared_contract_final_tests_20261104_m3p4` **4/4 PASS** (source-only cross-provider parity), `wda_sbroenne_static_hashes_final_20261104_m3p4` **PASS** (EXE/DLL pin), `wda_sbroenne_recompile_host_canonical_20261104_m3p4` **PASS** (zero warnings). Native Job remains **RED** notwithstanding these source/unit successes.

Paths shown are relative to `C:\work\workbridge-mcp\investigations\windows-desktop-automation`. Ignored publish/host binaries stay staged for audit; only owned prototype source/tests and this benchmark report may be committed.
