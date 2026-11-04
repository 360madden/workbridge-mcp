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

Status as of November 4: **M0 complete; M1 WinApp read-only timing baseline measured; M2 Sbroenne pinned CLI/server built on SDK 10.0.302 and a direct stdio protocol-only handshake passed; M3 source alternatives audited; M4 VM/OneDrive boundaries plus synthetic recovery reviewed; M5 provisional per-function matrix drafted**. Evidence checkpoints: `reports/2026-11-04-investigation-sitrep-01.md` and `reports/2026-11-04-investigation-sitrep-02.md`. No GUI action or production code/service change.
