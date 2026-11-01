# WB-015 — Deployed saved-job recovery and publication acceptance

Date: **October 21, 2026 EDT**. Version: **0.14.0-dev**, **51 tools**.  
Status: **Deployment and hosted tool acceptance passed.** Browser final-reply
rendering remains separately unverified.

## Release and activation

Reviewed release: `wb015-20261021-review02`, under
`C:\work\workbridge-wb015-20261020-01\candidate\.local\releases`.
Manifest SHA256:
`A06C46999908538F792001FCC74785D4C888B6858FD997B861F89A0F88241108`.
All seven release gates returned zero. The original review01 failed testing,
received no validation receipt, and was never installed; its evidence is retained.

The independent updater completed `wb015-activate-20261021-01` at
**00:21:02 EDT / 04:21:02 UTC**, replacing 0.13.0-dev, with no deployment error,
recovery error, or controller error. The updater's `hostedVerified: false`
remains unchanged: this report records external hosted proof separately.

Fresh browser and connected CLI observed the same 0.14.0-dev owner:
`e71cf4eb-075c-40f2-9c4b-0391e61dd467`.
Owner IDs and ports are acceptance evidence, not fixed configuration.

## Verification

| Check | Actual result |
| --- | --- |
| Candidate full suite | 332/332 passed |
| Sealed-release suite and seven gates | Passed |
| Production-only focused tests | 36/36 passed; subset of 332 |
| Fresh installed full suite | 332/332 passed; no skips or cancellations |
| Real persistence probe after correction | 40/40 results saved; zero errors |
| Final read-only saved-job comparison | 1,041 records; identical summaries and hashes; zero issues |
| Installed runtime | 2,805 files matched sealed hashes |
| Sealed payload | 2,973 files matched; seal preserved |
| Rollback runtime | 2,805 files matched backup hashes |
| Retained source/configuration backup | 3,371 files matched |
| Reviewed source before final documentation | 170 files matched expected baseline/promotion |
| Live configuration | Six file hashes unchanged |
| Main Git index | Original hash unchanged |

Installed test job: `wb015-installed-full-tests-20261021-01`, exit 0.
It used `node --test test/*.test.mjs`, not a build over the running service.
Production-only execution used `npm ci --offline --omit=dev --ignore-scripts`;
source, compiler, and formatter were absent. No dependency versions changed.

The 36 new cases cover saved-record identity/schema/size/storage consistency,
partial-error paging, output/time budgets, cross-client failures, isolated restart,
legacy output, exactly-once replay, and delayed/transient/permanent publication.
Fault injection and malformed records remained in private disposable state.
No real live job journal was deliberately corrupted to manufacture a hosted error.

## Live browser and CLI acceptance

Disposable project:
`C:\work\workbridge-wb015-20261020-01\Hosted fixture ü`.
It held staged baseline files plus an unrelated dirty edit.

Browser launch `wb015-hosted-success-20261021-01` completed successfully.
CLI replay returned the same job without a second execution; the counter was
exactly one. Output tails and the final saved record agreed with the passed status.
CLI launch `wb015-hosted-failure-20261021-01` produced actual child exit **7**;
its waited batch exited **1**, skipped its sentinel write, and retained stderr.
A direct browser output call observed the same failure and code.

CLI launch `wb015-hosted-block-20261021-01` was visible in the browser's live
job view. A sparse browser catalog page returned zero saved rows, an explicit
`nextOffset: 1000`, `complete: false`, and the active job separately. Browser
cancellation terminated that fixture process; the CLI verified cancelled state
and that its recorded child PID no longer existed.

The CLI continued from the actual browser offset. All **five pages** were retained;
the three fixture IDs appeared once each, and final completeness was true. No
cursor was guessed. Driver IDs used a late-sorting prefix during continuation.
Pagination remains live, not a snapshot guarantee.

A hash-guarded browser write restored the empty counter. Replaying the completed
success job again did not alter it. Counter, unrelated dirty file, and fixture
Git index all matched baseline; the sentinel file remained absent. Evidence and
fixture records were retained rather than removed to conceal outcomes.

## Promotion, preservation, and evidence

Source promotion `wb015-source-promotion-20261021-01` applied 18 explicit files;
two package files were installed by the independent updater. The same assistant
reviewed the complete 1,842-line submitted diff using paged reads; no independent
agent review is claimed. The first preview was truncated, but preflight checked
all hashes and the complete submitted diff was preserved and reviewed before apply.
No undocumented source merge, Git reset, broad staging, commit, or remote push occurred.

Evidence root: `C:\work\workbridge-wb015-20261020-01\evidence`.
Key evidence includes original reproductions and failed logs, both compatibility
comparisons, production verification, source review/promotion, deployment journal
output, installed test output, actual browser observations, raw shared CLI batches,
all five catalog pages, and restored fixture hashes.

The documentation checkpoint uses `wb015-deployed-docs-20261021-01`.
Expected documentation hashes are recorded before applying it. Final results
`documentation-validation.json` and `deployed-integrity-after.json` verify those
intentional changes, all other expected source, configuration, Git staging,
sealed/runtime/rollback files, and restored fixture. Inspect their actual results.

## Limits and next resume

Structural validation does not authenticate forged internally consistent records.
Bounded read fingerprints do not eliminate every external filesystem race.
Successful publication is distinct from guaranteed survival of sudden power loss.
A permanent record-save failure is retained only in the current owner, consumes
one existing job slot, and requires output preservation/storage investigation
before any separately authorized restart. No automatic command retry or repair
was introduced. An explicit no-restart recovery path remains a future audit target.

The Windows probe established EPERM rename failures, not their underlying lock
source; no antivirus or external-process attribution is claimed. Historical
browser display failures are not declared fixed. Tool correctness and visible
final-response rendering remain distinct.

Resume from the [handoff](handoff-20261020.md); do not repeat completed activation.
The sealed release and earlier milestone evidence stay unchanged.

Model: **GPT-6 Astra Pro**.  
Reasoning level:
