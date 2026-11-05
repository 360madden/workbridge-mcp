# Windows desktop automation investigation — SITREP 04

**Thursday, 2026-11-05 (America/New_York).** Coordinator: Workbridge-MCP research lane. **Investigation only.** No new production backend, Windows service, desktop input, RIFT game action, VMware guest action, or live desktop lock mutation was performed by this investigation team. Other concurrently authorized RIFT workflows are separate and not implied by this statement.

## Executive outcome

- **Workbridge remains in daily operation**: latest coordinator read-only health showed 0.16.4-dev, PID 58580, instance `be5f373a-8c98-4877-b5dd-dbea9e5728d5`, ready/controlPlane OK and 36/36 available slots at that instant. Job inventory scanning was bounded/incomplete; no whole-history claim.
- **November 2 historical desktop quarantine has already been archived** by a separate user-authorized Nov 5 recovery; old screenshot stays `unknown_outcome`, not replayed. A separate one-shot physical RIFT `/reloadui` later completed with independent postconditions. This investigation did not conduct those actions.
- **Sbroenne single-file direct MCP protocol proved bounded** under a private Windows Job: OS exit0, real `tools/list`, exactly one `ui_snapshot` advertised and **zero UIA tool calls**; Job member count settled to 0. **No comparable GUI/UIA performance test exists yet.**
- **Disposable Windows modal target now exists** and builds on .NET 10, enabling real future before/after dialog evidence without touching OneDrive or RIFT.
- **Native lock handoff** passed six standalone Windows NTFS synthetic scenarios with exact file identity and cleanup, but remains **a test harness, not a production recovery utility**. Source-level old Node release races remain unpatched.

## Evidence and measured status

| Research lane | Verified state | Scope/limitation |
| --- | --- | --- |
| WinApp 0.7.1 incumbent | Prior Nov 4 Explorer taskbar read-only 10/10, paired median 3,677 ms (small sample); new offline evidence oracle **9/9** Nov5 | Not an actual disposable GUI benchmark; no cross-provider parity |
| Sbroenne v1.3.28 v2 stdio | **OS0, private Job0**, server `ui_snapshot` catalog, no calls; one run 1,291 ms | Protocol/process startup only; no UIA latency |
| Sbroenne single-file v3 | SDK10.0.302 isolated build **one EXE** 59,893,792 bytes, SHA256 `ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128`; protocol **OS0/Job0** | No UI call. Extraction root existed with zero files; extraction confinement not established |
| Watchdog normal uncertainty | Fixed `requestId` and null `intentSha256` for `DESKTOP_TREE_UNSETTLED`, .NET10 compile; actual archive script read-only synthetic parser **1/1** | Different tamper/delete-failure sidecars intentionally not releasable through this parser |
| Crash-without-sidecar recovery | Logical simulator **10/10**; private native NTFS harness **6/6**, OS0, six fixtures cleaned in 1.23 s | Not a deployed archiver; admission-only orphan and full producer quiescence still HOLD |
| Modal dialog | Owned WinForms modal fixture .NET10 compile **0 warnings/0 errors**, native GW_OWNER/WinEvent timeline | Never launched; no actual UIA wait or Invoke tested |
| VMware/guest | Source/deployed producer matrix; filtered 409-process / 238-task read-only census | No Lab1/Lab2 guest session or OneDrive readiness proven |

## Lessons and engineering decisions

1. **Keep Workbridge** as the MCP coordinator/scheduler and preserve its existing desktop functions. Evaluate alternate providers per exact function/target and measured evidence. It does not need to own every Windows GUI operation.
2. **WinApp first for existing host read-only UIA**, with fresh PID/HWND/start/session and independent native after-state. **Sbroenne next** for candidate modal/wait capabilities only after a bounded real `ui_snapshot` sample under the same exact-target contract. The 1.29-second and v3 protocol timings are **not** evidence that Sbroenne beats WinApp.
3. **eugman/FlaUI-MCP-Core** pinned Oct29 commit `f372899...` brings a useful native owner-disabled + new-owned-window modal detector, 50ms polls / 2s window and 300ms late-watch, and PID/start-bound pending status. Prefer porting small algorithms rather than importing its entire .NET8/FlaUI5 MCP dependency graph. Its CI build does not establish modal integration success.
4. **VMware Workstation host chrome is not the guest Windows desktop**. Workbridge host UIA cannot directly inspect a OneDrive dialog inside a guest. RIFT HUD/DirectX renderer may need dedicated visual/game telemetry rather than UIA.
5. **Before/after evidence is mandatory**: a tool returns `passed` or dispatches input without proving app state; classify PASS, FAIL, UNKNOWN separately. No retry of an unknown mutation.

## Priority reliability gaps — not yet production fixes

- **Pathname release TOCTOU:** deployed Node `desktop-turn-admission.mjs` and several GUI guard scripts perform identity checks followed by `unlink(path)`; a competing same-user replacer could theoretically be deleted during a narrow gap. Source-level P2-likelihood/high-consequence finding, **not a reproduced production incident**. Synthetic N06 demonstrates a deterministic interleaving, not a two-process exploit.
- **Crash orphan:** watchdog can leave admission+GUI lock with no sidecar, or admission-only with no guard. Current archivers intentionally refuse those states. Six native tests validate a guard-covered admission handoff using pinned FileId and no-replace rename on **private NTFS fixtures**, not operator authority to recover a real lock.
- **Sbroenne environment truth:** MCP SDK default Windows allowlist (up to roughly 18 present keys) merges with explicit child env. The v3 host inherited its parent environment when starting Node. `DOTNET_BUNDLE_EXTRACT_BASE_DIR` was explicitly supplied to the server, but **four-variable-only isolation is false**, and zero extraction files does not prove a confined extraction destination. No sensitive env values were printed by these tests.
- **Foreground and concurrent RIFT:** live physical RIFT and VMware processes were observed; a new fixture may take focus. No quiet user window, fresh target-bound interactive admission, watchdog crash recovery and read-only after-state have yet been established together.

## Commit anchors

- `8deef110` Sbroenne v2 MCP protocol, `5b7cf30` independent review.
- `6ea9676` WinApp offline evidence oracle.
- `d07d096` logical orphan recovery; `f6ac386` native NTFS 6/6; `c09f7cc` red-team audit.
- `6583553` modal fixture; `aba2127` eugman modal-source pin/analysis.
- `5db8f90` Sbroenne single-file build; `e6e4047` v3 protocol; `86d97e0` child environment correction.
- `13d746b` deployed GUI producer guard source+census; `4fcdea7` held-handle remediation roadmap.
- `5be2bef` shared investigation README/ROADMAP coordinator checkpoint.

## Next controlled milestones

1. Finish source review of the isolated crash-orphan **read-only classifier/archiver** design, and of the native FileId-token release approach; build synthetic negative/race tests first. **Do not execute against live .tools.**
2. Resolve exact Sbroenne child env and bundle extraction provenance by source/isolated no-GUI verification; keep `ui_snapshot` disabled until approved.
3. Stage one **fresh owned disposable DesktopProbe read-only WinApp snapshot** only during a user-coordinated quiet interactive window, with a 110-second child-owning private Job and native target/poststate oracle. It may take Windows foreground on launch; announce before doing so.
4. If that passes, one direct Sbroenne `ui_snapshot` on the same disposable HWND, then a passive owned-modal observation. No RIFT/VM guest input.
5. Make a per-function keep/wrap/replace decision from actual median/p95, correctness, pending-modal, cleanup and maintenance evidence. Any deployment goes through separate WB-001 review/rollback.

**Integrity:** All listed coordinator/research experiments were confined to documentation, isolated prototypes, pinned builds, protocol-only jobs, and private synthetic fixtures. Source audit and operational time-of-check results are snapshots, not persistent locks or guarantees. Preserve unrelated user-owned dirty or untracked files and active other projects.
