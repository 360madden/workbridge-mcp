---
handoff_id: workbridge-windows-desktop-automation-2026-11-05
owner: Joey
repo: C:/work/workbridge-mcp
investigation: investigations/windows-desktop-automation
time_basis: Thursday evening 2026-11-05 America/New_York / 2026-11-06 UTC
status: offline_milestones_verified_live_uia_comparison_holding
production_backend_replaced: false
requires_fresh_desktop_permission: true
---

# HANDOFF — Workbridge Windows Desktop Automation Investigation

**Read this first on resumption.** Workbridge remains Joey's day-to-day MCP coordinator; the investigation is deliberately isolated from production desktop, physical RIFT, and both VMware labs. Preserve existing behavior, local Git history, concurrent worktrees and the deployed service. This handoff covers the research launched November 4–5, the peer-reviewed M5 matrix and newer concurrent WGC P3.4/P3.5 source-only work.

## 1. Resume entry and authoritative reading order

1. `AGENTS.md`
2. `docs/autonomous-investigation-policy.md` and `docs/interactive-desktop-vm-roadmap.md` (**P3.5 audit near its top, below a newer 21:13 LuaPadModern entry; older October 0.16.3 release note is historical**)
3. `investigations/windows-desktop-automation/README.md`, `ROADMAP.md`, `DECISIONS.md`
4. `investigations/windows-desktop-automation/reports/2026-11-05-investigation-sitrep-06.md`
5. `investigations/windows-desktop-automation/reports/2026-11-06-m5-provisional-function-matrix.md` — 12 ranked functions and two disposable pilot specifications
6. `investigations/windows-desktop-automation/reports/2026-11-05-wgc-disposable-cross-workflow-observation.md` and the **separately owned** `prototypes/wgc-no-focus-pilot/README.md`
7. For a future production repair only, the WB-001 staged validation/rollback documentation and `reports/2026-11-06-edit-file-dollar-replacement-audit.md`.

Do not treat the presence of a source prototype, successful command ACK, host VMware frame, or completed synthetic unit test as a verified real desktop/application outcome.

## 2. Fresh read-only operational snapshot

- As checked Thursday evening Nov 5 ET: live Workbridge **0.16.4-dev**, PID **58580**, instance `be5f373a-8c98-4877-b5dd-dbea9e5728d5`; local MCP `127.0.0.1:63458`, tunnel ready, control plane OK. **36/36 command slots free**, zero in-progress at that instant. The 20,000-entry retained-job scan was **incomplete**; these figures are a point-in-time snapshot.
- Git branch `main`; initial handoff read HEAD **`b8b8862fe7e9fc3990ffa181b409528a9ac2b2bd`**. A later check found **`4dec5cca504b137f6c28d33269ef7998299eba84`** from another LuaPadModern source-only helper milestone. Both are historical snapshots; re-query HEAD before committing.
- **Protect unrelated worktree changes:** `M scripts/freebuff-conpty-probe.py` remained modified at the newest check. At the first handoff inspection, `scripts/physical-rift-luapad-open.mjs` and `test/physical-rift-luapad-open.test.mjs` were untracked; a concurrent LuaPadModern workflow subsequently committed them as `4dec5cca` (4/4 synthetic, live `/lp` deliberately NOT SENT because the editor was already open). Do not edit, stage, stash, clean or reset concurrent files. WGC sessions also commit independently.
- Workbridge's 36 command slots are **not** 36 desktop input owners. Maintain one exclusive foreground/desktop lease per Windows interactive session. Do not start a second Workbridge service against `.local`.

## 3. Stable design decisions

| Surface | Current position | Evidence limit |
| --- | --- | --- |
| Workbridge MCP scheduler and incumbent four desktop tools | **KEEP operational**; optional versioned, individually replaceable backends only | No wholesale migration authorized |
| Microsoft WinApp CLI **0.7.1** | **KEEP baseline**, first controlled real UIA read-only sample | 10-cycle historical host taskbar list+inspect median **3,677 ms**; p95 approx **5,672 ms**, taskbar only |
| `sbroenne/mcp-windows` **v1.3.28** | **PILOT** independently owned, exact-HWND **`ui_snapshot` ONLY** | Pinned single-file protocol-only handshake OS0/Job0 **1,328 ms**; zero `tools/call`, no real UIA. `ui_find`, `ui_read`, `ui_wait` explicitly deferred from first trial |
| `eugman/FlaUI-MCP-Core` | **REFERENCE** for owner-modal/pending tracker and drag recovery | Source observations; no live superiority proof |
| Windows Graphics Capture (WGC) | Separate, evolving **disposable-window** research; **not** a general RIFT/VM capture replacement | One historical partial GUI attempt; later P3.4/P3.5 are source/offline only |
| VMware Workstation vs Windows guests | Workbridge WinApp sees **host chrome/frame**; separate guest-side inspection is needed for OneDrive | Host UIA cannot observe the semantic guest OneDrive UI |
| Physical / guest RIFT | **KEEP** RR2/RRE/addon/guest-specific telemetry and controlled input | Do not replace game-rendered HUD control with generic UIA/coordinates without evidence |
| General drag, clipboard, File Save/Overwrite, secure desktop | **DEFER** until separate disposable and target-specific proof | Do not auto-dismiss or replay a real app prompt |

## 4. Verified milestones, with deliberately narrow claims

| Milestone | Recorded outcome | Commit / evidence |
| --- | --- | --- |
| D1 fail-closed before/after action-outcome reducer | **22/22** deterministic offline Node cases, OS exit0, zero failed/skipped, exact retained job `wda_outcome_reconciler_private_22cases_20261106_e01`; cannot infer live action success | `159dd1f`; `prototypes/outcome-reconciler/README.md` |
| M3-P12 WinApp/Sbroenne strict typed-control parity reducer | **18/18** pure offline, OS exit0, exact retained job `wda_m3p12_parity_pure_offline_unit_20261105_a01`; **no actual provider snapshot pair** | `9a1c2a5`; `benchmarks/desktopprobe-snapshot-parity-normalizer-2026-11-05.md` |
| Owned-modal native oracle | .NET 10 WinExe source compiled; **8/8** pure synthetic model cases. WinExe/modal GUI **not launched** | `1c6a961`; `prototypes/modal-dialog-oracle/` |
| Sbroenne strict V5 watchdog | Default-UIA-disabled compiled, native identity/Job guard source, pure **6/6**; executable **not run with UIA** | `c1baeb9`, peer `f0ddd32` |
| Private FileId lease and orphan recovery | R0 **4/4**, corrected R1 e02 **5/5**, orphan classifier corrected e02 **12/12** private synthetic. Failed first attempts preserved; no live lock release | `378b2ea`, `9ac45bb`, `f542678` |
| P1 Workbridge text edit bug | `edit_file` replacement-string expansion of certain dollar tokens confirmed in source; isolated callback regression **11/11**. Deployed `src/changes.ts`/`dist/changes.js` **not patched by this investigation** | `8ce2d8e`, `2e42969`, proposed WB-001 fix `4da6507` |
| Provisional M5 decision matrix | **12** ranked desktop functions; WinApp+VMware peer review; first Sbroenne runtime allowlist `ui_snapshot` only | `2e68210`; `reports/2026-11-06-m5-provisional-function-matrix.md` |

**Concurrent WGC caveat:** A separate workflow performed **one** disposable synthetic WGC GUI attempt (`wgc_pilot_one_disposable_gui_attempt_20261105_01`), reported a 406×253 PNG (4,255 bytes, SHA-256 `9414885183cf32274a353ccefb75c5a5e2028b97e87053cf90cec38a08b628f5`) and unchanged foreground HWND endpoints; three offline PNG reconcilers passed. **PowerShell wrapper exited 1 because child ExitCode was null**, so the whole operation is **NOT clean-green**. It was not a physical RIFT/VM capture. No retry or further GUI run is authorized by this handoff.

**Newer concurrent source milestones:** `b8b8862` P3.5 native admission/geometry trust audit; `29ced7a` P3.4 locked-dependency and receipt audit; `3b92452` 60/60 synthetic PNG/Int64 validation; `43e91df` locked NuGet restore; `4bd7e26` offline foreground witness. These are not proof of real UIA or focus preservation.

## 5. Live safety and unresolved blockers

- **HOLD new real desktop/fixture launches** until Joey confirms a quiet Windows desktop interval, and immediately before launch the coordinator proves: correct WinSta0/Default/session/SID, target PID+process start+HWND, exact fixture image/source SHA, unchanged original foreground, exclusive admission and desktop-input lease, no active quarantine/orphan holder, native watchdog/Job settlement plan and independent after-observer. If any guard is unknown, **STOP**.
- Preserve the separate old November 2 screenshot's `unknown_outcome` despite its separately authorized hash-archival; do not replay it. The later authorized physical RIFT `/reloadui` is a different verified event. No further RIFT focus/click/reload/restart in *this* investigation.
- Admission-only crash-orphan with no GUI-guard ownership remains a source-confirmed HOLD; do not release a live lock because it is old or because an offline classifier passed.
- Real provider snapshot parity **UNKNOWN**: existing compact WinApp/Sbroenne samplers lack a durable independently authenticated provider-time typed-ID witness bound to the same sample, run, lease, exact target and native owner/Job receipt. The 18/18 reducer cannot manufacture this evidence.
- WGC P3.5 identifies missing independent G1/G3 geometry, G2 canonical dual-lock admission, WinEvent callback pump/coverage and compositor-frame freshness proof. `WINEVENT_OUTOFCONTEXT` reports *observed* transitions only; zero events cannot establish no transient foreground theft. P3.6 source-only follow-up must align request ID limit **64** (a v2 validator admitted 80).
- OneDrive sync pause in RIFT-Lab-1/2 is **not diagnosed** by a host VMware frame. Old vmrun guest transfer ~1.67–1.69 s is transport latency, not guest UIA latency. Never repurpose game-specific RR2 guest input queue as generic OneDrive control; Lab1 queue/lease has independent concerns.

