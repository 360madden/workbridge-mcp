# Workbridge edit_file literal-replacement fidelity defect — 2026-11-06

**Status: source-confirmed defect in edit_file only; no Workbridge production changes/deployments.**

## Reproducible observation during isolated desktop research

A proposed read-only watchdog inspector inserted a PowerShell regex anchored with the dollar end-of-string character immediately followed by a closing apostrophe (**U+0024 then U+0027**). Two guarded edits unexpectedly generated malformed PowerShell and appended a large suffix of the original file.

- Initial operation wd_orphan_inspector_pid0_duplicate_guard_20261105_e01: caller built the file text using JavaScript String.replace(oldText,newText), then Workbridge write_file applied that already-generated text. The file grew from the expected ~16.5 KiB to 24,663 bytes, and the original suffix was duplicated after the end of the file. This observation does **NOT** establish any bug in Workbridge write_file itself: the caller's String.replace expands the same replacement token.
- Independent operation wd_orphan_inspector_pid0_narrow_exact_edit_20261105_e01: direct Workbridge edit_file with exact oldText, one occurrence and replacement containing that dollar+apostrophe sequence also appended the old suffix and malformed the regex. The returned diff showed a change around 5 lines ballooning to roughly +155 lines. This is consistent with String.replaceAll replacement-token interpretation and is supported by the server source.
- Both unexpected own operations were safely undone using their exact undo IDs. File SHA returned to b5fa7fb5f040dba7e5fcfd6f88e110bbf29daa365d9293755a53a5fbe2a19709 after each undo.
- Replacing the regex with a literal no-special-token membership test, and then doing a tiny exact edit, gave a normal narrow diff and syntactically correct script. Subsequent read-only PowerShell Parser.ParseFile checks passed with zero syntax errors.

## Exact code evidence

The live repository source at src/changes.ts:314–346 (read-only inspected SHA c7c6d85c2e0826632758cc0d5a1763529b00723bd2ecb6562e2600ee885cf99b) contains a literal replacement loop. At line 343:

    content = content.replaceAll(oldText, newText);

JavaScript String.prototype.replaceAll with a **string** replacement interprets metasyntax in that replacement. The exact **U+0024 U+0027** sequence expands to the suffix of the matched input, rather than being written as literal replacement characters. U+0024 U+0026 and U+0024 U+0060 similarly have special replacement meaning. The source uses a callback-free replaceAll, so this is a deterministic path for incorrect edit_file output when a legitimate replacement contains such sequences.

Workbridge write_file takes a separately provided full content string and does **not** call replaceAll for that content in this inspected path. The initial write_file corruption should therefore be attributed to the caller's own String.replace before the tool call, not generalized to write_file.

## Minimal source-level fix proposal (NOT APPLIED)

Use a replacement callback in src/changes.ts:

    content = content.replaceAll(oldText, () => newText);

This preserves newText **literally**, with the current exact-occurrence counting and SHA preconditions unchanged. Add isolated tests covering replacement text with the suffix/whole-match/prefix token sequences, multiline PowerShell regex endings, mixed CRLF/LF normalization, and false-positive absence; verify actual resulting bytes and hashes, not merely tool exit0.

Before any live owner deployment, apply the existing WB-001 staged release procedure and rollback. No current Workbridge process, .local state, GUI lease, RIFT or VMware machine was modified during this finding.

## Safety classification and next gate

**P1 correctness/fidelity defect:** edit_file may silently produce the wrong textual content while returning an afterHash of those wrong bytes. Hash guarding protects concurrent writes, not the intent of a replacement string. Until corrected and tested, prefer unified patches or safe literal replacements without substitution tokens, followed by diff inspection and independent PowerShell/TypeScript parse checks where relevant. No automatic edit retry after uncertainty.
