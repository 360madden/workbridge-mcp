# WB-014 — 0.13.0-dev deployment and browser/CLI acceptance

Date: October 20, 2026 EDT (October 21 UTC).  
Status: **Deployment and tool acceptance passed.**

## Delivered behavior

Workflow discovery now shares the bounded history pager, counts good summaries
and issues together, and reports completeness and budget limits. Corrupt-record
pages retain valid rows but return a failed MCP operation and CLI exit 1, preventing
later batch steps from running. Known-ID workflow actions refuse linked catalog
storage and nonregular metadata. Existing IDs, journals, exact filters, shared
owner semantics, and ordinary workflow continuation remain available.

The baseline defects were reproduced on disposable owners: a 206,179-character
page containing 1,000 issues despite limit 1; a partial-error CLI batch that exited
0 and performed its next write; and cancellation rewriting a linked catalog's
journal. [Verification](wb014-validation.md) records scope and limitations.

## Release and deployment

Version **0.13.0-dev**, **51 tools**. All seven release gates passed, including
**296 tests**, Windows startup, **21 updater cases**, formatting, generic acceptance,
and actual MCP catalog probing. A production-only offline installation passed
**17/17** new workflow tests without source/compiler/development dependencies.
Those 17 are a subset of the 296 tests, not additional unique cases.

Activation `wb014-activate-20261020-01` completed **22:50:47 EDT**, with no error
or recovery error. The independent updater retained the 0.12.2-dev rollback package.
Sealed manifest: `A7217A3389ECEB7DE2F7DA00A5F945496BC9EE9505F2DBFD3050078E1CCE731C`.
Fresh browser and CLI calls observed owner `9f911553-23f0-4a8c-94b5-b59852e8bc5d`.
The updater's local `hostedVerified: false` remains unchanged; this report records
external acceptance separately. No additional catalog refresh was required for
these calls; that does not establish future clients never need refresh.

Fresh installed suite `wb014-installed-full-tests-20261020-01`: **296/296 passed**,
exit 0, no skipped/cancelled cases. No live rebuild was performed.

## Hosted proof

Disposable project: `C:\work\workbridge-wb014-20261020-01\Hosted ü`.
Browser applied `wb014-hosted-patch-20261020-01` and created workflow A;
CLI created workflow B on the same owner. Both used a staged CRLF target, an
explicitly watched check script, and an unrelated dirty fixture file.

Browser listing with limit 1 returned A, `nextOffset: 8`, `hasErrors: false`,
`complete: false`, and all new budget flags. CLI used that exact returned offset
and received B with `nextOffset: null` and `complete: true`. The connected catalog
advertised all new output fields and all 51 tools. These offsets describe this
acceptance only and must not be reused as fixed offsets on future live catalogs.

CLI continued A to `ready_for_review`. Browser reviewed the complete patch diff
and passing output, then explicitly resumed A again. A later CLI continuation also
preserved exactly one attempt and one execution; a checked counter remained 1.
CLI cancelled B before any launch and discovered it through the recorded-state
filter. Browser undo restored the patch; CLI repeated undo idempotently. Fresh
browser read verified the original target hash. Fixture staging, watched script,
and unrelated dirty file matched their baseline. The counter is retained evidence.

No live workflow record was deliberately corrupted. Partial-error and linked-state
proofs used isolated owners through actual CLI/MCP tests, not a fabricated direct
hosted corrupt-journal test. Recorded workflow state and current status remain
distinct; after restoration A's current state is undone and B remains cancelled.

## Preservation and evidence

Before documentation, verified hashes covered **2805 installed runtime files**,
**2967 sealed files**, **2805 rollback runtime files**,
**3365 backup files**, **164 expected source files**, and **six configuration files**.
The real Git index was unchanged. Twelve reviewed source files were promoted with
hash guards; the updater installed two package files with the runtime.

Evidence root: `C:\work\workbridge-wb014-20261020-01\evidence`.
It contains baseline, original reproduction/raw failure results, preserved failed
build/test evidence, successful test logs, seven-record read-only live compatibility,
sealed receipt, promotion diff/backups, deployed manifest comparisons, complete
CLI results, the actual browser first page, and selected hosted observations.
The documentation patch is `wb014-deployment-checkpoint-20261020-01`;
`checkpoint-expected.json` records its intended hashes. Final verification is
`deployed-integrity-after.json`; inspect its actual result.

No Git staging, credentials, permissions, model settings, unrelated worktree,
or real Rift/RRE project changes were made. No commit or push was performed.
The serialized-body limit is not a wire-byte bound for repeated MCP wrappers.
Pagination and fingerprint checks are not atomic filesystem snapshots. Structural
validation does not authenticate forged consistent records. Browser final-response
rendering remains separate and no permanent display fix is claimed.

## Resume

Read [the handoff](handoff-20261020.md). WB-014 has no remaining release or hosted
tool gate. The next audit is saved command-job consistency; it is not a delivered
capability at this checkpoint. Preserve all sealed releases and evidence.

Model: GPT-6 Astra Pro.  
Reasoning level:
