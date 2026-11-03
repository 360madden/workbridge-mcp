# Freebuff delegation feasibility — Workbridge Control Center
Date: 2026-11-02
Status: investigated; no automated Freebuff task launched

## Objective
Assess whether ChatGPT Chat mode can delegate bounded Workbridge reviews or coding tasks to the already-installed Freebuff CLI without using Ollama or Codex. This is a technical feasibility report, not approval to alter account/session controls or production services.

## Locally verified
- Windows PATH resolves `freebuff` to `C:\Users\mrkoo\AppData\Roaming\npm\freebuff.ps1`, `.cmd`, and shell launcher.
- The global npm package `freebuff` is version **0.0.128**, while the cached native CLI reports **0.2.35** (`~\.config\manicode\codebuff.exe`, Win32 x64, about 124 MB). Always distinguish launcher version from actual executable.
- Native `--help` shows only `--version`, `--continue [conversation-id]`, `--cwd <directory>`, `--trust-agents`, and `--help`, with only `login` as a command. There is **no advertised prompt, --print, --json, --headless or --agent** CLI argument.
- Freebuff’s npm launcher calls `ensureBinaryExists()`, launches the cached native executable, and checks for updates in the background. The direct native executable was used for help/version inspection to avoid a launcher-initiated update.
- Ubuntu under WSL has **tmux 3.6**, but `freebuff` in its PATH points to the **Windows npm shell shim under /mnt/c**, not a verified native Linux Freebuff installation. Native WSL `node` was absent, while Windows `node.exe` is accessible. A tmux-to-Freebuff task session has **not been proven**.
- Global Windows npm did not contain `node-pty` packages queried in this investigation. Workbridge’s `terminal_run` explicitly closes stdin and rejects running the `.cmd` launcher as a native executable.
- The Workbridge repository does not currently contain `.agents/mcp.json`; Freebuff is therefore **not yet configured** as a client of the authenticated Workbridge MCP endpoint.
- Freebuff Desktop is also installed, with Windows Start app ID `com.freebuff.desktop`. A running Desktop instance, account login, actual model eligibility, and Desktop API access were **not** verified.
- No Freebuff model was invoked; no usage allowance was consumed by this investigation; no Freebuff-auth credentials were read.

## Confirmed upstream interface limitations
- Freebuff CLI is an interactive TUI. Official open issue: https://github.com/CodebuffAI/freebuff/issues/947 requests a headless / print mode and programmatic use of Freebuff authentication by `@codebuff/sdk`. As of this investigation, that issue remained open.
- The related `@codebuff/sdk` documents programmatic `CodebuffClient.run()` requiring a separate Codebuff API key, not an established drop-in Freebuff device-login credential: https://www.codebuff.com/docs/advanced/sdk
- Freebuff offers internal specialized agents and interactive `/review`, `/plan`, `/queue` workflows. Those *do not* imply Workbridge can create a new Freebuff task, monitor its completion, or collect structured receipts unattended.
- Freebuff runs model calls against a **separate account allowance** (check its live model picker); this is not the ChatGPT Chat-mode usage allocation.

## Recommendation for efficient parallel work
1. **Available now, with one interactive handoff:** Use Freebuff CLI or the installed Freebuff Desktop to review a **separate worktree or disposable copy**, while ChatGPT stays the lead coordinator on the main Workbridge repository. Give Freebuff a strictly bounded read-only review prompt and require a named Markdown report. Inspect its results manually/through Workbridge and independently verify findings. Do not give Freebuff ownership of the same files being edited by ChatGPT.
2. **Promising but unverified automation bridge:** A proper ConPTY or native Linux WSL/tmux adapter could drive Freebuff’s interactive terminal and collect bounded results; it would require dedicated testing of login/permissions/ad UI, character input, terminal control sequences, task completion detection, process cleanup and result integrity. WSL has tmux, but its currently available `freebuff` is a Windows shim. Do **not** claim this bridge already works or script blind UI keystrokes into shared desktop sessions.
3. **Clean autonomous integration if supported later:** Prefer an official Freebuff headless/ACP API with structured events, owner-authorized account flow, durable operation IDs, timeouts, output bounds and independent worktree isolation. Do not substitute arbitrary Freebuff auth tokens for Codebuff API keys.
4. **Current best low-friction independent reviewer:** A second ChatGPT Chat conversation can read the existing reviewer brief through Workbridge. The prepared handoff file is `docs/desktop-control-center-independent-chat-review-prompt.md`; it is not itself review sign-off.

## Guardrails and non-results
- The main repo may contain unrelated or in-progress changes. Never let an external reviewer silently overwrite them, nor stage or commit those files on its behalf.
- Preserve live MCP service, DPAPI authentication, scheduled task and RIFT/VMware processes. External agent review should be source-only in a disposable workspace, no broad shell or production deployment rights.
- No Freebuff task or independent Freebuff review was actually run in this investigation. No API keys, passwords, browser cookies or `credentials.json` content were accessed.
- For M0/M2 acceptance, only count an independently returned review with exact reviewed Git HEAD, paths, findings and limitations. Physical Windows Explorer tray interaction remains its own M1 gate.
