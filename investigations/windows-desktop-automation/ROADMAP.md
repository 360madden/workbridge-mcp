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
- [ ] Reconcile old quarantine under separately approved and technically proven release gates; no age-based auto release/replay.
- [ ] Verify real interactive watchdog/fixture launch and teardown, then one read-only WinApp sample.
- [x] Finish and independently review **synthetic** Sbroenne native Job supervisor v2; clean OS exit0 and forced-negative OS exit3 both prove Job empty. Evidence `benchmarks/sbroenne-private-job-v2-synthetic-2026-11-04.md`, commit `fb479175`. Real MCP/UIA fixture sample remains gated.

Evidence: `reports/2026-11-04-investigation-sitrep-03.md`. Production deployment remains a separate M6 decision.
