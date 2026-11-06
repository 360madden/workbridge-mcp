# Cross-provider desktop outcome + latency reconciler — minimal design

Status: SOURCE/DESIGN ONLY, 2026-11-06. Workbridge remains the sole coordinator; Microsoft WinApp CLI 0.7.1 remains its existing read-only baseline. No production adapter, new MCP action tool, GUI, VMware, RIFT interaction, installation or benchmark was performed for this design. This is the narrow follow-on to prototypes/provider-interface-design.md, not a second general automation framework.

## Decision: add one pure outcome reducer, keep the already-proven components

An action is a small **before → durably intend → dispatch once → wait/observe → independently verify → settle/reconcile** transaction. The provider produces *delivery metadata*; Workbridge's separate observer produces *semantic state*. Distinguish an app effect from process/lease cleanup, and preserve both dimensions on an incomplete run. Start with the disposable DesktopProbe's existing native counter; do not generalize its exact-once proof to a real third-party app.

| Existing source / primary reference | Reuse as-is | Missing glue |
| --- | --- | --- |
| src/desktop-action-guard.ts, previewDesktopAction (lines 353–440) | Fresh native desktop observation, WinApp 0.7.1 read-only UIA tree, fresh native observation; strict target/geometry/foreground/unique selector; 2s freshness, 5s total preview | Do not call preview an execution permit; no generic provider ID substitution. Future normalizer is separate and version-pinned. |
| src/desktop-action-policy.ts, planDesktopProbeAction / verifyDesktopProbeActionAuthorization | Stable request hash, bound context/approval/lease, independent counter before action | Keep preview, authorization and execution distinct. Authorization must be checked again at dispatch time. |
| src/desktop-action-postcondition.ts, verifyDesktopProbeActionPostcondition (lines 190–333) | Synthetic exact-once counter interval, complete event ordering, unchanged target, host session, lease fence, wall and monotonic timestamps | This strict verifier is **offline** and not wired to the live action script. Keep unchanged; supply authenticated evidence rather than provider booleans. |
| scripts/desktop-probe-act.mjs, invokeProbeOnceOwned (lines 256–553) | Durable wx GUI turn, durable intent before WinApp call, request-ID replay check, 12×100ms independent native counter poll, uncertain-intent quarantine | Its successful receipt is not yet the complete strict postcondition contract; 1.2s poll is an observation budget, not proof of eventual non-effect. No settled-descendant guarantee from the wrapper. |
| src/desktop-registration.ts, withDesktopCaptureTurn / withDesktopCaptureTurnOwned | Shared admission + exclusive desktop-input turn, immutable stamp, surviving quarantine veto | Generalized input must join **both** shared gates, never create its own provider-specific lock. Owner start/session currently null in parts of the capture path; do not infer identity. |
| src/desktop-cli-runner.ts, createDesktopPrototypeInvoker | Sanitized allowlist, bounded output and 45s wrapper deadline; explicitly returns DESKTOP_TREE_UNSETTLED on forced kill | Use the separately tested child-only native Job supervisor before production action dispatch; direct Node kill is not descendant settlement. |
| Pinned Sbroenne v1.3.28 src/.../Automation/ElementIdGenerator.cs and Tools/UISnapshotTool.cs | Revalidation of original UIA element against window PID/start, provider PID/start, runtime ID; auto snapshot tokens and incomplete flag | An element ID, snapshot diff, CLI/MCP ACK, or job exit0 is not application result proof. maxDepth limits returned tree, not necessarily COM work. |
| eugman/FlaUI-MCP-Core upstream README, plus local candidates/eugman-flaui-mcp-core.md | ModalAwareInvoker/pending operation status design, owned-modal report, late-modal watch (~300ms after some actions), no-ref-reuse, read-only recovery tools | Upstream README is documentation, not a locally pinned/executed binary. A 30s tool timeout or a pending tracker is not a hard guarantee that COM call or delayed app effect stopped. Its own mutex is not Workbridge-wide arbitration. |
| investigations/.../prototypes/Sbroenne-Mcp-Provider-Host-V2.cs and benchmarks/sbroenne-mcp-v2-protocol-2026-11-05.md | Suspended child attached to child-only Windows Job; protocol-only execution showed owned Job active0 settlement | That test did no UIA tool call or app action. Do not promote a result on its protocol receipt alone. |

