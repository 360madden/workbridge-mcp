# Workbridge storage retention and garbage collection

November 14, 2026. Active machine: **AMD-DESKTOP**. This is an implementation
plan; no retained runtime, backup, job, fixture or evidence has been deleted.
The first implementation is an offline, read-only storage inventory. Source
commits, installed runtime changes and reclaimed disk space are separate results.

## Outcome and priorities

Reduce repeat runtime/dependency copies while preserving the installed service,
usable rollback, unresolved recovery, unique source/configuration backups,
request idempotency and useful investigation evidence. Use CLI operations and
structured receipts first; a compact GUI can consume the same operations later.
Ordinary retention decisions should use local rules, without model calls.

Work in this order, reassessing after each measured result:

1. **Bounded read-only inventory and reference preview.** Count the large storage
   areas, identify resource units and explain protection. Distinguish counted
   bytes, potentially eligible bytes and actually reclaimed bytes. Inventory
   alone never establishes deletion eligibility.
2. **Obsolete update/release payloads.** Resolve the installed marker, deployment
   requests and rollback references before proposing individual resources. This
   is the first cleanup target because prior inspection found several GiB of
   repeat copies here. Keep small history and unique backups.
3. **Recoverable maintenance with explicit purge.** Implement guarded quarantine,
   restore and later purge of reviewed resource units. Confirm real disk savings
   only after purge; a move on the same volume reclaims no space.
4. **Job-output compaction.** Expire large output while keeping durable command
   identities and workflow reconciliation. This requires owner/schema work;
   deleting historical job JSON is not an acceptable shortcut.
5. **Routine retention and UI.** After a successful manual cycle and recovery
   exercise, add bounded scheduled previews, pressure reporting and shared GUI
   review. Automatic purge remains an explicit operator policy, not the default.

## Current source findings

The bounded November 14 census counted the following logical file bytes. This
is a changing filesystem, not an atomic snapshot or an allocated-space measure.
Four links under `temp` were skipped; their targets are not included.

| Area | Counted bytes | Approximate GiB |
| --- | ---: | ---: |
| `.local/update-operations` | 6,689,171,575 | 6.23 |
| `.local/releases` | 2,577,954,844 | 2.40 |
| `temp` | 2,325,410,128 | 2.17 |
| `investigations` | 1,300,410,354 | 1.21 |
| `.local/jobs` | 325,723,318 | 0.30 |
| Three `.local/wb001-gui-src-*` staging roots | 245,061,484 | 0.23 |

Within updater operations, candidates account for 2,190,105,261 bytes,
displaced runtimes for 2,187,367,054 and backup runtimes for 2,187,367,054.
Candidate plus displaced bytes total about **4.08 GiB before exclusions**.
That is a prioritization ceiling, not a reclaimable estimate. Source backups
including archived Git metadata total 71,823,624 bytes, configuration 174,317
and backup manifests 51,168,208. Retaining these smaller unique resources while
reviewing duplicate runtime trees offers a better tradeoff than starting with
job history.

The updater intentionally retains operations, backups, displaced trees and tasks.
See [update and recovery operations](updates.md),
[the deployment implementation](../scripts/Workbridge-Update.ps1) and
[the existing job preview](../scripts/preview-job-retention.mjs).

Fresh metadata inspection found installed operation
`wb001_gui_prep03_apply_20261105a`. Its request points to
`.local/wb001-gui-src-20261105c/.local/releases/gui-quarantine-20261105-prep03`.
Protecting only `.local/releases` would miss that release; deleting the enclosing
staging root would also delete it. Resolve references before classifying parents.

Starting from the installed marker's `operationId`, following `previousRelease`
in each operation journal reaches all 30 completed updater operations.
Two additional operation directories have no journal and remain
unknown/protected. All inspected journals have `hostedVerified=false`; this field
alone cannot distinguish historical hosted acceptance because the updater
intentionally does not certify an external caller. Consult explicit acceptance
evidence rather than inventing a true value.

Rollback reads the selected operation's journal, controller/request,
`backup/runtime` and `backup-manifest.json`, then restores the preceding marker.
It does not restore from that operation's candidate or displaced runtime.
Therefore classify resources within an operation rather than deleting entire
operation roots or retaining every duplicate forever. Preserve source, Git and
configuration backups until their uniqueness and recovery value are understood.

Historical fixture relocations include junctions and Git worktree metadata.
`temp` is not synonymous with disposable. Investigation artifacts, raw captures,
undo snapshots and configuration are excluded from initial cleanup.

## Protection and proposed retention policy

These are proposed defaults for the eventual reference-aware planner, not
authorization to apply them to current files:

| Resource | Default treatment |
| --- | --- |
| Installed runtime, exact sealed release and required containing paths | Protect |
| Current operation and rollback chain | Initially preserve all 30 backup runtimes; verify checksums before declaring rollback available |
| Unresolved, missing, malformed or unknown operation state | Protect; report the blocker |
| At least 14 days old, completed, redundant candidate/displaced runtime | Review only after equivalent retained bytes and all references are verified |
| Referenced release, active preparation or Git worktree/staging root | Protect regardless of age |
| Unreferenced sealed release older than 30 days | Review only after validation and recovery references are closed |
| Operation request, controller, journal, manifests and retirement receipt | Retain compact history |
| Unique source, Git metadata, configuration/task backups | Preserve; no automatic age expiry in the first version |
| Job IDs, request digests, terminal status and workflow attempt references | Preserve durable semantics; compact output separately |
| Credential material, settings, change/patch/workflow journals and undo snapshots | Outside initial GC scope |
| `temp`, investigations and relocated fixtures | Inventory only until explicit ownership/reference proof exists |

Keep a seven-day quarantine grace period for eligible payloads. An explicit size
budget can prioritize review but must never override a protection. If protected
bytes exceed the budget, report that condition and the responsible resources.
Do not promise a reclaimable total before reference and equivalence checks pass.

If a finite rollback depth is introduced later, use current plus two preceding
generations as the proposed minimum, subject to an explicit policy choice and
recovery trial. Finite rollback depth must be explicit in retained metadata. A restored historical
marker must not silently imply that an already retired older runtime can still
be recovered. Keep retirement receipts, report unavailable generations before any
service stop, and test updater rollback/downgrade behavior before retiring backups.
Initially target redundant candidate/displaced copies rather than backup/runtime.
The first mutation scope should exclude releases as well: release retirement
needs dispatcher/builder coordination beyond the controller's existing lock.

## CLI and execution contract

The inventory foundation is `scripts/preview-storage-retention.mjs`. It reads
bounded metadata under an explicit installation root, skips links, reports errors
and incomplete scans, and emits JSON. Its classifications are inventory-only.
It does not load the server, stop services, acquire runtime ownership, rewrite
state or propose executable deletion commands.

```powershell
node scripts/preview-storage-retention.mjs --install-root C:\work\workbridge-mcp
```

Exit `0` means the requested inventory completed, `1` means incomplete/unsafe
metadata or a scan limit, and `2` means invalid arguments. Optional
`--max-entries`, `--max-scan-ms`, `--max-depth` and `--max-units` remain bounded.
Default scans allow 50,000 entry visits, 20 seconds, depth 64 and 500 output
units. A large installation can exceed these limits; a partial total is a lower
bound and cannot establish reference closure. The Windows metadata helper uses
fixed read-only PowerShell code and JSON input to check reparse attributes.
Ancestor/path checks remain a best-effort live inventory, not handle-based
authorization for later deletion.

The subsequent reference-aware CLI should expose `preview`, `quarantine`,
`status`, `restore` and `purge` over shared operations. A preview identifies exact
resource units, reason codes, observed references, metadata/digests, policy,
limits, completeness and logical byte totals. Save a reviewed preview only to an
explicit output path. Use a durable operation ID and preview digest for mutation;
never accept a caller's arbitrary recursive-delete path.

Immediately before mutation, recheck the full root/ancestor chain, no links or
reparse points, resource identity and content preconditions, installed marker,
references and exclusions. Reject changed, incomplete or uncertain inputs.
Do not traverse junctions or hardlinks to infer unique physical savings. Do not
follow a resource's reference outside the allowlisted installation silently.

