# Live Workbridge twelve-slot mixed-load saturation (2026-11-01)

Project: `C:\work\workbridge-mcp`. Version: `0.16.4-dev`. Live instance: `6b9008e9-990b-4078-a6fd-6fc0214b24bd`.

## Question and scope

Can Workbridge remain responsive and recover cleanly while **all twelve global command-job slots are genuinely occupied**, with read-only control calls arriving during the load? This is a host command-capacity test, **not** proof that twelve separate ChatGPT models/agents are executing concurrently. It follows the separate six-agent Session A read-only test recorded in [the dual-chat experiment](chatgpt-edge-two-session-12-agent-test.md).

No code edits, file writes by workers, deployment, service restart, GUI actions, or RiftReader2 recovery were performed.

## Preflight and launch

At `2026-11-01T07:56:50.702Z`, live diagnostics reported **12 available / 0 occupied**, `inProgress=0`, `retainedResults=0`, `closing=false`, ready tunnel, healthy control plane, and complete job inventory.

The coordinator submitted twelve independent `terminal_run` requests with unique durable IDs `wb-mixed-saturation-20261101-02-lane-01` through `lane-12`, all in `workbridge-mcp`. Each used the existing Windows Node executable and a bounded no-op timer of approximately 35 seconds, printing its lane/PID/UTC start and end. No external files or services were touched.

## Independent process receipts

All timestamps are UTC on 2026-11-01, from each distinct process's own stdout. All twelve final Workbridge job statuses were `passed` with exit code **0**.

| Lane |   PID | Process start | Process end  | Exit |
| ---- | ----: | ------------- | ------------ | ---: |
| 01   |  6212 | 07:57:03.782  | 07:57:38.797 |    0 |
| 02   | 53900 | 07:57:05.799  | 07:57:40.810 |    0 |
| 03   | 66036 | 07:57:06.961  | 07:57:41.972 |    0 |
| 04   | 51676 | 07:57:08.124  | 07:57:43.131 |    0 |
| 05   | 57548 | 07:57:10.484  | 07:57:45.501 |    0 |
| 06   | 34480 | 07:57:11.507  | 07:57:46.519 |    0 |
| 07   | 45168 | 07:57:15.258  | 07:57:50.275 |    0 |
| 08   | 32964 | 07:57:17.726  | 07:57:52.738 |    0 |
| 09   | 59024 | 07:57:19.260  | 07:57:54.272 |    0 |
| 10   | 65716 | 07:57:20.242  | 07:57:55.261 |    0 |
| 11   | 62524 | 07:57:22.153  | 07:57:57.171 |    0 |
| 12   | 62948 | 07:57:23.245  | 07:57:58.253 |    0 |

The latest process start was lane 12 at **07:57:23.245Z**; the earliest process end was lane 01 at **07:57:38.797Z**. Thus the **minimum all-twelve process overlap was 15.552 seconds**.

## Full-pool observation and concurrent control-plane reads

During this overlap, an independent `diagnostics` call returned:

- `limit=12`, **`occupied=12`**, **`available=0`**, `inProgress=12`, `retainedResults=0`, `closing=false`.
- Exactly twelve enumerated `running` command jobs matching these unique IDs, with `command_status` as their next action.
- `runningJobs=12`; complete inventory, no error.
- The **same service instance** and a healthy, ready tunnel/control plane.

At the same time, direct read-only `workspace_info` and `agent_status(project:"workbridge-mcp")` calls succeeded. Assignment metadata still showed `maxWorkers=12`, `available=12`, `running=0`, `revision=0`. That is expected: independent command jobs do **not** automatically allocate agent metadata or create AI reasoning sessions.

A separate **13th `terminal_run` probe** was submitted during this full-pool window with ID `wb-mixed-saturation-20261101-02-lane-13-probe`. Its tool response was `INVALID_ARGUMENT`, **not** the documented `JOB_LIMIT`, and no successful job receipt was obtained. This does _not_ establish correct live at-capacity rejection; diagnose the precise argument/tool-layer failure before claiming that gate.

## Settlement and verdict

At `2026-11-01T07:58:14.938Z`, independent post-test diagnostics showed:

- **12/12 command slots available again**, `occupied=0`, `inProgress=0`, `retainedResults=0`, `runningJobs=0`, `closing=false`.
- Same healthy instance, tunnel ready, control plane OK, and complete job inventory.
- Coordination assignments still `running=0`, `available=12`.

**Passed:** full twelve-slot occupancy, **15.552 seconds** of measured all-lane overlap, 12/12 clean process completions, control-plane responsiveness during saturation, and clean recovery without restart.

**Not yet passed:** unambiguous live thirteenth-command `JOB_LIMIT` rejection, or twelve separately reasoning ChatGPT agents each dispatching its own Workbridge job. The latter still needs the two-conversation B7-B12 worker receipts and a new coordinated _agent-owned_ six-plus-six run.
