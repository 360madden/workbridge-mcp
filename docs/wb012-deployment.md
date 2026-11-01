# WB-012 — Deployed recovery validation and browser/CLI acceptance

Date: **October 20, 2026 EDT** (October 21 UTC)  
Version: **0.12.1-dev**; connected catalog: **51 tools**  
Status: **Deployment and tool acceptance passed.** Final-reply rendering is a separate, unverified presentation property.

## Deployment identity

Activation `wb012-activate-20261020-01` completed at **21:18:45 EDT** with
`error: null` and `recoveryError: null`. This resumed turn found that completed
operation; it did not redeploy or restart the service. Previous runtime: 0.12.0-dev.

Sealed manifest SHA256:
`38E4162EDAE4AD3E1DD0914DCE806A157F77855E01C9452C7A2ECCEBA7258695`.

The browser and installed shared-service CLI observed owner
`a64e74f3-fd13-469b-908a-bb303ea3f5c0`, version 0.12.1-dev.
Refresh owner IDs and endpoints on resume; these identify this acceptance only.
The updater's `hostedVerified: false` is intentionally unchanged: its local
journal does not certify an external caller. This report records hosted evidence separately.

## Fresh installed checks

| Check | Result |
| --- | --- |
| Installed recovery suite | **18/18 passed**, job `wb012-installed-recovery-tests-20261020-2135`, exit 0 |
| Installed complete Node suite | **254/254 passed**, job `wb012-installed-full-tests-20261020-01`, exit 0; no skips/cancellations |
| Connected CLI catalog | **51 tools**, server 0.12.1-dev |
| Installed runtime hashes | **2,805 files matched** the sealed manifest |
| Sealed release payload | **2,958 files matched**; seal unchanged |
| Retained rollback runtime | **2,805 files matched** backup manifest |
| Retained source/configuration backup | **3,357 files matched** backup manifest |
| Source reconciliation before acceptance documentation | **156 expected files matched** reviewed promotion/baseline |
| Live configuration | **6/6 hashes unchanged** |
| Main Git index | Unchanged from predeployment hash |

The full suite used `node --test test/*.test.mjs`; the focused suite named its
two recovery test files. Neither command rebuilt the running installation.
Corrupt metadata, oversized/nonregular backups, linked catalogs, and owner
restart were tested only in disposable owners/state. No live recovery journal
was deliberately corrupted. These command tests are not direct hosted mutations
of a corrupt live journal.

## Direct hosted and connected CLI sequence

The retained disposable repository is
`C:\work\workbridge-wb012-hosted-20261020-01\Fixture ü`.
It included staged fixture files, an unrelated dirty edit, and a CRLF target.

1. Browser `read_file` observed the original target hash. Browser `write_file`
   created operation `wb012-hosted-write-20261020-01`.
2. Connected CLI `workspace_info` identified the same owner. `change_status`
   found the browser operation; the identical write replay returned
   `replayed: true` without a duplicate mutation.
3. CLI operation `wb012-cli-later-20261020-01` wrote a later edit. Browser
   `change_status` retained the original operation's recorded state but showed
   the newer current-file hash.
4. Browser undo of the original returned structured `CONFLICT` /
   `stale_hash`. The actual hosted wrapper is retained in the observations.
   CLI returned the same error and **exit 1**, stopped the batch before its
   sentinel write, and preserved the later bytes.
5. CLI explicitly undid its later edit. Browser then undid the original edit.
   CLI repeated that undo and received `replayed: true`; both recorded states
   were `undone`. A fresh browser read observed the original bytes.
6. Original target hash, unrelated dirty fixture hash, and fixture Git index
   matched their baseline. The sentinel file was absent. Evidence is retained,
   not deleted or concealed by cleanup.

Original/restored target SHA256:
`f44c1d1204580a58257fb2c34e7848d32adc0c616d44d18c815f9d7a1316bf82`.

Main repository Git index SHA256:
`c80028eb0e2a577a8f457290f00850c7151ba5fb8cd0d062f03778646d50b351`.

## Evidence and documentation checkpoint

Evidence root:
`C:\work\workbridge-wb012-hosted-20261020-01\evidence`.

It contains `plan.json`, `integrity-before.json`, fixture baseline, raw CLI
requests/results, complete installed-test output, connected catalog,
`browser-observations.json`, and the documentation patch preview/application.
The documentation-only checkpoint uses patch ID
`wb012-acceptance-docs-20261020-01`. Expected documentation hashes are recorded
before application in `documentation-expected.json`; the final verification
rechecks those specific intentional changes, all other expected source files,
configuration, staging, sealed/runtime/rollback files, and restored fixture.
Final reports are `documentation-validation.json` and `integrity-after.json`;
inspect their actual pass state rather than inferring it from this report.

This acceptance turn did not change runtime implementation, permissions,
credentials, scheduled tasks, model settings, or real Rift/RRE project files.
It did not stage, commit, push, or alter the prior candidate worktree.
The sealed payload keeps its preparation-time documentation snapshot.

## Limitations and next resume

Structural recovery validation does not authenticate a deliberately forged,
internally consistent journal. Current-file and backup checks remain necessary.
Historical browser final-response failures are not declared fixed: tool results
are available, but visible rendering cannot be independently observed by these
tools. No new image transport or orchestration capability was added.

WB-012 has no remaining deployment or tool-correctness gate. Start from the
[handoff](handoff-20261020.md) and [AI workflow roadmap](ai-workflow-improvements.md)
for further work; do not repeat activation or replay fixed acceptance IDs.
Future capability work requires a bounded demonstrated gap; existing deferred
proposals remain proposals.

Model used for this resumed acceptance: **GPT-6 Astra Pro**.  
Reasoning level: 
