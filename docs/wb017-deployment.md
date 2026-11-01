# WB-017 — Deployed pre-launch ownership and recovery

Date: **October 21, 2026**, America/New_York. Runtime: **0.15.1-dev**.
Status: **Release, deployment and browser/shared-CLI acceptance passed.**
The catalog remains at **52 tools**; no dependency or transport was added.

## Correction

The 0.15.0-dev baseline failed ten of twelve new module checks. A final-record save
failure could discard the original executable-resolution error. Host setup or
synchronous launch exceptions could leave an admitted intent without an owned
result. Status could also report interruption while the original owner was still
preparing the command.

Admitted requests now remain owned through preparation. A common publication
routine handles startup and process outcomes. It saves the original outcome or
retains it for the existing explicit recovery operation within the six-slot bound.
Cancellation/shutdown during preparation prevents launch after an outstanding
filesystem call returns. An initial intent-write failure still creates no phantom
owned job. See [detailed behavior and test scope](wb017-validation.md).

## Release and verification

Activation `wb017-activate-20261021-01` completed at **02:16:46 EDT / 06:16:46 UTC**.
The independent updater replaced 0.15.0-dev with no deployment or recovery error.
No other active jobs or retained publication failures were observed in the fresh
preactivation scan and immediate dispatch check. The earlier RogueTV job was not
cancelled or interrupted by this work.

Seal: `wb017-20261021-review01`.
Manifest SHA256: `440DCE7E391545B7458DE8C292D9E3213E62CF2E976FC42B49C931641701721F`.
Owner during acceptance: `6dbdd7b4-6c97-4ae2-968a-bc8b66e79043`.
The updater's local hosted-verification flag was not rewritten; direct browser
results are recorded separately.

| Check | Result |
| --- | --- |
| Full candidate suite | 376/376 passed |
| Fresh installed suite | 376/376 passed, exit 0; no skips/cancellations |
| New production-only cases | 15/15 passed; included in the full suite |
| Sealed-release checks | All seven passed |
| Installed runtime | 2805 files matched |
| Sealed payload | 2982 files matched |
| Rollback runtime | 2805 files matched |
| Preserved backup | 3380 files matched |
| Reviewed source before final documentation | 179 files matched |
| Live configuration | Six original hashes unchanged |
| Main Git staging | Original index hash unchanged |

Installed job `wb017-installed-full-tests-20261021-01` ran the compiled suite
without rebuilding the running installation. Production-only execution omitted
application source, TypeScript and Prettier. Original red results remain failures;
passing results are recorded separately. The same assistant implemented and
reviewed the change; no independent reviewer is claimed.

## Actual browser and shared CLI checks

Disposable project: `C:\work\workbridge-wb017-20261021-01\Hosted fixture ü`.
Direct browser launches returned `EXECUTABLE_NOT_FOUND` for a missing executable
and `SHELL_REQUIRED` for a script without an explicit interpreter. Both had
`status: failed`, null child exits and zero captured output. The script did not
run. Shared CLI calls found those same IDs and errors; waiting returned exit 1 and
skipped the following sentinel write. Save requests returned `already_saved`
without rewriting records, and identical launch requests did not execute again.

A normal direct browser command succeeded once. CLI replay left its execution
counter at one and retained its actual output. A hash-guarded browser write restored
the empty counter; subsequent replay left it empty. Fixture staging, the unrelated
dirty file and the refused script matched baseline. All three completed job-record
hashes stayed unchanged; no sentinel file appeared.

Actual induced save/setup faults, preparation cancellation and capacity recovery
were exercised in private disposable module and real MCP/CLI tests, including the
production-only build. No live service journal was damaged to manufacture a test.

## Checkpoint and boundaries

Evidence: `C:\work\workbridge-wb017-20261021-01\evidence`.
Source patch `wb017-source-promotion-20261021-01` promoted eleven reviewed files;
the updater installed two package files and runtime. Documentation checkpoint:
`wb017-deployed-docs-20261021-01`. Final checks are recorded in
`documentation-validation.json` and `deployed-integrity-after.json`.
Their actual pass state, not this report alone, establishes completion.

No main staging, commit, remote push, credential, permission or unrelated-project
edit was made. Previous candidates, seals, backups and failed logs remain retained.
A resumed preparation helper refused an already-updated version selector; its
failed result is retained and it did not trigger another activation.

WB-016's direct named `command_retry_save` exposure remains a separate interface
check; installed shared CLI recovery works. WB-017 introduced no new tool. Nothing
here claims a permanent browser rendering fix, atomic filesystem compare-and-swap,
power-loss durability, or reconstruction of already-lost owner memory.

Resume from [the handoff](handoff-20261020.md). Do not repeat activation or fixed
acceptance IDs. No further runtime feature was started.

Model: **GPT-6 Astra Pro**.  
Reasoning level:
