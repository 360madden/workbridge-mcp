# WB-010 — 0.11.0-dev deployment and browser/CLI acceptance

Date: **2026-10-20** (local; acceptance continued on October 21 UTC)  
Result: **0.11.0-dev deployed; structured configuration editing passed normal browser Chat and connected CLI acceptance.** New browser replies rendered successfully. Earlier response-display failures remain historical observations; no Workbridge rendering fix was made or inferred.

## Release and installed service

Release **`wb010-20261020-review01`** exposes **51 tools**. Manifest SHA256: `A10433F0E33327A4910819D07AAE415757454A6574B20DA7F1ACFAA385090D89`. The [candidate report](wb010-validation.md) records all seven passing gates: pinned installation, **214 tests**, startup, **21 updater cases**, formatting, generic acceptance, and release probe. The suite adds **24 configuration cases** to the 190-test baseline. Four additional integration tests passed against the exact sealed runtime with production dependencies only.

Independent [WB-001 deployment](updates.md) operation **`wb010-activate-20261020-01`** completed at **2026-10-20 23:59:31 UTC**, replacing 0.10.0-dev. The updater completed without deployment or recovery errors and retained its previous runtime backup. Its local journal correctly retains `hostedVerified: false`; browser evidence is recorded separately.

The acceptance-time owner is **`e85636bf-5999-4dee-9d5c-088fe94ff4fe`**, PID **59260**, started **2026-10-20T23:59:31.211Z**. Browser and CLI reports identify this same owner. Discover current connection details through the installed CLI and service-state directory instead of hard-coding this identity or an endpoint port.

All **four installed configuration CLI/MCP integration tests passed** after deployment, using disposable owners. These cover discovery, shared preview/apply/review/undo, explicit workflow validation, errors and exits, restart/replay, and conflict protection. The live service was not deliberately crashed; crash recovery was exercised by isolated tests.

## Fresh normal browser Chat acceptance

Testing used the existing [Deployment Test Results chat](https://chatgpt.com/c/6ad7dbb6-098c-83ea-ac08-fa9c824e4ddf) after refreshing Workbridge's tool catalog. Fixtures were confined to **`C:\work\workbridge-wb010-hosted-20261020-01`**. No real RRE project was edited.

| Check                         | Observed result                                                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser starts, CLI continues | Browser previewed and applied one JSON and one explicit JSONC file. CLI verified current hashes and the saved complete combined diff, validated the JSON through a workflow, then undid both files. |
| CLI starts, browser continues | CLI applied a second two-file configuration patch. Browser replay returned the original applied operation with `replayed: true`, inspected its diff, and undid it.                                  |
| Validation                    | The explicit workflow parsed JSON, asserted the enabled flag and single appended tag, and printed `WB010_CONFIG_VALIDATION_OK`.                                                                     |
| Stale hashes                  | The corrected browser request returned `CONFIG_PREFLIGHT` with two `CONFLICT` issues and exact expected/actual hashes. No patch journal was created.                                                |
| Failed value test             | A replace followed by a failing test returned `CONFIG_TEST_FAILED` at operation index 1 and pointer `/tags`. The prior proposed replacement did not reach disk.                                     |
| Comment protection            | Removing a key with an adjacent comment returned `CONFIG_COMMENT_CONFLICT` at `/other`. JSONC comments and file bytes remained unchanged.                                                           |
| Guarded undo                  | After a deliberate later edit, browser undo returned `PATCH_BLOCKED` with `PATCH_CONFLICT`. Readback hashes proved the later edit and the other patched file were preserved.                        |
| Recovery and replay           | CLI replay of the browser-undone operation returned `undone`, without applying it again. Ordinary patch recovery tools handled configuration journals.                                              |
| Browser presentation          | All three new replies rendered, including the unexpected test result and corrected stale-conflict verdict. The captured final reply shows `PASS`.                                                   |

After independent verification, the harness restored its deliberate later edit from the exact checksum-verified patch snapshot and invoked guarded undo. All **six original fixture files** and their **staged Git index** match the baseline. Evidence reports and durable records remain available. No real-project staging, commits, or publishing occurred.

## Test correction and evidence quality

The original stale-hash test was sequenced after undo. Undo restored the original bytes, making the request's original hashes valid again. Workbridge correctly applied the request, and browser Chat reported the unexpected outcome without claiming a pass. The harness guardedly undid that disposable patch, then submitted a new request using its saved after-hashes, which no longer matched current bytes. That genuine stale request was rejected for both files. No product change was needed.

The original browser report is preserved alongside the corrective report and `harness-correction.json`. Independent verification checks exact replay/state/operation IDs, the complete saved diff, preview/apply hashes, structured nested error codes and operation pointers, conflict readback hashes, absence of journals for rejected requests, and restored bytes. It does not accept the browser's prose verdict alone.

Hosted errors arrive inside `INVALID_ARGUMENT` / `TextContent` wrappers. The harness decodes the retained JSON text without evaluating it; both `rawError` and `wrappedError` report fields are supported. CLI JSONL retains direct structured errors and nonzero failure exits.

## Preservation

Before integration, all **139 original source files** were backed up and hash-checked. Exactly **22 reviewed changed/new files** were integrated, leaving **122 original files** unchanged at that point. Eight later documentation updates have separate byte-preserving backups. No commit, staging change, reset, or inherited-change cleanup was performed.

Post-install verification matches **2,944 sealed payload files**, **2,802 installed runtime files**, and **105 implementation/test/script/package files**. It checks all **2,780 previous runtime backup files**, the complete original source backups, both Git indexes, and **six saved configuration files**. Roots, profiles, startup, permissions, and tunnel configuration were preserved.

The final inventory contains **145 expected source/documentation files**; **121 original files** remain byte-for-byte unchanged after integration and documentation updates. Updated documentation is formatted and local links checked. The pre-existing trailing blank line in `docs/validation.md` remains unchanged.

Evidence is retained under **`.local/wb010-deployment-20261020-01/`**:

- `baseline.json`, `source-before/`, `integration.json`, `docs-before/`, and `documentation-changes.json` capture preservation boundaries.
- `install-verification.json`, `installed-tools.json`, `installed-config-cli-tests.log`, and the independent updater journal establish installed behavior.
- `browser-start-results.json`, `browser-results.json`, `browser-stale-results.json`, CLI JSONL outputs, and `normalized-hosted-errors.json` retain original and normalized results.
- `browser-independent-verification.json`, `harness-correction.json`, `fixture-restoration.json`, `hosted-acceptance.json`, and `final-verification.json` record checks and restoration.
- `browser-acceptance.png` and `browser-acceptance.ax.txt` capture the rendered browser result.

## Limits and next work

[Structured configuration editing](structured-config-edits.md) supports existing JSON and explicit JSONC files with bounded add/replace/remove/test operations. It does not add YAML/TOML, implicit parents, move/copy operations, or a general formatter. Ambiguous comment removal is refused and affected lines can reformat. Validation still requires explicit checks.

Successful rendering in this run does not establish the cause or permanent resolution of earlier browser UI failures. Hosted error wrapping remains less convenient than CLI JSONL.

The next practical recovery improvement is **AI-006 filtered change and patch history**: discover relevant operation IDs by project, path, and recorded state with bounded scans and honest completeness reporting. Build it on existing journals and CLI contracts, preserving known-ID recovery and avoiding a separate index/database or automatic undo. This deployment record is the baseline before that work begins.
