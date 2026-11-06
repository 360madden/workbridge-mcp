# M3-P11 Sbroenne V5 exact-target snapshot adapter — OFFLINE source/compile receipt

Date: 2026-11-05 (America/New_York; Workbridge receipts UTC Nov 6).
Owner: Sbroenne provider research lane. Scope: **investigation-only**, new prototype files; no production provider changes.

## Outcome

**GREEN — source-only / offline artifact.** Independent FlaUI and WinApp reviewers gave GO for the **default-disabled** offline build/syntax/unit checks at the exact frozen hashes below. All four bounded Workbridge jobs finished with true OS exit code 0; the pure unit suite passed **6/6**. No V5 executable was launched, no MCP `tools/call`, no UI Automation tree query, no DesktopProbe GUI/TaskScheduler launch, no focus/input/screenshot, no VM/RIFT activity and no daemon or Workbridge service change.

**RED — live UIA still HOLD.** This is not a real desktop performance, safety or reliability benchmark, not an enabled V5 build, and not proof that future enabled code executes correctly. Native C# compile used the default `#if !ENABLE_SBROENNE_UI_SNAPSHOT` branch, which returns **OS64** before runtime setup. The enabled branch is intentionally not compiled, run or authorized here.

## Frozen source provenance

| Investigation-owned source | SHA256 |
| --- | --- |
| `prototypes/Sbroenne-RestrictedSnapshot-Host-V5.cs` | `12e52c7d7261bf3b22452cd323f98e38329d1b8ecc8944326f3454974fb2c2bc` |
| `prototypes/Sbroenne-SuspendedEnvNode-V5.cs` | `efdbd55ad284c6965b9296ebdb8a929847a0855ec392634ab61dddca922b3937` |
| `prototypes/sbroenne-v5-restricted-desktopprobe-snapshot.mjs` | `2208e47660727bc619406917fadcf89af3ebd29d724ec9d5d2f1b3ce3c4414cf` |
| `prototypes/Observe-DesktopProbeAndWatchdog-V5.ps1` | `50ed06c93a64dd79c2e6e2ba1a1fb614dade642e2328979dc700f4923bb0228b` |
| `prototypes/sbroenne-v5-restricted-desktopprobe-snapshot.test.mjs` | `b0b6e10fd636a8ea3a4c1afc1d37f046ec1210458567bb8dc6ef52fbc0992bfc` |
| Reused unchanged `prototypes/Sbroenne-PrivateJob-V2.cs` | `55a3571647fcb525c605d7f922e63885809ec01dffd9f3a88f00f882ff6f9b30` |

V5 source pins the previously verified sole vendor Sbroenne v1.3.28 single-file MCP server EXE SHA256 `ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128` and expected size 59,893,792 bytes. Independently verify any candidate DesktopProbe binary SHA and watchdog identity at actual future admission; never rely solely on manifest claims. Existing V4 restricted protocol-only source/build remains unchanged.

## Actual bounded receipts (Workbridge retained jobs)

| Gate | Exact job ID | OS exit | Output and outcome |
| --- | --- | --- | --- |
| C# Framework csc default-disabled WinExe build, no `/define` | `wda_m3p11_v5_default_disabled_compile_20261105_a01` | **0** | 0 output bytes, no compiler warnings/errors, output confined to ignored `temp/Sbroenne-RestrictedSnapshot-Host-V5-default-disabled.exe`. Artifact **not run**. |
| Node `--check` V5 sampler | `wda_m3p11_v5_sampler_syntax_20261105_a01` | **0** | 0 output bytes. |
| Node `--check` V5 test | `wda_m3p11_v5_tests_syntax_20261105_a01` | **0** | 0 output bytes. |
| Node `--test` source-only V5 test | `wda_m3p11_v5_pure_offline_unit_20261105_a01` | **0** | 662 output bytes; **6 passed / 0 failed**; ~245 ms test suite. |

C# compiler path was `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`; source files were host V5 + launcher V5 + unchanged PrivateJob V2, output inside ignored investigation `temp`. Node executable was `C:\Program Files\nodejs\node.exe`; all jobs were bounded noninteractive `terminal_run` with cwd `C:\work\workbridge-mcp`. No execution of the produced WinExe was permitted.

The pure tests checked fresh manifest/lease matching; invalid/stale/foreign fixtures and unknown foreground rejection; distinct immutable-lease multi-sample receipts; privacy-preserving structural tree hash; rejection of diff/incomplete/deep/wrong-type and duplicate-control snapshots; source-only single explicit `ui_snapshot`/HWND and no extra input tool dispatch. The tests operate on synthetic objects and source text, **not a real MCP server**.

## Future enabled-run design and gates

1. Separate explicit coordinator and user quiet-window authorization; reconcile any shared GUI-turn quarantine; fixture owner must hold the exclusive watchdog lease throughout a 110-second live fixture lifetime. At admission require fresh signed-off trusted fixture EXE hash independent of manifest, exact session/SID/process start/HWND/class/title/owner and pinned watchdog process PID/start/session/image hash, non-reparse manifest/evidence path.
2. Keep WinApp peer comparison separate by provider and sample ID; common age <=65 seconds, stable nonzero existing foreground, watchdog deadline >=30s admission and >=15s generic dispatch; V5 B-only conservative admission >=80s and pre-dispatch >=40s, which may exclude same-lifetime A-first trials. No focus calls.
3. Native independent observer before, before dispatch, and after verifies the same fixture and watchdog, top-level unowned WinForms window, identical foreground, original native journal (counter0, no input events), and no private data. Pre-action `entered` plus `dispatch-pending` journal records each `fsync` before the *one* potential direct MCP `ui_snapshot({windowHandle: freshHwnd,maxDepth:1,mode:'full',includeDiagnostics:false})` call.
4. Strict post-call target/owner lease/journal verification, provider exit and private Job empty proof, bounded retained audit and no raw UIA Name/Value/Text/error or screen captures. Preserve unknown-outcome status if any PID, lease, timeout, journal, terminal process or Job state is uncertain.
5. **Known timing hardening for a future enabled source revision:** re-validate watchdog lease/deadline immediately **after** `dispatch-pending` fsync and before dispatch; current source checks >=40 seconds **before** that fsync and could cross the threshold if sync is slow. This does **not** affect the disabled offline compile outcome. Future source changes require fresh exact-hash peer review.
6. This unit/compile milestone proves no direct desktop provider reliability, safety or speed. Actual GUI read-only functional pilot, enabled branch compiler pass, external-process escape assessment and A/B performance parity remain **NOT TESTED / HOLD**.

## Preservation / ownership

The five V5 source files and this benchmark are the only intended scoped commit targets. Preserve unrelated dirty `scripts/freebuff-conpty-probe.py` and other agents' investigation reports/prototypes. No live production files were edited. Pinned source remains reproducible from committed text; ignored temporary build executable is retained for audit and is not to be mistaken for a production binary.
