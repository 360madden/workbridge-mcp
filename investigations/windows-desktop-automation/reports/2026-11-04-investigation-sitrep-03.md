# Windows desktop automation — SITREP 03 / watchdog and quarantine checkpoint

Date: 2026-11-04 (America/New_York). Coordinator: Workbridge-MCP desktop reliability investigation.

**Research-only checkpoint. No production Workbridge provider replacement, host GUI launch, screen capture, keyboard/mouse action, RIFT focus change, VMware guest input, OneDrive operation, or protected-lock mutation.** Joey authorized a disposable DesktopProbe focus pilot only **after** independent hard-watchdog proof; the live shared desktop-turn quarantine prevents that pilot for now.

## Executive status

| Lane | Result | Evidence and constraint |
| --- | --- | --- |
| Operational Workbridge | GREEN | v0.16.4-dev, owner PID 43508, instance `9aa9b65f-b34f-49a7-8b92-c7954bd4dc9a`, 36 command slots, tunnel/control ready; no production edit. |
| Standalone DesktopProbe watchdog | GREEN, synthetic | New `prototypes/desktopprobe-watchdog/`, independent private kill-on-close Windows Job, 110-second monotonic deadline, exact process identity manifest and atomic shared-turn lock. Final build/smoke PASS; actual interactive Task Scheduler launch NOT proven. Commit `c2fe162`. |
| Watchdog safety review | GREEN, source | Independent audit verified CREATE_NEW guard before fixture spawn, exact held-handle release only after settled Job, quarantine on unknown, orphan-sidecar fail-close, no input. Commits `2d7b61f` and `358c17b`. |
| Microsoft WinApp 0.7.1 | GREEN, offline harness | Read-only exact-PID/HWND native oracle, structural-only output, entry/dispatch deadlines; offline 7/7 tests. Commits `31554e9`, `8db1a8d`. |
| Cross-provider A/B contract | GREEN, synthetic | Same watchdog/target/lease gate, independent before/after, typed fixture controls, age/deadline and unique per-trial IDs; paired 4/4 tests. Commit `251e003`. No live head-to-head latency data. |
| Sbroenne v1.3.28 direct MCP | GREEN build/protocol; v1 host RED, v2 synthetic GREEN | Pinned source/server; only `ui_snapshot` eligible; offline 5/5 tests and compiler PASS. Native Job expected host+Node+child but observed two additional `conhost.exe` members, both console and WinExe trials. Correctly reported `HOST:UNKNOWN`; Workbridge job exitCode 0 is insufficient. Commits `e99963d`, `f4b5fa8`. NO GUI/UIA snapshot executed. |
| November 2 RIFT shared GUI-turn | RED/QUARANTINED | Existing guard + matching `DESKTOP_TREE_UNSETTLED` sidecar, old screenshot result `unknown_outcome`, `automaticRetryAllowed:false`; no original capture receipt identified. Do not replay or release automatically. |
| Read-only quarantine classifier | GREEN, synthetic; cautious live | PowerShell 5.1 9/9 then 10/10 after PID0 OS sentinel handling; read-only lineage found two post-lease `conhost.exe` candidates created with the **current November 4 diagnostic**, strongly consistent with inspector sidecars, not November 2 survivors. This is not historical settlement proof. |
| Preferred eventual test path | DESIGN | One new on-demand, non-AtLogon Limited/Interactive Task Scheduler helper launching pinned watchdog/fixture; WinApp one read-only sample first; Sbroenne only after separately validated native Job settlement. Decision note `5306780`. |

## Hard safety boundaries

1. Preserve the **real** `.tools/desktop-evidence/desktop-input-turn.lock` and exact linked `desktop-turn-quarantine-8aed4916-1cf3-4100-bc1b-d56f2308585f.json` until separately reviewed/manual-authorized reconciliation. Read-only SHA evidence: lock `635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0`; sidecar `f1b37ebbeca97b4351d719786beb8c93dc678b76170f7e1a32b04bdecf0750a0`. Old request `rc18-physical-rift-screenshot-20261102-postinstall-b1` remains `unknown_outcome` forever absent legitimate proof. The original action must never be blindly replayed.
2. Workbridge existing capture admission currently checks **lock existence**, while the new watchdog checks **both lock and any orphan quarantine sidecar**. Guard-only archival cannot safely unblock both. Any future manual transition needs exact-byte evidence archival, real admission freeze/quiescence, sidecar-first while old guard still blocks, exact guard-last release, crash/partial-recovery rules, independent hash/post-state checks, and operator approval. This is a *proposal*, not authorization or implementation.
3. Native Job and semantic result must each be verified. `terminal_run:passed/exitCode:0` was observed even after Sbroenne host printed `HOST:UNKNOWN`. A successful benchmark requires explicit `HOST:SETTLED`, exact independently verified snapshot/fixture controls, and no intervening foreground or journal change. Do not compare protocol handshake timing with an actual UIA snapshot.
4. Host Windows UIA cannot see inside the VMware guest desktop by virtue of selecting a VMware frame. OneDrive guest troubleshooting and RIFT custom-rendered input/screenshot are separate controlled phases after host acceptance.

## Most useful next milestones

- **P1 — Clarify quarantined-Nov2 provenance:** finish exact read-only lineage report and source-reviewed manual recovery design. Do not archive/release while original outcome or process settlement cannot be accepted at the gate.
- **P2 — Sbroenne native host synthetic verified:** v2 external owner, suspended create→Job assignment→resume; clean synthetic exit0/Job0 and intentional forced failure exit3/Job0. Commit `fb479175`; real MCP/UIA and auxiliary-process coverage still NOT proven. Hold GUI until separately reviewed.
- **P3 — Host disposable pilot:** after a new explicit recovery decision and verified free desktop turn, register ONE on-demand Limited/Interactive helper with a fresh unique ID and no startup trigger; prove watchdog fixture launch/window manifest, clean native Job teardown and focus invariants. One WinApp read-only observation first, then Sbroenne if P2 passes.
- **P4 — Compare by per-function evidence:** only after correct A/B measured results, score whether Workbridge should keep, wrap or replace specific desktop capabilities; production rollout needs separate WB-001 review/rollback.

## Worktree and preservation

All investigation source, benchmarks and reports reside under `investigations/windows-desktop-automation/`. Existing user-modified `scripts/freebuff-conpty-probe.py` belongs to Joey and has not been staged or edited by this investigation. Shared production `src/`, deployed `dist/`, `.local/`, VMware guest configuration and RIFT windows have not been changed by these lanes. No inference of successful UIA automation from synthetic tests is permitted.

Prior checkpoints: `reports/2026-11-04-investigation-sitrep-01.md` and `reports/2026-11-04-investigation-sitrep-02.md`. Detailed evidence: `reports/desktopprobe-host-ops-preflight-2026-11-04.md`, `reports/gui-turn-reconcile-readonly-2026-11-04.md`, `benchmarks/desktopprobe-paired-runner-contract.md`, `benchmarks/sbroenne-stdio-sampler-offline-2026-11-04.md`.

## V2 supervisor addendum (same-day close)

After the initial SITREP 03 checkpoint, Sbroenne M3-P5 isolated v2 was independently source-reviewed and **synthetically validated**. Pinned evidence in `benchmarks/sbroenne-private-job-v2-synthetic-2026-11-04.md`, commit `fb47917558e5666cf8ba4d2fb3a957e46c249917`: clean fixture job `wda_sbroenne_v2_fixture_final_clean_20261104_m3p5` exited OS 0, emitted exact `HOST:SETTLED:0`, job empty, 265 ms synthetic; deliberate failure `wda_sbroenne_v2_fixture_forced_negative_20261104_m3p5` exited OS 3, emitted `HOST:BLOCKED:FORCED_NEGATIVE_TEST:JOB_EMPTY:1`. The supervisor stays **outside** its private kill-on-close Job and starts the owned Node child suspended, assigning it before resuming. v1 RED receipts remain valid history. This is **NOT** live MCP/UIA or a proven universal OS-auxiliary containment guarantee. Existing November 2 quarantined GUI turn and RIFT/VM host/guest boundaries remain unchanged; no live fixture launched.
