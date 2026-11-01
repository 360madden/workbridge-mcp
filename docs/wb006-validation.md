# WB-006 — Shared service CLI candidate verification

Date: 2026-10-20  
Candidate: **0.7.0-dev**, AI-007  
Deployment: The standalone 0.7.0-dev candidate was not deployed. Its shared-service foundation is now deployed in **0.8.0-dev**; see [WB-007 deployment acceptance](wb007-deployment.md).

## Delivered behavior

The CLI can connect to the existing Workbridge owner with `--service-state`, discover its complete tool catalog and schemas, and use the same jobs, change journal, recovery records, and cursor state as the browser transport. Closing or timing out a connected CLI does not terminate the owner or its jobs. The existing isolated CLI remains available.

The shared owner uses the official MCP HTTP adapter on authenticated IPv4 loopback. Windows DPAPI protects the endpoint credential, the descriptor directory restricts access to the current user and SYSTEM, and an exclusive guardian lock prevents competing connected owners. The helper is packaged in `dist` so the existing runtime manifest, installation, and rollback include it. No updater runtime roots were expanded.

This delivery supplies the shared ownership prerequisite. AI-008 multi-file edits and AI-009 resumable workflows remain planned; neither is implemented by this candidate. See the [roadmap](ai-workflow-improvements.md), [CLI contract](workbridge-cli.md), and [shared-service reference](shared-service-cli.md).

## Source preservation

Implementation uses the attached `codex/ai-workflows` worktree, initialized from the existing main checkout including its uncommitted work. Before changes, all 115 nonignored source files were copied and hashed, and the main Git index hash was recorded. No staging, reset, or commit was performed. No RRE source or service configuration was changed.

Local evidence is retained in the candidate's `.local/wb006-service-cli-20261020-01/`, including `baseline.json` and `source-before/`. Generated runtime and release artifacts are separate from the running installation.

Source integration copies only the 21 reviewed changed/new files into `C:\work\workbridge-mcp`, after checking all 115 original source hashes and the Git index again. The integration receipt records each copied hash, the 100 untouched original files, and index preservation. It does not install `dist`, dependencies, or runtime configuration.

## Verification

- Baseline: 108 tests passed before implementation.
- Full candidate: 123 tests passed through the live Workbridge command runner as `wb006-shared-service-suite-20261020-03`, exit 0, with no captured-output truncation.
- The 15 new integration/lifecycle cases cover shared catalog and metadata, bidirectional edits and undo, replay, concurrent stale-hash conflicts, cross-invocation jobs, client deadlines, owner exclusion, HTTP authentication and bounds, DPAPI and ACLs, restart/crash recovery, guardian failure during startup, and ownership retained during shutdown.
- Startup checks and all 21 updater cases passed during development. Formatting, self-contained acceptance, and the 35-tool release probe passed.
- Independent security and lifecycle review found no remaining actionable concerns after the fixes below.

After the runtime-helper packaging adjustment, all seven release checks passed from a clean copied payload and pinned dependency installation: install, 123 tests, startup, 21 updater cases, formatting, self-contained acceptance, and the 35-tool release probe. This ran through Workbridge as `wb006-seal-release-20261020-01`, exit 0.

A separate production-dependency fixture passed all 13 shared-service CLI integration cases using only the compiled runtime, the CLI/test harness, and `npm ci --omit=dev --ignore-scripts --offline`. The fixture contained no source descriptor helper or TypeScript installation. Its `dist` helper matched the source SHA256. Logs are `runtime-only-install.log` and `runtime-only-tests.log` in the evidence directory.

## Sealed release

Release ID: `wb006-20261020-review01`  
Path: `C:\Users\mrkoo\.codex\worktrees\workbridge-ai-workflows\workbridge-mcp\.local\releases\wb006-20261020-review01`  
Manifest SHA256: `F372FC17D205BE3D36E0137E4085AFCDCFD02F1865735CCDE99858DC1807F47D`

`validated.json` records all seven checks as exit 0, version `0.7.0-dev`, 35 tools, and `hostedVerified: false`. The immutable payload retains documentation captured before sealing; source documentation was subsequently updated with this result. Runtime, dependency, script, and test bytes were not changed after the release copy.

## Issues found and corrected

1. The strict `workspace_info` output schema initially omitted the new public `localCli` metadata. It now declares the enabled/disabled shapes; stdio/CLI metadata parity is tested.
2. Guardian loss during descriptor protection could race endpoint publication. Startup cancellation, publication checks, and instance-specific descriptor cleanup now reject that race.
3. Cleanup could wait forever for a guardian `close` event that had already fired after termination. The close promise is now captured at spawn and reused; deterministic lifecycle tests cover it.
4. The helper initially lived outside the updater's runtime roots. Build now copies it to `dist`, and the runtime resolves that packaged copy. The native-build fixture includes the new required source asset.

## Deployment boundary

No service was stopped, restarted, or deployed during this original candidate phase; the live release then remained 0.6.3-dev. Local stdio/HTTP parity and executing tests through Workbridge did not establish fresh browser Chat acceptance. The later 0.8.0-dev installation and hosted tool results are recorded separately in [WB-007 deployment acceptance](wb007-deployment.md).

After an authorized WB-001 installation, verify the intended version from normal browser Chat mode, compare owner metadata with the connected CLI, and exercise disposable read/edit/status/undo and job launch/output flows across both clients. Keep local release verification and fresh hosted acceptance as separate evidence.