Serialize mutation with the updater and active preparation. The existing
`updater.lock` protects updater/job admission but is not a universal GC lock over
job finalization or workflows. Initial mutation should require a coordinated
maintenance interval; an idle snapshot alone is insufficient. Later online
compaction must participate in the owner's actual publication serialization.
Never start a competing owner or restart the service as part of an inventory.
The dispatcher validates a release and writes its request/controller before the
deployment controller acquires `updater.lock`. A later release-cleanup feature
must close that interval with shared admission coordination or a verified quiet
maintenance window. Do not treat the controller lock alone as full serialization.

Journal intended actions before moving a resource into a private same-volume
quarantine. Check postconditions and retain restore metadata. On interruption,
`status` reconciles exact source/destination identities; retrying the operation
must not repeat an uncertain move. Restore refuses a replacement at the original
path. Purge rechecks references and grace period, is explicit and irreversible,
and records logical bytes removed separately from observed volume free space.

## Job compaction requirements

`Jobs.start()` loads the job ID before launch. The retained request digest lets
the same request replay its result and makes a changed request fail `ID_REUSE`.
A missing job for a workflow attempt in `starting` state can be interpreted as
never launched. Removing the record can therefore repeat real side effects.
A `.result.json` by itself is not an equivalent replay record.

Introduce a versioned durable terminal tombstone before expiring output. Preserve
ID, request digest, terminal result, timestamps and references; output APIs must
report explicit expiration, never fabricated empty output. The current stored-job
parser strips unknown keys, so adding an expiration flag alongside `output:''`
would silently mislead an older runtime. Make old owners fail closed on new
tombstones and test supported rollback compatibility before deployment.

Start with explicitly old successful output. Preserve running, finalizing,
cancelling, retained-unsaved, interrupted, failed, malformed and unknown records
until separately supported. A complete terminal record and clean ownership are
required before retiring worker result files. Keep change/patch/workflow undo
and request-dedup domains separate from output retention.

## Acceptance and delivery gates

For the inventory: test no writes/service imports, stable schema and bounded
output, deterministic classifications on an unchanged completed fixture,
missing roots, links/junctions, nested staging roots, unreadable/changing entries,
depth/entry/time/output budgets and honest incomplete totals. Run the read-only
CLI on AMD-DESKTOP and retain only a compact summary in this plan.

For resource planning: fixture the actual nested installed-release arrangement,
previous-marker chain, unresolved/missing journals, malformed references, shared
resources, live preparation, unique source/config backups and partial scans.
Assert protections and non-overlapping byte accounting, not just candidate age.

For duplicate screening, the release manifest is relative to `payload`, while
`backup-manifest.json.files` is relative to `backup/runtime`. Candidate comparison
must filter the release manifest to exactly `dist`, `node_modules`, `package.json`
and `package-lock.json`. Displaced runtime comparison uses the backup runtime
map and preserves that backup. Validate paths, duplicate names, sizes and digests;
bind the release manifest digest to its passed validation receipt and deployment
request/journal. A complete matching names/size census is only a screen: hash
the current resource and its surviving copy before declaring equivalence.
Two sampled old operations had no standalone candidate manifest. If the recorded
release is outside the installation or unavailable, retain the candidate unless
another explicitly qualified retained copy supplies proof; do not follow the
external path automatically.

For mutation: disposable fixtures only until move/restore, stale-preview refusal,
lock contention, directory replacement, crash at each journal boundary,
idempotent retry and purge-reference rechecks pass. Verify the existing updater
can still validate and restore every promised generation. No service deployment
or real purge is implied by passing synthetic tests.

For jobs: prove compacted same-ID replay and changed-ID-request refusal without
launching a worker; workflow crash/restart reconciliation must not rerun effects.
Cover explicit output expiration, old-owner refusal, pending-save ownership,
concurrent publication, SHA changes and incomplete inventories.

Commit each verified slice with exact owned files. Publish disk savings only
after actual deletion and independent measurement. Reassess the next priority
using measured size, risk and current blockers rather than expanding cleanup to
unrelated projects.

