# Independent ChatGPT Chat-mode review handoff — Workbridge Control Center

Purpose: make M0/M2 independent review executable in a **different ChatGPT conversation**, without Codex or Ollama. This file is a handoff, not a completed review or permission to edit. The other conversation must actually run its own inspections and return findings.

## Copy-paste into a NEW ChatGPT Chat conversation

> Act as an independent senior code reviewer, separate from the ChatGPT conversation authoring Workbridge Desktop Control Center. Use the connected **Workbridge** tools, operating read-only in `C:\work\workbridge-mcp`. Do **not** use Ollama, Codex, local models, agent assignment metadata as substitute reviewers, or connected GitHub write actions. Do not modify files, run deployment or maintenance commands, change Windows scheduled tasks, affect the live Workbridge server, take shared GUI input, or interfere with RIFT/VMware.
>
> 1. Read `AGENTS.md`, `docs/desktop-control-center-roadmap.md`, `docs/desktop-control-center-m1-m2-handoff.md`, and especially the **entire** `docs/desktop-control-center-review-brief.md`. Verify Git HEAD and working-tree status. Do not assume a hardcoded commit is still current.
> 2. Independently read the relevant **full source**, including `desktop/Workbridge.ControlCenter/App.xaml.cs`, `MainWindow.xaml.cs`, `MainWindow.xaml`, `BoundedLineReader.cs`, `scripts/desktop-monitor.mjs`, `scripts/desktop-monitor-format.mjs`, `scripts/desktop-status.mjs`, `scripts/desktop-job-detail.mjs`, `scripts/desktop-assignments.mjs`, and applicable tests. Continue across file pages/cursors when needed; do not base conclusions on truncated snippets.
> 3. Perform an adversarial, correctness-first review. Focus on WinForms/WPF notification icon lifecycle, concurrent single-instance launch and restore, dispatcher shutdown races, monitored Node process ownership and EOF cleanup, bounded input/output and JSON type validation, retries/timeouts, selection/input change races, DPAPI-authenticated local service boundary, and test-harness cleanup. Distinguish **36 command slots** from native AI reasoning agents.
> 4. Return a severity-ranked **review report only**. For each candidate issue give a grounded path/line range, concrete failure sequence, whether the defect is confirmed by source or only hypothetical, a minimal proposed fix and an isolated verifying test. Clearly name paths inspected, uninspected areas, and unresolved questions. Do not claim independent sign-off based solely on pre-existing smoke tests.
> 5. State plainly whether the source is ready for M0/M2 acceptance, has blocking defects, or still lacks evidence. The actual Windows Explorer notification-area double-click and menu Exit interaction is a **separate physical M1 acceptance gate** and has NOT passed. Do not mark it complete merely because Shell icon registration and synthetic callbacks passed.
>
> **End your answer with a compact, self-contained REVIEW HANDOFF suitable for pasting into the original developer conversation.** Do not commit or change any files. The original developer conversation will validate and implement fixes separately, then rerun tests.

## Review acceptance

The coordinator may mark the independent review received only after an actual second ChatGPT reviewer returns source-grounded findings or explicit scoped sign-off. Record its exact reviewed Git HEAD, scope, findings, reviewer limitations, and outstanding M1 physical test. The coordinator remains responsible for verification and any changes.

## Separate physical Windows notification-area gate

In a Windows PowerShell window, from `C:\work\workbridge-mcp`, after closing any existing Control Center, run:

```powershell
.\desktop\tests\Run-PhysicalTrayAcceptance.ps1 -TimeoutSeconds 120
```

During the test, **physically** double-click the Workbridge notification icon (possibly under **Show hidden icons**), then right-click the icon and choose **Exit Control Center**. Save the resulting JSON receipt. An `iconRegistered=true` result by itself is not full acceptance.

Last attempted physical run: `wbdesktop-physical-tray-real-attempt-20261102` exited 2. The icon was registered (ID 1), but no physical restoration click was observed before timeout; cleanup succeeded. This is **not** a pass.
