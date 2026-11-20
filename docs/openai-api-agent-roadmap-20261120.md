# OpenAI API and agent integration roadmap (WB-OAI)

**Created:** 2026-11-20 (America/New_York)  
**Target:** AMD-DESKTOP; repository `C:\work\workbridge-mcp`  
**Status:** Approved for staged source implementation; **no deployment, paid API traffic, or live game input authorized by this document**.  
**Starting baseline:** Workbridge 0.16.5-dev, Git `main` clean when inspected; existing secure MCP tunnel and authenticated loopback CLI are in use.

## Objective

Use OpenAI's current API with Workbridge's **existing** Windows, file, Git, command, and desktop tooling. Enable actual OpenAI-powered specialist agents to inspect and improve local projects, especially RIFT / RiftChatModern, while keeping the existing ChatGPT-to-Workbridge connection available.

**Key separation:** Workbridge's 36 command jobs / assignment slots are NOT 36 AI model sessions. Actual model subagents require an API-supported orchestration session. Computer-use intelligence is NOT equivalent to working mouse/keyboard control. Neither is declared working until independently verified.

## Architecture choice

- Add a **separate companion** under `integrations/openai/` initially, using Node.js 24+ and official OpenAI Node SDK. Do not put API requests or credentials into the existing Workbridge owner process.
- Drive tools through the existing **same-owner, authenticated local CLI** (or its shared MCP transport), without starting a second Workbridge server or handling the DPAPI descriptor directly.
- Prefer OpenAI **Responses API** for the first paid proof; enable **Responses Multi-agent beta** only behind an explicit feature flag and compatibility check.
- Reuse existing Workbridge command jobs, source hashes, patch journals, workflow validation, ownership and job-status recovery; avoid a parallel task database or custom Windows input subsystem.
- Start with _zero-token dry-run and fake API tests_. No automatic API spending, no credentials stored in Git, no services launched on boot.
- Defer standalone low-level Windows action drivers until exact-window identity, input ownership, screenshots and postconditions are proven on a disposable test window. Do not send RIFT input during early milestones.
- No OpenCode, Ollama or Codex CLI dependency. OpenAI API agents are distinct from chat-internal subagents and from existing Workbridge assignment metadata.

## Milestones and acceptance gates

### P0 — Baseline + roadmap (start here)

- [x] Inspect real repository, working tree, connector version, existing local-CLI architecture and desktop limitations.
- [x] Verify the model IDs `gpt-6.2-astra` and `gpt-6.2-sol` against current OpenAI documentation.
- [x] Document API separation, recovery strategy, scopes and measured acceptance.
- [x] Commit the roadmap and initial companion foundation in a narrow local commit.

**Gate:** Roadmap is committed, existing live service untouched, no unreviewed changes.

### P1 — Isolated provider foundation (first implementation)

- [x] Companion command supports `doctor` / `plan` with **no network requests** or API charges and clear machine/project identity.
- [x] Model/routing config validated by allowlist and reasoning effort (`low|medium|high|xhigh|max` for GPT-6.2); default to Sol/medium, explicit Astra upgrade.
- [x] Implement one official SDK Responses call behind an explicit `run --live` choice and environmental API key; no arbitrary URL override. Real credentialed call still pending.
- [x] Return structured receipt: operation ID, model, state, response ID (if available), token usage, elapsed time, and sanitized errors. Never log prompts, private window content or API keys by default; a successful response intentionally emits bounded model output.
- [x] Add offline fake-provider tests for dry-run, invalid options, missing key, successful call, remote failure and token usage (part of 14/14 tests passing on 2026-11-20).
- [ ] Add cost-estimation calibration and cancellation/deadline tests before unattended API automation.
- [x] Maintain one request per invocation, 16-KiB prompt and 2,048-token output caps, and explicit live-call switch. API key must remain in current-user environment or a separate approved secret facility; do not write it into files or pass it in command arguments.

**Gate:** Offline tests 14/14 PASS; SDK export and local doctor PASS. Live API acceptance PENDING until key and spending are explicitly configured.

### P2 — Workbridge shared CLI tool adapter

- [x] Use its **existing** CLI discovery / shared-service mode rather than reading its protected DPAPI descriptor.
- [x] Read-only allowlisted tools first: `workspace_info`, `project_overview`, `read_file`, `search_text`, `git_status`, `command_status`, `command_output`.
- [ ] Implement bounded tool catalog/schema translation, output-size caps, exact project root and hostname preflight, tool-call ID ledger, timeouts and explicit error returns.
- [x] Add offline fake CLI tests, live `workspace_info` identity proof and a real `read_file` smoke against AMD-DESKTOP; no model-driven shell execution exposed.
- [ ] Only then opt in to journaled mutations (`patch_preview`, `patch_apply`, tracked validations), with file locks/ownership and postcondition verification.

**Gate:** Local same-owner read-only bridge PASS (AMD-DESKTOP, owner 0.16.5-dev, 36 slots, `read_file` returned actual hash). A model-assisted **read-only** repository summary and later disposable patch/recovery remain PENDING.

### P3 — Native OpenAI Multi-agent

- [ ] Experiment behind `--multi-agent` using the documented `responses_multi_agent=v1` beta switch and `multi_agent.enabled`.
- [ ] Start with `max_concurrent_subagents=3`; measure latency, usage, provider limits and completion correctness before increasing.
- [ ] Distinguish provider-native subagents (same model/tool configuration per request) from separately orchestrated multi-model jobs.
- [ ] Handle the model's hosted `multi_agent_call` outputs as **provider-managed**, not customer-executed functions; execute only permitted `function_call` items with matching `call_id` outputs.
- [ ] Verify a reproducible split: investigator, test reviewer and documentation reviewer on distinct files; root agent produces a cited synthesis. No RIFT input required.
- [ ] On API incompatibility, fail closed to single-agent. Do not guess deprecated schema.

**Gate:** Actual agent tree observed in API response with correct tools, distinct tasks, usage, and reproducible results.

### P4 — Computer use and desktop validation

- [ ] Adapt an official supported computer-use tool driver to **existing** Workbridge screenshot and guarded desktop primitives.
- [ ] Use synthetic Windows app first. Confirm exact HWND/PID/session, current visible frame, action target, execution receipt and independent post-action screenshot/UIA state.
- [ ] Implement explicit manual-override, input lease, kill/cancel, focus transition accounting and stale-frame rejection. One desktop controller at a time.
- [ ] Test focus/drag/text entry against disposable WPF or Win32 fixture; log failures with image hashes and clear stage labels.
- [ ] Only after the fixture passes, propose a separate RIFT-specific controlled acceptance; never infer working game input from synthetic tests.

**Gate:** Evidence-backed observe-act-observe loop and successful no-action recovery without disrupting the installed RIFT client.

### P5 — Robustness, deployment, and operations

- [ ] Per-project agent policy and spending ceilings; distinct development and production profiles.
- [ ] Persist minimal job/response IDs in a protected ignored local path with bounded retention, resume and explicit cancellation; do not replay uncertain writes.
- [ ] Isolated tests, lint/format, and release acceptance all pass; document API model/beta version drift and secret rotation.
- [ ] Use WB-001 staged update/rollback only **if** Workbridge core actually needs a change. The standalone companion must not require service restart.
- [ ] Publish optional GitHub changes only through the established review/push workflow, not as a side effect of local test completion.

**Gate:** End-to-end validated companion with zero changes to the owner until explicit maintenance acceptance.

## First vertical slice (2026-11-20)

1. Create this roadmap and a companion package under `integrations/openai`.
2. Implement offline `doctor` and `plan`; implement a dependency-injected standard Responses adapter.
3. Add deterministic tests (fake client; no network or credentials) and a documented optional live test path.
4. Commit only these files. Leave the Workbridge tunnel, .local state, global credentials and running RIFT untouched.

## Design decisions and risks

| Risk                                                   | Mitigation                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| API credits/billing are independent of ChatGPT usage   | Offline default; explicit `--live`; configure hard budgets before automation.                 |
| Multi-agent API is beta and changes shape              | Feature-flag, documentation version, compatibility tests, fail-closed fallback.               |
| 36 Workbridge jobs mistaken for 36 AI subagents        | Report separate counters and only claim actual spawned agents from API evidence.              |
| Local Windows input steals focus or changes the game   | Single-controller lease; synthetic-first, screenshot + postconditions.                        |
| Live Workbridge release breaks existing ChatGPT tunnel | Separate companion process; no WB-001 service changes until independent release gate.         |
| API output asks for broad shell or file writes         | Tool allowlist, project scope, hash preconditions, recoverable edits and explicit validation. |
| Prompts/keys/desktop captures appear in logs           | Store neither keys nor prompt bodies by default; sanitize errors and receipts.                |

## Documentation baseline (verified 2026-11-20)

- Responses API: https://developers.openai.com/api/reference/resources/responses/methods/create
- Multi-agent beta: https://developers.openai.com/api/docs/guides/responses-multi-agent
- Computer use driver: https://developers.openai.com/api/docs/guides/tools-computer-use
- Models: https://developers.openai.com/api/docs/models
- Workbridge: `docs/shared-service-cli.md`, `docs/agent-coordination.md`, `docs/interactive-desktop-vm-roadmap.md`, `docs/updates.md`

**Evidence discipline:** A code file written is not a build pass; a test pass is not a live API call; a successful API response is not verified desktop control. Report each gate separately.
