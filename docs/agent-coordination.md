# Workbridge agent coordination — 12-worker capability

Workbridge's command-job pool supports **12 concurrent jobs**. The agent-coordination limit now derives from that same constant, so metadata can track **up to 12 running worker assignments per repository**. One additional **logical coordinator role** is reported, but it does **not** reserve a 13th command slot.

**This does not spawn AI reasoning agents.** The AI platform must create separate reasoning sessions. ChatGPT, DeepSeek, or another MCP-capable client may use Workbridge tools to coordinate existing job IDs, but provider-side concurrency and quotas remain independent constraints.

## MCP workflow

Tools are scoped to a real Git repository specified by `project`. Source file ownership is repository-relative and cannot escape that repository. Each Git repository has its own durable coordination journal under the protected Workbridge private state.

1. Call `agent_list` or `agent_status` to inspect capacity and ownership.
2. Call `agent_assign` with `taskId`, `workerId`, `ownedPaths`, and the exact Git `baseHead`.
3. Start a real job via `terminal_run` or an existing command profile. `agent_assign` itself launches no job.
4. Call `agent_dispatch` or `agent_dispatch_next`, binding an _already running_ job ID.
5. Once the job is durably settled, call `agent_finish` with a sanitized result receipt containing `outcome`, nonempty `testExitCodes`, and optionally owned artifact hashes.
6. Review the result and call `agent_verify` to release file ownership.

When a receipt declares artifact SHA-256 hashes, the installed runtime verifies those hashes against the current files before releasing ownership. Missing or modified artifacts leave the task in `review` with ownership retained. This is a point-in-time check, not an atomic repository snapshot, and it does not independently validate claimed test exit codes. The guard was installed through WB-001 operation `artifact-verify-update-20261031-01` on 2026-10-31, and a disposable compiled-runtime MCP test passed both altered and missing artifact cases before releasing ownership. For receipt artifacts, use the canonical absolute path returned in `agent_assign.ownedPaths`; unlike the assignment input, `agent_finish` does not currently reinterpret repository-relative artifact paths.

Use `agent_owner_of` to inspect which task owns a path. Replaying a job ID is idempotent only for its original task; never re-use an uncertain job ID for a different command.

## Limits and invariants

- **12 global command-job slots** are shared across all projects and clients. They are not allocated per repository.
- **12 worker assignments per repository** may be recorded as running. Each running assignment requires independent existing job evidence; no API launches models.
- `coordinatorSlots: 1` is a _logical role descriptor_, not guaranteed spare command capacity. A coordinator using `terminal_run` also competes for the global 12 slots.
- Unique worker IDs and nonoverlapping owned paths are enforced within a repository. Cross-repository work shares command slots but has separate assignment journals.
- A job may be bound only to an assignment in the same actual Git repository as the job's working directory. Cross-repository job evidence is refused with `AGENT_JOB_PROJECT`.
- Unverified work retains file ownership. Completed command processes do not free a recorded worker assignment until `agent_finish` settles its state.
- Git HEAD changes, stale paths, incomplete job publication, conflicting IDs, locks, or corrupt journals fail closed; recovery is explicit.
- Per-worker AI reasoning activity and provider-side subagent spawning must be measured separately from Workbridge job capacity.

## Release boundary

Source changes do not affect the active service until sealed with the existing WB-001 release/update path. Verify `workspace_info.limits.coordinatedWorkers` and the eight `agent_*` MCP tools on the new owner after activation.
