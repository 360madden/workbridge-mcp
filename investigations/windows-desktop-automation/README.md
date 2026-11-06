# Windows Desktop Automation Reliability Investigation

Owner: Joey. Established: 2026-11-04. Scope: isolated research and evaluation; no production backend replacement yet.

## Mission
Make Workbridge reliable at controlling Windows desktop applications, native/third-party dialogs, VMware host controls and, where a guest-side helper is present, applications in RIFT-Lab-1 and RIFT-Lab-2. Close the observe -> identify -> act -> wait -> independently verify -> recover loop. Distinguish dispatched input from confirmed application outcomes.

## Standing decisions
- **Workbridge remains the operational MCP coordinator and 36-slot command scheduler.** It does not have to implement every GUI function itself.
- **Replacing a specific Workbridge desktop function with a maintained third-party component is acceptable** if it provides a better reliability/time-to-value result than a bespoke adapter. Choose buy/reuse/replace versus custom code by measured engineering cost, compatibility and verified results, not architectural pride.
- Preserve the existing desktop service and its working host/VM capabilities during research. No second owner against Workbridge's `.local`, no automatic replacement of live tools, no competing input stream.
- Maintain one coordinated desktop input lease per Windows interactive session even when workers run in parallel. Identify PID, process start, HWND, target app and host-versus-guest context.
- Prefer semantic control actions, but permit screenshots/OCR, native input, VMware guest receivers and other suitable backends when required. RIFT's custom-rendered game UI may need a different path.
- **Action dispatch is not success.** Report verified_success, verified_failure, pending, unknown_outcome or blocked with before/after evidence. Never blindly repeat an unknown mutation.
- Investigation, installation, integration and production rollout are separate decisions. Use synthetic apps and read-only probes first; deploy only via WB-001 release gates.
- A desktop helper may work around a paused OneDrive GUI but does not by itself establish or repair the root cause of sync pausing inside VMware guests.

## Folder index
- `ROADMAP.md` — ordered milestones and acceptance rules.
- `DECISIONS.md` — durable policy and selection principles.
- `FINDINGS.md` — researched candidate landscape and open questions.
- `candidates/` — technical notes for WinApp CLI, sbroenne/mcp-windows and eugman/FlaUI-MCP-Core.
- `benchmarks/` — test methodology/results; no claim that a test ran until evidence exists.
- `prototypes/` — isolated evaluation artifacts, not production modules.
- `reports/` — periodic comparisons, decision and release-readiness reports.

## Existing sources of truth
- `../../AGENTS.md`
- `../../docs/autonomous-investigation-policy.md`
- `../../docs/interactive-desktop-vm-roadmap.md`
- `../../docs/handoff-flaui-workbridge-2026-11-04.md`

## Initial baseline
Workbridge workspace_info on 2026-11-04 reported live version 0.16.4-dev, 36 command/worker slots and a local owner. Microsoft WinApp CLI 0.7.1 has already been installed and partially validated in the older GUI roadmap. These facts do **not** prove all proposed new features are ready.

Status as of November 4: **M0 complete; M1 WinApp read-only timing baseline and offline disposable-fixture sampler; M2 Sbroenne pinned CLI/server and offline sampler; v1 native supervisor RED, v2 suspended-child synthetic containment and honest exit reporting GREEN (real MCP/UIA still untested); M3 source alternatives audited; M4 host/VM boundaries, standalone watchdog, synthetic outcome/lock recovery and read-only quarantine classifier evaluated; M5 provisional per-function matrix and Task Scheduler launch design drafted**. Evidence checkpoints: `reports/2026-11-04-investigation-sitrep-01.md`, `reports/2026-11-04-investigation-sitrep-02.md` and `reports/2026-11-04-investigation-sitrep-03.md`. **No disposable GUI launched; no production code/service or protected desktop guard changed.**

## November 5 operational and investigation checkpoint
- The old November 2 physical desktop quarantine was archived under a separate authorized exact-hash maintenance procedure; it was **not** automatically released, and its original screenshot remains `unknown_outcome`. A later authorized, one-shot physical RIFT `/reloadui` has independent verification. See `reports/2026-11-05-vmware-boundary-workbridge-freshness.md`.
- Workbridge remains the operational `0.16.4-dev` coordinator with 36 command slots. The current owner at the recorded Nov 5 inspection was PID `58580`; verify fresh on each new live trial.
- Microsoft WinApp 0.7.1 remains the **incumbent** provider. A fresh exact-HWND disposable read-only pilot is planned but **not yet performed**; see `reports/desktopprobe-winapp-first-readonly-pilot-readiness-2026-11-05.md`.
- Pinned Sbroenne MCP direct stdio **protocol-only** launch passed under a native suspended-before-Job supervisor: one `ui_snapshot` tool discovered, zero calls, all four observed Job members settled to zero, OS exit 0 (1,291 ms single run). There is **no UIA or comparative speed finding**. See `benchmarks/sbroenne-mcp-v2-protocol-2026-11-05.md`.
- Standalone DesktopProbe watchdog's normal unsettled-state quarantine now supplies its required request ID and explicit null intent hash. .NET 10 build and a synthetic read-only invocation of the existing recovery parser passed 1/1. This does **not** cover abnormal crash-before-sidecar nor stamp-tamper/delete-failure branches.
- An orphan admission+GUI guard/no-sidecar recovery handoff has a **source-only design and 16 proposed test cases**. Later isolated tests proved the logical 10/10 and native private-NTFS handoff 6/6, but **no production operator archiver or live release is validated**. Its admission-only orphan case remains a separate **HOLD**. See `reports/watchdog-orphan-admission-recovery-design-2026-11-05.md`.
- **Live disposable GUI input/UIA pilot remains HOLD** until the crash-orphan recovery path, fresh desktop/foreground coordination, exact target identity, and independent postconditions are defensible. No production provider replacement or VMware guest action occurred in this investigation checkpoint.

Latest detailed Nov 5 coordinator checkpoint: `reports/2026-11-05-investigation-sitrep-05.md` (restricted Sbroenne actual-vendor protocol OS0/Job0, FileId lease R0 4/4 and R1 5/5 private synthetic, orphan inspector e01 failure retained then distinct e02 12/12 PASS, edit_file substitution defect with 11/11 regression, WinApp A/B inconclusive). Earlier checkpoint: `reports/2026-11-05-investigation-sitrep-04.md`. The latest sixth-wave V5 offline 6/6, VMware/OneDrive session delta and provider-neutral outcome design are indexed in `ROADMAP.md`. No actual UIA/desktop or production fix.
