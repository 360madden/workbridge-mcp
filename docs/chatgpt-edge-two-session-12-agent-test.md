# Microsoft Edge two-chat, twelve-reasoning-agent experiment

Status: **proposed; not yet verified**. Recorded 2026-11-01. Project: `C:\work\workbridge-mcp`.

## Purpose and terminology

Test whether two separately opened ChatGPT conversations in Microsoft Edge can each coordinate six independent AI reasoning workers (A1-A6 and B7-B12) against the same Workbridge connector, yielding **twelve genuinely simultaneous reasoning agents**. This is a test hypothesis, **not** a currently proven feature or a guarantee that an additional Edge tab increases the account's concurrency quota.

These are different resources:

- **Edge tabs and ChatGPT conversations:** user-visible browser surfaces; a second tab/conversation does not itself create six workers or an independent capacity allocation.
- **ChatGPT reasoning workers:** independent active AI inference sessions. The currently observed primary conversation exposes six child-worker slots plus the lead.
- **Workbridge coordination assignments:** twelve server-side worker records for tracking jobs/file ownership; creating an assignment does not create a reasoning session.
- **Workbridge command jobs:** twelve bounded local process slots; they can run simultaneously without proving that twelve AI models are thinking simultaneously.

The operational gate is twelve individually identifiable, _overlapping_ AI reasoning sessions with direct, read-only Workbridge responses—not twelve tabs, assignments, terminal processes, or workers run in serial waves.

## Evidence available on 2026-11-01

| Observation                                                              | Result                                                                                                                                  | What it establishes                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ChatGPT primary coordinator plus six independently spawned child workers | Six children each made a live, read-only Workbridge call; a fresh six-worker attempt did not establish twelve-simultaneous AI inference | Independent worker-to-Workbridge access; present per-conversation limit in this environment   |
| Two waves of six independent reasoning agents                            | Twelve distinct AI agents produced Workbridge-backed results, in separate waves                                                         | Twelve total agents **over time**, not twelve concurrent                                      |
| Workbridge twelve-command stress                                         | All twelve separate terminal jobs were running together, with 7.055 seconds of shared overlap; all finished successfully                | Twelve concurrent local command slots; **not** model inference                                |
| Workbridge coordination API                                              | Twelve assignment slots and the refreshed 64-tool ChatGPT catalog, including eight `agent_*` tools                                      | Server coordination metadata and tool discovery, **not** reasoning workers                    |
| Connected Microsoft Edge browser-control extension                       | Browser surface was connected; the control API advertised `browser.tabs.new()` and `tab.goto()`                                         | Automation _capabilities exposed_, not a successfully opened second ChatGPT session           |
| Automated navigation to `https://chatgpt.com/`                           | **Rejected by the browser-control host's network-egress/security policy**                                                               | The assistant did **not** open or verify a second ChatGPT tab/conversation through automation |

**Important disclosure:** The automated navigation failure was an explicit browser automation permission boundary. It was **not** a ChatGPT account login failure, an Edge application outage, or evidence that Joey cannot open ChatGPT manually. The attempt never verified a persistent second ChatGPT session. It should have been surfaced to Joey clearly when it happened.

Do not circumvent that host-level rejection using a different browser automation adapter, cloud browser, raw CDP, redirected URL, or indirect navigation. Joey may manually open a second tab, but that action alone does not confer browser-agent authority to inspect or operate it. An independently supported and properly authorized top-level conversation creation facility could be considered if actually offered; none has been verified in this session.

## Follow-up: user-opened second tab (2026-11-01)

- Joey manually opened a new Edge tab at `https://chatgpt.com/`. The browser extension's read-only tab inventory confirmed the new entry (title `ChatGPT`) alongside the existing Workbridge project conversation. **Manual tab opening succeeded.**
- A subsequent attempt to claim/inspect that specific newly opened tab was **rejected by the browser host security policy**, which denied authority to observe content at `https://chatgpt.com/`. It was not possible to verify that tab's ChatGPT sign-in, plugin selection, independent conversation state, or ability to spawn reasoning workers.
- Control of the **already-open Workbridge project conversation** had separately been verified; that success does not imply authority for the newly opened root tab. Do not retry the denied inspection through another automation adapter or indirect mechanism.
- The remaining supported path is Joey manually pasting the Session B coordinator prompt below and reporting whether it can access Workbridge and initiate six workers. Session A can then start six workers as closely coordinated as practical. Without receipt/timing evidence from Session B, the twelve-way inference gate remains **unverified**.

