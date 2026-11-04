# Isolated prototypes

Prototype code and experiments live here only when their dependencies and target scope are understood. No component in this folder is a production Workbridge owner or automatically deployed tool.

Prototypes must identify target PID/start/HWND, serialize physical input through an explicit Workbridge-owned lease, reject stale controls, bound output/deadlines, journal mutations and report independently verified outcomes.

Use disposable target windows first. Promotion to production requires a separate milestone and WB-001 staged validation/rollback.
