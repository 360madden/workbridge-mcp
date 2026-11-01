# Recoverable multi-file text patches

AI-008 / deployed **0.8.0-dev**. Includes the shared-service CLI foundation from 0.7.0-dev. See [candidate verification](wb007-validation.md) and [deployment/browser-CLI acceptance](wb007-deployment.md), including the browser response-rendering limitation.

Use one patch set to update related source, callers, tests, and documentation with one durable operation ID. Workbridge checks every expected file version and patch before writing, saves before/after snapshots and a combined diff, then records progress around each file write. Resume and undo use those saved bytes; neither regenerates the patch from a conversation.

## Operations

All seven operations are available through the same [CLI](workbridge-cli.md) and MCP server. Discover their actual schemas with `--list-tools --tool patch_apply`.

| Operation       | Arguments                                 | Result                                                                                                 |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `patch_preview` | `files`                                   | Read-only whole-set preflight and combined diff; no journal or file writes                             |
| `patch_apply`   | `operationId`, `files`                    | Durable snapshots, saved combined diff, application progress, final state                              |
| `patch_status`  | `operationId`                             | Saved progress plus live per-file hashes and suggested next action; available while a writer is active |
| `patch_diff`    | `operationId`, optional `offset`, `limit` | Pages of the immutable combined before/after diff                                                      |
| `patch_list`    | optional `offset`, `limit`                | Patch IDs, states, direction, file counts, and corrupt-record issues                                   |
| `patch_resume`  | `operationId`                             | Explicit continuation of interrupted forward application                                               |
| `patch_undo`    | `operationId`                             | Guarded reversal of complete or partial application; repeated calls also continue interrupted undo     |

Patch operation IDs belong to the separate patch journal. Use `patch_status`/`patch_list` for these IDs; `change_status`/`change_list` continue to serve existing single-file operations. Single-file edits, selected-file commits, and patches share the owner's mutation queue.

## Request format

Each entry selects its target explicitly:

```json
{
  "path": "Example/src/value.txt",
  "expectedHash": "SHA256_FROM_A_FRESH_READ",
  "patch": "--- a/Example/src/value.txt\n+++ b/Example/src/value.txt\n@@ -1 +1 @@\n-old value\n+new value\n"
}
```

Replace the placeholder with the actual lowercase SHA256 from `read_file`, `read_files`, or `file_info(hash=true)`. Never guess a hash. Paths follow the existing workspace rules: relative to the primary root, or absolute within an allowed root. Parents must exist. Canonical duplicate paths, including Windows case aliases, are refused.

Each patch must describe exactly one selected file. Header names must match the explicit input or returned canonical path, optionally prefixed with `a/` and `b/`. Standard quoted Unicode/spaces filenames are supported by the pinned `diff` parser. Creation uses `expectedHash: null` and an old header of `/dev/null`; deletion uses the current hash, a new header of `/dev/null`, and must remove all text. Empty-file creation and deletion are supported.

Only text create/update/delete operations are included. Binary, copy, rename, file mode, and directory patches are refused. UTF-8, UTF-8 BOM, and BOM-marked UTF-16 LE/BE are supported. Existing uniform LF, CRLF, or CR endings and missing final newlines are preserved. Mixed line endings are refused instead of silently normalizing untouched lines. New files use UTF-8.

The pinned `diff` library applies exact context with fuzz disabled. It may relocate a hunk to matching context within the expected file; the whole-file hash must still match. Matching has a bounded comparison budget.

## CLI workflow

