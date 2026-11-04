# Microsoft WinApp CLI — candidate baseline

Repo: https://github.com/microsoft/winappCli
Local version reported: 0.7.1 (reverify before benchmarks).

What to evaluate:
- Exact process/window targeting, `list-windows`, `inspect`, `search`, `get-value`, `invoke`, `set-value`, `wait-for`.
- CLI's cross-workflow physical desktop arbitration and `WINAPP_UI_WORKFLOW_ID` semantics.
- Correct behavior on modal dialogs, a minimized window, moved buttons and mixed monitor DPI.
- Cold/warm subprocess overhead against persistent alternatives.
- Screenshots only on known disposable targets; no RIFT/VM input in the initial phase.

Caution: library-level consumers do not automatically get the CLI's shared arbiter.

Status: existing dependency; new comparison untested.