Upstream eugman source of behavioral claims: https://github.com/eugman/FlaUI-MCP-Core (README sections Modal dialogs, Timeouts, Batches, Fills, Snapshots). Its README says windows_operation_status can inspect an ongoing operation; pending inputs must not be replayed; provider-sensitive operations fail fast while one is unresolved; a returned Invoke/Toggle/Select/Expand watches another ~300ms for late modal; toggle/expand/collapse state readback can be unsettled. These are **candidate semantics**, not independently verified on Joey's host.

## Minimum internal contract: append events, reduce them, never trust provider ACK as outcome

Introduce only a pure research module (proposed name: prototypes/outcome-reconciler/model.mjs) with a no-I/O function reduceDesktopOutcome(intent, immutableEvents, clock). Production source remains unchanged. Future Workbridge integration may reuse the already-planned versioned provider contract, not build a second provider registry.

**Required durable binding (version outcome-trace/1):** requestId and canonical SHA-256 requestHash; allowlisted provider ID + pinned build hash; preserve the existing DesktopProbe policy requestHash byte-for-byte and bind provider digest separately in a versioned outer trace hash (never silently change the tested policy hash); seven-field exact DesktopActionTarget (PID/HWND/process/title/class/processStartedAt/session); action kind/selector/expected effect; Workbridge GUI admission and input-turn lease IDs, context revision/generation, host session and owner process lifetime; unique attempt number fixed to 1. One requestId cannot retarget to a new HWND/provider after it was intended.

**Each event:** sequence, source identity (Workbridge owner, native oracle, provider adapter, independent supervisor), source-specific monotonic clock domain and decimal tick/frequency, UTC for correlation only, phase, outcome-independent reason code, source-record SHA256/reference, and bounded metadata. Separate immutable intent record, provider dispatch receipt, native counter/modal events, before/after native target observations, lease/Job settlement, and final receipt. No raw UIA tree/text, terminal output, personal screenshot, clipboard or credentials in the public trace. Keep private images optional and individually SHA/size/dimension verified. Missing event = unknown, never a fabricated zero-duration phase.

**Internal orthogonal facts:**
- dispatch: not_started | entered_once | return_ack | ambiguous (a durable entered marker is written **before** attempting the vendor call);
- semanticProof: applied_once | terminal_no_effect | incomplete | contradictory;
- operationTracking: inactive | active_known | modal_known | lost_unknown;
- cleanup: not_started | owned_tree_settled_and_lease_released | quarantined | unknown.
The public state is derived from all four; do not collapse them into vendor's ok/failed flags. Evidence refs are bound to one request hash, provider hash, complete target identity, session, event interval, and lease generation.

| Public state | Strict acceptance / retry contract |
| --- | --- |
| blocked | Fresh fail-closed policy/identity/session/lease denial AND **provably no vendor call entered**. No replay; later action needs a new approved identity/request. If a crash obscures dispatch entry, use unknown_outcome. |
| pending | Exact durable request still bound to **independently verified** live worker PID+creation/session/Job, original target and GUI lease, and a finite monotonic deadline; a provider pending token or a Job-active count **alone** is insufficient. Native owner-modal HWND is corroborating evidence. No second input or lease release; monitor by read-only status/native oracle. If ownership cannot be proven, unknown_outcome. |
| verified_success | Independent application-specific proof of **exactly one** intended effect, complete before/after interval and target/fence binding, no possible delayed duplicate, plus settled owned worker and releasable lease. Replay returns the **stored receipt**, never the action. |
| verified_failure | Independent authoritative terminal **no-effect** proof, complete effect/event interval, no queued/late work and settled worker; a fixed poll expiring, unchanged screenshot, provider rejection after entered dispatch, or missing UIA control cannot establish this. New separately approved request only. |
| unknown_outcome | Dispatch could have happened, provider timed out/crashed, counter interval incomplete/duplicate, stale/mismatched target, untracked modal, lost worker, or Job/lease cleanup unproven. Never automatically retry; preserve intent/lock/quarantine and independently reconcile. |
 
When the native counter proves applied_once but the worker tree is unsettled, retain **semanticProof=applied_once** internally but publish overall unknown_outcome with cleanup=quarantined. This preserves real feedback without granting a new desktop turn. A pending operation becomes unknown_outcome when its owned deadline/identity expires without terminal proof; a timeout is not a verified failure. Provider-level cancellation is advisory and must not be described as undo.

