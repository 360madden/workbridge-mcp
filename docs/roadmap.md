# Workbridge upgrade execution

## Current checkpoint — 2026-11-01

**Current deployed and committed baseline: Workbridge 0.16.4-dev / 36 command-job slots / 36 coordinated-worker assignments.** The sealed release passed nine WB-001 gates and 1,037 tests (zero failures; three skips). The healthy hosted instance and its capacity were independently verified, and the source, scripts, tests and documentation were reconciled into selected-file Git commits on `main`. The previous 0.16.3-dev/six-slot architecture is retired from active use, while Git and release history are retained. See [36-slot release and adoption evidence](workbridge-36-capacity-20261101.md). Browser-session helpers and tests of 36 independent AI reasoning workers remain separate future work.

**Historical checkpoint — 2026-10-21:** WB-025 was complete as a CLI input-consistency milestone. Observed request-file growth, rewrite or replacement is rejected before execution. Final full suites passed **509/509**, including 19 new cases also checked with production dependencies only. An existing cancellation-test readiness failure was reproduced and corrected; the original failed run is retained. At that time the server remained **0.16.3-dev / WB-022**, with no rebuild, restart or deployment for WB-025. See [verification](wb025-validation.md), [last runtime deployment](wb022-deployment.md), and [handoff](handoff-20261020.md).

The sections below retain earlier milestone history and separate local-PC work. Their historical versions are not the current deployment.

The useful-helper phase adds a normal-user PC health recorder and a fixed,
UAC-approved Windows component-store diagnostic. See the
[PC health and Windows scan roadmap](pc-health-and-windows-scan.md) for operation,
report storage, validation, and removal commands.

Administrator report cleanup, manual recorder restart rehearsal, and the real
[sign-in recovery test](pc-health-recovery-and-cleanup.md) have passed. After the
approved sign-out, read-only verification confirmed a new Windows logon and a fresh
normal-user recorder instance without manual Start. No restart or sign-out is
automatic.

The [full reboot recovery test](pc-health-full-reboot-test.md) also passed after an
explicitly approved orderly restart. Verification confirmed a new boot and logon,
a new normal-user recorder instance with advancing samples, both tasks running,
and a successful live Workbridge read without manual helper/bridge Start.
Unexpected-power-loss and operation before Windows sign-in remain untested.

The next local-PC phase is implemented as a prototype in
[administrator/UAC and persistent helpers](admin-and-persistent-helpers.md),
with native user-task lifecycle control and a separate locally approved UAC diagnostic.

For the October 18 local-PC capability investigation and phased helper-app,
installation, configuration, and ordinary ChatGPT acceptance plan, see
[local PC roadmap](local-pc-roadmap.md). The existing 0.6.0 command tools passed
the connected PowerShell/.NET 10 helper proof without a runtime upgrade.

Historical WB-004 runtime: **0.6.1**, 33 tools and six shared command slots, with `C:\work` as the stable primary root and `C:\rift modding` as an additional root. **WB-004 is implemented, deployed, and tested.** Operators can register unrelated folders without rebuilding; discovery distinguishes nested repositories/worktrees and plain folders; project overviews expose scoped instruction evidence; generic acceptance has no real-project dependency.

Acceptance passed 80 integration tests, 21 updater cases, Windows startup/restart checks, generic fixtures, full MCP self-build, real scheduled-controller installation/automatic recovery/manual rollback, and fresh hosted failure → guarded fix → pass/undo in an arbitrary temporary root. Original configuration bytes and credentials were preserved; the temporary root was removed and denied afterward. Both real RiftReader repositories and VMware were untouched. See [validation evidence](validation.md) and [root management](workspace-roots.md). WB-003 remains separate; RiftReader comparison/stabilization follows as separate work.

WB-001 update/recovery tooling and WB-002 terminal execution are implemented and active. The 0.4.0 terminal milestone exposed 33 tools and passed fresh hosted terminal acceptance after operation `wb002-first`. See [validation evidence](validation.md) and the [operator workflow](updates.md). WB-003 remains proposed in [pending upgrades](pending-upgrades.md). The first source commit is user-authorized; its author is supplied per invocation without changing Git settings.

Original 0.3.0 scope: the ten approved coding-workflow upgrades plus saved memory-snapshot inspection (added by the user). Arbitrary terminal access, remote Git pushes, live capture/debugging, and new infrastructure were outside that release. WB-002 subsequently added general terminal execution in 0.4.0.

- [x] Foundation: source/runtime rollback baseline, local status shortcut.
- [x] File changes: create, exact edits, optimistic conflicts, durable change journal, undo, move, recoverable delete.
- [x] Validation: operator-owned command profiles, bounded background jobs, cancellation.
- [x] Inspection: streamed text, filtered/ignored/regex search, historical Git reads/diffs/blame, project overview.
- [x] Git commits: explicitly selected files, preserve unrelated index/worktree, author preflight.
- [x] Snapshots: raw/gzip byte ranges, typed values, bounded byte searches, private streaming cache, RiftReader pose/segment manifests and exact 64-bit address mapping.
- [x] Local tests and bughunt: 40 MCP integration tests, Windows startup tests, RiftReader source/snapshot acceptance, strict build, formatting.
- [x] Rollout: preserve startup/key configuration, update documentation, refresh ChatGPT tools, verify from hosted client.

Each milestone records concrete evidence in validation.md. Continue independent work when blocked; never invent Git identity, request keys in chat, or repeat an uncertain write without checking its operation ID and resulting file.

Implementation and hosted acceptance are complete at 0.3.0 (32 tools). The background runtime is active, its ChatGPT catalog is refreshed, and Workbridge alone uses the explicitly approved Allow all permission. A synthetic hosted acceptance project exercised the full coding workflow and snapshots generated by RiftReader's offline fixture writer; no RiftReader source was changed. At that milestone the host repository had no author identity or initial commit; this does not affect the tested Git tool, whose synthetic repositories use explicit fixture identities. All milestones have evidence in validation.md.

## WB-002 terminal execution (0.4.0)

User-authorized implementation adds `terminal_run` and shared bounded job controls. All 55 integration tests, 21 updater cases, startup checks, staged release checks, version-changing update/rollback fixtures, and live hosted terminal acceptance passed. See [coding workflow](coding-workflow.md) and [validation evidence](validation.md).
