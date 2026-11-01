# Bounded multi-file reads (AI-005)

Deployed: 0.6.3-dev, 2026-10-20, with 35 tools. All 108 local tests and all seven sealed-release checks passed. Hosted acceptance is recorded below.

`read_files` reads source, tests, and instructions in one operation, using the same reader and path checks as `read_file`. It adds no dependencies or storage. Individual results retain line numbers, encoding, version, SHA256 where supported, truncation, and file cursors.

## Request and results

```json
{
  "files": [
    {"path":"Example/AGENTS.md"},
    {"path":"Example/src/main.ts","startLine":20,"lineCount":80},
    {"path":"Example/test/main.test.mjs","lineCount":120}
  ],
  "offset": 0
}
```

Paths use the configured workspace roots. Each request has the same options and defaults as `read_file`: `startLine: 1`, `lineCount: 200` (maximum 1,000), and optional `cursor`. Request 1–20 file pages; duplicate paths with different ranges are allowed.

Each returned entry contains its original zero-based `index`, requested `path`, and either:

- `ok: true` with a `result` holding the complete `read_file` result for that page.
- `ok: false` with an `error` containing `code`, `message`, and optional `details`.

Good pages are retained when another file is missing, binary, inaccessible, outside the roots, or rejected by another existing path/cursor check. Any returned error sets `hasErrors: true` and marks the MCP operation as an error; inspect the returned JSON for all entries. Invalid batch arguments fail before reading files.

The hosted ChatGPT connector may add an `INVALID_ARGUMENT` error envelope. The text JSON still contains the individual results and their actual error codes; hosted acceptance verified that a good page survives beside `ENOENT`.

## Two independent continuations

**Batch continuation:** The serialized result body is capped at 60,000 JavaScript string characters, including JSON escaping and metadata. This counts the result JSON, not the enclosing MCP transport envelope. The 20-second elapsed budget is checked between files; each in-progress read retains its existing scan/hash limits, so this is not a hard 20-second cancellation deadline.

`nextOffset` identifies the first request whose result was not returned. Resubmit the **same ordered `files` array** with that offset. A new page starts a new budget. Returned indices prevent confusion when the array contains duplicate paths. `outputLimitReached` and `timeLimitReached` describe the batch limit reached on that call.

If one page cannot fit even in an otherwise empty response, its entry returns `BATCH_ITEM_LIMIT` with `details.nextAction: "read_file"`. Later requests can still be returned. Use `read_file` for that page, or request fewer lines; the batch never silently cuts a successful page's text or cursor to make it fit.

**File continuation:** A successful entry can itself have `result.truncated: true` and a file `cursor`. Continue that file with its cursor in either `read_file` or a new `read_files` request. Batch `nextOffset: null` means all requested pages were returned, not that every file reached EOF or every entry succeeded. A null cursor does not make a clipped enormous line complete; inspect the file's truncation fields.

Do not change the request order while following `nextOffset`. These are sequential live reads, not an atomic snapshot. Files can change between entries or calls; stale file cursors are refused. Existing cursors are bound to their server instance and cannot be transferred to a new CLI invocation.

SHA256 remains available only within the existing 16 MiB editable-file limit. Larger files retain paging/version information and return `sha256: null`. Use the returned hash for applicable guarded edits; batch reading grants no additional edit capability.

## CLI

Use the existing [batch CLI](workbridge-cli.md) with a request file:

```json
[
  {
    "tool":"read_files",
    "arguments":{
      "files":[
        {"path":"src/main.ts","lineCount":80},
        {"path":"test/main.test.mjs","lineCount":120}
      ]
    }
  }
]
```

```powershell
node scripts/workbridge-cli.mjs --root 'C:\work\Example' --state-dir 'C:\work\Scratch\read-UNIQUE_ID' --input 'C:\work\Scratch\reads.json' --timeout 60 --json
```

Choose a new private state directory with an existing parent. Stdout contains the normal schema-versioned JSONL step, including every returned file result. A partial read failure produces `ok: false`, exits **1**, and stops later CLI steps while preserving the good entries. An error-free page exits **0**; automation must still inspect batch and file continuation fields. The CLI does not automatically assemble file contents or follow dynamically returned cursors.

For an offset-only batch whose request array contains no file cursors, a new invocation can retain that same array and returned offset with another new state directory. Cursor-bearing requests require the original MCP session. In a new session, start a fresh read at the desired line instead; it observes the file's current bytes and version.

## Verification and scope

Ten added tests cover ordered duplicates, parity with single-file reads, UTF-8/UTF-16, exact hashes, per-file errors, protected paths/junctions, escaped JSON size limits, batch continuation, oversized individual pages, file cursors and stale-file rejection, large-file null hashes, request limits, elapsed-budget continuation, and success/failure through the CLI launched by Workbridge.

Local regression result: **108/108 passed**. All seven sealed-release checks passed: dependency installation, tests, startup, 21 updater cases, formatting, generic acceptance, and the 35-tool release probe. Activation `wb005c-activate-20261020-01` completed with the previous 0.6.2-dev runtime backed up.

The 2,127 installed runtime files match the sealed manifest; all 2,551 backup files were verified. Deployment preserved 115 source files at their reviewed versions, Git staging, and command profiles, including AI-004.

Normal ChatGPT Chat acceptance: **5/5 passed** after refreshing the tool catalog. The checks verified the deployed version and 35-tool catalog, ordered reads with exact hashes and UTF-16 decoding, cursor continuation, partial errors retaining good results, and the installed CLI's success/failure behavior. CLI jobs `wb005c-hosted-cli-success` and `wb005c-hosted-cli-failure` exited 0 and 1 respectively; the failure retained its good result and did not execute the next step. Independent checks confirmed that all three fixture files retained their original hashes and the missing file remained absent.

The [verification conversation](https://chatgpt.com/c/6ad7b504-23ec-83ea-afb7-53d15e11e90b) and local `hosted-chat.txt`/`hosted-chat.png` retain the hosted results. `hosted-cli-verification.json` and `final-verification.json` record the independent checks. The updater's own `hostedVerified: false` remains unchanged because that local process cannot certify hosted behavior.

Evidence is retained under `.local/wb005c/` in the attached `codex/ai-workflows` worktree and `C:/work/workbridge-mcp/.local/wb005c-20261020-01/` in the source checkout. The sealed release remains unchanged; its original documentation describes the candidate at preparation time.

`read_file` remains available with its existing behavior. AI-006 filtered change history remains proposed.
