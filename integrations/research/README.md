# Workbridge Research Coordinator

A dependency-free, standalone **Node.js 24+** research-plan engine. WB-RIFT-001 is the first adapter profile; the generic engine is intended to support other reverse-engineering repositories through reviewed, typed registries.

## Status

**M1 complete:** source-only manifest validator, dependency planner and read-only CLI. The `run` executor, recovery, MCP server adapter and GUI are later roadmap gates—not available in this M1 checkpoint. The live Workbridge owner is **not** changed.

From PowerShell 7, in `C:\work\workbridge-mcp\integrations\research`:

```powershell
node .\src\cli.mjs validate --plan .\examples\rift-offline-20261120.plan.json
node .\src\cli.mjs plan --plan .\examples\rift-offline-20261120.plan.json
node --test test\plan.test.mjs
```

Both commands read the saved manifest but do **not** run RIFT, a debugger, addon, telemetry companion, PowerShell script, model or any other research tool. `validate` reports whether the source conforms to the schema and host; `plan` reports the deterministic dependency order. A failed check exits 2 with a structured error code.

## Plan contract

- Root `schema: "workbridge.research-plan.v1"`, `planId`, `expectedHost`, `profile`, `inputs` and `steps`; unknown top-level/step/source fields reject.
- Explicit Windows host must match the current OS hostname, even when a repository is available on several machines.
- `profile` selects a **fixed reviewed registry**. First profile: `rift.offline.v1`. Future research profiles may use the same parser by registering their own input and action descriptions in trusted source code.
- Bounded source roles (`client`, `telemetry`, `track`, `rr2`, `rre`, `rreBinding`, `afterClient`, `anchors`, `physicalReceipt`). Local Windows absolute paths only; the planner does not open the referenced source files until M2.
- `client` and `afterClient` have mandatory 64-hex SHA-256 pins when used. The RRE publication and binding pair must be declared together.
- Up to 12 unique named steps; actions `rift.doctor`, `rift.saved-session`, `rift.patch-compare`, and `rift.compat-audit`. Each must satisfy registered required input roles and dependency contracts, plus global dependency-cycle checks.
- No user-provided executable, command string, open URL or model service is accepted. A plan only names trusted adapter IDs and source files.
- Maximum plan size 32 KiB, UTF-8 JSON; no symbolic-link plan files. File stability/size and SHA-256 are checked while reading.
- A preview reports `toolsInvoked:false`, `gameContacted:false`, `writesPerformed:false`; it does not claim any generated research evidence.

The included example references existing archived RIFT files and a prior saved process receipt on AMD-DESKTOP, but **none of them are interpreted as fresh game data**. It is a realistic M2 target, not a live-session authorization.

## Next milestones

**M2:** implement fixed RIFT adapters, one-command offline run with child evidence packages and independently verified run ledger/checksums. **M3:** uncertain-result recovery and restart-safe resume. **M4–M5:** bind to existing Workbridge command jobs, isolated tests and WB-001 controlled staged rollout. **M6+:** source-bound fresh physical RIFT telemetry and other adapter profiles.

Full roadmap: [WB-RIFT-001](../../docs/wb-rift-001-unified-research-coordinator-roadmap-20261120.md).