## Manual pilot in Microsoft Edge

1. Joey opens a **new ChatGPT conversation manually** in Microsoft Edge, alongside the existing Workbridge conversation. Confirm both conversations can independently see Workbridge in their tools; a new conversation may need to select the connector. Do not assume the refreshed catalog or permissions propagate automatically.
2. **Session A** is the existing primary coordinator. It assigns independent, read-only reasoning tasks to six AI child workers, identified A1-A6. **Session B** is the manually opened second coordinator. It attempts to assign six separate child workers, B7-B12. If Session B cannot obtain six slots, stop and record the actual limit.
3. Ask each worker to make **its own direct Workbridge read-only call** (`workspace_info`, bounded file read, or diagnostics), return the task and tool outcome, and record whatever reliable UTC start/end or request identifiers the tool/runtime actually exposes. Do not claim a model-generated clock estimate is measured telemetry.
4. Stage both sets to the extent the ChatGPT runtime supports it. Initiate the runs as close together as possible using a coordinated START message or agreed UTC start window. A waiting worker may time out; do not describe a planned start as proof of overlap.
5. Collect both coordinator transcripts and Workbridge read-only call receipts. Correlate per-worker identity, conversation, actual start/end intervals, tool result, and error/rate-limit signals. Distinguish _tool-call overlap_ from separately evidenced _reasoning/inference overlap_. If inference timing is unavailable, report the gate as **inconclusive**, not passed.
6. Stop at normal completion. Keep this test read-only: no repository edits, external writes, service restart, terminal-slot saturation, or modification of RiftReader2 jobs. Do not deploy the updater-quiescence candidate as part of this experiment.

### Paste into Session B

> You are coordinator B in a proposed twelve-agent Workbridge concurrency experiment. In this new ChatGPT conversation, attempt to start six **independent AI reasoning child workers**, labeled B7 through B12. The other conversation coordinates A1 through A6. Each worker must make its **own direct, read-only** Workbridge call, report its tool result and any _reliable_ UTC timing/receipt identifiers available, and perform a distinct bounded reasoning review. Coordinate a START window with Joey and Session A if the runtime permits. Do not edit files, run terminal commands, restart services, or declare twelve-way concurrency without actual overlapping evidence. If any capacity, account quota, tool permission, or synchronization limitation appears, report it precisely instead of serially substituting workers.

### Paste into Session A at test time

> Prepare six independent reasoning workers A1-A6 for the read-only Workbridge concurrency experiment. Joey will separately initiate B7-B12 in a second Edge ChatGPT conversation. Use real independent worker sessions and direct read-only Workbridge calls. Correlate identity, observed times and tool results; report any unsupported concurrency separately. No file edits, command jobs, service changes, or unsupported claims of model overlap.

## First 6+6 pilot: Session A results (2026-11-01 UTC)

Joey manually submitted the coordinator B prompt in the separate Edge ChatGPT tab. The main coordinator cannot inspect the B tab through the blocked browser-control surface, so **B worker identities, responses and timings were not yet independently received** at this checkpoint.

Six existing independent ChatGPT child reasoning sessions A1-A6 were reactivated concurrently in Session A. One coordinator status snapshot reported all six as `running`; this snapshot was not independently wall-clock stamped and does not by itself measure inference concurrency. Each worker directly called read-only Workbridge tools and returned success receipts:

| Worker | First successful tool call began (UTC) | Last successful tool call ended (UTC) | Distinct reasoning topic              |
| ------ | -------------------------------------- | ------------------------------------- | ------------------------------------- |
| A1     | 07:52:52.760                           | 07:53:04.975                          | Service/tunnel readiness              |
| A2     | 07:52:58.629                           | 07:53:12.562                          | Coordination slots versus AI sessions |
| A3     | 07:52:56.728                           | 07:53:08.942                          | Twelve-command stress evidence        |
| A4     | 07:52:59.020                           | 07:53:17.262                          | Git provenance and dirty-tree safety  |
| A5     | 07:53:04.381                           | 07:53:11.043                          | Release admission race and quiescence |
| A6     | 07:53:04.857                           | 07:53:14.684                          | Edge browser authority boundary       |

The columns are **enclosing observed tool-call timestamps**, not measured start/end times of model inference. All workers made at least two direct successful Workbridge read-only calls. The common service remained `0.16.4-dev`, instance `6b9008e9-990b-4078-a6fd-6fc0214b24bd`. Workers did not launch command jobs, modify files/assignments or deploy. A2 observed Workbridge assignment `running=0` while actively reasoning, directly showing that its metadata is not a live model-agent count.

**Checkpoint:** Session A six-worker participation **passed**. Session B six-worker evidence **pending**. Twelve-way simultaneous AI inference **not yet verified**, regardless of reported A-side activity or tool-call overlaps. On receipt of B7-B12 evidence, calculate per-session identity and actual timing overlap, and do not call an inference overlap proven by tool timestamps alone.

## Session B report and twelve-worker comparison (2026-11-01 UTC)

Joey subsequently pasted a full Coordinator B report from the separately opened ChatGPT conversation. This is **user-supplied second-conversation evidence**, not an independently inspected B tab: the browser host continued to deny control of that tab. B reported six independent reasoning workers B7-B12, **34/34 successful direct read-only Workbridge calls**, six distinct bounded reviews, no terminal jobs/writes/deployments, and live service instance `6b9008e9-990b-4078-a6fd-6fc0214b24bd`.

| B worker | Read-only call family | Successes | First observed (UTC) | Last observed (UTC) |
| -------- | --------------------- | --------: | -------------------- | ------------------- |
| B7       | `workspace_info`      |       6/6 | 07:53:30.342         | 07:55:59.403        |
| B8       | `diagnostics`         |       5/5 | 07:53:37.961         | 07:55:40.815        |
| B9       | `discover_projects`   |       6/6 | 07:53:42.671         | 07:56:21.449        |
| B10      | `command_list`        |       6/6 | 07:53:50.083         | 07:56:20.819        |
| B11      | `agent_list`          |       6/6 | 07:53:54.176         | 07:56:12.414        |
| B12      | `commands_list`       |       5/5 | 07:54:02.791         | 07:56:28.127        |

From the enclosing first/last-successful-tool-call intervals (not measured inference lifetimes):

- A-side six-way common observation window: **07:53:04.857–07:53:04.975Z**, **0.118 seconds**. This is only intersection of _envelopes_; it does not establish six simultaneously outstanding requests.
- B-side six-way common observation window: **07:54:02.791–07:55:40.815Z**, **98.024 seconds**. B separately reported three outstanding MCP requests overlapping for **2.274 seconds**, not six concurrent backend executions.
- All-twelve common interval: latest start **07:54:02.791Z** (B12), earliest end **07:53:04.975Z** (A1); **no intersection, 0 seconds**. Raw end-minus-start is **-57.816 seconds**.
- Even the _last_ recorded A activity (A4 ended **07:53:17.262Z**) preceded the _first_ recorded B activity (B7 started **07:53:30.342Z**) by **13.080 seconds**.

**Verdict:** Each conversation separately demonstrated six active reasoning workers with live Workbridge calls, per the available A receipts and user-supplied B report. The recorded activity spans **do not overlap across conversations**. Therefore the operational gate for twelve simultaneous reasoning agents **remains open**; neither independent model-token-generation overlap nor even cross-conversation tool-window overlap was measured. A second, deliberately synchronized 6+6 run is required.

Separately, the coordinator later stress-tested **all twelve Workbridge command slots**, with 15.552 seconds of actual twelve-process overlap and clean recovery, as recorded in [the mixed-load saturation report](workbridge-mixed-saturation-20261101.md). That command-pool test began **after** B's last recorded tool call, and those jobs were not dispatched by twelve independent reasoning workers; it cannot close the AI concurrency gate.

## Acceptance / falsification criteria

**Pass:** Twelve distinct reasoning-worker sessions from the two conversations demonstrably run over an overlapping real-time window, each gives a traceable direct Workbridge response, and both coordinators record the evidence. Record what measures inference overlap separately from Workbridge tool overlap.

**Not passed:** Only one chat gets six worker slots; two conversations exist but share an account-wide six-worker quota; the second chat lacks the Workbridge connector; workers run in sequential waves; only twelve command jobs or assignment records overlap; or available timings cannot establish simultaneous inference.

**Open question:** Is ChatGPT child-agent concurrency enforced independently per conversation, or across this account/runtime? Only an authorized two-conversation experiment or official product evidence can answer it. As of this document, the twelve-simultaneous-reasoning-agent milestone remains **open**.

Related: [twelve-agent roadmap](workbridge-12-agent-roadmap-20261031.md), [chat-mode Workbridge workflow](chatgpt-local-workflow.md), and [approval visibility](chatgpt-approval-visibility.md).
