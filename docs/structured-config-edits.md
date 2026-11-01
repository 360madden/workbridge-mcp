# AI-011 — Structured configuration edits

Deployed: **0.11.0-dev**, **51 tools**. [Release verification](wb010-validation.md) and [normal browser Chat/CLI acceptance](wb010-deployment.md) passed, including cross-client recovery and conflict refusal.

`config_preview` and `config_apply` update selected values in existing JSON files, or JSON-with-comments files when `format: "jsonc"` is explicit. They share one module between MCP and the complete CLI. Every file requires its observed raw-byte SHA256. The whole set is prepared before mutation, and apply records ordinary patch snapshots, combined diffs, and recovery state. No new journal, scheduler, executable, or transport is introduced.

## Complete CLI workflow

Read the intended files with `read_file` or `file_info(hash=true)`, inspect applicable instructions, and save a UTF-8 request array. The following illustrates the request shape; replace both hash placeholders with the actual returned 64-character lowercase SHA256 values:

```json
[
  {
    "tool": "config_preview",
    "arguments": {
      "files": [
        {
          "path": "Example project/appsettings.json",
          "expectedHash": "SHA256_FROM_THE_FIRST_FILE_READ",
          "operations": [
            { "op": "test", "path": "/Capture/Enabled", "value": false },
            { "op": "replace", "path": "/Capture/Enabled", "value": true },
            { "op": "add", "path": "/Capture/Tags/-", "value": "validation" }
          ]
        },
        {
          "path": "Example project/settings.jsonc",
          "expectedHash": "SHA256_FROM_THE_SECOND_FILE_READ",
          "format": "jsonc",
          "operations": [{ "op": "replace", "path": "/logging/level", "value": "debug" }]
        }
      ]
    }
  }
]
```

Preview returns the same schema as `patch_preview`: `schemaVersion`, `applicable`, file summaries with before/after hashes, bounded combined `diff`, `diffComplete`, `diffTruncated`, and `snapshotBytes`. It writes neither files nor journals. To apply, use the same `files` with tool `config_apply` and a unique `operationId`, for example `config-capture-001`. Preview is optional; apply always repeats preflight against the observed hashes. A preview does not reserve files or authorize later writes with fresh hashes substituted silently.

After deployment, or against a separate matching disposable owner, use the existing shared-service CLI:

```powershell
node scripts/workbridge-cli.mjs --service-state "C:\path\to\owner-state" --root "C:\work" --input "C:\work\Scratch\config-request.json" --json
node scripts/workbridge-cli.mjs --service-state "C:\path\to\owner-state" --list-tools --tool config_apply --json
```

The installed 0.11.0-dev CLI connects to the matching deployed owner. For a separate private fixture, use `--root "C:\work" --state-dir "C:\work\Scratch\config-private-001"`; its parent must exist, its state directory must be new, and it cannot manage the deployed owner's history. Never point private mode at live state. See the [CLI connection contract](workbridge-cli.md).

Apply returns the ordinary `patch_apply` summary, including `operationId`, per-file hashes/progress, state, and `replayed`. Use that same ID with `patch_status`, `patch_diff`, `patch_list`, `patch_resume`, and `patch_undo` through either client. Do not use `undo_change` for these patch IDs. For example, save this recovery/review request array:

```json
[
  { "tool": "patch_status", "arguments": { "operationId": "config-capture-001" } },
  { "tool": "patch_diff", "arguments": { "operationId": "config-capture-001", "limit": 10000 } }
]
```

Follow `patch_diff.nextOffset` until null and check `diffComplete`; a bounded preview may omit part of a large diff. After uncertainty, inspect status first. Choose `patch_resume` explicitly to finish applying saved bytes, or `patch_undo` to restore the saved originals. Guarded recovery checks the entire set and refuses to overwrite later edits. A multi-file set is recoverable, not an OS-wide atomic transaction: a process crash or I/O failure after the first replacement can leave recorded partial progress.

The same normalized structured request and operation ID replay the recorded terminal result without regenerating edits from changed files. Reusing the ID for different arguments, a different format, or raw `patch_apply` is refused. Replaying an undone operation leaves it undone. Nonterminal records require explicit patch recovery; they are not silently restarted. Replay describes recorded completion, not proof that nobody edited the files afterward; use `patch_status.current` for that.

For validation, create an existing-style `workflow_create` record with `patchOperationId` equal to the configuration operation ID and explicit checks/inputs, then use CLI `{"runWorkflow":"your-workflow-id"}` or the workflow MCP tools. Applying configuration alone never executes checks, scripts, reloads, builds, commits, or deployments.

CLI JSON Lines retain schema version 1. Exit 0 means the invoked operation succeeded; exit 1 retains structured operation errors, exit 2 means setup/input/runtime mismatch, 124 means deadline, and 130 means interruption. The batch stops at the first failure. After a timeout, retain the operation ID and inspect its state before retrying.

## Path and operation semantics

File paths are workspace-relative, or absolute within configured roots. They are not relative to the selected project. Files must already exist; this phase does not create/delete configuration files or parent directories. Existing protected runtime/Git state, junction, root-boundary, and read-only-service checks remain effective.

Value paths follow the string form of [JSON Pointer (RFC 6901)](https://www.rfc-editor.org/rfc/rfc6901): `""` selects the root, `/` selects an empty object key, `~0` represents `~`, and `~1` represents `/`. URI fragments, JSONPath expressions, wildcards, and implicit recursive search are unsupported.

Operations use the following explicit subset of [JSON Patch (RFC 6902)](https://www.rfc-editor.org/rfc/rfc6902), applied in caller order:

| Operation | Contract                                                                                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add`     | Add or replace an object member; insert before an array index; append with `-` or the current array length. The parent must already exist. An empty pointer replaces the root.                                             |
| `replace` | Replace an existing value, including the root. Missing values are errors.                                                                                                                                                  |
| `remove`  | Remove an existing member or array element. Root removal is refused because a configuration must retain a JSON value; use the existing recoverable file-deletion tool for deleting files.                                  |
| `test`    | Require semantic equality at an existing value before proceeding. Object member order is irrelevant, array order matters, and numeric comparison does not round observed source digits. Failure prevents every file write. |

Array indices must be canonical nonnegative integers: `0` is valid, `01`, negative numbers, and fractions are not. `-` is valid only for array `add`. Object keys that look like indices remain literal string keys. `__proto__`, `constructor`, and similar keys are handled as data without prototype traversal.

`value` is required for add/replace/test, and JSON `null` differs from absence. Unknown operation members, `move`, and `copy` are refused; this is not advertised as a complete RFC 6902 implementation. No missing-parent construction, fuzzy matching, automatic conflict repair, or hash substitution occurs. Every selected file must change bytes; a no-op or test-only file rejects the whole set with `NO_CHANGE`. Use read tools for inspection-only assertions.

## Formatting, comments, and numbers

The pinned [Microsoft jsonc-parser](https://github.com/microsoft/node-jsonc-parser) **3.3.1** supplies the syntax tree and localized edit operations. Workbridge checks parser errors rather than relying on its fault-tolerant return value, rejects duplicate object keys, and checks the result after every edit. `json` is strict: comments and trailing commas fail. Explicit `jsonc` permits JavaScript-style comments and trailing commas, not arbitrary JavaScript or JSON5 syntax.

Unchanged values retain their text, including large numeric literals; the whole document is not deserialized and reserialized. UTF-8/BOM and BOM UTF-16 LE/BE encoding, consistent line endings, and normal final-newline behavior are preserved through the patch engine. Mixed line endings require explicit normalization first. Local insertions/removals can reformat affected lines; indentation is inferred from the first indented property, with two spaces as the fallback. This is not a promise of byte-identical whitespace everywhere outside the value.

JSONC comments outside a removed/replaced value must remain present in the same order and with the same text. An ambiguous structural edit that would discard an adjacent comment fails with `CONFIG_COMMENT_CONFLICT`; review its scope and use an explicit text patch if that removal is intended. Replacing a whole object/array deliberately replaces comments inside that value. These rules are tested; YAML, TOML, XML, and INI support remain deferred.

Request values use JSON numbers supported by the JavaScript client/server runtime. Nonfinite numbers and integers outside the safe integer range are refused. Send large identifiers, addresses, or exact decimal values as strings. A JSON numeric token may already have lost precision when the caller parsed its request; the server cannot recover those original digits. Existing source numbers are compared from their decimal text for `test`, and untouched source digits are preserved. Very large exponent spellings can be refused during numeric comparison.

## Limits and errors

- 1–20 files; 100 operations per file, 200 total; 1 MiB serialized structured input and 8,000 combined file-path characters.
- Existing and resulting files at most 1 MiB in their encoding; parsed UTF-8 text is also bounded to 1 MiB. Up to 64 JSON nesting levels/pointer segments and 100,000 syntax tokens per parse.
- A 20-second soft preparation budget is checked between parsing/editing steps; an individual underlying operation may finish after the deadline. Existing patch generation, input, snapshot, and diff bounds apply afterward.
- Generated patch input at most 2 MiB; inherited snapshot bound 32 MiB and saved combined diff bound 2 MiB characters. Narrow requests when output, parsing, or diff limits prevent a complete change.

`CONFIG_PREFLIGHT` includes `issues` with file index/path and precise error codes. Operation failures include `operationIndex` and `pointer`; parse errors include bounded offsets/codes without source excerpts. Typical codes are `CONFLICT`, `CONFIG_PARSE`, `CONFIG_DUPLICATE_KEY`, `CONFIG_PATH_MISSING`, `CONFIG_PATH_TYPE`, `CONFIG_ARRAY_INDEX`, `CONFIG_TEST_FAILED`, `CONFIG_COMMENT_CONFLICT`, `CONFIG_LIMIT`, and `NO_CHANGE`. Invalid request/value/pointer validation can fail before the per-file preparation pass. Failed preflight publishes no patch journal and writes no files.

After journal publication, the existing `PATCH_BLOCKED`, `PATCH_CONFLICT`, `OPERATION_UNCERTAIN`, `ID_REUSE`, and corrupt-journal/snapshot handling apply. Configuration fields and diffs may contain secrets; inspect only authorized files and avoid putting credentials in arguments or diagnostics. No extra credentials or access are introduced by this feature.
