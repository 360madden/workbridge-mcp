# Workbridge coding-agent instructions

## Mandatory machine identity preflight (every new agent/chat session)

Before inspecting or changing a local project, running commands, controlling a desktop, or dispatching workers, verify the actual Windows hostname on the selected Workbridge connector. Run `hostname.exe` through that connector (not through the ChatGPT sandbox), and check the completed job's stdout and exit code. The expected hostname for the LEGION connector is `LEGION`; for AMD_DESKTOP it is `AMD-DESKTOP`. Connector names, cached context, `C:\work` paths and earlier chats are not identity evidence. If the hostname does not match, the command fails, or the target is ambiguous, STOP local operations and report the mismatch. Do not silently switch to another connector. Reverify after a server restart, connector change, or when changing target machines. State the verified machine in the first operational status update. This preflight is required even if another chat already verified the machine.

When the agent itself already runs on the target host (a local shell in this checkout), `hostname.exe` from that shell is the same evidence, and `workspace_info.computerName` plus the optional `.local/settings.json` `expectedHostname` guard confirm it from the server side; the server refuses to start on a mismatch. Neither shortcut removes the requirement to state the verified machine.

This repository is used for long-running AI-assisted development on Joey's Windows host. Before working on Workbridge, desktop/VM control or Rift integration, read `docs/autonomous-investigation-policy.md` and the relevant active roadmap (currently `docs/interactive-desktop-vm-roadmap.md`).

- **Investigate blockers autonomously.** An error is a starting observation: classify its layer, inspect live evidence, compare supported alternatives, and continue useful independent work. Do not ask the owner to fix routine tooling problems for an agent.
- **Surface ChatGPT Chat-mode approval needs in the MAIN conversation.** Before the first approval-prone Workbridge tool call in a phase (especially `terminal_run`), prominently name the intended action and warn that ChatGPT may show **“Allow ChatGPT to use Workbridge?”**. If hidden, the user can expand **Previous activity** to review **See details**, **Allow once**, **Always allow**, or **Deny**. Do not silently await, claim a pending tool ran, auto-click, bypass the host gate with another execution route, or confuse this prompt with Windows UAC. Limit repeated alerts. See `docs/chatgpt-approval-visibility.md`. ChatGPT owns the approval UI; Workbridge cannot force its placement or reliably observe an intercepted request.
- **Do not conflate identities.** Differentiate Workbridge's host session, VMware Workstation's unlocked/encrypted-VM context, Windows guest autologin, the running game, and guest receiver health.
- **Preserve live work.** Enumerate and verify the exact VM, host window/PID and guest control target before acting. Use read-only/synthetic tests first, serialize shared GUI input, and never blindly repeat uncertain actions.
- **Reuse existing tooling.** Review VMware/WinApp/guest receiver facilities and code already under the configured roots. Add narrow adapters and tests instead of unnecessarily duplicating frameworks.
- **Protect the dirty worktree.** Existing modified and untracked files are user-owned. Do not blanket-stage, stash, reset, remove or overwrite them. Use SHA-256 guards on edits, durable operation IDs and bounded evidence. Stage and commit only the verified files owned by the current milestone.
- **Commit each verified milestone.** Run focused tests, inspect the diff, verify HEAD, commit a small self-contained slice, then update the roadmap. Keep local Git commits distinct from deployed changes and off-machine backups.
- **Escalate true dependencies only.** Broad project authorization supports ordinary diagnostics, safe code/test operations, local commits and documented recovery. It does not supply unknown credentials or waive approval required by a protected workflow or for a material destructive change. Record the blocker and work other legitimate paths.

For live Workbridge service updates, follow the existing WB-001 staged validation and rollback process. Never launch a competing owner against `.local`.

## What this repository is

A local-first MCP server (TypeScript, Node ≥ 24) that exposes Windows file, Git, command, snapshot, desktop/VMware and coordination tools to ChatGPT through an OpenAI Secure MCP Tunnel, plus an authenticated loopback CLI for the same owner. No public listener, database, Docker, or model API. Current version: `0.16.4-dev` (see `package.json` for the authority; README prose can lag).

