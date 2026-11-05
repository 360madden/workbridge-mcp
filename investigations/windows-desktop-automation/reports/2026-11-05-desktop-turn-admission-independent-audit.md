# Independent desktop-turn admission / watchdog reliability audit — 2026-11-05

**Decision: HOLD for first real DesktopProbeWatchdog disposable GUI pilot.** Existing Workbridge desktop features may continue for separately authorized operations under their new guard, but momentary lock absence is not standing permission. This review changed no production, live desktop lock, GUI, RIFT, VM or service.

## Source and state evidence

- At a **momentary Nov 5 evening snapshot**, the shared .tools/desktop-evidence directory had zero desktop-input-turn.lock, desktop-turn-admission.lock, or desktop-turn-quarantine-*.json; direct file_info checks found both lock paths absent. This is not an atomic lease.
- Nov 5 recovery commits 0e5a6a4 and 08821b5 document exact-file-ID manual archive of the historical Nov 2 quarantine. Report investigations/windows-desktop-automation/reports/2026-11-05-physical-rift-reloadui-v0411-success.md:7-39 documents an already-authorized one-shot physical-RIFT UI reload and independent before/after evidence, plus post-action lock hygiene. No replay is authorized by that result.
- scripts/desktop-turn-admission.mjs:51-97,109-159 creates an atomic exclusive (wx) admission before GUI operations. src/desktop-registration.ts:36-62 wraps the older GUI-turn guard inside that admission. scripts/desktop-capture.mjs:284-336 now requires matching parent admission and GUI stamp for bounded captures (commit d3e9851).
- Native watchdog DesktopTurnLease.cs:61-150,174-197,299-381 opens and holds **both exact native handles**, admission **before** GUI guard. Verified settlement deletes GUI guard by exact handle, then admission; uncertainty retains guard+matching quarantine before admission release or holds admission too. Synthetic success, uncertain and admission-busy tests are documented in watchdog README:47-55.
- Watchdog Program.cs:175-324 verifies private Job active 1→2→1 and exact child exit. A real displayed HWND also needs independent native target manifest; without it result=no_gui_manifest / unknown_outcome. These synthetic tests do not establish Task Scheduler interactive launch or real GUI safety.

## Fixed interoperability bug and proof

Before repair, DesktopTurnLease.WriteQuarantine lacked sidecar fields requestId and explicit intentSha256:null, whereas pinned scripts/Archive-DesktopQuarantine.ps1:329-340 requires exact q.requestId == ExpectedRequestId, q.intentSha256 == null, standard DESKTOP_TREE_UNSETTLED reason and same guard SHA. An ordinary watchdog uncertainty was therefore not accepted by the existing safe recovery classifier.

Investigation-owned DesktopTurnLease.cs now stores runId and emits requestId=runId and intentSha256=null, retaining strict unknown-outcome/fail-close logic. New C# source SHA256: **00e67f7f0721f2a139a39c3e799f666fc3577d68830142a674e99cd82ae54b3f**.

| Verification | Receipt | Outcome |
|---|---|---|
| Fresh .NET 10 publish | wd_sidecar_compat_publish_20261105_e01 | Exit 0, ~3.97 s |
| Real archive parser contract, NO execution | wd_sidecar_archive_readonly_contract_20261105_e01 | Exit 0, 1/1 PASS, 5.51 s |
| Archived source pin | Archive-DesktopQuarantine.ps1 SHA256 5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0 | Exact source used |

Test WatchdogQuarantineContract.test.mjs runs **synthetic uncertain only**, asserts Job members 1→2→1, exact child settled, mock GUI guard + matching sidecar retained, then clones bytes into a unique OS-temp fixture with canonical names. It calls the actual PowerShell archive script with **NO -Execute**. Read-only classification returned readyForManualReview:true, releaseEligible:false, archiveCreated:false, priorActionOutcome:unknown_outcome and exact lease; both fixture files remain byte-identical. It proves **schema acceptance/read-only preflight**, NOT archive execution or recovery from arbitrary watchdog crash.

