# DesktopProbeWatchdog orphan-admission synthetic classifier and handoff — Nov 5, 2026

**Result: 10/10 PASS (synthetic logical model only). Real GUI/recovery remains HOLD.**

Workbridge command: C:\Program Files\nodejs\node.exe --test investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/OrphanAdmissionHandoffSynthetic.test.mjs
Job ID: **wd_orphan_handoff_model_20261105_e01**; status PASSED; exit **0**; 10 tests, 0 failures, **240.8 ms** Node harness duration, no stderr. Only unique OS-temp mock fixture roots named wb-orphan-handoff-fixture-* were used. No live .tools lock, GUI, TaskScheduler, physical RIFT, VMware, provider, service, or desktop input was touched. No production source changed.

The design basis is the independent boundary report reports/watchdog-orphan-admission-recovery-design-2026-11-05.md (commit **222ff4d**): a crash can leave the **admission + GUI guard pair but no sidecar**; any operator recovery must retain old GUI guard across admission ownership handoff and cannot pretend the old GUI operation was successful.

## Logical test result

| Scenario | Synthetic invariant / negative | Outcome |
|---|---|---|
| S01 | Exact producer/runId/lease/owner pair + empty sidecars, accepted only for operator review; byte backups precede original movement; admission relocated then new maintenance acquired, old guard relocated last, receipt preserves old unknown outcome | 🟢 PASS |
| S02–S03 | Inject owner alive, child/descendant alive, enabled launcher, uninspectable script host, PID reuse, or incomplete census | 🟢 All refused |
| S04 | Wrong admission/guard producer, mismatched requestId | 🟢 Refused |
| S05 | Change pinned admission file SHA/size before preflight | 🟢 Refused before archive created |
| S06 | Unexpected quarantine sidecar | 🟢 Refused |
| S08 (partial) | Halt before admission relocation | 🟢 Both original guards retained |
| S09 | Competitor wins atomic admission creation during handoff gap | 🟢 Old GUI guard remains and foreign admission untouched |
| S10 | Halt after new maintenance admission created but before guard relocation | 🟢 Maintenance and original GUI guard retained |
| S14 | Admission-only or GUI-guard-only shape | 🟢 Hard refused |
| S15 | Cannot prove all producers honor legacy guard | 🟢 Refused |

The synthetic classifier compares immutable stamp fields (schema version/kind/producer/mode/requestId/runId/leaseId, owner PID/start ticks/session, target process/synthetic flag), checks sidecar absence, bounded ordinary single-link files, and pinned SHA plus Node dev/ino/size. Quiescent process/task/Job and all-producer coverage are **injected test conditions**, not real Windows observations.

## What this proves — and does not

**Proves:** The **ordering concept** can fail closed in controlled mock states, including a competing admission writer, without moving the original GUI guard before maintenance admission is established. Every passing model receipt still reports priorActionOutcome=unknown_outcome and newActionPerformed=false.

**Does not prove:** Windows native FILE_ID/NTFS handle-pinned no-replace rename; security descriptor/ACE or sharing semantics; real Process/Job/TaskScheduler census; abrupt watchdog crash; rollback across power loss; durable fsync across a real rename; an actual all-producer freeze; or any GUI launch. Node fs.rename and stat ino are **only logical stand-ins**, not permission to execute archival recovery on a real machine.

## Remaining approval gates / next narrow milestones

1. Implement separate **investigation-only Windows native** fixture helper with held handle FILE_ID checks, no-replace rename and independent guards; synthetic S07/S11/S12/S16 crash-stage/collision cases; verify no pathname swap and exact ownership. No live path arguments.
2. Independently validate fresh complete process/task/Job census and actual deployed producer discipline in read-only mode; direct/legacy GUI paths that ignore either guard are a hard NO-GO.
3. Design distinct **admission-only** orphan protocol under verified full GUI-producer offline mode. The pair-handoff procedure may never silently accept admission-only.
4. Require operator-reviewed, pinned evidence and a separate one-shot decision before any manual archival execution or disposable DesktopProbe GUI pilot.

**Verdict: GO for additional synthetic/natively pinned research only. HOLD all real watchdog GUI launch and any live orphan recovery.**
