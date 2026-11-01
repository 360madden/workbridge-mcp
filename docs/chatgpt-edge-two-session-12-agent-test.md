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

Do not circumvent that host-level rejection using a different browser automation adapter, cloud browser, raw CDP, redirected URL, or indirect navigation. A manually opened tab controlled by Joey is a distinct, allowed next step. An independently supported and properly authorized top-level conversation creation facility could be considered if actually offered; none has been verified in this session.

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

## Acceptance / falsification criteria

**Pass:** Twelve distinct reasoning-worker sessions from the two conversations demonstrably run over an overlapping real-time window, each gives a traceable direct Workbridge response, and both coordinators record the evidence. Record what measures inference overlap separately from Workbridge tool overlap.

**Not passed:** Only one chat gets six worker slots; two conversations exist but share an account-wide six-worker quota; the second chat lacks the Workbridge connector; workers run in sequential waves; only twelve command jobs or assignment records overlap; or available timings cannot establish simultaneous inference.

**Open question:** Is ChatGPT child-agent concurrency enforced independently per conversation, or across this account/runtime? Only an authorized two-conversation experiment or official product evidence can answer it. As of this document, the twelve-simultaneous-reasoning-agent milestone remains **open**.

Related: [twelve-agent roadmap](workbridge-12-agent-roadmap-20261031.md), [chat-mode Workbridge workflow](chatgpt-local-workflow.md), and [approval visibility](chatgpt-approval-visibility.md).
