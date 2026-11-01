# Copy this identical Workbridge 12-agent prompt into both ChatGPT conversations

Run ID: `wb12_edge_20261101_pilot2` (same exact ID in both chats; change it in both copies for a future rerun).

**Use the entire block below unchanged in each chat.** Whichever conversation completes the first atomic role claim becomes A; the other becomes B. Workbridge's existing command occupancy is **not** the role signal. Joey does not need to paste the prompts simultaneously.

## Short bootstrap message (the only text Joey needs to paste)

> Using Workbridge, read the **entire** `workbridge-mcp/docs/workbridge-two-chat-copy-paste-prompt.md` (continue with a cursor if necessary). Then **execute**, not merely summarize, its section **Identical copy-and-paste prompt** for run ID `wb12_edge_20261101_pilot2`. This exact same message is being pasted into two separate ChatGPT conversations. Elect A/B through the helper's atomic claim, wait for the second coordinator, launch the six child workers belonging to your role, and return real Workbridge receipts. Follow the documented safeguards; do not require simultaneous pasting.

## Identical copy-and-paste prompt

> You are one of two independent ChatGPT coordinators in a live Workbridge-MCP twelve-reasoning-agent test.
>
> **Shared run ID:** `wb12_edge_20261101_pilot2`
>
> **Goal:** Elect exactly one Coordinator A and one Coordinator B through the already-installed local `scripts/dual-chat-rendezvous.mjs` helper. After both coordinators have arrived, use six **real, separate ChatGPT reasoning child agents per conversation**. Each child must call Workbridge itself to run one distinct, bounded synthetic command. Prove all twelve command jobs share a measurable active interval; collect each independent AI worker's Workbridge receipt. Do not confuse command-job concurrency with measured simultaneous model-token generation.
>
> **0. Preflight.** Use Workbridge `workspace_info`, `diagnostics`, and a bounded read of `workbridge-mcp/scripts/dual-chat-rendezvous.mjs`. Confirm the file is present, local instance/tunnel healthy, job inventory complete and not closing, and no **unrelated** in-progress or retained command jobs. The other coordinator's same-run `join` or `wait` command (request ID beginning `wb12_edge_20261101_pilot2-join-` or `wb12_edge_20261101_pilot2-wait-`) is expected and is not a reason to abort; any unrelated job is a stop condition. Never stop or replay another project's jobs. Do not edit source, deploy Workbridge, reset coordination assignments, or use browser automation.
>
> **1. Atomic role selection.** Make a _fresh, unique_ Workbridge `requestId` for this conversation with prefix `wb12_edge_20261101_pilot2-join-` followed by a generated UUID. Never copy a fixed request ID from this prompt, and reuse your original ID if the response becomes uncertain. Call:
>
> `terminal_run({cwd:"workbridge-mcp", executable:"node", args:["scripts/dual-chat-rendezvous.mjs","join","wb12_edge_20261101_pilot2"], timeoutSeconds:30, requestId:YOUR_UNIQUE_JOIN_ID})`
>
> Poll `command_output` for its original job ID until terminal status. Parse the JSON stdout, and retain your unique `participantId` and returned `role` (**A or B**). Do not self-assign a role from chat order, occupied slots, or guesses. If two coordinators already claimed this run, stop with an explicit error.
>
> **2. Delay-tolerant peer rendezvous.** With another unique, stable Workbridge request ID beginning `wb12_edge_20261101_pilot2-wait-` and ending in your role/UUID (so the other chat can recognize this as a same-run wait job), call:
>
> `terminal_run({cwd:"workbridge-mcp", executable:"node", args:["scripts/dual-chat-rendezvous.mjs","wait","wb12_edge_20261101_pilot2",PARTICIPANT_ID], timeoutSeconds:300, requestId:YOUR_UNIQUE_WAIT_ID})`
>
> Poll the **same job** until it succeeds with `peer-ready`. Coordinator A may wait for up to **four minutes** while Joey copies the prompt into the second chat. That wait is intentional. **Do not launch any of the six child agents until the peer rendezvous succeeds.** If it times out, abort, report the run ID, and request a _new shared run ID_ for a future try. Never take over stale claims or retry uncertain jobs under new IDs.
>
> **3. Six independent reasoning workers.** If your role is A, start six independent ChatGPT child agents A1–A6. If B, start six agents B7–B12. Launch the six child sessions promptly and in parallel, not serial waves. If ChatGPT refuses six independent child sessions, report the actual capacity and stop; do not impersonate the missing agents with one model or one coordinator. Give each child the same run ID, your returned `participantId`, your role, and its unique lane number.
>
> Each child must personally call Workbridge `terminal_run` exactly once for its own synthetic lane, using its **own** stable request ID `wb12_edge_20261101_pilot2-LANE` (for example, `...-A1` or `...-B7`):
>
> `terminal_run({cwd:"workbridge-mcp", executable:"node", args:["scripts/dual-chat-rendezvous.mjs","lane","wb12_edge_20261101_pilot2",PARTICIPANT_ID,ROLE,LANE_NUMBER], timeoutSeconds:210, requestId:LANE_SPECIFIC_ID})`
>
> Each child must poll its original Workbridge command to final status, record its distinct AI-worker identity, lane/job ID, UTC process start/end, PID, exit code, and one independent reasoned finding about Workbridge capacity or test reliability. The synthetic script waits up to **140 seconds** for all twelve lane registrations, then automatically releases a common barrier and holds the twelve local processes for **30 seconds**; no manual simultaneous start is needed. Failed/missing workers must time out rather than being silently replaced.
>
> **4. Monitor without adding terminal jobs.** As coordinator, call Workbridge read-only `diagnostics` and `agent_status({project:"workbridge-mcp"})` during the run, including a snapshot while the twelve jobs are running if possible. The capacity target is `occupied=12`, `available=0`, `runningJobs=12`, with twelve matching unique IDs. Read-only Workbridge MCP calls should remain responsive under saturation. Do not submit a thirteenth terminal command while the pool is full. Coordination metadata may remain at zero and must not be presented as the number of ChatGPT reasoning sessions.
>
> **5. Settle and report.** Wait for the six child agents to finish, verify all their Workbridge jobs exited cleanly, and check post-test diagnostics for 12/12 free slots, zero retained results, a ready tunnel, and the same service instance. After the pool is free, you may read the retained test state with:
>
> `terminal_run({cwd:"workbridge-mcp", executable:"node", args:["scripts/dual-chat-rendezvous.mjs","status","wb12_edge_20261101_pilot2"], timeoutSeconds:30, requestId:YOUR_UNIQUE_STATUS_ID})`
>
> Report your six worker receipts, any failures/rate limits, observed real-time overlap, and what remains unproven. Do **not** delete the ignored test receipts, modify the repository, restart services, or claim twelve simultaneous model inference without direct evidence. Coordinator B should return a copyable report for Joey to paste into A; Coordinator A will reconcile the twelve records, compute the process-window intersection, and produce the consolidated verdict.

## What the helper actually guarantees

- **Atomic election:** the first successful filesystem role-directory claim becomes A; the next becomes B. The helper doesn't use Workbridge's unrelated assignments or occupancy as a proxy.
- **Human-delay tolerance:** A's bounded `wait` command blocks only until B arrives (at most four minutes); neither launches workers early.
- **Worker barrier:** each independent ChatGPT worker has to start its own Workbridge command job. Each job waits for twelve lane registrations before beginning the shared thirty-second test period. Each job exits after the bounded test or timeout.
- **Evidence:** a coordinator can inspect full-pool diagnostics; the helper retains per-lane process start/end receipts in ignored `.tools/dual-chat-runs/<run-id>/`. These are local test artifacts, not deployed Workbridge changes.
- **Limits:** a full pool of twelve child-owned command jobs plus twelve independent worker transcripts demonstrates agent-originated concurrency and command capacity, but not necessarily that twelve models were generating tokens at exactly the same instant. A missing child, ChatGPT account-wide limit, approval denial, or foreign job collision must be reported as a failed/inconclusive run.

The helper is intentionally local, reversible and independent of the live Workbridge service's own `.local` updater/owner state. The existing unrelated dirty Git worktree is not touched by the test itself.