## Smallest orchestration / modal-wait algorithm

1. **Before (read-only):** identify exact window PID+start/HWND/class/session/SID/WinSta0+Default/foreground/visible state, unique typed control, fresh owner/child HWND relationship; acquire the shared Workbridge admission and GUI input turn only for authorized input, then recheck all identity and approval fences. Resolve modal ownership by native Win32 HWND/owner chain, not just UIA textual title.
2. **Intent (durable):** save requestHash, expected native before state, provider digest, deadline, lease owner identity and bounded retry policy. If this persistence or readback fails, do not dispatch.
3. **Dispatch (once):** write entered_once marker ahead of sending a single reviewed command to an isolated child. Provider ack and WinApp/eugman/Sbroenne CLI return are *transport/delivery* metadata. Never allow a second call with the same request ID, even after connector timeout.
4. **Wait (asynchronous, non-input):** native observer watches original window and newly owned modal HWND; provider operation-status polls are additional information only and must be bound to an independently identified live child/request/deadline. The installed Workbridge WinApp adapter calls **no** ui wait-for operation; do not invent a WinApp modal wait engine. If a true tracked owned-modal appears while UIA Invoke remains blocked, state=pending, record owner/modal HWND and stable target lifetime; UIA provider reads may themselves hang, so use independent native observer and separately bounded worker. Do not press Enter/Escape/close modal automatically: these are new actions requiring their own approval/turn, and may mutate the original operation.
5. **After (independent):** collect full native oracle interval and second exact target/session/lease observation; invoke the unchanged strict DesktopProbe verifier for the synthetic counter case. For third-party apps provide a separately reviewed app-specific oracle; do not use the initiating provider's self-reported value or screenshot pixel difference as semantic success. Sbroenne auto-mode snapshot-diff and eugman partial snapshot may guide observations but cannot prove absence; source-specific observation timestamps and completeness flags remain visible.
6. **Recover/settle:** require owned private Windows Job process list stable-empty and known identities exited; verify the request's lease/recovery receipt. If effects may still arrive, enter quarantine; reconciliation is *read-only only* until an operator approves a distinct action. A lost stdio/daemon process or worker Job0 cannot retroactively disprove a completed target effect.

Eugman's ~300ms late-dialog check is helpful *diagnostic grace*, not Workbridge's general modal timeout. Model a late owner-modal at 350ms, a still-pending operation at 30s, a COM provider that returns after timeout, and a modal dismissed externally: none permits blind re-dispatch. A known provider pending token is not an independent app postcondition. No label-based fallback to a different dialog or changed HWND.

## Latency: show Joey the bottleneck separately from app confirmation

Phase intervals are **not generally disjoint or additive**: startup L2 and dispatch L3 can overlap if the entered marker precedes worker readiness; modal L4 and effect L5 share dispatch origin. Do not sum L0–L7 to obtain L8. Intervals include explicitly named setup but never equate provider return with verified action. On a single host process use performance.now()/Stopwatch monotonic time **with one origin**; record raw 64-bit ticks as decimal strings where needed. Across Workbridge process/vendor child, report per-process spans and parent measured round-trip; across VMware guest/host, never subtract uncalibrated clocks. UTC is for correlation, not latency arithmetic.

| Phase | Monotonic markers | What it measures / caution |
| --- | --- | --- |
| L0 admission | received → acquired GUI turn | Queue contention and fresh policy/target, separate human ChatGPT approval wait |
| L1 baseline | acquired → before oracle durably recorded | Native before-state + source hash/read; app/source readiness |
| L2 provider startup | intent durable → worker/transport ready | Cold/warm process, Job admission, MCP/CLI startup; separately identify reuse |
| L3 dispatch | entered_once → provider ACK/timeout | CLI invoke + COM/input delivery, **not app result**; timeout retains elapsed span with terminal=timeout and ackAt=null |
| L4 modal wait | dispatch entered → owner-modal shown/closed or deadline | Native modal onset, ownership and unresolved UIA; 300ms vendor grace is not this deadline |
| L5 effect convergence | dispatch entered → independently observed terminal app effect | App delay including asynchronous queue; compare after→verified separately |
| L6 proof | oracle observed → verifier receipt | Independent counter/event/session/fence verification and receipt/fsync |
| L7 cleanup | provider done/deadline → stable Job0 + lease settlement | Descendant/keyboard state and quarantine/recovery; no child==gone shortcut |
| L8 total | request admitted → durable terminal receipt | Verified technical completion when evidence complete; otherwise labelled pending/unknown |