## Residual risk-ranked findings

### P1 / HOLD: Crash orphan has no supported manual mover yet

DesktopTurnLease.Dispose at lines243-250 deliberately retains **both** admission + GUI guard on exception before Complete and may leave **no sidecar**. A crash between GUI exact-handle deletion and admission exact-handle deletion could leave **admission only**. This is intentionally fail-closed, but current archival scripts do not handle these shapes:

- Archive-DesktopQuarantine.ps1:303-340 requires **GUI guard + matching sidecar** and obtains a new maintenance admission (blocked by an existing orphan admission).
- Archive-StaleDesktopLock.ps1:136-147 only accepts producer=chatinput-probe-test, not desktopprobe-watchdog, and also acquires a new admission.
- Another independent specialist drafted admission-first orphan recovery design; it remains **unexecuted**, and no synthetic full recovery has been proven. Distinct stamp-change/partial-write uncertainty also requires operator reconciliation outside standard quarantine path.

### P2: Node release has a pathname check-to-unlink gap

scripts/desktop-turn-admission.mjs:85-93 closes its created OS file handle after durable write. releaseDesktopAdmission validates lstat/read/lstat identity and hashes then **unlink(pathname)** at lines117-143. A foreign actor that replaces pathname after verification could have its replacement removed. Ordinary conforming contenders cannot acquire wx while the original pathname exists, so this is a hardening issue, **not proof of a live race**. Native watchdog and PowerShell maintenance instead delete/rename their opened exact native file handles.

### P2: Generic callback error semantics need a provider boundary

src/desktop-registration.ts:118-125 retains a GUI guard on missing stamp or error DESKTOP_TREE_UNSETTLED, but other thrown errors are treated as process-settled. Current src/desktop-cli-runner.ts:109-182 deliberately maps timeout/forced termination/nonzero wrapper/malformed output into DESKTOP_TREE_UNSETTLED; managed prototype path is consistent. Future providers or direct callback exceptions after possible dispatch need independent no-dispatch/tree settlement evidence, not a generic catch/release assumption.

### P2: Host self-assignment to private Job and Task Scheduler remain unproven for real GUI

Program.cs:175-179 attaches watchdog **itself** into its KILL_ON_JOB_CLOSE private Job, with child inheritance active 1→2. Windows synthetic test passed, but independent real TaskScheduler token/session, host actual process exit and descendant liveness are not demonstrated. Separate Sbroenne V2 research tests an **outside-Job** supervisor with suspended child assignment. Do not infer full tree settlement from scheduler task exit code alone.

## GO/HOLD checklist for a first disposable host GUI trial

1. **Recoverability:** operator-reviewed exact-file-ID/hash archival plan with synthetic positive+negative proof for both crash-before-sidecar (admission+GUI) and admission-only. Must fail on live/reused owner, extra sidecar, contender, changed hashes and unproven descendants; no age-based unlock.
2. **Target:** fresh hash-pinned disposable DesktopProbe binary and DLL, unique evidence directory, native HWND/PID/start tick/SID/session/foreground manifest; independent read-only samplers verify exact target. No title-only lookup or forced focus.
3. **Supervision:** prove TaskScheduler interactive user token/session and independent Job owner/child process tree, monotonic <=110s watchdog, terminal child settlement, and truthful nonzero/unknown error classification.
4. **Admission:** new absence check for both locks/sidecars immediately before *atomic* owner acquisition; once owned, samplers validate the watchdog stamp and do not take competing GUI turn.
5. **Authorization:** separate precise operator go-ahead for disposable window launch/focus; absolutely no physical RIFT, live user app, or VMware input.

**Current verdict: HOLD** real watchdog-driven GUI pilot despite successful Nov 5 synthetic schema repair. **GO** for further synthetic recovery proof and independent read-only analysis.
