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
| Older than 30 days, terminal, redundant candidate/displaced runtime | Review only after equivalent retained bytes and all references are verified |
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
the bounded read-only behavior; reference closure, duplicate proof, quarantine,
restore and purge are still upcoming work. No retained data was deleted and the
live service was unchanged.