## First implementation validation

The standalone inventory and existing job-preview suites passed **25 tests with
one host-privilege skip** on AMD-DESKTOP. Directory-junction coverage passed;
the skipped case required file-symlink privilege. Scoped JavaScript formatting
and PowerShell syntax checks passed. No production build or deployment was
needed for these standalone scripts.

An actual ten-second CLI run exited `1`, reported `complete=false` and
`TIME_LIMIT`, visited 38,022 entries and counted 818,939,569 logical bytes. It
discovered 128 resource rows across categories, including all three staging
roots and their nested release groups before sizing exhausted the budget.
Those bytes are a partial lower bound, not the full census above. This verifies
the bounded read-only behavior. At that checkpoint, reference closure, duplicate
proof, quarantine, restore and purge were still upcoming work. No retained data was deleted and the
live service was unchanged.

## Reference and duplicate preview

`scripts/preview-runtime-retention.mjs` now connects the reference graph to
bounded, current-content comparison of a selected completed operation:

```powershell
node scripts/preview-runtime-retention.mjs --install-root C:\work\workbridge-mcp
node scripts/preview-runtime-retention.mjs --install-root C:\work\workbridge-mcp --operation artifact-verify-update-20261031-01 --kind displaced --max-scan-ms 60000
```

`--kind candidate` compares against the runtime subset of an internal sealed
release, checking the named validation gates and manifest binding first.
`--kind displaced` compares the operation's single GUID-named displaced tree
against its preserved backup runtime and manifest. Multiple or unknown displaced
layouts remain refused. Both actual trees must match every manifest file and
contain no unexpected runtime entries. Both copies are streamed through SHA-256.
The selected metadata is re-read afterward; changes invalidate the comparison.
No request provides an arbitrary deletion path, and every result remains
`mutationEligible:false`.

The graph discovers 32 operation directories and traverses all 30 installed
predecessor identities. At `cap12-activate-20261031-01`, the recorded previous
runtime version differs from its predecessor marker version; this is reported
as a caveat and does not certify exact-version rollback. Two missing journals
leave the overall graph incomplete while preserving those entire operations.
Independent hash evidence for another completed operation remains reportable.
The active internal release seal binds the manifest bytes to the installed
marker, request, journal and passed named validation gates. Its status is
`manifest-bound` with `payloadVerified:false`; this is not a fresh runtime or
whole-release acceptance check. Selected active metadata is re-read at the end.
Exit `1` therefore can include a successful duplicate comparison alongside
unresolved graph blockers. Inspect both fields; it never means deletion ready.

An initial real comparison reached its 60-second budget without finishing and
correctly withheld proof. A proof-local Windows metadata cache, keyed by full
file identity and nanosecond timestamps, reduced repeated checks while retaining
fresh stat/handle checks and hashing both trees. The bounded rerun verified
5,730 files and 148,056,112 bytes across the two copies in 32.4 seconds. That
establishes observed equality of a 74,028,056-byte displaced runtime and its
preserved backup during that non-atomic scan. It does not qualify the operation
for age-based retention or deletion. No disk space was reclaimed.

After final ancestor-identity hardening, a separate candidate-to-sealed-release
comparison verified 5,730 files and 148,058,650 bytes across both copies in
30.0 seconds. The active seal was manifest-bound, the 30-operation lineage was
complete and the same two missing journals kept the overall result incomplete.
The combined preview/reference/duplicate suite passed **60 tests with one
host-privilege skip**. The ancestor replacement regression uses an injected file
identity change; Windows refused the attempted physical reparent fixture.

The next implementation is journaled quarantine/restore of explicitly reviewed
resource units, with fresh reference and identity checks under coordinated
maintenance. Purge and job-output compaction remain later gates.

## Quarantine and restore implementation

The CLI is now `node scripts/storage-retention.mjs --help`, with shared operations
for `plan`, `quarantine`, `status` and `restore`. It exposes no purge command.

