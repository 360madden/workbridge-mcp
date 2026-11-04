# Investigation roadmap

## M0 — Establish the isolated investigation
- [x] Define a separate Workbridge-owned research directory, with reports/candidates/benchmark/prototype areas.
- [x] Record Joey's permission to replace specific existing desktop functions when an external replacement is better than writing an adapter.
- [ ] Commit the documentation-only baseline and confirm the live Workbridge owner remains unchanged.

## M1 — Baseline the installed Microsoft WinApp CLI
- [ ] Inventory actual local 0.7.1 verbs, response schema and supported UIA selectors.
- [ ] Record current Workbridge desktop tools, locks and request journaling without changing them.
- [ ] Test repeated read-only observations, exact PID/HWND/process identity, dialogs, minimized windows and multi-DPI behavior on disposable targets.
- [ ] Measure cold/warm latency, median/p95, nonempty evidence, timeouts and context/output size.

## M2 — Evaluate sbroenne/mcp-windows as the leading replacement candidate
- [ ] Pin a release/source revision and review license, build provenance, packaging and compatibility with .NET 10.
- [ ] Evaluate its MCP surface against `wincli` persistent daemon and map candidate functions that could replace existing Workbridge tool implementations.
- [ ] Verify immutable observed element IDs, process-instance identity, target/foreground checks and concurrent input behavior.
- [ ] Run identical synthetic app observations and failure cases; no live RIFT or guest input.
- [ ] Compare results with M1 using the same test cases and independent state evidence.

## M3 — Evaluate eugman/FlaUI-MCP-Core as a specialized alternative/reference
- [ ] Pin revision and document .NET runtime/SDK requirements.
- [ ] Examine modal-aware pending-operation tracker, no-reused-ref registry, global lease, screenshot DPI checks and drag recovery.
- [ ] Benchmark selected operations where WinApp/sbroenne falls short; do not port mechanisms by assumption.

## M4 — Guest/VM and desktop reliability
- [ ] Separate host Windows, VMware Workstation chrome, guest Windows session, RIFT renderer and guest receiver paths.
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
