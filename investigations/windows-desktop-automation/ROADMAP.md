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
- [x] Resolve the private crash-orphan inspector's canonical FileId mismatch: e01 **failed I01** (exit1, preserved); separate hash-pinned e02 passed parser/Temp preflight, dual peer review and **12/12** private synthetic cases (exit0, 12 fixtures cleaned). Evidence `reports/watchdog-orphan-pair-inspector-independent-audit-2026-11-06.md`, commits `d3322ad`, `f542678`. **Live** orphan archival and real lock release remain **HOLD**.
- [x] R1 native private safety matrix: first e01 partial 3 PASS then B02 blocked due synchronous Console.In timeout (FAILED, retained), corrected source independently peer reviewed, distinct e02 **5/5 PASS**, zero skipped, exit0, 4.152s: hardlink, share denial, PINNED→rename EBUSY→ACK, missing-ACK native timeout retain, junction guard. Post-test read-only helper census 0. Evidence `prototypes/fileid-lease-r0/R1-E02-EVIDENCE-2026-11-05.md`, commits `8bf26a1`, `9ac45bb`, `3616192`. No native event-trace proof, 40-run performance or production integration; these remain separate HOLD.
- [ ] Coordinate a quiet Windows desktop interval before any **real** WinApp/Sbroenne UIA snapshot or owned-modal fixture launch. Keep the incumbent working backend and RIFT/VMware user sessions undisturbed.

Latest coordinator evidence: `reports/2026-11-05-investigation-sitrep-05.md`.

## Sixth-wave source/offline checkpoint (2026-11-05 Eastern / 2026-11-06 UTC)

- [x] Sbroenne V5 strict exact-HWND, approved fixture hash, watchdog start/session/SID/image, fixed seven-key env, pre-dispatch synced journal, private child Job supervisor: **default UIA-disabled C# compile OS0, Node syntax 2/2 OS0, pure Node tests 6/6 OS0**. Source+evidence commit `c1baeb9`; independent peer receipt `f0ddd32`. V5 EXE was NOT run and no real UIA has been invoked. Enabled screenshot/input/desktop access remains HOLD.
- [x] Provider-neutral before/dispatch-once/wait/independently-verify outcome and latency design peer reviewed and committed `d7c97df`. Five terminal/pending/unknown outcomes, nine non-additive phases; **18 pure synthetic reducer tests proposed at this sixth-wave cutoff** (the later D1 implementation executed 22/22 in the seventh wave).
- [x] Host VMware vs OneDrive guest Windows session/latency delta documented `386ee5c`. Guest UIA is not host UIA and historical vmrun command availability does not establish interactive OneDrive desktop. One-lab read-only metadata-only trial remains gated.
- [x] Admission-only orphan no-guard handoff threat documented `1060ece`; no live recovery authority, process/stamp+census incomplete. Retain unknown and HOLD all live release.
- [x] Build and peer-review pure outcome reducer (**22/22** synthetic, commit `159dd1f`) and WinApp/Sbroenne structural parity normalizer (**18/18** synthetic, commit `9a1c2a5`). Both OS exit0 with independently audited receipts; **no real GUI/UIA/parity or latency result**. Actual producer-bound typed-ID witness attestation remains HOLD.
- [x] Source review passive owned-modal native oracle: .NET 10 WinExe compiled, pure modal state model **8/8** offline tests (commit `1c6a961`); actual native oracle/WinForms GUI **not launched**, real owner/HWND timing unverified.
- [ ] **Quiet user-coordinated Windows foreground interval required** for the first actual WinApp/Sbroenne comparable read-only DesktopProbe snapshots, with fresh owner watchdog/lease and postcondition receipts. No production backend change before measured M5/M6 decision and WB-001.

## Seventh-wave pure evaluation checkpoint (Thursday evening, 2026-11-05 Eastern / 2026-11-06 UTC)

- [x] Verify and commit **D1 22/22** fail-closed provider-neutral action-outcome reducer (OS0, saved untruncated 1,951-byte stdout, stderr0, 349ms terminal job). FLAUI/WinApp independently inspected receipt, VMware independently reviewed source. `prototypes/outcome-reconciler/`, commit `159dd1f`.
- [x] Verify and commit **M3-P12 18/18** strict privacy-preserving typed-control comparison model (OS0, saved untruncated 1,757-byte stdout, stderr0; `--check` 2/2). `prototypes/desktopprobe-snapshot-parity.mjs`, benchmark/report, commit `9a1c2a5`. Actual WinApp/Sbroenne producers do **not** yet generate authenticated provider-time typed-ID witness receipts; runtime parity must remain UNKNOWN.
- [x] Confirm native modal **8/8** pure model; no WinExe/modal/GUI launch, commit `1c6a961`.
- [x] Read-only triage of separate `prototypes/wgc-no-focus-pilot/`: offline BGRA-to-PNG self-test source and optional visible 420-by-260 WinForms WGC capture branch; no autorun, generic RIFT target or observed launch by this investigation. A concurrent workflow committed its evolving source as `03af169`; latest reviewed source fixes output to its own `pilot.png`. It still lacks this investigation's verified desktop lease/watchdog/user quiet-window admission. **No WGC/window launch by this investigation; do not touch the other workflow's tracked or dirty files**.
- [ ] Coordinate WGC's separate concurrent owner and confirm exact native desktop lease/watchdog, visible-window and fixed output safety before any separately approved GUI experiment; no authorization in this investigation.
- [x] Complete evidence-rated **provisional** M5 keep/wrap/pilot/defer report (12 ranked functions, independently WinApp+VMware reviewed, commit `2e68210`) and prioritize **two** user-coordinated disposable no-activate GUI proofs. First Sbroenne pilot allows `ui_snapshot` only; actual measured M5 provider selection remains open.
- [ ] Ask Joey to coordinate a quiet desktop interval before a newly approved read-only GUI/UIA pilot; preserve host RIFT, VMware, Workbridge's deployed desktop integration, and live locks.

Checkpoint summary: `reports/2026-11-05-investigation-sitrep-06.md`. No production backend switch, GUI/VM/game input or service restart in this seventh-wave checkpoint.
