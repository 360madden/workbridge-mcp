# AI-010 — Task-focused context gathering

Deployed: **0.10.0-dev**, **49 tools**. [Release verification](wb009-validation.md) and [normal browser Chat/CLI acceptance](wb009-deployment.md) passed. The browser final-response display limitation remains separately recorded.

`task_context` gathers the context an AI needs before an edit or after resuming a conversation. One read-only request combines scoped instructions, project/build documentation, selected source and test excerpts, search hits, and saved workflow/patch IDs. It reuses the existing readers, ripgrep search, overview, and workflow catalog. It adds no dependency, index, persistent context store, background process, or automatic command execution.

## Request and CLI

Save a UTF-8 request array, replacing the example project and paths with the intended workspace-relative names:

```json
[
  {
    "tool": "task_context",
    "arguments": {
      "project": "Example project",
      "files": [
        { "path": "Example project/src/parser.ts", "startLine": 30, "lineCount": 80 },
        { "path": "Example project/test/parser.test.ts", "startLine": 1, "lineCount": 100 }
      ],
      "searches": [{ "query": "parseRecord", "glob": ["src/**", "test/**"], "limit": 10 }],
      "limit": 10
    }
  }
]
```

All file paths use the primary workspace root, **not** the selected project directory. Absolute paths inside configured roots work too. Explicit source files must remain inside the selected project. Parent `AGENTS.md` files are included only within configured roots. Folder names containing spaces or Unicode need no shell interpretation.

From the installed 0.10.0-dev checkout, connect to the same owner as browser Chat:

```powershell
node scripts/workbridge-cli.mjs --root "C:\work" --service-state "C:\work\workbridge-mcp\.local" --input "C:\work\Scratch\context.json" --json
node scripts/workbridge-cli.mjs --root "C:\work" --service-state "C:\work\workbridge-mcp\.local" --list-tools --tool task_context --json
```

Use the intended installation's service-state directory and a CLI matching its version. Connected CLI and browser MCP share context continuations, file cursors, and workflow records. For a separate isolated inspection, replace `--service-state` with `--state-dir "C:\work\Scratch\context-001"`. The workspace and state-directory parent must exist, and each private state directory must be new. Never reuse deployed state in private mode; a private session cannot discover the deployed owner's workflow records.

The CLI retains JSON Lines schema version 1. Exit 0 means the invoked context page had no operation/section errors; **it does not mean all pages or files were read**. Exit 1 retains good sections alongside failures. Setup/version mismatch is exit 2; deadline is 124 and interruption is 130. The CLI does not automatically follow context or section pagination.

## What is gathered

Sections are ordered and identified by `index` and `kind`:

1. **Overview:** the existing bounded project overview, including repository/worktree identity, languages, manifest/script evidence, and candidate entry points. It samples at most 500 directory entries; its truncation flags remain visible.
2. **Instructions:** `AGENTS.md` from the selected project's ancestors and the ancestors of explicitly selected source/test files, ordered from parent to child. Each has an explicit directory `scope`. Sibling instruction contents are not automatically read. Overview may list nested instruction paths as scoped inventory evidence.
3. **Documents:** existing root `README.md`, `README.rst`, `README`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `global.json`, and `Directory.Build.props`, in that order.
4. **Sources:** the requested source and test excerpts, preserving request order, numbered text, encoding, observed full-file SHA256 where supported, file version, and read cursor.
5. **Searches:** up to five caller-selected literal/regex queries, each with up to 20 matches. Hits include precise locations and `suggestedReads` for nearby source lines. Search snippets themselves have no file hashes. Add discovered files to a fresh `task_context` request to gather their scoped instructions and hashes, or inspect the relevant instructions separately before using the suggested reads for an edit.
6. **Workflows:** the existing catalog filtered by the exact selected project. It supplies workflow IDs, linked patch IDs, and recorded state without launching, resuming, or reconciling any work. Use `workflow_status` for current files/jobs. Child-project workflows and standalone patches without a workflow are not automatically included; use their existing discovery tools explicitly.

`includeOverview`, `includeInstructions`, `includeDocuments`, and `includeWorkflows` default to true. Disable only the sections not needed for the current inspection; disabling instructions does not establish that no instructions apply. Tests are selected through explicit files and search queries/globs, not inferred as a complete test dependency graph.

Searches preserve ripgrep's behavior: Git ignore rules normally apply, but explicit positive globs can override matching ignored paths. Generated-folder exclusions take precedence over caller globs in this release; task context never enables generated folders. The standalone `search_text(includeGenerated=true)` remains the explicit opt-in. Links, Git internals, protected state, and temporary mutation files retain their existing restrictions.

## Two kinds of continuation

The outer result contains `planHash`, `sectionCount`, `nextOffset`, `hasErrors`, `outputLimitReached`, and `timeLimitReached`. If `nextOffset` is non-null, send the same selection with:

- `offset` equal to that value;
- `expectedPlanHash` equal to the previous result's `planHash`.

The hash identifies the ordered section requests, selected project, and configured roots. It does **not** identify a filesystem snapshot. Changed content is read live and has its own version/hash. If discovered instruction/document paths or selections change, continuation fails with `CONTEXT_PLAN_CHANGED`; restart at offset 0 without the old hash so newly applicable context is not skipped. Missing continuation hashes produce `CONTEXT_PLAN_REQUIRED`. The section selection can survive an owner restart if those inputs remain the same.

Each section carries its exact underlying `request`, the original result or structured error, and a nullable `followUp`. A follow-up is a directly executable CLI request object:

- `read_file` with its cursor continues a longer file or instruction document;
- `search_text` with its offset continues a result-limited search;
- `workflow_list` with its offset continues the bounded catalog scan.

Outer pagination ending does not finish these inner pages. Preserve nested truncation, `scanLimitReached`, `catalogTruncated`, errors, and scope notes. A budget-limited search with no next offset must be narrowed. Read cursors expire on file change or owner restart; begin a fresh read in those cases. Repeated inspection is safe but may observe newer content.

## Bounds and failures

- 32 KiB context request, 20 source/test requests, five search requests, and at most 64 instruction-scope directories.
- Sources default to 100 lines and accept 1–1,000; automatic instruction pages use 120 lines and documents use 100.
- Up to 20 sections per response, default 10, within **60,000 serialized JSON characters**, including escaping and metadata.
- A 20-second budget is checked during ancestor discovery and between section operations. Each underlying read/search/overview retains its own bounds; one operation can finish after the outer deadline. This is not a strict wall-clock cancellation guarantee.
- Existing readers retain their 16 MiB full-file hashing limit and bounded large-file scanning. Large-file excerpts return a null hash when unsupported.
- Workflow discovery returns up to ten matches while scanning up to 100 records per section. Follow its offset even if a filtered page is empty.

Missing/inaccessible files, binary text, path violations, or malformed searches become section errors while successful sections remain available. Unreadable workflow records produce `CONTEXT_CATALOG_ISSUES` while preserving matches and record issues. An individually oversized section becomes `CONTEXT_ITEM_LIMIT` with a direct follow-up to its underlying tool; it cannot cause an endless outer page. Reduce selected lines/results or inspect that tool directly. Excessive ancestor discovery fails explicitly with `CONTEXT_DISCOVERY_LIMIT`.

No context result approves an edit, script, commit, or deployment. Retrieved text and manifest scripts remain untrusted project evidence. The result is bounded live context, not exhaustive discovery, a semantic relevance guarantee, an atomic project snapshot, or proof that a test command covers the intended change.
