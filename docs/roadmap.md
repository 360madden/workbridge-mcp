# Workbridge upgrade execution

## Storage cleanup readiness — November 15, 2026

Read-only preparation passed for one reversible production trial on
**AMD-DESKTOP**: the old `agent12-activate-20261031-02` candidate runtime.
The fresh plan accepted current identity and duplicate-byte proof; the modeled
reference graph and installed chain are complete across 34 updater operations,
with zero blockers. The bound retained manifest describes 2,865 runtime files
and 74,027,483 logical bytes. The final release, bridge generation and every
rollback backup remain protected; offline recovery is a separate operator
exclusion outside the allowed candidate/displaced source namespace.

The [review packet and exact trial procedure](storage-cleanup-trial-20261115.md)
bind the fresh plan SHA and proposed operation
`gc-agent12-candidate-trial-20261115a`. **No real quarantine or restore trial has
run, and maintenance is not confirmed.** The next gate is exact-target review
and coordinated quiet maintenance for quarantine, status, restore and final
verification. That trial restores the candidate and reclaims zero bytes. No
new server build is needed; later permanent purge remains a separate reviewed
operation after the real seven-day quarantine grace.

## Current deployment — November 14, 2026

**AMD-DESKTOP is running Workbridge 0.16.5-dev, with 66 MCP tools, 36 command-job
slots and 36 coordinated-worker assignments.** Release source `a939ccc` passed all
11 WB-001 gates: 1,347 tests passed, zero failed and six environmental skips.
Final operation `wb0165-archive-final-20261115d` completed; all 2,879 installed
runtime files and its rollback backup match the sealed release.

Live hosted-terminal acceptance reached the existing shared owner, discovered
66 tools, rejected a stale archive hash, preserved 46,500 output characters and
same-request replay, then restored the disposable job's exact original bytes.
The current chat still caches 64 direct tool bindings; refresh Workbridge tools
to expose the two named archive tools directly. This routed acceptance does not
claim that the cached bindings were refreshed.

The attempted historical cap-36 rollback rejected the newer hostname settings.
Recovery installed the validated compatible runtime without changing settings,
then two normal WB-001 activations established a consistent current marker and
immediate rollback backup. **Do not roll back the bridge operation or use the
old cap-36 runtime with current settings.** Use the final operation's documented
recovery path. See [deployment and recovery evidence](wb0165-deployment-20261114.md).

## Storage retention — November 14, 2026

On **AMD-DESKTOP**, the [retention plan](storage-retention-plan.md) now has
reference-aware runtime quarantine/restore and separately reviewed purge in
source. A fresh read-only scan closed the installed chain and reference graph
using narrow evidence for two historical controller preflight refusals; their
operation roots and release references remain protected, with no synthesized
journals or comparison scope. A real candidate plan was reviewed read-only,
but it must be revalidated under coordinated quiet maintenance before any move.
No real retained payload has been quarantined or purged by this workstream.

The deployed Jobs owner now has a one-ID lossless archive reader and
compact/restore writer, exposed through shared CLI/MCP operations. Source commit
`adc2c86` passed the build and **94 focused archive, CLI, recovery, result and
publication tests**; independent review found no remaining safety blocker under
the documented single-owner model. The writer preserves exact record bytes,
request identity and streams, requires positive logical savings, and uses durable
operation receipts. A prior single-record proposal modelled 30,743 logical bytes
of savings while retaining the original. Live acceptance compacted and restored
only a newly created disposable job. No historical job was compacted; the
synthetic round trip and proposal do not establish reclaimed space.

The November 14 census counted 6.23 GiB in updater operations, including about
4.08 GiB of candidate and displaced copies before exclusions. Those figures are
not a reclaimable-space claim. Preserve historical backup runtimes and their
evidence; their compatibility is not implied by retained bytes. The installed
seal is `.local/releases/retention-archive-0165-20261115d`; the older nested
November 5 release and staging references remain protected. The postdeployment
read-only inventory honestly reached its 50,000-entry limit and is incomplete.
Staging roots and durable job IDs must not be deleted by age alone.

Next steps, in priority order:

1. Release validation, activation and routed live archive/restore acceptance are
   complete. Retain the seal, final rollback backup and separate hosted receipt;
   refresh cached client tools before relying on direct archive bindings.
2. Refresh a concrete runtime target's plan and retained-copy/reference proof;
   review and explicitly authorize any quarantine under coordinated quiet
   maintenance. After the full v2 grace period, a real purge requires a separate
   reviewed digest and explicit authorization for that exact operation. Measure
   storage after any authorized purge.
3. Before archiving a historical saved job, review and authorize that explicit
   operation and current hash. The disposable acceptance cycle is complete;
   it does not authorize catalog-wide compaction. Measure actual disk use after
   any real operation. Restore compacted records before downgrading to
   an owner without archive-reader support; one-ID restore does not certify the
   entire state directory.
4. Defer routine scheduling, automatic purge, output expiry and shared GUI controls
   until a successful manual cycle and explicit policy choices. See the
   [ranked next steps](storage-retention-plan.md#ranked-next-steps).

## Historical capacity checkpoint — 2026-11-01

**Historical deployed and committed baseline: Workbridge 0.16.4-dev / 36 command-job slots / 36 coordinated-worker assignments.** The sealed release passed nine WB-001 gates and 1,037 tests (zero failures; three skips). The healthy hosted instance and its capacity were independently verified, and the source, scripts, tests and documentation were reconciled into selected-file Git commits on `main`. The previous 0.16.3-dev/six-slot architecture is retired from active use, while Git and release history are retained. See [36-slot release and adoption evidence](workbridge-36-capacity-20261101.md). Browser-session helpers and tests of 36 independent AI reasoning workers remain separate future work.

**Workspace consolidation completed 2026-11-01:** 34 archived Workbridge validation/experiment folders moved from the `C:\work` root into ignored `workbridge-mcp\temp`; active Workbridge and `Workbridge Health` remain in place. Live configuration pointers, four NTFS junctions and 12 historical Git-worktree metadata pointers were corrected. See [verified relocation inventory and recovery map](workbridge-historical-fixture-relocation-20261101.md).

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