## Repository map

| Path | Contents |
| --- | --- |
| `src/server.ts` | MCP entry point. Declares every tool through a local `register(name, description, shape, run, annotations)` wrapper over `McpServer.registerTool`; the server `instructions` string is the agent-facing protocol contract. |
| `src/core.ts` | Shared `limits`, `excludedDirectories`, `BridgeError` and `errorDetails` mapping. |
| `src/schemas.ts` | Per-tool output schemas keyed by tool name (`resultSchemas`). |
| `src/workspace.ts`, `roots-config.ts` | Root allowlists, path policy, `.git`-aware resolution, `workspace-roots.json` reading. |
| `src/text.ts`, `search.ts`, `overview.ts`, `context.ts` | Streamed reads/paging, ripgrep search, project overview, `task_context` assembly. |
| `src/changes.ts` | Single-file create/edit/move/delete with SHA-256 preconditions, durable change journal and undo. |
| `src/patches.ts`, `config-edits.ts` | Multi-file unified-patch journal and JSON/JSONC pointer edits reusing that journal. |
| `src/jobs.ts`, `command-*.ts`, `command-worker.ts` | Bounded command-job slots, admission/safety/executable resolution, native command host. |
| `src/workflows.ts`, `src/history.ts`, `src/git.ts` | Resumable validation plans, Git inspection/commits, filtered file history. |
| `src/snapshots.ts`, `snapshot-cache.ts`, `snapshot-manifest.ts` | Byte-range/gzip snapshot reads and typed RiftReader manifests. |
| `src/agent-assignments.ts`, `agent-coordination.ts` | Worker assignment capacity and exclusive file ownership (coordination, not AI-agent spawning). |
| `src/desktop-*.ts` | Desktop/VMware capture, guarded actions, session policy, UI automation registration. |
| `src/local-service.ts`, `roots-cli.ts` | Authenticated loopback shared service and operator CLI plumbing. |
| `test/*.test.mjs` | Main suite; imports built output from `../dist`, so it needs `npm run build` first. |
| `test/*.test.ps1`, `desktop/tests/*` | Separate PowerShell/UIA suites, not run by `npm test`. |
| `scripts/` | PowerShell lifecycle (install/configure/update/autostart/health/rollback), `.mjs` CLI and acceptance runners, `Command-Host.cs`, C# helpers in `scripts/helpers/`. |
| `desktop/` | WPF `.NET 10` control center and its smoke fixtures. Built with `dotnet`, not `npm`. |
| `docs/` | Policies, roadmaps, operator guides, and per-milestone `wb0NN-*` validation evidence. |
| `investigations/` | Archived investigation artifacts (including published binaries). Evidence, not build input. |
| `temp/`, `.local/`, `dist/`, `.tools/` | Ignored: relocated historical fixtures, live runtime state, build output, downloaded tunnel binaries. |

## Commands

```powershell
npm ci                # locked install (Node >= 24)
npm run build         # tsc -> dist/ + Windows command host (scripts/build-command-host.mjs)
npm test              # build, then node --test test/*.test.mjs
npm run test:serial   # same, --test-concurrency=1
npm run test:startup  # test/startup.test.ps1 (DPAPI, Task Scheduler fixtures)
npm run test:updater  # test/updater.test.ps1
npm run format:check  # prettier gate (also: npm run format)
npm run acceptance    # isolated end-to-end fixture scenario
npm run acceptance:release
npm start             # node dist/server.js -- waits on stdin for an MCP client (expected)
npm run cli -- --root PATH --state-dir NEW_PATH --input requests.json
```

Run a single test as `npm run build; node --test test/<name>.test.mjs` — pointing `node --test` at a file without rebuilding tests stale `dist/`. Default concurrency is parallel CPU count; use `test:serial` for suites that share GUI, scheduled tasks, VMware or service state. Opt-in native rename tracing: `node --import ./test/native-rename-diagnostic.preload.mjs --test test/patch-recovery.test.mjs` (disposable tests only, never the installed service).