```powershell
# Read-only policy/proof checks; save only to an explicit absent output file.
node scripts/storage-retention.mjs plan --install-root C:\work\workbridge-mcp --updater-operation OLD_OPERATION --kind displaced --output C:\absolute\reviewed-plan.json

# Review the exact plan and coordinate quiet clients/builders before maintenance.
node scripts/storage-retention.mjs quarantine --plan C:\absolute\reviewed-plan.json --expect-plan-sha256 REVIEWED_SHA256 --operation-id GC_OPERATION --maintenance-confirmed
node scripts/storage-retention.mjs status --install-root C:\work\workbridge-mcp --operation-id GC_OPERATION
node scripts/storage-retention.mjs restore --install-root C:\work\workbridge-mcp --operation-id GC_OPERATION --expect-plan-sha256 REVIEWED_SHA256 --maintenance-confirmed
```

These examples are templates, not a reviewed action for current retained data.
The maintenance flag attests that clients, builders and manual writers have
been coordinated; an idle snapshot or updater lock alone cannot establish that.

The first policy requires a complete reference graph, a completed operation at
least 14 full days old, an unreferenced allowed resource, and current byte-equivalence
proof. The current and immediately previous deployment generations are excluded.
Every recovery backup remains protected. A metadata-only preflight rejects known
blockers before hashing runtime copies. Actual AMD-DESKTOP plan creation refused
`REFERENCE_GRAPH_INCOMPLETE` in about 1.35 seconds because of the two retained
missing journals. It created no plan, quarantine directory or maintenance lease.

The candidate/displaced age was reassessed from the initial proposed 30 days to
14 days after this milestone. The oldest current deployment is October 18, so
the original cutoff would prevent any useful current cleanup despite keeping
every recovery backup. Fourteen days, exclusion of the current and preceding
generation, active duplicate verification and the planned seven-day quarantine
grace give a practical first default. Release review remains 30 days; backup
retention has no automatic expiry. No purge is implemented or authorized here.

Plans bind the actual host, canonical installation path, exact updater operation
and resource kind, native directory volume/file ID, manifest, source/retained
file evidence and stable reference metadata. Output is create-only; execution
requires the reviewed canonical plan SHA-256 and a durable GC operation ID.

The journal lives at `.local/storage-quarantine/<GCID>`. Preparatory creation
checks ordinary ancestry and flushes a create-only immutable intent before any
payload move. An existing incomplete or different intent refuses reuse. This
preparation is path-based and assumes coordinated maintenance; it grants no move
authority. Before movement, the Windows helper pins the relevant directory
chains, holds the updater's exclusive lock, rechecks volume/reparse state, and
renames the expected directory through its handle without replacing an existing
destination. There is no production Node rename fallback.

The engine revalidates the plan under the lease and verifies payload bytes before
and after movement. Its prepared/quarantined/restoring/restored states reconcile
the original and archive directory identities. Both locations present, neither
present, unexpected identity, modified payload or a restore collision refuses
without overwriting. Restore verifies the archive against its retained proof;
it does not require the original source still to exist or rerun the original
source preview. Status is read-only.

Phase receipts are generated from fixed fields by the native helper, written to
a unique private temporary file, flushed, then published atomically with a
handle-relative no-replace rename while the lease is held. A crash before
publication leaves an inert scratch file and an absent phase, allowing existing
identity-based reconciliation. Explicitly corrupted journal files fail closed.
A partial initial intent still requires manual reconciliation, before a payload
can move. Source contents rely on coordinated quiet writers; neither the hash
scan nor the final lease observation claims an adversarially atomic whole-tree
snapshot.

Disposable Windows acceptance has exercised the full CLI plan, quarantine,
status and restore sequence, preserving both runtime copies. Separate fixtures
cover native lock contention, no-overwrite moves in both directions, identity
and junction refusals, lease timeouts, atomic phase publication, interrupted
state transitions, stale plans and journal corruption. Only generated test
installations were moved. No real retained data or running service was changed,
and quarantine frees zero disk space. Real maintenance, purge, job compaction
and routine scheduling remain open.

