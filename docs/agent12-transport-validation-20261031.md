# Workbridge-MCP — 12-worker coordination and MCP transport verification (2026-10-31)

Repository: C:\work\workbridge-mcp. Live version: 0.16.4-dev.

## Observed baseline and bug

- The earlier capacity deployment increased command jobs from 6 to 12.
- The next coordination deployment exposed eight agent-management MCP tools and set coordinated-worker metadata capacity to 12 per Git repository. It does not spawn AI reasoning agents.
- A live concurrency test launched 12 independent connected CLI processes calling read-only agent_list. Initial runs returned 10/12, 10/12 and 9/12 successes. Failed connections reported MCP_ERROR / fetch failed; an instrumented read-only probe identified ECONNRESET.
- The prior local HTTP server used server.maxConnections = 32. Each CLI client can establish multiple HTTP connections during readiness, MCP initialization, and a tool invocation; 32 was insufficient for the tested burst.

## Correction

- src/local-service.ts: bounded HTTP connection limit is now MAX_LOCAL_MCP_CONNECTIONS = Math.max(64, (MAX_CONCURRENT_JOBS + 1) * 4), with MAX_CONCURRENT_JOBS = 12, yielding 64 connections.
- This is an HTTP socket allowance, not permission to run 64 commands, spawn models, bypass authorization, or change workspace permissions.
- test/local-service-concurrency.test.mjs: two waves of 12 independent CLI clients against a disposable authenticated local MCP service, with ordinary ping tool calls and bounded fixture cleanup.

## Verification

1. TypeScript no-emit compile and Prettier checks passed.
2. An isolated build passed the new concurrency regression: 24/24 independent CLI tool invocations over two waves (test exit 0).
3. The guarded WB-001 release builder passed all eight gates: install, tests, startup, updater, format, generic, desktop-stage, acceptance. Validated release: .local\releases\agent12-sockets-20261031-01.
4. The guarded updater operation agent12-sockets-activate-20261031-01 completed with no controller, journal or recovery errors. The previous release remains recorded for recovery.
5. A fresh runtime reported version 0.16.4-dev, command limit 12, coordinated-workers limit 12, and healthy MCP tunnel. Observed new instance ID: 595ecff2-578d-4767-9aaa-ed5da32b23f8.
6. Live post-update stress: three consecutive waves of 13 independent MCP clients (12 worker-style clients plus one coordinator-style client) each invoked agent_list. Results: 13/13, 13/13, 13/13 = 39/39 successes, zero observed connection resets.
7. The two unrelated RiftReader2 health-check jobs that appeared during the updater preflight both completed successfully (exit 0) before the owner switched.

## Source-control boundary and remaining work

- An earlier exact-file commit d3c3fe3 recorded the 12-worker coordination contract in docs/agent-coordination.md.
- The main Git working tree has extensive older modified/untracked work, including shared code files on which the new runtime depends. Do not bulk-commit, reset, stash, or stage unrelated files. Selective complete-file commits of the shared code could misattribute pre-existing user work; reconcile those older changes in a separate reviewed baseline checkpoint.
- The 64-tool MCP server lists eight agent_* coordination tools via its connected CLI. This ChatGPT conversation's connector tool list was not refreshed to show those eight names, so direct tool exposure through ChatGPT still needs independent verification.
- Workbridge coordinated-worker metadata capacity and simultaneous MCP client connections are now verified separately. Twelve independently reasoning AI agents remain untested. That requires an AI runtime capable of spawning independent model workers, with traceable tool calls and provider-side concurrency evidence.
- No off-machine Git push was performed.