Use the matching CLI to connect to the deployed running owner. These commands do not start or deploy a service:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --list-tools --tool patch_apply --json
node scripts/workbridge-cli.mjs --service-state "C:\work\workbridge-mcp\.local" --input "C:\work\Scratch\patch-preview.json" --json
```

The request file is a JSON array. A preview request is:

```json
[
  {
    "tool": "patch_preview",
    "arguments": {
      "files": [
        {
          "path": "Example/src/value.txt",
          "expectedHash": "SHA256_FROM_A_FRESH_READ",
          "patch": "--- a/Example/src/value.txt\n+++ b/Example/src/value.txt\n@@ -1 +1 @@\n-old value\n+new value\n"
        }
      ]
    }
  }
]
```

For application, change the tool to `patch_apply`, retain the exact `files` array, and add `"operationId": "task-042-patch"` inside `arguments`. Preview is optional; apply always performs its own fresh preflight. A successful preview is not a reservation of the file versions.

Inspect or recover in a later CLI invocation using the same service state and operation ID:

```json
[
  { "tool": "patch_status", "arguments": { "operationId": "task-042-patch" } },
  { "tool": "patch_diff", "arguments": { "operationId": "task-042-patch", "offset": 0, "limit": 20000 } }
]
```

After inspection, explicitly choose `patch_resume` or `patch_undo` with that ID. Do not automatically append recovery to every failed operation. The CLI stops at a failing step, returns structured error details, and exits 1. Setup/version failures exit 2; deadlines exit 124. A disconnected or timed-out CLI does not cancel an owner operation, so inspect its saved state before deciding what to do next.

The isolated CLI also exposes these tools, but its existing-state refusal prevents later isolated invocations from reopening that state. Use shared-service mode for recovery across separate invocations. Integration tests exercise CLI/stdio parity and recovery after an owner restart.

## State and conflict rules

A journal moves through `prepared`, `applying`, and `applied`. Undo uses `undoing` then `undone`. An ordinary failure records `blocked`; an abrupt process exit may leave the preceding state. Each file records `pending`, `applying`, `applied`, `undoing`, or `undone` independently.

Before any forward or recovery write, Workbridge validates all snapshots and every current file against the permitted state. Before each actual write it checks again, and before reporting completion it verifies the whole resulting set. A file whose write was interrupted can match its recorded before or after hash. A still-pending file must match its before hash; matching proposed bytes from another writer are not silently adopted. Completed files must match their recorded result. Repeated completed apply/undo calls return the recorded result without rewriting files.

When a later edit conflicts, the attempt fails with `PATCH_BLOCKED` and a structured cause such as `PATCH_CONFLICT` or `CORRUPT_PATCH`. Preflight rejection before publication uses `PATCH_PREFLIGHT`, with per-file issue codes and no project writes. Conflicting ID reuse returns `ID_REUSE`; uncertain apply replay requires explicit recovery. Once undo begins, forward resume is refused with `PATCH_DIRECTION`.

Undo processes files in reverse order and restores original bytes only when the current state permits it. It deletes files created by the patch only while their hashes match. It does not reset Git, alter staging, or remove directories. A patch journal is bound to its original primary workspace root; current allowed-root and protected-path checks remain active during recovery.

If whole-set preflight rejects an undo before restoration begins, `state` becomes `blocked` but `direction` retains the prior value, often `apply`. The requested undo direction is committed only after preflight succeeds. Inspect the conflict and current hashes before explicitly choosing recovery.

These are recoverable file operations, not an atomic filesystem transaction. A process failure can leave a partially applied set visible. Other Workbridge mutation calls are serialized; external editors and terminal commands do not participate in that lock. Avoid concurrent external writers to affected files. Hash checks cannot make a read/check/replace sequence atomic against an external process writing in the final filesystem race window. Current hashes also cannot distinguish identical bytes independently written by another process. Automated tests cover process interruption, not sudden power loss.

## 0.12.2-dev recovery validation

The deployed WB-013 release makes discovery and known-ID status, diff, replay, resume,
and undo share the same bounded journal reader. Catalog and operation folders
must be regular directories, not links/junctions. Metadata, snapshots, and saved
diffs must be regular files. Completed states must agree with the operation
direction and every file's progress; invalid timestamps and error indexes are
also refused. Invalid metadata returns `CORRUPT_PATCH` without changing project
files or rewriting that journal. Existing snapshot failures retain the
`PATCH_BLOCKED` recovery contract. No automatic repair or migration is performed.

Legitimate interrupted forward and undo states remain supported. Structural
checks do not authenticate a deliberately forged consistent record or make
external filesystem races atomic. See [WB-013 verification](wb013-validation.md)
for actual release/deployment status, test scope, and platform limitations.

## Review and storage bounds

- At most 20 files, 2 MiB of serialized patch entries, 16 MiB per editable file, and 32 MiB total before/after snapshots per operation. Combined input path labels are capped at 8,000 characters.
- Diff generation uses bounded work and retains up to 2 Mi characters. Preview returns up to 60,000 diff characters. `patch_diff` pages the saved artifact, default 20,000 and maximum 60,000 characters per call.
- Follow `nextOffset` until null. `diffComplete: false` means generation exceeded its budget; exhausting pages does not make that diff complete. Review the source/saved hashes or split a future request before accepting an incomplete preview. The saved diff always describes the proposed before/after bytes, even when application is partial or undone; pair it with `patch_status`.
- `patch_list` orders operation IDs lexically, defaults to 20 records, and caps a page at 50. It scans at most 20,000 directory entries and reports `catalogTruncated`. Offsets are not a snapshot if other operations are added concurrently.
- Journals and checksummed snapshots live under protected service state in `patches/<operationId>/`. They remain until explicit operator cleanup. A crash before plan publication can leave an unpublished `.prepare-*` folder; it has not mutated project files and is excluded from discovery. No automatic retention cleanup is added.

Resumable edit/test/review orchestration is available through the deployed [AI-009 workflow tools](resumable-workflows.md). Patch operations themselves do not automatically run commands or deploy anything.