Validation on AMD-DESKTOP: the combined retention suite passed **105 tests with
one file-symlink privilege skip**, including the full native CLI fixture and
adapter shutdown/output-limit cases. The final 14-day age-policy check passed
all 15 focused plan tests, including the exact UTC boundary. The separate
Windows PowerShell native fixture also passed. These checks exercised process
interruption and disposable filesystem state, not system power-loss recovery or
an unattended real service maintenance window.

## Purge prerequisites (deletion still pending)

New native phase receipts use `workbridge-retention-phase/2`, adding an exact UTC
`publishedAtUtc` timestamp generated before atomic publication. Status and restore
still accept legacy v1 receipts. The read-only `purge-check` command requires a
committed v2 quarantine, the original source absent, the expected directory at
the quarantine location, and seven complete days since publication. Future,
invalid or changed receipts refuse. Legacy receipts have no trusted grace start
and are never backdated from filesystem times.

```powershell
node scripts/storage-retention.mjs purge-check --install-root C:\work\workbridge-mcp --operation-id GC_OPERATION
```

This reports grace/location prerequisites only, with `mutationAuthorized:false`.
It does not establish current reference closure, surviving-copy proof or deletion
authority. Production CLI exposes no clock override and still has no purge action.

The native read-only Inventory mode now inventories only the derived quarantine
payload, with full volume/file IDs, exact relative paths, entry types, sizes,
link counts and default-stream SHA-256. It refuses reparse points, hardlinked
files, named streams on files/directories/root, unsupported file attributes and
exceeded bounds. A directory can have named streams: disposable Windows tests
confirmed this, so ordinary file hashes alone are insufficient purge evidence.

Inventory is bounded at 20,000 entries, 512 MiB hashed data, 60 seconds and an
8 MiB response. The adapter gives only this mode the larger bounded frame and
wait; ordinary protocol limits remain smaller. Its consumer binds the native root
identity, validates topology/paths/counts and canonicalizes entry order. The
snapshot remains explicitly non-atomic and authorizes no mutation.

Disposable acceptance passed for the real native CLI cycle including v2 receipts,
read-only inventory and an unelapsed grace result. The final combined
engine/CLI/adapter/inventory/grace suite passed 38 focused tests. The separate Windows native fixture passed named-stream,
hardlink, junction, sparse/oversized, Unicode and ordinary inventory cases.

Actual irreversible purge remains the next implementation. It needs a reviewed
digest binding native per-entry identities, a verified surviving copy, fresh
closed references and a durable partial-deletion ledger. On interruption, only
the recorded in-flight deletion prefix may be absent; newly created or replaced
entries must survive and cause conflict. Directory pins do not freeze child
creation, as a disposable Windows probe demonstrated. No generic pathname-based
recursive deletion or weaker whole-tree snapshot claim is an acceptable fallback.
No real retained data was deleted and no disk space has been reclaimed.

## Journaled purge mechanism checkpoint (production proof integration pending)

The separate `Storage-RetentionPurge.ps1` helper, Node lease provider and journal
core now implement bounded deletion against a reviewed immutable per-entry
manifest. The native lease pins the operation parents, approval and manifest,
checks original-source absence, requires a v2 quarantine receipt at least seven
full days old, and refuses legacy, future or malformed times. Grace is checked
again before each batch. Unknown purge-namespace records refuse execution.

Deletion uses verified entry handles in reverse manifest order, at most 32
entries per batch. Fixed-schema intent/done/final records are published without
replacement under the same lease. Replay permits only the committed absent
prefix and a contiguous absent prefix within the one recorded in-flight batch.
New names, replaced identities, modified data, links, streams or unexpected
absence stop the operation. The provider executes the exact SHA-256-verified
helper bytes while holding its source open against write/delete sharing.

The core requires fresh reference and retained-copy proof at entry, before each
new intent, immediately before deletion and before final publication. V1 purge
approval fingerprints must match exactly; unrelated update-history drift can
therefore stop a partial run and needs explicit reconciliation. No implicit
baseline replacement or relaxed reference comparison is implemented. Ordinary
quarantine/restore refuses destructive purge markers under the shared lease;
its status labels observed markers without claiming a verified final ledger.

