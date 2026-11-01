# WB-011 — 0.12.0-dev deployment and browser/CLI acceptance

Date: **2026-10-20** (local; October 21 UTC)  
Result: **0.12.0-dev deployed; filtered history and recovery passed normal browser Chat and connected CLI acceptance.** Browser final replies again displayed “This response couldn’t load.” Tool interoperability passed; the complete browser presentation experience did not.

## Release and installation

Release **`wb011-20261020-review01`** exposes **51 tools**. Its manifest SHA256 is `6B5169BA260F63C7FA13A4BC61259CD557EB63ABB30D30CB11FDB4CCF05AAF91`. The [candidate report](wb011-validation.md) records all seven passing gates: pinned installation, **236 tests**, startup, **21 updater cases**, formatting, generic acceptance, and the release probe. The suite adds **17 history module cases and five connected CLI/MCP cases** to the 214-test baseline. Five additional tests passed against the exact sealed runtime with production dependencies only.

Independent [WB-001 deployment](updates.md) operation **`wb011-activate-20261020-01`** completed at **2026-10-21 00:29:09 UTC**, replacing 0.11.0-dev. No Workbridge jobs were running before activation. The updater completed without deployment or recovery errors and retained the previous runtime backup. Its local journal deliberately retains `hostedVerified: false`; actual browser evidence is recorded separately.

The acceptance-time owner is **`bec82774-852a-41c1-a1a7-db136478178e`**, PID **68036**, started **2026-10-21T00:29:09.005Z**. Browser and CLI reports identify that same owner. Discover current connection details using the installed CLI and service-state directory rather than hard-coding these values.

All **five installed history CLI/MCP integration tests passed** after deployment using disposable owners. They cover cross-client paging, filtered configuration-patch discovery and guarded undo, restart continuity, partial errors and failure exits, and preservation of staging and pre-existing dirty files. No source rebuild or development dependency was needed. The live service was not deliberately crashed; restart and fault cases used disposable owners.

## Fresh normal browser Chat acceptance

Testing used the existing [Deployment Test Results chat](https://chatgpt.com/c/6ad7dbb6-098c-83ea-ac08-fa9c824e4ddf), after refreshing the Workbridge catalog. Project fixtures were confined to **`C:\work\workbridge-wb011-hosted-20261020-01`**. No real RRE project was edited.

| Check                               | Observed result                                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser starts, CLI continues       | Browser requested a project/state-filtered page with `scanLimit: 1`, receiving no matches and a valid continuation. CLI used that exact continuation, found the intended edit, checked its current hash, and undid it.                                       |
| CLI starts, browser continues       | CLI prepared another empty sparse page. Browser continued its cursor, discovered the next intended edit, inspected it, and undid it using the returned ID.                                                                                                   |
| Move endpoints                      | Browser discovered the same move using either the missing source path or the destination path, then restored the source using the discovered operation ID.                                                                                                   |
| Configuration patch discovery       | Project/path/state filtering found the intended structured configuration patch and returned its recorded `applied` state.                                                                                                                                    |
| Recorded state versus current files | The harness had made a later independent edit. Browser `patch_status` reported a current conflict despite the catalog's recorded `applied` state.                                                                                                            |
| Guarded undo                        | Undo returned `PATCH_BLOCKED` with `PATCH_CONFLICT`; readback hashes and independent CLI status confirmed that the later edit remained intact.                                                                                                               |
| Invalid scope                       | A Git-internal path filter returned `GIT_INTERNAL` without changing files.                                                                                                                                                                                   |
| Partial catalog error               | A temporary malformed acceptance-only record produced one `CORRUPT_CHANGE` issue while retaining the following valid change summary. Browser preserved the complete wrapped partial result. CLI independently returned exactly the same result and exited 1. |
| Restoration                         | The temporary malformed record was removed after an exact content-hash check. Guarded undo restored all disposable edits, including the configuration patch after restoring its exact checksum-verified after-snapshot.                                      |

All **six original fixture files**, the fixture's **pre-existing dirty edit**, and its **staged Git index** match their baseline. The three temporary project paths no longer exist. Browser-authored reports, requests, and valid durable history remain for evidence.

The malformed record was a newly created, uniquely named test entry in the live change catalog; no existing journal was corrupted or replaced. It affected only metadata discovery, and was removed immediately after browser and independent CLI verification. `temporary-record-removed.json` records its exact path/hash. No deployment, command execution, staging, or arbitrary journal repair was delegated to browser Chat.

## Preservation and evidence

Before integration, all **145 original main source files** were backed up and hash-checked. Exactly **21 reviewed files** were integrated, including five new files; **129 original files** remained unchanged at that point. Eight subsequent documentation updates have separate byte-preserving backups. No commit, staging change, reset, or cleanup of inherited changes occurred.

Verification matched **2,953 sealed payload files**, **2,805 installed runtime files**, and **108 implementation/test/script/package files**. It checked all **2,802 previous runtime backup files**, all source backups, both Git indexes, and the same **six saved configuration files**. Roots, profiles, permissions, startup, and tunnel configuration were preserved.

The final inventory contains **151 expected source/documentation files**; **128 original files** remain byte-for-byte unchanged after integration and documentation updates. Updated documentation was formatted and its local links checked. The pre-existing trailing blank line in `docs/validation.md` remains unchanged.

Evidence is retained under **`.local/wb011-deployment-20261020-01/`**:

- `baseline.json`, `source-before/`, `integration.json`, `docs-before/`, and `documentation-changes.json` capture preservation boundaries.
- `install-verification.json`, `installed-tools.json`, `installed-history-cli-tests.log`, and the updater journal establish installed behavior.
- `browser-start-results.json`, `browser-results.json`, `browser-partial-results.json`, CLI JSONL outputs, and normalized hosted errors/partial data retain actual client responses.
- `browser-independent-verification.json`, `temporary-record-removed.json`, `fixture-restoration.json`, `hosted-acceptance.json`, and `final-verification.json` record independent assertions and restoration.
- `browser-first-render-failure.png`, `browser-acceptance.png`, and their AX snapshots show the recurring display limitation and completed tool activity.

The acceptance harness verified operation IDs, exact continuation positions, recorded/current states, nested errors, current file hashes, identical browser/CLI partial results, and restored bytes. It did not rely on a browser prose verdict. Hosted `INVALID_ARGUMENT`/`TextContent` wrappers were decoded as JSON without evaluating their contents. Original reports remain unchanged.

## Compatibility and remaining limitations

**Single-file history now uses ascending operation ID order instead of newest timestamp first.** Restart offsets at zero after upgrading. Existing summary fields, operation IDs, journal formats, status, and guarded recovery are retained. Patch discovery keeps its ascending-ID ordering. See the [filtered-history contract](filtered-history.md) for limits and examples.

History is live, bounded metadata. New/removed records can shift positions between pages, recorded states are not fresh file verification, and a null continuation does not erase truncation or errors from earlier pages. Discovery does not read backup files, hash project files, or run recovery implicitly.

All three browser final replies failed to display in this run, despite successful tool execution and saved reports. The preceding 0.11.0-dev acceptance had rendered successfully. The recurrence establishes an intermittent presentation limitation, not its cause. No Workbridge rendering fix is claimed. Hosted partial-result wrappers also remain less convenient than direct CLI JSONL.

AI-001 through AI-011 are now implemented/configured and deployed. Further work should follow observed AI workflow gaps and reuse the existing context, catalogs, validation, and recovery contracts. This report is the baseline for subsequent work.

## Browser recovery follow-up

The subsequent [browser response diagnosis](browser-response-recovery.md) reproduced the display failure with a tool-free one-line reply. Reloading the completed conversation restored that reply and all three WB-011 acceptance replies. A new read-only `workspace_info` request then rendered correctly and matched the same deployed owner. No Workbridge code or runtime changed. The original acceptance-time failure evidence is retained; this successful recovery does not establish a permanent fix or the underlying cause. The linked guide documents CLI-first inspection before retrying a mutation whose reply was lost.