Report sample count, median, p95 with n, cold/warm, provider SHA, trace completeness, native observer cost, modal/no-modal, timeouts/unknowns and target equality before comparing. Per-phase null ≠ 0ms. Missing terminal proof is a correctness failure even if API RTT is fast. For guest UIA, the existing benchmarks/guest-latency-proof-plan.md H0–H8 and G0–G11 clocks are the canonical extension; record uncertainty for cross-clock estimates. Never compare host WinApp taskbar to a Sbroenne disposable app and claim an optimization.

## Isolated pure synthetic harness proposal — **not implemented or executed**

Files proposed only under investigations/windows-desktop-automation/prototypes/outcome-reconciler/: model.mjs, model.test.mjs, fixtures/README.md. No imports of src desktop runners, Win32, COM, MCP or child_process; deterministic fake monotonic clock and immutable in-memory events; tests produce fixed aggregated counters, no user data. These cases test **outcome-reducer mappings**, not the already-covered native counter identities, postcondition verifier internals, or CLI byte/deadline controls in existing test/desktop-action-*.test.mjs and test/desktop-cli-runner.test.mjs. Node --test from an isolated review is a later separate milestone.

| Case | Synthetic input | Expected reduced state / immutable property |
| --- | --- | --- |
| O01 | Exact target, fresh before, no dispatch, denied admission | blocked; no call entered |
| O02 | One native increment, complete interval/lease, Job0 | verified_success; no second dispatch |
| O03 | Provider ok/ACK, no independent native event | pending if actively tracked within deadline, else unknown_outcome |
| O04 | Effect observed, provider hangs after app mutation, Job unsettled | unknown_outcome + semanticProof applied_once + quarantine |
| O05 | Hung before attempted call with *proven* never-entered worker | blocked; otherwise unknown_outcome |
| O06 | Owned modal 350ms after callback, then remains open | pending, same request, no replay |
| O07 | Vendor 30s timeout then modal closes/late effect | unknown until independent re-observation/reconciliation, never auto-reinvoke |
| O08 | Provider status says completed but owner-modal still present | pending/unknown, never verified_success by provider alone |
| O09 | Native owner/modal HWND mismatch, reused PID or changed start | blocked before dispatch, unknown after dispatch |
| O10 | Two counter increments or incomplete native event interval | unknown_outcome, not success |
| O11 | Authoritative terminal no-effect + no delayed work + Job0 | verified_failure |
| O12 | Unchanged screenshot, missing marker at 1.2s, no terminal oracle | unknown_outcome, not verified_failure |
| O13 | Sbroenne incomplete/auto-diff snapshot or eugman partial tree | never infer target/control absence |
| O14 | 6 agents contend for same GUI input lease | 1 owner max; others blocked/pending before dispatch |
| O15 | Provider worker process disappears but descendant proof missing | unknown_outcome, GUI turn retained |
| O16 | Same request ID replay after stored receipt or uncertain intent | same receipt / recovery-only, zero new dispatch |
| O17 | Out-of-order/cross-clock host/guest timestamps | reject invalid local order, preserve unknown cross-machine duration |
| O18 | Missing provider version, observer hash, raw private UI text, oversized trace | reject; no private raw output |

## Rollout and explicit stop gates

D0 (this document): review existing source; independent engineering peer reviews; no production behavior changes. D1: implement and test pure reducer with mock events and injected clock in investigation only, append evidence hashes; keep original DesktopProbe validators untouched. D2: one separately approved disposable modal window/native observer comparison, with exact target/owner, host quiet-time and hard independent watchdog, read-only first; report phase timing, not only API RTT. D3: only after source+synthetic+modal safety and independent native Job tests, propose an opt-in provider-specific WB-001 patch behind a default-off toggle, preserved Workbridge owner and rollback. Physical RIFT, VMware guest, OneDrive and real third-party modal input remain out of scope.

**Hard stops:** another owner or quarantine exists; no approved disposable host GUI window; changed process start/owner HWND; nondefault/locked session; UAC/consent/secure desktop; no durable intent; unknown child/daemon; incomplete terminal oracle; unproven Job settlement. No provider switch or fallback click can override these.