The focused checkpoint passed 57 tests on AMD-DESKTOP, including four real
provider/native NTFS end-to-end cases. The partial-prefix case simulates an
interruption; it is not a native-process kill during deletion or a power-loss
test. Other fixtures exercise missing/future/recent timestamps, unknown markers,
identity conflicts and recoverable journal boundaries.

The mechanism checkpoint above used synthetic safety proofs. The subsequent
production-proof and CLI integration is recorded below. No real quarantine or
purge, service update, or disk-space reclamation has occurred.

## Reviewed preparation and production proof CLI

`purge-prepare` now takes a single maintenance lease, inventories the complete
quarantine, verifies the entire original surviving copy and current closed
reference graph, then publishes a fixed manifest followed by its approval draft.
The helper independently reconstructs canonical bytes and confirms the reviewed
hashes before no-replace publication. Identical preparation can be retried;
manifest-only publication can resume, and mismatched or approval-only states
refuse. Preparation does not delete or move the payload, and restore remains
available until a destructive purge marker is published.

```powershell
node scripts/storage-retention.mjs purge-prepare --install-root C:\work\workbridge-mcp --operation-id GC_OPERATION --maintenance-confirmed
```

Review the returned operation, exact digests, entry count, logical bytes and
proof before invoking the separate permanent deletion command:

```powershell
node scripts/storage-retention.mjs purge --install-root C:\work\workbridge-mcp --operation-id GC_OPERATION --expect-purge-sha256 REVIEWED_LOWERCASE_DIGEST --confirm-permanently-delete GC_OPERATION --maintenance-confirmed
```

The full surviving-copy proof uses the original immutable file inventory and
updater manifest even after entries have disappeared from the quarantine. It
reuses the existing duplicate verifier's file/metadata checks and fingerprint
calculation, with a single surviving tree. The native core receives a clone of
the validated original inventory and revalidates production proof before further
deletion and final publication. It never substitutes a different surviving copy
or silently accepts changed approval fingerprints.

Two actual NTFS outer-operation fixtures passed using real retention plans,
reference graphs, native inventories and surviving-copy verification: candidate
interruption/recovery and displaced-copy purge. Both retained their surviving
copies. These fixtures deliberately created old v2 receipts and moved generated
temporary payloads; there is no production clock override. Focused proof/core
checks also passed. Neither source tests nor a successful fixture authorize real
deletion. Actual maintenance still requires a reviewed target and explicit
confirmation. The two historical missing-journal cases are handled by the narrow
evidence classification below; job compaction and scheduling are later work.

## Historical controller refusals

The reference scanner recognizes exactly two reviewed AMD-DESKTOP invocations:
`agent12-activate-20261031-01` and `gui006-activate-20261026-01`. Their retained
controllers reported an initial health-probe failure before invoking deployment.
A versioned catalog binds the exact request, error, probe, controller and service
task bytes, expected directory contents and fresh filesystem identities. The
scanner checks those contents again after reading the evidence. Changed, linked,
missing or additional evidence keeps the graph incomplete.

The resulting `controller_preflight_refused` disposition describes the observed
invocation only; earlier history remains unproven. No journal is synthesized.
These operations have null journal bindings and no comparison scope, and their
operation, release and executable references remain protected. Ordinary journals
cannot claim this reserved disposition. An installed or predecessor edge that
requires either absent journal still refuses closure.

The classifier/reference suite passed 24 tests, and a fresh read-only scan
reported a complete reference graph and installed chain with both operations'
protections retained. This permits evaluating unrelated old candidate/displaced
copies; it does not authorize moving or deleting either historical operation.

A real candidate plan for `agent12-activate-20261031-02` subsequently passed the
outer read-only CLI. Its duplicate preview hashed 5,730 files across the candidate
and retained release (148,054,966 bytes total). The initial cold plan exhausted
the old 30-second preview budget; the default is now 60 seconds, still within the
existing maximum, and refused plans retain their underlying proof reason. The
successful review record is saved under ignored `.tools/retention-evidence/`.
No real payload has been moved or deleted; a saved plan still needs fresh
maintenance revalidation before quarantine and the full grace/review flow before
permanent deletion.