Desktop UI: `dotnet build .\desktop\Workbridge.ControlCenter\Workbridge.ControlCenter.csproj --nologo -warnaserror`, then `.\desktop\tests\Run-DesktopSmoke.ps1` (see `desktop/tests/README.md`).

## Engineering conventions

- **TypeScript strictness:** `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`; NodeNext ESM, so `.ts` imports use `.js` specifiers. Build must stay clean.
- **Formatting:** Prettier with single quotes at width 110. `.gitattributes` enforces LF for `.ts`/`.mjs`/`.json` and CRLF for `.ps1`; keep line endings as-is.
- **Errors:** throw `BridgeError(code, message, details?)` with a stable uppercase code. Codes are a public contract asserted by tests and surfaced to MCP and CLI clients; extend deliberately rather than reusing creatively.
- **Mutations are journaled and reversible:** every write path takes a caller-supplied durable `operationId`, checks a SHA-256/expected-state precondition, and is recoverable through `change_status`/`undo_change` or `patch_status`/`patch_resume`/`patch_undo`. No new mutation without preconditions, journaling and tests for the failure paths.
- **Bounds are mandatory:** honor `limits` in `src/core.ts`, paginate (`nextOffset`/`cursor`), cap characters/time/bytes per call, and never buffer a whole file or a whole process's output. Report `truncated` honestly instead of inventing counts.
- **Tool surface:** register inputs as Zod shapes, add the output schema to `src/schemas.ts`, and annotate reads vs mutations (`readOnly`). Keep the guidance in the server `instructions` string in sync when tool semantics change.
- **No shell strings:** command and Git execution use an explicit executable plus argument array with fixed arguments, timeouts and capture limits. `terminal_run`'s working-directory check is not an OS sandbox — say so when documenting.
- **Diagnostics:** stdout is exclusively MCP; log JSON to stderr only, with tool name, code and elapsed time — never source bodies, keys or clipboard contents.

## Runtime state and live service

- `.local/` holds live state: `settings.json` (`snapshotCacheGiB`, `expectedHostname`), `workspace-roots.json`, `commands.json` profiles, journals, `logs/`, `autostart.json`, and the DPAPI-protected tunnel key under `%LOCALAPPDATA%\Workbridge`. Workbridge file tools refuse to edit this state; never hand-edit it casually and never read out credentials.
- Environment overrides: `WORKBRIDGE_ROOT`, `WORKBRIDGE_STATE_DIR`, `WORKBRIDGE_SNAPSHOT_CACHE_GIB`.
- `npm run build` does **not** deploy. A source change reaches the live owner only through the independent WB-001 updater (`docs/updates.md`); `scripts/Restart-Workbridge.ps1` is for a deliberate restart of the current runtime, reusing the saved key.
- Tests use temporary fixtures and a real MCP stdio client; no account key, tunnel, or hosted call is required for `npm test`.

## Where to read more

| Need | Document |
| --- | --- |
| Operating posture and blocker playbook | `docs/autonomous-investigation-policy.md` |
| Active desktop/VM roadmap | `docs/interactive-desktop-vm-roadmap.md` |
| Machine identity and VM inventory | `docs/machine-identity.md` |
| Coding workflow, jobs, recovery, local commits | `docs/coding-workflow.md` |
| Patches, config edits, workflows, task context | `docs/multi-file-patches.md`, `docs/structured-config-edits.md`, `docs/resumable-workflows.md`, `docs/task-context.md` |
| Roots, CLI, snapshots, capacity | `docs/workspace-roots.md`, `docs/workbridge-cli.md`, `docs/snapshots.md`, `docs/job-capacity.md` |
| Deployment, rollback, release gates | `docs/updates.md`, `docs/validation.md` |
| Current checkpoint and history | `docs/roadmap.md`, `docs/workbridge-36-capacity-20261101.md` |
