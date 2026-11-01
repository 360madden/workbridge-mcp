# WB-017 — Reliable ownership and recovery before command launch

Date: October 21, 2026 (America/New_York).
Release: **0.15.1-dev**; **52 tools**, no catalog addition.
Status: **Deployed and accepted.** Full candidate and installed suites passed 376/376. The 15 new cases passed with production dependencies only; all seven release gates passed. Direct browser and shared CLI acceptance passed. See [deployment evidence](wb017-deployment.md). The preparation procedure below is retained history, not a pending activation instruction.

## Demonstrated failures

The 0.15.0-dev baseline passed two and failed ten of the 12 new module checks.
A missing executable followed by a failed final-record save escaped as an I/O
error, without retaining the original executable error for explicit recovery.
Host-lock setup and synchronous spawn failures could leave the accepted intent
marked running on disk; subsequent reads misleadingly reported interruption.
Even during ordinary executable resolution or error publication, status could
claim interruption although the original owner was still handling the request.
All fault injection and regression fixtures use private state, not live journals.

## Correction and contract

After its initial intent has been saved, a request is owned throughout executable
resolution, command-host setup, execution and final result publication. The same
publication routine handles pre-launch and process results. It saves the original
outcome or retains it, within the existing six-slot bound, for command_retry_save.
The result is not fabricated as successful, lost, automatically rerun or repaired
by changing its request identity. A pre-launch failure has exitCode null because
no command child supplied an exit code; empty stdout/stderr remain empty.

Known executable errors, including EXECUTABLE_NOT_FOUND and SHELL_REQUIRED, retain
their codes. Failed host setup uses COMMAND_SETUP_FAILED. A synchronous host launch
exception uses COMMAND_LAUNCH_FAILED. If final publication also fails, the public
error is JOB_RECORD_SAVE_FAILED; explicit save recovery restores the original
failure, not a passing command. See [retained-result recovery](job-retry-save.md).
A saved failed job remains failed when replayed or read after owner restart.

Cancellation or shutdown observed during preparation prevents the command from
launching. It is checked after executable resolution and host setup. Cancellation
does not forcibly abort a filesystem call already in progress; it waits for that
call to finish before returning the final cancelled result. Once the process has
launched, existing process-tree cancellation and timeout behavior remains.

If the initial exclusive intent write fails, the request was not admitted: no
phantom retained result or occupied capacity is created. No second owner, new
tool, dependency, listener, permission, scheduled recovery loop, or command retry
was added. Existing publication/hash/replay checks and their limits still apply.

## Tests and scope

The new tests comprise 12 module cases and three real private-owner CLI/MCP cases.
The first focused run passed all 12 plus 26 existing persistence/recovery cases
(38/38). All three new CLI/MCP cases passed: stable missing-executable failure,
resolution failure with failed publication, and setup failure with failed
publication. Checks include replay/restart, no child execution, null exit,
preserved errors, failed CLI waits stopping subsequent writes, bounded six-slot
retention/release, changed-record refusal, cancellation, shutdown and initial-write
failure. Full suite/release results must be inspected separately before deployment.

The previous WB-016 direct named-tool exposure gap remains distinct: installed
CLI access to command_retry_save works, but this conversation still did not expose
that named tool. No redeployment or permissions change is a substitute for that
client-side catalog check. WB-017 adds no new tool and can be accepted through the
existing launch/status/output/cancel tools and shared CLI.

## Preservation and resume

Candidate and evidence: C:\work\workbridge-wb017-20261021-01.
The baseline contains 176 source files, six configuration hashes and the main Git
index hash. Prior candidates/releases remain unchanged. No main staging, commit,
remote push, credentials, permissions or unrelated project edits are authorized
by this document. The user requested continuation to the next milestone.
A RogueTV job was observed during isolation: do not interrupt other active work
for activation; recheck the live owner and active jobs at deployment time.

Use the independent updater only after the full seal, production-only tests and
reviewed source promotion. Never rebuild the running installation. Preserve red
results as failures rather than relabeling them. Actual induced-fault recovery is
private-test evidence, not a claim of inducing faults in the real service.

Model: GPT-6 Astra Pro.
Reasoning level:
