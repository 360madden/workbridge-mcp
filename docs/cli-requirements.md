# CLI-001 — CLI-centric AI automation

Adopted: 2026-10-20\
Audience: AI coding agents and maintainers of Workbridge helpers, utilities, and modules\
Status: Required for new work and substantial changes; this document implements no functionality.

## Requirement

All new or substantially modified helper applications, utilities, scripts, and operational modules must support their intended workflows through a complete, noninteractive command-line interface. Standardize interfaces where practical, reuse established tools and libraries, and verify execution through the actual automation environment.

Practical workflow impact takes priority over keeping a change small. A valuable capability is not excluded because it needs a substantial CLI, transport, recovery model, or validation effort. Scope still must be explicit, bounded, and reviewable.

This is a design and acceptance requirement, not permission to implement, install, deploy, or change configuration. The [AI workflow improvement plan](ai-workflow-improvements.md) identifies the proposed next work.

## Scope and architecture

- Prefer established supported CLIs for Git, Python, Node, .NET, and PowerShell operations. Check existing capabilities before introducing a wrapper or dependency.
- Keep operational logic in reusable modules. CLI, MCP, and optional GUI adapters share that logic and its validation, conflict checks, and recovery behavior.
- Internal modules can be exposed through their owning application's CLI; each module does not need its own executable. Small synchronous utilities should remain synchronous.
- Cover the complete intended automation workflow: inputs, execution, results, failures, and applicable recovery. Async workflows additionally need status, output, and cancellation.
- For recoverable mutation workflows, additionally cover preview or preflight where applicable, operation discovery, progress inspection, continuation, review, rollback, and guarded undo.
- Required automation must not depend on GUI clicking or an unexpected prompt. Document unavoidable external consent or interactive setup separately; do not bypass it or claim that step is automated.
- Apply the requirement to relevant new or substantially changed code. Existing tools are not scheduled for a blanket rewrite by this document.

## Standard interface contract

| Area                  | Required behavior                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery             | Provide help and version information using the platform's conventions. For custom executable CLIs, prefer `--help` and `--version`; retain native PowerShell help/parameter conventions. Document prerequisites and runnable examples.                                                                                             |
| Naming                | Use consistent command groups, action verbs, and descriptive options. Reuse `--input`, `--output`, `--json`, and `--timeout` where their meanings apply. Do not add meaningless options to every tool.                                                                                                                             |
| Structured results    | Offer stable machine-readable results for structured operations. In JSON mode, stdout contains the result and stderr contains diagnostics; omit banners, progress animations, and ANSI formatting from machine output. Version custom result schemas where compatibility matters. Reuse existing tools' supported machine formats. |
| Errors and exits      | Document exit codes and structured error categories. Use zero for successful completion of the invoked command contract and nonzero for failure. An accepted async launch must return a job ID and explicit nonterminal state; it is not proof that the job succeeded.                                                             |
| Noninteractive input  | Automation must finish or fail clearly when required input is missing. Interaction must be explicitly selected. Support a request file or stdin when structured/large input makes arguments impractical; advertise only mechanisms supported by the actual execution host.                                                         |
| Windows execution     | Use literal argument arrays and explicit working directories. Support spaces, Unicode, and ordinary Windows paths. Define relative-path and configuration-precedence rules. Use an explicit shell only when shell behavior is required.                                                                                            |
| Bounded operation     | Bound output and waiting where applicable. Identify incomplete or truncated results and provide supported continuation or artifact references. Use existing job supervision for long-running work rather than inventing another scheduler.                                                                                         |
| Mutation and recovery | Preserve applicable hashes, expected versions, operation IDs, and guarded undo. Document retry behavior; never silently duplicate an uncertain mutation or overwrite a newer edit. Preview/dry-run is useful where justified, but not a mandatory extra call before every edit.                                                    |

Do not place credentials in command arguments or output. Additional CLI access does not expand filesystem roots, project ownership, or authorization.

For custom JSON results, keep field names and meanings consistent across related commands. Prefer small additive schemas over a new universal response framework. An error should identify what failed and the next supported inspection step; it must not instruct the AI to bypass a conflict.

## CLI and MCP compatibility

An existing supported CLI client may satisfy the requirement for an MCP-exposed operation if the intended workflow is actually demonstrated through it. Merely starting a stdio server or having a client SDK installed does not establish a usable CLI.

