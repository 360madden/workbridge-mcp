# WB-009 — 0.10.0-dev deployment and browser/CLI acceptance

Date: **2026-10-20**  
Result: **0.10.0-dev deployed; task-context tool workflows passed in normal browser Chat and the connected CLI.** The browser final-response display still says “This response couldn’t load.” Tool interoperability passed; the complete browser presentation experience did not.

## Release and installed service

The deployed release is **`wb009-20261020-review01`**, with **49 tools**. Its manifest SHA256 is `2E906F75EF302845E928A80D9280B0E20061344855D6E050AFA503C952AABDAA`. The [candidate report](wb009-validation.md) records all seven passing release gates: pinned installation, **190 tests**, startup, **21 updater cases**, formatting, generic acceptance, and the release probe. Five additional tests passed against the exact sealed runtime with production dependencies only.

Independent [WB-001 deployment](updates.md) operation **`wb009-activate-20261020-01`** completed at **22:54:17 UTC**, replacing 0.9.0-dev. No job was running before activation. The updater retained its previous runtime backup and completed without recovery errors. Its local journal correctly retains `hostedVerified: false`; the fresh hosted evidence is recorded separately.

The owner is **`d5b6bed8-ce90-4adc-a211-591a3975d2db`**, PID **65264**, started **2026-10-20T22:54:17.057Z**. Browser and CLI reports identify that same owner. These are acceptance-time identities, not values to hard-code. Discover the current endpoint using the installed CLI and `.local` service-state directory.

After deployment, all **five installed-runtime context integration tests passed**, using disposable owners. They cover CLI/MCP discovery, section and file continuation, partial errors and exit codes, instruction changes, workflow discovery without execution, preserved staging, and owner restart. No source rebuild or development dependency was required. The deployed owner was not deliberately crashed for these checks.

## Fresh normal browser Chat acceptance

Testing used the existing [Deployment Test Results chat](https://chatgpt.com/c/6ad7dbb6-098c-83ea-ac08-fa9c824e4ddf) after refreshing Workbridge's tool catalog. All files were inside **`C:\work\workbridge-wb009-hosted-20261020-01`**. No real RRE project was edited.

| Check                         | Observed result                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser starts, CLI continues | Browser called `task_context` for the first two sections. CLI continued the saved `nextOffset` and `planHash` to completion without gaps or duplicate sections.                 |
| CLI starts, browser continues | Browser continued a CLI-created source/test selection and finished at `nextOffset: null`, retaining the same selection hash.                                                    |
| File cursor handoff           | Browser used the CLI-issued `read_file` continuation and returned the next source line. Source and test SHA256 values matched the actual file bytes.                            |
| Instruction scope             | Root, project, selected source, and selected test instructions were gathered. Sibling instructions were not included as instruction content.                                    |
| Search and follow-up          | Search paging and suggested source reads worked. A positive `**/*.ts` glob did not leak the generated `node_modules` match.                                                     |
| Changed selection             | After the harness added a new applicable `AGENTS.md`, both clients rejected the old selection with nested `CONTEXT_PLAN_CHANGED`. Fresh browser context included the new scope. |
| Partial failure               | Both clients retained the good source section and its hash while reporting `ENOENT` for a missing file. CLI exited 1; browser retained the full nested partial result.          |
| Related change discovery      | Context found workflow `wb009-context-workflow-20261020-01` and linked patch `wb009-context-patch-20261020-01`. The workflow remained unstarted, with zero check attempts.      |
| Read-only behavior            | Source bytes, staged Git index, and command catalog count remained unchanged throughout context calls; no unexpected command marker was created and no jobs were running.       |

The acceptance harness deliberately applied one README patch and created its pending workflow before gathering context. It later added the instruction file solely to test selection conflicts. These were explicit test setup actions, not effects of `task_context`. Browser writes were limited to two new evidence reports. After verification, guarded patch undo restored the README and recoverable file deletion removed the added instruction file. All **11 original fixture files** and its staged Git index match their baseline. Evidence reports and the terminal workflow/patch records remain available.

## Preservation and evidence

Before source integration, all **133 original main files** were backed up and hash-checked. Exactly **21 reviewed candidate files** were integrated; **117 original files** were unchanged by integration. The eight subsequent documentation updates have separate byte-preserving backups. No commit, staging change, reset, or inherited-change cleanup occurred.

Post-install verification matched **2,916 sealed payload files**, **2,780 installed runtime files**, and **102 implementation/test/script/package files**. It verified all **2,777 previous runtime backup files**, all source backups, both Git indexes, and the same **six saved configuration files**. The final check repeats these assertions after acceptance and documentation updates. Runtime permissions, roots, profiles, startup configuration, and tunnel configuration were preserved.

The final source inventory contains exactly **139 expected files**; **116 original files** remain byte-for-byte unchanged after integration and documentation updates. Updated documentation was formatted and its local links checked. Repository-wide whitespace inspection still reports the pre-existing trailing blank line in `docs/validation.md`; its bytes match the original backup and were deliberately preserved.

Evidence is under **`.local/wb009-deployment-20261020-01/`**:

- `baseline.json`, `source-before/`, `integration.json`, `docs-before/`, and `documentation-changes.json` preserve the source and documentation boundaries.
- `install-verification.json`, `installed-tools.json`, `installed-context-cli-tests.log`, and the updater journal/probe establish installed behavior.
- `browser-start-results.json`, `collected-context.json`, CLI JSONL outputs, `browser-results.json`, and `normalized-hosted-errors.json` retain cross-client results and original wrapped failures.
- `browser-independent-verification.json`, `fixture-restoration.json`, `hosted-acceptance.json`, and `final-verification.json` record independent checks and final preservation.
- `browser-acceptance.png` and `browser-acceptance.ax.txt` show the browser activity and response display failure.

Harness correction: the initial browser verification expected errors at the top level. Hosted routing instead retained them inside `INVALID_ARGUMENT` / `TextContent` wrappers, including escaped string content. The harness was corrected to decode that wrapper without evaluating it; original browser reports remain unchanged. The resulting structured error and good-section hash were verified against independent CLI evidence. No product change was made to accommodate the wrapper.

## Limits and next work

The browser final-response rendering issue remains unresolved, including after successful tool execution. This report does not claim it was fixed. Hosted error routing also makes structured failures less convenient to consume than CLI JSONL. Both limitations are separate from the passing Workbridge tool results.

Task context is bounded, live, and explicitly selected; it is not an atomic snapshot, semantic search index, exhaustive test discovery, or permission to execute retrieved scripts. A selection hash guards the section plan, while file hashes/versions retain their separate meanings. See the [task-context contract](task-context.md).

**AI-011 has not started.** The next planned capability is structured configuration editing, kept CLI-centric and built on the existing preview, hash-conflict, journaling, and guarded undo contracts. The release and acceptance record above must remain the baseline for that work.
