# WB-019 — Deployed capacity and recovery diagnostics

**0.16.0-dev**, retaining **52 tools** and six shared job slots.
Deployment and direct browser/shared-CLI acceptance passed on October 21, 2026.
Activation `wb019-activate-20261021-01` completed October 21, 2026 at 3:24:41 AM EDT.
UTC: `2026-10-21T07:24:41.1948519Z`. No deployment/recovery error.
Owner during acceptance: `3d43ca1e-0efc-4ddb-b027-add6d27bd089`.

## What changed

The prior diagnostic could show zero running jobs while all six slots held unsaved
results. JOB_LIMIT supplied no original job IDs. Inventory enumeration was unbounded
and read failures were reported as zero. Fourteen new module checks failed against
that baseline; fourteen module and four real MCP/CLI cases now pass. Those failures
establish missing coverage/behavior, not that all existing operations were broken.

Existing diagnostics now exposes current-owner capacity and compact recovery IDs;
the same view is attached to JOB_LIMIT. No command, argument or captured log is
included in that compact view. A bounded inventory scan reports complete, partial
or unknown counts. **storedJobs may be null**; a partial count is only a lower bound.
A successful diagnostics request returns the report, not a blanket health approval.
See [the full contract](job-capacity.md).

No queue, scheduler, slot reservation, automated command retry, cancellation or
result recovery was introduced. The existing explicit guarded recovery remains
responsible for saving retained results and freeing their slots.

## Validation

| Check | Result |
| --- | --- |
| Full candidate suite | 402/402 passed |
| Fresh installed suite | 402/402 passed; exit 0; no skips or cancellations |
| New production-only cases | 18/18 passed; included in the full count |
| Release gates | All seven passed |
| Installed runtime | 2805 files matched the seal |
| Sealed payload | 2990 files matched |
| Rollback runtime | 2805 files matched |
| Preserved backup | 3388 files matched |
| Expected source before final documentation | 187 files matched |
| Live configuration | Six original hashes unchanged |
| Main Git staging | Original index hash unchanged |

Installed suite `wb019-installed-full-tests-20261021-01` ran compiled tests without
rebuilding the running installation. Production-only execution used an offline
installation with no application source, TypeScript or Prettier. No dependency
versions changed. Red results and passing results are preserved separately.

Seal: `wb019-20261021-review01`.
Manifest SHA256: `6A6AA46A627C046DF39D7C7C8167F03C7E4F145171782395131ECCF98803B1C0`.
The independent updater installed runtime/package files after fresh checks found no
other active jobs or retained save failures. RogueTV's earlier active job was not
cancelled. The updater's local hosted-verification flag was not rewritten to imply
an external check; actual browser proof is retained separately.

## Direct browser and shared CLI proof

A direct browser diagnostics call reached the replacement owner and showed six
available slots. A direct browser launch of the disposable active fixture consumed
one slot; diagnostics identified its exact job ID/project/status and command_status
as the next inspection action. The shared CLI observed that same fixture, plus its
own executing driver. Different-time global counts were not falsely equated.

Direct browser cancellation terminated only that fixture. A subsequent direct
browser diagnostic showed all six slots free; the CLI verified the cancelled state,
that the child was gone, and removal of the fixture from capacity. A normal command
then succeeded once. CLI replay did not execute it again or rewrite its completed
record. Hash-guarded browser restoration returned the counter to empty, and another
replay left it empty. Original fixture Git staging/unrelated dirty bytes and both
completed-job record hashes were unchanged.

Actual all-six-retained states, read denial, linked catalogs and concurrent recovery
were exercised in private disposable module/MCP/CLI owners, including production-only
tests. No live journal fault or six-slot saturation was manufactured.

## Preservation and resume

Thirteen source files were promoted by a guarded patch; two package files were
installed with the runtime by the updater. The complete 1,069-line submitted source
diff and package metadata-only change were reviewed by the implementing assistant,
not an independent reviewer. Prior releases, backups and evidence remain unchanged.
No main staging, commit, push, credentials, permissions or real Rift/RRE edits.

Evidence: `C:\work\workbridge-wb019-20261021-01\evidence`.
Documentation patch: `wb019-deployed-docs-20261021-01`.
Final reports are documentation-validation.json, deployed-integrity-after.json,
checkpoint-workflow-review.json and milestone-complete.json. Inspect their actual
pass state. Expected hashes of intentional documentation changes were saved before
application; the sealed preparation documentation remains untouched.

Capacity is a current-owner observation, not a reservation. Inventory and live
capacity are not an atomic filesystem snapshot; counting names does not validate
record contents. Scan-time budgets are cooperative, not forced cancellation of an
outstanding filesystem operation. Already-lost owner memory cannot be recreated.
The inherited named command_retry_save browser-catalog gap remains separate; CLI
recovery works and existing diagnostics was directly verified in browser Chat.
No permanent reply-rendering fix or power-loss guarantee is claimed.

Resume from [the handoff](handoff-20261020.md). Do not repeat activation or fixed
acceptance IDs. No further runtime feature was started.
Model: GPT-6 Astra Pro. Reasoning level:
