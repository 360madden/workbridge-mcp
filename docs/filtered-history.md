# AI-006 — Filtered change and patch history

Deployed: **0.12.0-dev**, **51 tools**. This capability extends existing `change_list` and `patch_list` through the same MCP module and request-file CLI. [Release verification](wb011-validation.md) and [browser/CLI tool acceptance](wb011-deployment.md) passed. It adds no journal, database, scheduler, or recovery engine.

## Find an uncertain operation

Use `change_list` for single-file write/edit/move/delete/directory operations, then `change_status` and `undo_change`. Use `patch_list` for unified patches and structured configuration edits, then `patch_status`, `patch_diff`, and explicit `patch_resume` or `patch_undo`.

Both tools accept:

| Argument    | Meaning                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `project`   | Optional directory scope, including descendants. A Git repository is not required.                              |
| `path`      | Optional exact recorded path; not a glob or substring.                                                          |
| `state`     | Optional recorded journal state, not a fresh assessment of current files.                                       |
| `offset`    | Catalog position to resume, default 0. Use returned `nextOffset`.                                               |
| `limit`     | Maximum combined matching summaries and issues per page; default 20, maximum 100 for changes or 50 for patches. |
| `scanLimit` | Maximum metadata records inspected in this call; default 200, maximum 1,000.                                    |

Change states: `prepared`, `applied`, `failed`, `undone`. Patch states: `prepared`, `applying`, `applied`, `undoing`, `undone`, `blocked`.

Project and path filters combine on the **same recorded path**. A move can match either its source or destination. A patch can match any of its files. If `project` selects one directory and `path` identifies a file outside it, the result is empty even if a move or patch touches both directories. State combines with these filters using AND.

Matching respects path segments and platform case rules: `Project` does not match `Project-copy`. Relative paths use the stable primary root; additional roots use absolute paths. Deleted files and missing parent directories can still be discovered. Existing ancestors are checked for links and root/protected-path boundaries, and invalid components remain forbidden even below a missing directory. Missing paths are never recreated by discovery.

Every recorded path is checked against current access rules before its summary is returned. A revoked root or invalid path produces an issue containing the operation ID and a safe error, without exposing that record's file labels. This is read-only history validation; it does not broaden the paths accepted by write operations.

## CLI requests and continuation

Save a request array such as:

```json
[
  {
    "tool": "change_list",
    "arguments": {
      "project": "ExampleProject",
      "path": "ExampleProject/src/settings.ts",
      "state": "applied",
      "limit": 20,
      "scanLimit": 200
    }
  },
  {
    "tool": "patch_list",
    "arguments": {
      "project": "ExampleProject",
      "state": "blocked",
      "limit": 20,
      "scanLimit": 200
    }
  }
]
```

With a matching deployed CLI and owner:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --root "C:\work" --input "C:\work\Scratch\history-requests.json" --json
```

The installed 0.12.0-dev CLI connects to the matching deployed owner. Use a separate disposable owner or new private state for isolated tests; never point private mode at live state. See [CLI connection requirements](workbridge-cli.md).

Continue with the same filters and the returned `nextOffset`. Browser Chat and the CLI can exchange that request. Do not calculate an offset from the number of returned matches. A sparse scan can return no matches and still have a non-null continuation. Inspect each discovered operation's status before recovery; listing never performs recovery or starts validation jobs.

## Ordering and compatibility

Both catalogs now return **operation IDs in ascending lexical order**. This retains patch discovery's ordering and replaces single-file history's previous newest-time ordering, which required reading every journal before pagination. Existing summary fields and durable operation IDs are retained; journal and undo formats are unchanged.

Start at offset 0 after upgrading from 0.11.0-dev. Do not reuse old single-file catalog offsets. Timestamps remain available in summaries, but this endpoint does not promise the globally newest records first. Clients may sort the bounded results they collected, without claiming those are the newest records in an incomplete catalog.

Catalogs are live rather than snapshots. Adding/removing IDs between calls can shift positions; changing a record's state can change filter matches. Restarting the owner does not itself change the order. If other clients modify history while you page, restart discovery and deduplicate IDs before concluding that a search was exhaustive. Known-ID status/recovery is preferable once the ID is known.

## Completeness, errors, and limits

Existing `changes` or `patches` arrays are accompanied by:

- `issues`: per-operation metadata/access errors. Good results remain available.
- `scanned`: metadata records inspected this call, including nonmatches and an output-budget item that may need to be inspected again on continuation.
- `nextOffset`: next catalog position; null when the collected catalog has been exhausted.
- `scanLimitReached`, `outputLimitReached`, `timeLimitReached`, and `catalogTruncated`: separate reasons the work may be incomplete.
- `hasErrors`: whether this page contains issues.
- `complete`: this call exhausted its collected catalog with no issues or limit truncation. It does not erase errors or incompleteness from earlier pages.
- `order` and `stateFreshness`: explicit ordering and recorded-state semantics.

At most **20,000 directory entries** are enumerated, **1,000 metadata records** are inspected, and **256 KiB per metadata file** is read. Discovery has a soft **20-second** preparation budget, checked between filesystem steps, and a **60,000-character serialized output** budget. Metadata counts and output are bounded separately. Backup files and saved diffs are not read. An oversized/corrupt journal cannot make the whole catalog unbounded or suppress later good records. A summary that cannot fit even on an empty page becomes an explicit issue so continuation can advance.

Directory enumeration includes unrelated entries toward its cap. When `catalogTruncated` is true, a null continuation does **not** establish that no other operations exist. Project/path filters do not make the underlying global directory smaller. Prefer known-ID recovery or separately planned operator maintenance; this phase does not delete history or build a persistent index. A missing/empty catalog returns an empty complete result without creating a directory.

Metadata issues preserve the partial result but make MCP `isError` true and CLI JSONL `ok` false with **exit 1**. Default CLI batches stop at that operation; later mutations do not run. Ordinary pagination/limit truncation without issues is not a tool failure and requires explicit continuation or acknowledgment of incompleteness. Hosted routing may wrap the complete partial result in `INVALID_ARGUMENT`/`TextContent`; retain the nested result instead of replacing it with an empty list.

Recorded `applied` does not mean files still match the applied bytes. Later edits and missing snapshots are deliberately checked by status/recovery tools, not inferred by this catalog. No file hashes, Git staging, source contents, jobs, or journal state are changed by discovery.

The **0.12.1-dev** recovery correction makes single-file discovery, status, replay, and undo use the same complete metadata checks. A mismatched operation ID or inconsistent recovery fields are refused before use. Backup contents remain outside discovery; bounded backup validation happens only when restoration needs them. See [WB-012 verification](wb012-validation.md) and the [file recovery contract](coding-workflow.md).

## Verification gates

The baseline was 214 tests. Focused coverage exercises segment/case matching, move source/destination, deleted parents, additional and revoked roots, protected/junction boundaries, sparse pagination, corrupt/oversized/disappearing metadata, output/scan/time limits, no directory creation, recorded-state behavior, cross-client continuation, restart continuity, CLI partial-error exits, and preserved staging/dirty files.

All 236 tests and seven sealed-release gates passed, followed by five production-dependency-only and five installed integration tests. [WB-011 acceptance](wb011-deployment.md) records actual browser/CLI continuation, discovered-ID recovery, expected failures, and restoration. Browser final-response rendering remains separately limited.
