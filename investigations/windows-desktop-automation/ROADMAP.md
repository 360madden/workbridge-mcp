# Investigation roadmap

## M0 — Establish the isolated investigation
- [x] Define a separate Workbridge-owned research directory, with reports/candidates/benchmark/prototype areas.
- [x] Record Joey's permission to replace specific existing desktop functions when an external replacement is better than writing an adapter.
- [x] Commit the documentation-only baseline and confirm the live Workbridge owner remains unchanged (commit 8fc6c78; owner 0.16.4-dev PID 43508 verified).

## M1 — Baseline the installed Microsoft WinApp CLI
- [x] Inventory actual local 0.7.1 verbs, response schema and supported UIA selectors (read-only; SITREP 01).
- [x] Record current Workbridge desktop tools, locks and request journaling without changing them (SITREP 01).
- [ ] Test repeated read-only observations, exact PID/HWND/process identity, dialogs, minimized windows and multi-DPI behavior on disposable targets.
- [ ] Measure cold/warm latency, median/p95, nonempty evidence, timeouts and context/output size.

## M2 — Evaluate sbroenne/mcp-windows as the leading replacement candidate
- [x] Pin a release/source revision and review license, build provenance, packaging and compatibility with .NET 10 (v1.3.28, SHA 655b9fc; CLI built on SDK 10.0.302).
- [x] Source/static-catalog evaluation of `wincli` vs direct MCP stdio and map candidate functions (18-tool inventory; protocol-only `tools/list` passed). Performance replacement comparison is separate below.
- [ ] Verify immutable observed element IDs, process-instance identity, target/foreground checks and concurrent input behavior.
- [ ] Run identical synthetic app observations and failure cases; no live RIFT or guest input.
- [ ] Compare results with M1 using the same test cases and independent state evidence.

## M3 — Evaluate eugman/FlaUI-MCP-Core as a specialized alternative/reference
- [ ] Pin revision and document .NET runtime/SDK requirements.
- [ ] Examine modal-aware pending-operation tracker, no-reused-ref registry, global lease, screenshot DPI checks and drag recovery.
- [ ] Benchmark selected operations where WinApp/sbroenne falls short; do not port mechanisms by assumption.

## M4 — Guest/VM and desktop reliability
- [x] Separate host Windows, VMware Workstation chrome, guest Windows session, RIFT renderer and guest receiver paths (read-only RR2 evidence in SITREP 01).
- [ ] Test dialog handling, uncertain outcomes, hung UIA provider, window disappearance, foreground theft, two concurrent callers and manual-user takeover.
- [ ] Validate guest-side observation and controlled input only with independently identified guest receiver/session; keep both live RIFT instances undisturbed.
- [ ] Where a non-UIA backend is superior, include it in the comparison rather than forcing FlaUI/WinApp.

## M5 — Choose integration vs replacement per function
- [ ] Score candidates by correctness, before/after proof, failure recovery, median/p95 latency, code/maintenance cost, runtime overhead, session isolation, test evidence and update maturity.
- [ ] Produce a function-by-function decision: keep, wrap, replace, or defer; explain tradeoffs.
- [ ] Prototype the selected provider behind a versioned, target-bound Workbridge interface; no parallel uncontrolled desktop owner.

## M6 — Production release (separate milestone)
- [ ] Run focused tests and review exact file hashes/diffs.
- [ ] Commit only owned changes; preserve unrelated dirty files.
- [ ] Stage using WB-001 validation/rollback, with a separate deployment decision and post-deploy health check.
- [ ] Preserve a toggle/rollback route to the current Windows control tools.

## Evidence rule
For every trial record: date, repo commit/release, host/guest/desktop identity, target PID/start/HWND, request ID, starting state, exact operation, duration, returned status, independently observed final state, failure category and cleanup.

Never label the trial `PASS` simply because a tool says `success`.

## First-wave checkpoints (2026-11-04)
- [x] Microsoft WinApp 10-cycle taskbar discovery+inspect baseline (read-only) and 15-call startup decomposition.
- [x] Existing Job Object synthetic descendant containment smoke: 1/1 passed (not actual hung COM proof).
- [x] Exact sbroenne v1.3.28 source revision verified and isolated `wincli` self-contained publish passed on SDK 10.0.302; no GUI tool invoked.
- [x] Guest Lab-1 blocked queue surfaced without mutation; protect quarantine pending separate diagnosis.
- [ ] Controlled synthetic action proof and vendor comparison; no production changes.

## Second-wave checkpoint (2026-11-04)
- [x] Sbroenne MCP stdio server published under ignored investigation temp with exact EXE/DLL/runtimeconfig hash pins.
- [x] Direct MCP protocol-only smoke job `wda_sbroenne_stdio_protocol_20261104_001`: `protocol_passed`, exactly one `ui_snapshot` tool, 0 tool calls, direct child exited; **Job descendant settlement not proven**.
- [x] Hardened synthetic effect-then-hang test with Job members=2, child alive before kill and independent durable journal; 1/1 passed.
- [x] Source audits of legacy/OCR/Win32 candidates, provisional function-provider matrix and guest UIA/OneDrive/latency designs documented.
- [x] Prove independent hard process-lifetime watchdog in **synthetic-only** tests: `prototypes/desktopprobe-watchdog/`, 110-second deadline, exact GUI-turn lease, Job membership 1→2→1. Independent source review passed. Live interactive Task Scheduler helper remains unproven.
- [ ] Independently verify actual UIA effects/latency in a disposable fixture; no live RIFT or guest input until separate safety gate.
- [ ] No production provider replacement; WB-001 remains separate.

## Third-wave checkpoint (2026-11-04)

- [x] WinApp fixture structural read-only sampler with deadline parity; 7/7 offline tests.
- [x] Shared WinApp/Sbroenne exact target/lease/deadline/typed-control contract; 4/4 offline tests.
- [x] Direct Sbroenne MCP snapshot sampler, pinned binaries and 5/5 offline tests; **no MCP UI tool called**.
- [x] Sbroenne native Job forensic: host + two Node + two conhost members; fixed three-member assumption rejected, and Workbridge terminal exit0 alone is not semantic success.
- [x] Protect November 2 RIFT GUI lock/quarantine. Read-only classifier 10/10 synthetic; current `conhost.exe` lineage likely diagnostic sidecars, not proof of Nov2 completion.
- [x] Source-only future archival design: retain `unknown_outcome`, enforce cross-producer desktop admission freeze, archive exact sidecar first and lock last; **no release executed**.
- [x] Preferred future host path: one on-demand no-AtLogon Limited/Interactive scheduled watchdog; WinApp first, Sbroenne only after native containment green.
- [x] Reconcile old quarantine under separately approved and technically proven release gates; on Nov 5 the original artifacts were backed up and archived, outcome still unknown, no age-based release/replay.
- [ ] Verify real interactive watchdog/fixture launch and teardown, then one read-only WinApp sample.
- [x] Finish and independently review **synthetic** Sbroenne native Job supervisor v2; clean OS exit0 and forced-negative OS exit3 both prove Job empty. Evidence `benchmarks/sbroenne-private-job-v2-synthetic-2026-11-04.md`, commit `fb479175`. Real MCP/UIA fixture sample remains gated.

Evidence: `reports/2026-11-04-investigation-sitrep-03.md`. Production deployment remains a separate M6 decision.

## Fourth-wave checkpoint (2026-11-05)
- [x] Confirm operational Workbridge 0.16.4-dev / 36-slot owner and independently distinguish the later authorized RIFT `/reloadui` from the older unknown screenshot.
- [x] Independently source-review Sbroenne direct MCP stdio v2 child-in-Job protocol path; run one pinned protocol-only handshake with exact `ui_snapshot` inventory, zero `tools/call`, honest OS exit0 and full observed Job settlement to 0. **Actual UIA is still disabled.**
- [x] Read-only pilot readiness checklist for Microsoft WinApp 0.7.1 and existing disposable DesktopProbe; a historical native-input probe is not a valid read-only comparison sample.
- [x] Fix normal watchdog `DESKTOP_TREE_UNSETTLED` quarantine parser schema and run actual `Archive-DesktopQuarantine.ps1` **without Execute** against copied synthetic evidence: 1/1 passed. No live lock changed.
- [x] Document source-only crash-before-sidecar orphan-admission recovery: original GUI guard covers admission handoff; require producer invariant audit and 16 negative/crash/race checks before implementation.
- [ ] Verify source/deployed invariant that every permitted GUI producer honors the legacy guard, including standalone scheduled paths.
- [ ] Test crash-before-sidecar orphan classifier and guarded handoff on private synthetic NTFS fixtures; admission-only orphan needs a separately proven solution.
- [ ] Quiet desktop and exact fresh task/window/fixture identity gate; one **new** bounded read-only WinApp structural snapshot with native before/after proof, then Sbroenne actual `ui_snapshot` parity only if containment/recovery verified.
- [ ] Synthetic modal-dialog benchmark, then VMware host/guest boundary-specific evaluation; no RIFT/guest input in this pilot.
- [ ] Production provider selection/deployment only via M5/M6 and WB-001; Workbridge remains in daily service.