Stateful operations must reach the correct service/job owner. Starting a second Workbridge server against the same state is not an acceptable shortcut for managing the first server's live jobs. Reuse a supported connection when available; identify a missing transport or CLI adapter as a separate prerequisite before promising coverage.

AI-007 is deployed in 0.8.0-dev: browser Chat and CLI automation share the authoritative owner, jobs, changes, and recovery state. See the [shared-service CLI contract](shared-service-cli.md) and [deployment acceptance](wb007-deployment.md). Deployed 0.9.0-dev adds [AI-009 workflow records](resumable-workflows.md) on that owner; [WB-008](wb008-deployment.md) records release verification and fresh browser/CLI tool acceptance separately. The connection defines endpoint discovery, local authorization, version negotiation, ownership, timeouts, and behavior when the owner is unavailable without broadening configured roots.

Shared-service commands must use durable operation or workflow IDs. Retrying an uncertain request must return or discover the original result where the operation contract supports idempotence; it must not duplicate a mutation. A later invocation must be able to inspect nonterminal, failed, interrupted, recovered, and completed states without relying on the original process's stdout.

The deployed 0.10.0-dev [task-context tool](task-context.md) follows the same CLI/MCP contract for read-only context gathering. Section selection hashes guard outer continuation; file versions/hashes and nested cursors retain their original meanings. Context completeness, successful command execution, and approval to edit are separate claims. [WB-009 deployment acceptance](wb009-deployment.md) verifies cross-client continuation, CLI exit behavior, partial results, and read-only operation.

The deployed 0.11.0-dev [structured-configuration tools](structured-config-edits.md) extend the same CLI/MCP contract. `config_preview` and `config_apply` produce ordinary patch records, so inspection, diff paging, discovery, explicit resume, guarded undo, and workflow validation retain their existing CLI entry points. CLI and deployed-owner versions must match. [Deployment acceptance](wb010-deployment.md) verifies both handoff directions, replay, failures, and recovery.

The deployed 0.12.0-dev [filtered-history tools](filtered-history.md) uses the same request-file interface for `change_list` and `patch_list`. Sparse pages retain a scanned-ID continuation; per-record metadata errors retain good rows but produce CLI exit 1. Incomplete pagination is not a successful exhaustive search. Both catalogs use ascending operation IDs, and old single-file offsets must be restarted after upgrade. No new CLI transport or history database is introduced.

The inspected Workbridge command runner closes stdin. Request files and literal arguments are the immediate automation path; enabling streamed stdin is separate work. Existing fixed profiles and `terminal_run` already execute CLI programs, but do not constitute a complete Workbridge management CLI.

## Acceptance criteria

A change satisfies CLI-001 when:

1. The supported entry point can perform the intended workflow without human intervention after documented setup.
2. A representative success and failure demonstrate correct output, error information, and exit behavior.
3. Relevant Windows path/argument handling and applicable conflict, retry, timeout, or cancellation behavior are verified.
4. CLI and MCP adapters preserve shared operation semantics where both exist.
5. Stateful service-connected workflows prove that CLI and normal browser Chat observe the same authoritative operation ID, state, output, history, and applicable recovery actions.
6. Multi-file or multi-step workflows demonstrate preflight conflict handling, interruption recovery, refusal to overwrite later changes, and bounded review output where those behaviors apply.
7. Workbridge-driven workflows are exercised through Workbridge with disposable inputs. Local CLI validation and fresh hosted ChatGPT validation are recorded separately; neither substitutes for the other.
8. Help/examples describe supported behavior, limitations, connection discovery, and configuration accurately. A missing required CLI path remains an explicit acceptance gap.

Keep validation proportional to the change. Do not build infrastructure or rewrite unrelated tools merely to satisfy a checklist.

## Design references

The requirement above is the project's chosen policy. The following primary documentation supports consistent naming, noninteractive scripting, and reuse of argument-parsing facilities:

- [Microsoft command-line design guidance](https://learn.microsoft.com/en-us/dotnet/standard/commandline/design-guidance)
- [System.CommandLine overview](https://learn.microsoft.com/en-us/dotnet/standard/commandline/)
- [Python argparse](https://docs.python.org/3/library/argparse.html)

References reviewed on 2026-10-20. Use features supported by the project's installed runtime and pinned dependencies.
