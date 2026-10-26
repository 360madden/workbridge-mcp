# ChatGPT Chat-mode approval visibility — Workbridge operating protocol

Date: 2026-10-26. Scope: **ChatGPT's own tool approval cards in ordinary Chat mode**, not Windows desktop dialogs, Windows UAC, VMware prompts, or a guest receiver.

## Incident and exact user requirement

A ChatGPT Chat-mode request displayed **"Allow ChatGPT to use Workbridge?"** for **"ChatGPT will call Workbridge's Terminal Run tool"**. Available controls in the observed example were **Always allow**, **Allow once**, **Deny**, and **See details**.

The pending request was visually tucked under collapsed **Previous activity**. The user had to expand that activity panel to discover the approval. They require immediate, prominent notice that progress needs their action rather than extended silent waiting.

This is a platform-controlled approval card, not a window inside the Windows desktop. A pending request may be intercepted before the MCP tool invocation reaches the Workbridge server. Therefore **Workbridge cannot reliably detect a pending ChatGPT approval using its command history, local Windows notification API, or tunnel diagnostics**. A server-side watchdog that sees no request cannot distinguish a hidden approval from an idle model, a stalled client or network interruption.

On 2026-10-26, a read-only permission check reported **Workbridge app-specific "Allow all actions" already selected**; the global/default preference was "Allow low-risk actions." Do not change either setting to imply a fix: account permissions do not guarantee that every ChatGPT action, safety review, or connection authorization is bypassed. Treat a new approval card as genuine until the owner reviews it.

ChatGPT tab observation was refused by the browser security gate. Do **not** work around that refusal using Workbridge-driven desktop UIA, screenshots, raw CDP, an extension, or alternate browser automation to monitor ChatGPT itself. This protocol intentionally contains no ChatGPT page scraping, browser automation, auto-approval or notification-hook code.

## Immediate best-effort alert in the MAIN conversation

Before the **first** Workbridge call in a task that may prompt for approval, particularly `terminal_run`, `write_file`, `edit_file`, `patch_apply`, `git_commit`, or service-management steps:

1. Post one short **user-visible message in the main ChatGPT conversation before initiating the call**. Do not bury it inside a tool message, a long log, or a nested activity panel.
2. Name the intended tool and action. Use **"may require approval"** unless the ChatGPT host explicitly confirms a pending approval.
3. Tell the user where to find the existing card if hidden: expand **Previous activity** and look for **"Allow ChatGPT to use Workbridge?"**. Review **See details**; select **Allow once** or **Always allow** only when appropriate. **Deny** must remain available, and a denied action is not retried by another mechanism.
4. Once a real tool response arrives, verify the actual result, job ID, operation ID, status, and exit code before declaring progress. Do not infer execution from a submitted or pending request.
5. Avoid repeated alert spam. One preflight alert per approval-prone phase is sufficient; emit a new one only for a materially different permission/action or an observed new blocker.

### Suggested concise notice

> ⚠️ **Workbridge approval may be needed.** I'm about to use **Terminal Run** for [specific task]. If ChatGPT shows **"Allow ChatGPT to use Workbridge?"**, review it. If you cannot see it, expand **Previous activity**. I'll wait for the tool result before claiming the command ran.

If the host visibly reports an approval-required state, use **"Approval required now"** rather than "may". Do not assert that the host displayed a card when the assistant has no such signal.

## Lifecycle and distinctions

| State | What the assistant knows | Required handling |
| --- | --- | --- |
| Before potentially gated tool invocation | Approval *might* be requested | Give one visible preflight notice naming the tool and action |
| ChatGPT shows approval card, tool invocation withheld | Workbridge may see **nothing** | Let the user review; do not infer an accepted operation or silently use an alternate execution path |
| User selects Deny, or action is blocked | Tool may never execute | Respect the outcome, report what remains blocked, continue separate authorized work only |
| ChatGPT permits the call and Workbridge responds | The tool's actual job/operation identity is now available | Inspect status/output and original request identity; no invented success |
| Transport response lost *after* a possible tool acceptance | Outcome uncertain | Use the same durable ID and existing status/recovery tools before any retry |
| Workbridge command launched but child failed | Normal execution failure, **not** ChatGPT approval | Follow command_status/output and the documented Workbridge recovery path |
| Windows UAC prompt opened by a helper | Guest/host OS consent, **not** ChatGPT approval | Follow the separate UAC workflow, do not treat the ChatGPT app permission as OS elevation |

A user granting general project initiative does not grant the assistant authority to click through a ChatGPT-hosted security consent card on the user's behalf. Do not automatically change global/app permissions to eliminate prompts.

## Product-level fix versus project-level mitigation

**Implemented as project guidance:** an advance notice that remains in the main conversation, exact "Previous activity" recovery language, a no-bypass rule and durable job reconciliation. This reduces silent waits when a human reviews a tool request. It is **not automatic detection** of a pending platform card.

**Needs a ChatGPT product/UI change:** when an approval card exists, make it prominent even if an activity group is collapsed: persistent top-level banner, unobscured "Action required" indicator, optional alert sound/OS notification, and return to the exact approval card. ChatGPT's documented scheduled-task notification settings do not establish push/email notifications for ordinary Chat-mode tool approvals.

Suggested product bug reproduction:
1. In ordinary Chat mode, ask the assistant to use Workbridge **Terminal Run** on a scoped action that genuinely triggers approval.
2. Observe the card **"Allow ChatGPT to use Workbridge?"** and verify whether **Previous activity** is collapsed.
3. Navigate away from activity details without approving; check whether the main chat clearly displays **action required**.
4. Expected: an unmistakable persistent notification in the main conversation and an accessible way to review the actual pending action, without automatically approving it.

This UI fix must be implemented by the ChatGPT host. Workbridge cannot force a particular approval-card placement, push notification or badge through its MCP metadata.

## Validation and rollout boundary

- This is **documentation-only**. No server/runtime changes, browser page observation, extension, auto-click, permission modification, scheduled monitor, or new listener.
- A review of the current `AGENTS.md` and `docs/chatgpt-local-workflow.md` should show the same preflight guidance. Test their content consistency with a small read-only verifier.
- A future manual Chat-mode acceptance trial can record whether the preflight text appeared in the main conversation **before** a genuine approval card. It cannot claim platform visibility was fixed merely because the notice was displayed.
- Priority 1's GUI-006 `0.16.4-dev` sealed candidate remains separate and NOT deployed; do not rebuild or bypass its previously failed WB-001 preflight as part of this ChatGPT approval UX issue.

References:
- https://help.openai.com/en/articles/20001495-managing-app-permissions-in-chatgpt
- https://help.openai.com/en/articles/20001497-troubleshooting-plugins-and-apps-in-chatgpt
- https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt
