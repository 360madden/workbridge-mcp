# WB-025 — Stable, complete CLI request input

Date: October 21, 2026 (America/New_York). **CLI-only milestone complete**, with a separately verified test-readiness correction. The server remains **0.16.3-dev / WB-022**, with 52 tools and six shared command slots. No server build, restart or new runtime release occurred.

## Reproduced gap

The CLI previously read only the input file's initially reported byte length. A request file that grew during the read could still have its valid original prefix executed while appended bytes were ignored. Private tests also showed execution after a same-size rewrite, pathname replacement or removal during the read. These are controlled fixture results, not a claim that a spontaneous incident happened in production. Eight of the nineteen new checks failed against the original CLI; their actual failing output is retained.

## Changed behavior

The CLI keeps its existing **4 MiB and 1–100-step limits**. It now probes one byte beyond the expected length and compares the opened file's identity, size and high-resolution modification/change timestamps before and after reading. It also verifies the current pathname refers to the same file state. Observed growth, replacement, removal or metadata changes are rejected before a service connection, private state creation or batch execution. The file handle is still closed on success or failure.

Rejection remains **INVALID_INPUT / exit 2**. There is no automatic reread, repair or command retry. Finish writing the entire request file and leave it unchanged before invoking the CLI. Even a timestamp-only change is conservatively rejected. Stable short reads, UTF-8/BOM, Unicode, exact-size input and 100 steps remain supported. Structural validation of the whole array remains ahead of execution, so an invalid later step cannot cause an earlier write to run.

These are bounded before/after observations, **not an atomic cross-process snapshot, writer lock or continuous monitoring**. A change after validation does not modify the already parsed in-memory batch. The checks cannot guarantee detection of every deliberately concealed or precisely timed external filesystem change. File permissions and workspace roots are unchanged.

## Validation

| Check | Result |
| --- | --- |
| Original CLI against new checks | 11 passed, 8 failed; failures retained |
| Final isolated full suite | 509/509 passed |
| First main-repository run | 508/509; existing cancellation-test readiness failure |
| Main rerun after the readiness correction | 509/509 passed |
| New production-only input cases | 19/19 passed |
| Existing recovery suite, production-only | 21/21 passed |
| Delayed-output cancellation probe | Original test failed; corrected test passed with assertions intact |
| Normal browser / shared CLI acceptance | Passed; fixture and staging restored |

The suite grew from 490 to 509 because nineteen unique input cases were added. Production checks and the controlled cancellation probe overlap existing full-suite cases; do not add the counts. Production installation used the unchanged lockfile offline with --omit=dev --ignore-scripts and lacked application source, TypeScript and Prettier. Tests used the installed Windows host and Node v26.5.0. No dependency update was made.

## Cancellation-test correction discovered by the main run

The first main run failed because test/job-retry-save.test.mjs cancelled after observing count.txt, which the child writes before stdout/stderr. That marker did not establish that the output being asserted had been captured. A private probe inserted a one-second delay between the marker and output: the old assertion failed, while the revised readiness check passed.

The test now observes both expected captured streams before requesting cancellation, with a finite deadline and explicit failure on missing readiness. All final output, cancellation, real exit, saved-record, reconstruction and once-only replay assertions remain. No production cancellation or recovery implementation changed. The first failed main run and both delayed-output probe results are preserved; this is not a passing rerun presented as a fix.

## Hosted acceptance and preservation

A normal connected CLI request containing a valid first write followed by a structurally invalid step returned exit 2 and performed no write. A stable BOM-prefixed request containing Unicode then created the intended recoverable edit. The shared CLI and direct browser change_status observed the same operation wb025-hosted-write-20261021-01. Request replay did not write again. Direct browser undo_change restored the original file; final hashes confirmed target bytes, unrelated dirty fixture bytes and Git staging were restored. All request-input files remained unchanged.

Changing-input faults were injected only into private test caller reads and disposable instances, not the live service's journals or transport. The normal live owner remained d7ca7bc4-79c7-4588-b421-518a0dd5253c. The main CLI script, two test files and five Markdown files are the only intended source changes. Runtime source, binaries, package/lockfile, six configuration files, main Git staging, original sealed release, credentials, permissions and unrelated projects were preserved. No commit or push.

Code patches: wb025-cli-promotion-20261021-01 and wb025-cancellation-test-promotion-20261021-01.
Documentation patch: wb025-docs-20261021-01.
Final workflow: wb025-final-checkpoint-20261021-01.
Evidence: C:\work\workbridge-wb025-20261021-01\evidence.

Inspect final-verification.json and milestone-complete.json for final file counts and successful checkpoint results. Complete diffs were reviewed by the implementing assistant, not an independent reviewer. No new seven-gate runtime deployment is claimed because no server runtime changed.

Resume from [the handoff](handoff-20261020.md); see [CLI usage](workbridge-cli.md) and [last runtime deployment](wb022-deployment.md). No repeat activation is pending. Direct named command_retry_save exposure and browser-rendering limitations remain separate.

Model: GPT-6 Astra Pro. Reasoning level:
