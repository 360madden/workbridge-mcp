# Workbridge 36-slot capacity rollout — 2026-11-01

## Intent and scope

Joey requested a Workbridge increase from 12 to **36** global command jobs and coordinated-worker assignments. This expands **host command/process admission and repository assignment metadata**, not ChatGPT's internal reasoning-agent allocation. Six workers per ChatGPT conversation is a working experiment hypothesis, not a guaranteed provider quota.

## Source changes

- `src/jobs.ts`: `MAX_CONCURRENT_JOBS = 36`.
- `src/agent-coordination.ts`: `MAX_AGENT_WORKERS` already derives from `MAX_CONCURRENT_JOBS`, so no independent value was changed.
- `src/server.ts` and `src/schemas.ts`: exposed capacity and schemas already derive from that constant.
- `src/local-service.ts`: the connection budget already derives from capacity, yielding `MAX_LOCAL_MCP_CONNECTIONS = max(64, (36 + 1) * 4) = 148`; its comment was updated.
- `src/operational-alerts.ts`: removed a stale hardcoded twelve-slot assumption. The read-only classifier now validates an advertised per-snapshot capacity up to a bounded 1024 slots; this preserves compatibility with both 12-slot snapshots and the deployed 36-slot service.
- Focused tests updated for 36-worker coordination, capacity overflow, 36-concurrent-client transport, and backward-compatible alert classification. The standalone two-chat rendezvous helper is **not** part of this capacity update; its previously identified stale-registration issue remains open.

## Verified evidence

All times 2026-11-01 UTC; command identifiers identify the actual Workbridge jobs.

1. Source build `wb36-build-1793523768046-7yn4sr`: **passed**, exit 0. Subsequent source rebuild `wb36-build-1793524011953-2sqz3`: **passed**, exit 0.
2. Five focused suites `wb36-focused-1793523778417-916yfo`: **53/53 passed**, exit 0. Includes 36 coordinated workers with 37th assignment rejected, bounded command-job capacity and recovery, and 36 concurrent independent local MCP CLI clients.
3. Initial integration `wb36-integration-1793523942661-xbkxnz`: **14/15 passed**, exit 1. The 36-job test passed, but the alert classifier's first change attempted to import a compiled `.js` sibling directly from a TypeScript source test; Node reported `ERR_MODULE_NOT_FOUND`. This was diagnosed and corrected. Preserve the failed receipt; do not erase it.
4. Corrected `wb36-alerts-1793524011953-hqxlm`: **17/17 passed**, exit 0, including an explicit 36-slot full-capacity snapshot and existing 12-slot cases.
5. Focused Prettier `wb36-format-1793524011953-8e8jp`: **passed**, exit 0, for all nine edited source/test files.
6. The `test/terminal.test.mjs` isolated MCP integration test admitted **36 simultaneously running child jobs**, rejected the 37th via `JOB_LIMIT`, then freed a slot and admitted a replacement. This is **not** a 36-worker ChatGPT inference test or a 36-job live-service stress test.

## Release and deployment evidence

Joey authorized an exclusive maintenance window for the first guarded WB-001 cutover on 2026-11-01. The original live instance `6b9008e9-990b-4078-a6fd-6fc0214b24bd` advertised 12 command-job slots and 12 coordinated-worker assignments. The 36-slot source was packaged into three distinct candidates, preserving failed releases and their test logs:

1. `cap36-quiescence-20261101-01` **failed** full tests before sealing: three stale capacity assertions (two test files), one coordination journal lock contention, and a 36-process publication test timeout. No deploy.
2. `cap36-quiescence-20261101-02` **failed** one test: the capacity race fixture concurrently created 37 assignments and exhausted the legitimate exclusive coordination lock before reaching the dispatch check. No deploy.
3. `cap36-quiescence-20261101-03` **passed** and was sealed. Full suite **1,040 tests, 1,037 passed, 0 failed, 3 skipped**, including 36-process admission and 37th-job rejection. All nine WB-001 checks returned exit 0 (`install`, `tests`, `startup`, `updater`, `format`, `generic`, `desktop-stage`, `acceptance`, `desktop-closure`). Validated manifest SHA-256 `F04B372A9F47466997456105D6027FBF67B07FEE8B5C083B181380552E4E38FB`, compiled MCP version `0.16.4-dev`, 64 tools. Corrections were test-only: update expected limits, allow extra time for 36 test processes under suite load, retry transient dispatch-lock contention and set up queue sequentially before the parallel dispatch assertion.

After fresh diagnostics showed the old owner healthy, a complete inventory, zero occupied/retained slots and no closing state, WB-001 `Apply` was dispatched as **`cap36-activate-20261101-01`**. Its independently running scheduled controller completed at `2026-11-01T09:24:27.825Z` with `phase=completed`, `error=null`, `recoveryError=null`, and the same release digest. The controller stopped, installed, restarted and verified Workbridge. No forced stop or manual copy was used.

**Live upgraded and hosted verified:** the fresh ChatGPT Workbridge `workspace_info`, `diagnostics` and `agent_list` calls observed new instance `9aa9b65f-b34f-49a7-8b92-c7954bd4dc9a`, PID `43508`, local port `57318`, `commandJobs=36`, `coordinatedWorkers=36`, `maxWorkers=36`, `available=36` and `coordinatorSlots=1`. The tunnel was `available=true`, `ready=true`, control plane `ok`. Command inventory was complete with `occupied=0`, `retainedResults=0`, `closing=false`, and no registered assignments. The local updater journal retains `hostedVerified=false` by design; these hosted tool responses are the separate acceptance evidence.

## Git and safety boundaries

The existing dirty working tree contains numerous earlier user-owned edits, including files touched by this change. Keep those edits intact. Do not blanket-stage or claim a clean narrow source commit that would inadvertently include unrelated hunks.

An earlier WB-001 release collided with an unrelated RiftReader2 command admission. The first guarded rollout of the new admission-lock code was therefore conducted only after Joey approved an exclusive maintenance window, followed by a fresh complete idle diagnostic and the independent WB-001 updater. The now-running owner includes the updater/admission-lock synchronization; future deployments still require normal WB-001 guards. No client interruption was reported during this rollout.

## Remaining work

1. Reconcile the pre-existing shared-runtime dirty worktree without staging unrelated hunks, and make a coherent reviewable source commit for this change. The deployed sealed release is already retained independently; a Git commit is not yet complete.
2. In a separately coordinated load window, optionally test **live** 36-job occupancy, 37th-job `JOB_LIMIT` rejection while all 36 are confirmed active, read-only diagnostics under saturation, and clean recovery. Only the isolated compiled-runtime 36-job stress test has passed so far.
3. Test independent AI reasoning-worker sessions separately. Never equate command slots, browser tabs, coordination assignments and model inference; ChatGPT's six-worker-per-conversation observation is not a guaranteed provider limit.
4. Revisit the separate two-chat rendezvous helper's stale-registration issue and disposable browser-session helper design without broadening Workbridge core.