## Fourth-wave verified closeout (2026-11-05)
- [x] Native NTFS **private synthetic** handoff 6/6 OS exit0, exact FILE_ID/no-replace/owner sharing/guard-covered contender proof and six safe fixture cleanups; e01–e03 harness failures documented. This is **not** a live orphan archiver.
- [x] Pinned Sbroenne v1.3.28 single-file .NET10 publish (one 59,893,792-byte EXE) and supervised **protocol-only** v3 run OS0/Job0; no tools/call. Environment default inheritance and extraction destination remain unproven, explicitly corrected in benchmark.
- [x] M4 disposable owned-modal WinForms .NET10 fixture compiled clean; eugman FlaUI-MCP-Core pinned source review identifies owner-disabled/new-owned-HWND tracking and pending-status algorithms. No modal or UIA runtime test.
- [x] Source/deployed GUI producer lock-release audit and filtered TaskScheduler/process census; Node path-unlink TOCTOU remains **source-possible but unobserved**, with separate FileId-token remediation roadmap.
- [ ] Build and peer-review narrowly typed **read-only-first** watchdog orphan recovery utility; test fail-close then seek separate operator authorization before any live use.
- [ ] Quiet user-coordinated Windows desktop interval; actual first disposable WinApp read-only snapshot, Sbroenne equivalent snapshot and modal observation remain **HOLD**.
- [ ] No production backend switch or broad GUI input before M5/M6 and WB-001.

Detailed evidence: `reports/2026-11-05-investigation-sitrep-04.md`.

## Fifth-wave research checkpoint (Thursday evening, 2026-11-05, Eastern)

- [x] Verify seven-key restricted Unicode child environment with one synthetic 20-key mask and clean native Job settlement, OS exit0. Evidence `benchmarks/sbroenne-v31-restricted-env-oracle-2026-11-05.md` and commits `5dc47ad`, `8e8d78e`.
- [x] Launch exactly one pinned Sbroenne v1.3.28 **protocol-only** catalog via restricted environment; OS exit0, 1.328 s, one advertised `ui_snapshot`, no calls, Job0; no GUI/UIA proof. Evidence `benchmarks/sbroenne-v4-restricted-singlefile-protocol-2026-11-05.md`, commit `604c305`.
- [x] Build standalone .NET10 native FileId lease and prove 4/4 private synthetic cases, including exact FileId substitution refusal and lock preserved after aborted owner; no production locks touched. Evidence `prototypes/fileid-lease-r0/R0-EVIDENCE-2026-11-05.md`, commit `378b2ea`.
- [x] Independently source-confirm deployed Workbridge `edit_file` text-template substitution defect; **not proven** in `write_file`. Document regression and WB-001 proposed fix; production source/server unchanged. Report `reports/2026-11-06-edit-file-dollar-replacement-audit.md`, commit `8ce2d8e`.
- [x] Record aborted WinApp A/B with zero completed pairs; no direct-inspect performance claim.
- [ ] Resolve crash-orphan inspector canonical FileId mismatch. First actual private matrix **failed I01** with exit1 and was not automatically rerun; second source-only corrected 12-case version requires fresh parser/Temp preflight and independent peer review before any distinct attempt. Live orphan archival remains **HOLD**.
- [ ] R1 native release/rename/hardlink/share/reparse and performance tests, peer-reviewed private synthetic only, no deployed changes.
- [ ] Coordinate a quiet Windows desktop interval before any **real** WinApp/Sbroenne UIA snapshot or owned-modal fixture launch. Keep the incumbent working backend and RIFT/VMware user sessions undisturbed.

Latest coordinator evidence: `reports/2026-11-05-investigation-sitrep-05.md`.
