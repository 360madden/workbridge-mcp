# Source audit: literal-dollar corruption in Workbridge edit_file

**Date:** 2026-11-06 (America/New_York). **Status:** 🔴 Confirmed in current source and deployed JavaScript; **NO production edits or runtime repro performed by this reviewer**. Narrow risk: **`edit_file` replacement payload expansion**. Do not generalize to direct `write_file` without separate proof.

## Exact, independently read evidence

| Component | Verified operation | Consequence |
| --- | --- | --- |
| `src/changes.ts:287–296` | `Changes.write` calls `writeOrEdit({content})`; `Changes.edit` calls `writeOrEdit({edits})`. | Two modes enter the same function but select distinct branches. |
| `src/changes.ts:314–345` | On `input.edits`, normalize EOL on `oldText`/`newText`, verify exact expected occurrence count, then **`content = content.replaceAll(oldText, newText)` at line 343**. Source SHA-256 `c7c6d85c2e0826632758cc0d5a1763529b00723bd2ecb6562e2600ee885cf99b`. | JavaScript `replaceAll(stringSearch, stringReplacement)` interprets replacement-template tokens in user `newText`, including `$'` as suffix, `$\`` as prefix, `$&` as match and `$$` as one literal dollar. Thus an intended literal PowerShell `$'` can insert the whole original source tail, explaining apparent ~8 KB appendage without any extra tool call. |
| Deployed `dist/changes.js:303` | **Same `content.replaceAll(oldText, newText)` operation** verified by read-only search. | The faulty semantics exist in the deployed Workbridge runtime, not only unbuilt source. |
| `src/server.ts:487–512` | `write_file` dispatches `changes.write`; `edit_file` dispatches `changes.edit`. | Tool names share write machinery, but only edit has the user-supplied replacement-string call. |
| `src/changes.ts:63–81,346–365` | Direct `write_file` content passes to `encodeText`, then `atomicWrite`; the only regex replacement in `encodeText` uses an EOL-controlled replacement, **not** the caller's literal content. | **No verified direct `write_file` corruption path from this bug.** Observed write_file damage would require a separate transport/upstream cause or misattribution; do not claim it is proven. |

**Severity:** P1 **data-integrity correctness** for `edit_file` on code/text containing dollar-token combinations. Current expectedHash and occurrence-count guards prevent stale/mismatched targets, but **do not** prevent unintended replacement expansion; the expanded output may remain under the 16 MiB editable limit, be atomically written and receive an apparently valid receipt. Source feasibility is proven; no live-file corruption reproduced by this lane.

## Minimal safe patch (future WB-001 only)

Change just `src/changes.ts:343` to:

```ts
content = content.replaceAll(oldText, () => newText);
```

The callback's return value is inserted **literally**, so replacement-template tokens cannot expand. Keep the exact literal `oldText` matching, preflight occurrence count, EOL normalization, expectedHash, atomic write/undo, output hash and stable error contract unchanged. Do not blindly escape dollars or change to a regex search; a function callback fixes this specific semantic pitfall with the least behavior change.

## Repro and regression matrix — planned, **NOT EXECUTED**

Use a newly created, disposable text file in a verified private investigation fixture only, with original SHA and narrow authorized operationId. Never target an active PowerShell recovery script, production `src` or installed `dist`.

| Test | Intended newText / scenario | Required postcondition |
| --- | --- | --- |
| T01 | `$'` | Literal two characters inserted; **no suffix duplication** |
| T02 | `$\`` | Literal two characters inserted; **no prefix duplication** |
| T03 | `$&` | Literal two characters; not replaced by matched old text |
| T04 | `$$` | Literal two dollar characters; not collapsed |
| T05 | `$1`, `$<name>` | Preserve string literal; verify non-capture controls remain unchanged |
| T06 | Mixed PowerShell examples using `$'`, quoted here-strings, CRLF and LF files | Exact byte/text comparison, final SHA, EOL and BOM preservation |
| T07 | `occurrences=2`, overlapping candidates, zero/mismatch, oversized expansion | Correct literal count and deterministic refusal with original hash unchanged on error |
| T08 | Direct `write_file` using identical dollar-token content | **Control** that bypasses the edit replacement branch and writes verbatim |
| T09 | Single-file undo/replay/receipts after edited success; alternate UTF-8 BOM and UTF-16LE fixtures | Durable before/after hash and reversible exact bytes |
| T10 | Sealed candidate build/runtime tool dispatch through the same tool contracts | Source → `dist` / package → installed SHA parity, no fallbacks, no previously queued mutation |

**Safe repro order:** offline unit test of the pure JavaScript literal-string replacement semantics → isolated `Changes.edit` fixture test with explicit expected SHA and approved Workbridge normal gate → package and regression tests → separate WB-001 maintenance window. No live edit/replace test now.

## Verified isolated in-memory Node synthetic (not a Workbridge tool invocation)

**Reviewed source:** `investigations/windows-desktop-automation/prototypes/replaceall-literal-dollar.test.mjs`, SHA-256 `1ccd8229c158b34562cf48330a36a2ad17601fcfdb1c17818b647a09b5045e77`. Only imports `node:test`, `node:assert/strict`, `node:crypto`; no filesystem, network, process spawn, project source/dist import, GUI or Windows access. Pure JavaScript reproduces vulnerable `replaceAll(oldText,newText)` versus corrected `replaceAll(oldText,()=>newText)`, with independently constructed expected text and SHA-256.

**Exact bounded Workbridge command receipt:** job `wd_literal_replace_test_20261106b`, `node.exe --test investigations/windows-desktop-automation/prototypes/replaceall-literal-dollar.test.mjs`, exit **0**, stderr **0**, **11/11 tests PASS**, **0 fail**, Node runner duration 96.0138ms, Workbridge wall 396ms. Separate tests cover four expanding replacement tokens, two no-capture controls, CRLF repeated markers, mixed PowerShell text, regex-looking literal oldText, UTF-16LE BOM, and a narrow final SHA control. This proves **the JavaScript language semantics and callback remedy** only; no actual `Changes.edit` call, production file, or installed service was mutated.

## Deployment / recovery gate

- Preserve already-corrupted source as evidence before any recovery; compare original backup SHA, change receipt, affected file, expected ending and exact tail. A successful `edit_file` operation is **not** proof its resulting text equals the intended literal replacement. Use fresh guarded edits/undo only under an explicitly authorized maintenance scope.
- Keep currently operational Workbridge and desktop/RIFT GUI integrations running. Until a verified fix is deployed, **avoid `edit_file`** for text containing replacement tokens; prefer `write_file` with explicit full content and expectedHash after independent read/compare, acknowledging direct write_file source behavior has not been runtime-tested for this report.
- For promotion, independently test exact candidate `src`/compiled `dist` parity, preserve backups and operation receipts, check no in-flight edits, use the existing WB-001 staged/canary update, refuse hash drift, and roll back only with verified quiescence. **No hot patch of deployed `dist` and no service restart in this investigation lane.**
