# WB-012 — Single-file recovery metadata validation

Date: **2026-10-20** (local; October 21 UTC)
Release: **0.12.1-dev**, retaining **51 tools**.
Status: **Deployed and tool-accepted.** Preparation passed 254 tests, all seven sealed-release checks, and 18 production-dependency-only tests. Fresh installed validation passed 254/254 regression tests and 18/18 recovery tests. Browser/CLI recovery acceptance and preservation checks passed; see [deployment acceptance](wb012-deployment.md).

## Reproduced defect

On deployed 0.12.0-dev, a disposable single-file journal was changed so its internal
operation ID differed from its filename/requested ID. `change_list` correctly
reported `CORRUPT_CHANGE`, but `change_status` returned the wrong operation ID and
`undo_change` accepted the inconsistent record. Undo removed the created test file
and published an additional journal under the wrong ID. The test used private
disposable state; no live journal or real project file was altered.

The cause was separate metadata handling: history validated a summary while the
known-ID loader cast parsed JSON directly to its TypeScript type. Runtime JSON
does not acquire validation from that cast.

## Correction and CLI behavior

- Discovery, status, replay, and undo now share complete record validation,
  including exact ID spelling/case, request hash, action, directory flag,
  before/after hash relationships, destination presence, and backup reference.
- Known-ID metadata reads reuse the bounded history reader. Linked catalog
  directories, nonregular metadata, invalid JSON, and oversized metadata are
  refused before use. No repair or migration is performed.
- Undo reads regular backups within the existing 16 MiB edit limit, then verifies
  the checksum. It preserves the current file and journal on refusal.
- The existing tool and CLI interfaces remain intact. MCP returns structured
  failures; CLI JSONL retains them, exits 1, and stops later batch steps. Valid
  operation IDs, journals, recovery, and replay behavior remain supported.

No new command, transport, permission, scheduler, journal format, or automatic
retry was introduced. Structural validation does not authenticate a deliberately
forged, internally consistent journal; normal current-file and backup checks
remain necessary. See the [file recovery contract](coding-workflow.md).

## Verification completed

The preserved baseline passed **236 tests**. The candidate passes **254 tests**:
the baseline plus **16 focused module cases** and **two connected CLI/MCP cases**.

The new cases cover mismatched IDs, missing/invalid request hashes, wrong
directory flags, invalid/missing backup references, inconsistent hashes,
unexpected destinations, invalid state/action, unknown metadata fields,
malformed/oversized journals, linked catalogs, oversized/nonregular backups,
valid lifecycle recovery, CLI batch stop behavior, cross-client error parity,
owner restart, retained good catalog rows, and preserved staging/dirty files.

A read-only compatibility comparison of the existing **505 live metadata files**
returned the same **503 summaries** and **two existing `OUTSIDE_ROOT` issues** in
both implementations across six pages. All 505 metadata byte hashes were
unchanged. This comparison did not run status, undo, replay, or mutation on those
live operations. An initial harness comparison mixed old/new error class
identities; it was corrected to construct each implementation's own Workspace
before the successful comparison. That harness artifact required no product fix.

The attached isolated worktree was reused. Before editing, **152 main source
files** and **150 prior candidate files** were inventoried and backed up, with
both Git index hashes recorded. Ten known documentation differences were
synchronized only after preserving both versions. Existing main source/runtime
and configuration remain unchanged while the candidate is prepared.

Evidence: `.local/wb012-recovery-20261020-01/` in the candidate contains
`baseline.json`, `source-before/`, `candidate-before/`, `reproduction.json`,
`plan.md`, `baseline-tests.log`, `recovery-tests.log`, `recovery-cli-tests.log`,
`full-tests.log`, and `live-journal-compatibility.json`.

## Sealed release

Release `wb012-20261020-review01` completed pinned installation, all **254 tests**,
startup checks, **21 updater cases**, formatting, generic acceptance, and the
**51-tool** release probe. The preparation ran through real Workbridge job
`wb012-seal-release-20261020-01`, which exited 0 at
`2026-10-21T01:01:55.996Z`. Manifest SHA256:
`38E4162EDAE4AD3E1DD0914DCE806A157F77855E01C9452C7A2ECCEBA7258695`.

An independent runtime directory copied the sealed compiled output, package
files, CLI, and the two new tests. Offline installation used `--omit=dev` and
`--ignore-scripts`; all **18 recovery tests passed** without application source,
compiler, or development dependencies. Runtime evidence is retained as
`runtime-install.log`, `runtime-tests.log`, and `release-verification.json`.
The sealed payload retains its preparation-time documentation snapshot; this
report was updated after those gates completed.

## Live gate completed

The independent updater completed operation `wb012-activate-20261020-01` with no
error or recovery error. The installed runtime and the connected CLI report
0.12.1-dev. Fresh browser/CLI calls verified the same owner, write replay,
recorded versus current state, guarded undo refusal, CLI stop-on-error, explicit
restoration, and idempotent repeated undo. Fixture hashes and staging were
restored; real repository staging and all six configuration files were unchanged.

Corruption tests ran only with disposable owners/state against installed modules.
No live recovery journal was deliberately corrupted. Tool execution is distinct
from final-reply display; the latter is not independently observable here. See
[deployed evidence and limitations](wb012-deployment.md).