## 6. Recommended follow-ups — prioritized for practical value

| Order | Work / owner lane | Definition of a defensible next milestone |
| --- | --- | --- |
| **P0 — now** | Coordinator **read-only freshness** | Recheck service PID/version/36 slots, full Git status, deployed four desktop tools and exact admission/GUI guard/quarantine/Task Scheduler owner. Existing November 5 clean checks are historical; do not infer a currently free GUI lease from empty command-job slots. |
| **P0 — parallel** | Reliability / WB-001 **data-integrity fix plan** | Source+dist hash/diff and 11-case literal replacement regression; review minimal callback `content.replaceAll(oldText, () => newText)`, then **separately approved staged release/rollback**, no surprise service restart. Avoid risky `edit_file` dollar replacement strings meanwhile. |
| **P1 — user-coordinated** | WinApp native observer **first actual UIA read-only proof** | Once Joey says desktop is free, exactly one pinned nonactivating disposable DesktopProbe fixture, fresh process/window/native lease/watchdog/foreground checks, one depth-1 inspection, typed controls and independent before/after/Job0; stop if it takes focus. No click, key, clipboard, guest/physical RIFT input. |
| **P1 — only after first proof** | Sbroenne single-function **same-HWND parity** | One separately Job-contained, approved `ui_snapshot` against the exact same fixture; compare typed-ID witness, owner and process-settlement receipts; record startup/provider/full RTT separately. No `ui_find`, `ui_read`, or `ui_wait`. Do **not** compare protocol startup 1,328 ms to WinApp taskbar 3,677 ms as relative UIA speed. |
| **P1 — parallel source-only** | WGC **P3.6** separate owner | Fix canonical request ID 80-vs-64 and independently bound G1/G2/G3 native observation/admission, forged-stamp/quarantine/geometry negatives; repair child exit-code reporting **offline**, not by repeating the uncertain GUI attempt. Reconcile other session ownership; no GUI test merely because it compiled. |
| **P2 — controlled later** | Native owned-modal observer | Separately consented nonactivating owner+350 ms delayed owned modal: native owner disabled/new HWND/disappeared/reenabled and monotonic time, zero input. `sbroenne ui_wait` only after another source review and new allowlist; focus-stealing modal requires new scope/approval. |
| **P2 — independent VM lane** | VMware/OneDrive G0/G1 **one lab at a time** | With separately authorized lab identity, passive VMX/boot epoch/guest SID+session+OneDrive PID/start, network ConnectionCost, local files' Offline/placeholder flags and bounded redacted errors. No hydration, settings clicks, Resume Sync, guest game input, power/reboot or Lab1 queue release. G2 interactive helper only if G0/G1 insufficient and separately gated. |
| **P2/P3 — conditional** | Outcome integration then M5/M6 provider decision | Feed *real independent* typed UIA/Job/native events to D1, record nine non-additive latency phases and UNKNOWNs; build only minimum glue justified by actual P1/P2 evidence. Adopt optional default-OFF per-function backend via WB-001 after measured benefit and rollback, **never** replace everything by assumption. |

### Critical path

**P0 health/admission → P1 WinApp read-only → P1 Sbroenne same-window → P2 modal → real receipts in D1 → measured provider decision.**

**Parallel path:** WGC P3.6 source-only hardening and separately authorized guest OneDrive G0/G1, with independent file/GUI ownership. Don't keep workers busy with redundant synthetic tests that cannot change a selection decision.

## 7. Suggested next-session coordinator prompt

> Resume Joey's Workbridge Windows desktop automation investigation from `docs/handoff-windows-desktop-automation-2026-11-05.md`. Read `AGENTS.md`, the autonomous policy, the active GUI roadmap, investigation README/ROADMAP and M5 matrix. Refresh Workbridge live owner/health and Git status; preserve all unrelated dirty/untracked files. Coordinate meaningful parallel specialists with exclusive files, report compact color-coded verified/unknown/blocked SITREPs. Keep the incumbent deployed service and physical RIFT/VMware untouched. Do not launch a desktop fixture, WGC, UIA sample or input until Joey provides a quiet desktop window and the fresh native owner/admission/Job/foreground gates pass. Next material goal: one true, same-target read-only WinApp–Sbroenne `ui_snapshot` comparison and independent outcome evidence; parallel independent WGC P3.6 and guest OneDrive source/passive work. Use local commits only for scoped verified milestones, WB-001 for any production deployment.

**Resume trigger to ask Joey:** “Is the Windows desktop free for a brief disposable read-only test?” No user action is needed for purely offline/read-only source investigation.
