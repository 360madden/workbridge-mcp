# WB-013 — Consistent multi-file recovery validation

Date: October 20, 2026 EDT (October 21 UTC).  
Release: **0.12.2-dev**, retaining **51 tools**.  
Status: **Deployed and tool-accepted.** All seven release gates passed; 279 installed tests and 25 production-only recovery tests passed. See [deployment acceptance](wb013-deployment.md). The sealed payload retains the earlier preparation-time document.

## Reproduced defects

The 0.12.1-dev installed implementation was copied into an isolated candidate.
Disposable tests established two defects without altering any live journal:

- A linked patch operation directory was rejected by discovery as `CORRUPT_PATCH`, but known-ID status and undo accepted it. A linked catalog was rejected by discovery as `HISTORY_METADATA`, while known-ID access still followed it.
- An inconsistent record with `state: undone`, `direction: apply`, and per-file `progress: applied` was accepted. Undo returned an idempotent success even though the target still contained the applied, not restored, bytes.

Evidence: `C:\work\workbridge-wb013-20261020-01\evidence\reproduction.json`.
The reproduction retains its disposable fixtures. Do not run it against live state.

## Correction

All patch discovery and known-ID paths now share the same bounded record reader
and consistency checks. Catalog/operation directories must be ordinary directories;
metadata, snapshots, and saved diffs must be regular files. Reads retain size and
file-change checks. Journal saves recheck storage types before replacement.

Terminal states must agree with their direction and all per-file progress.
Prepared, applying, and undoing states must use a compatible direction; forward
records cannot contain reverse-restoration progress. Invalid timestamps,
out-of-range error indexes, and errors attached to successful terminal records
are refused. Legitimate interrupted forward and reverse states remain recoverable.

Invalid metadata produces `CORRUPT_PATCH` before project or journal mutation.
Snapshot failure retains the existing `PATCH_BLOCKED`/`CORRUPT_PATCH` recovery
contract. Discovery remains metadata-only and keeps valid rows when another
record is invalid. There is no journal migration, automatic repair, new transport,
permission change, retry policy, or tool-schema change.

## Verification before release sealing

The new module tests failed against the old implementation as intended, then
passed with the correction. The initial complete suite passed **279/279**, with
zero failures, skips, or cancellations: **254 existing tests plus 25 new tests**.

The 22 module tests cover inconsistent states, both junction locations, invalid
metadata, bounded snapshots, metadata-only discovery, unchanged evidence,
unknown IDs, and 13 valid intermediate recovery combinations. Three connected
CLI/MCP tests cover identical errors, exit 1 and stop-on-failure, same-owner
operation, restart persistence, retained good catalog rows, and unchanged Git
staging/unrelated dirty files. Existing crash and partial-undo tests also pass.

Read-only compatibility compared all **14 live patch metadata files**: both
implementations returned the same 14 summaries, no issues, and unchanged metadata
hashes. No status, undo, resume, or mutation was performed on those live operations.
The source baseline preserves **157 existing source files**, six configuration
file hashes, and the real Git index. Preparation uses a separate copy at
`C:\work\workbridge-wb013-20261020-01\candidate`; the previous candidate worktree
and live runtime remain untouched during development.

## Limitations

Real Windows directory junctions were exercised. An ordinary file-symbolic-link
probe returned `EPERM` under the current user; no privilege or system setting was
changed. File-link rejection is implemented but is not claimed as directly
validated with a real file symlink on this machine.

Checks are structural, not authentication of a deliberately forged consistent
record. File-type and hash checks are not an atomic filesystem transaction against
an external writer. Existing crash tests do not establish power-loss durability.
Browser reply rendering remains separate from tool execution.

## Release gate history — completed

The release and hosted tool gates below are complete; [deployment evidence](wb013-deployment.md) records the actual operation and test results.

Run all seven existing release gates, verify production-dependency-only recovery
execution, and compare the sealed runtime and preserved source/configuration.
Use the independent WB-001 updater only after gates pass. Inspect any existing
activation ID before retrying. Fresh hosted multi-file apply/replay/conflict/undo
must be recorded separately from isolated corruption tests and local readiness.

Model: **GPT-6 Astra Pro**.  
Reasoning level:
