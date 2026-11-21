# Workbridge Research Coordinator

A standalone, dependency-free **Node.js 24+** research coordination engine. The workflow graph, source validation, run ledger and verification are generic; the **RIFT adapter profile** is its first real workload.

**Status November 20, 2026:** M0 roadmap saved; **M1 planner complete**; **M2 offline runner complete and tested**. M3 restart-safe recovery, M4 Workbridge MCP facade and M5 service deployment are **not** complete. The active Workbridge owner was not restarted or modified.

## Commands (PowerShell 7 on AMD-DESKTOP)

From `C:\work\workbridge-mcp\integrations\research`:

```powershell
# M1: validate the exact plan and preview its deterministic dependency order.
node .\src\cli.mjs validate --plan .\examples\rift-offline-20261120.plan.json
node .\src\cli.mjs plan --plan .\examples\rift-offline-20261120.plan.json

# M2: actually execute approved OFFLINE functions. Select a NEW output path.
node .\src\cli.mjs run --plan .\examples\rift-offline-20261120.plan.json --out 'C:\work\workbridge-mcp\.tools\wb-rift001-offline-NEW_RUN_ID'

# Verify a completed saved run without rerunning the tools or contacting RIFT.
node .\src\cli.mjs verify --bundle 'C:\work\workbridge-mcp\.tools\wb-rift001-offline-NEW_RUN_ID'

# Narrow tests:
node --test test\*.test.mjs
```

`validate` and `plan` only read the plan. `run` performs the registered existing offline RIFT functions in dependency order; it is intentionally not a generic command runner. `verify` reads saved artifacts only. A failed run or invalid input exits 2 with a structured error code and, if the run directory was already created, its path for inspection.

## What the coordinator now does

The example profile `rift.offline.v1` contains four reviewed actions:

| Action               | Existing implementation reused                                       | Result                                                                         |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `rift.doctor`        | RIFT companion's on-disk PE32+ build inspector                       | Archived game executable identity, full SHA-256, tool source hash              |
| `rift.saved-session` | Telemetry + RR2/RRE source import and RPT Python position classifier | Complete child package with original bytes, normalized evidence and SHA256SUMS |
| `rift.patch-compare` | Existing RRE Python `rift_update_analyzer.py`                        | Pinned old/new PE section and byte-anchor comparison                           |
| `rift.compat-audit`  | Existing saved physical-epoch and archive compatibility audit        | Source build conflicts and unqualified memory/teleport findings                |

No live game PID is chosen automatically by this profile. The saved physical receipt can be used **only as historical reference**. The current build may differ from the archived RR2/RRE records, and a source-reported `live` state at capture time does not prove current freshness. A position discontinuity is never a completed arbitrary teleport.

### Input and plan contract

- Versioned `workbridge.research-plan.v1` schema with exact `planId`, `expectedHost`, `profile`, `inputs` and `steps`.
- Known adapter IDs only; unknown properties, actions, step references and dependency cycles fail closed.
- Local Windows absolute source paths with no traversal. Pinned SHA-256 on `client` and `afterClient`. RRE publication/binding pair must be present together.
- Up to 12 unique named steps; mandatory action prerequisites and conditional dependency rules enforced. The topological order is deterministic, including for plans supplied out of order.
- Up to 32 KiB UTF-8 plan file; read through a no-symlink regular-file guard with before/after metadata checks.
- M2 preflight pins all referenced saved sources, verifies the historical physical receipt, and hashes both archived PE images. It rechecks source hashes and original plan bytes before success publication.

The generic validation and run engines accept injected trusted registries for future projects. To add a new provider, implement a typed reviewed adapter; **do not** add arbitrary shell commands to plan JSON.

### Durable output package

A new, never-overwritten run directory contains:

| Artifact                    | Meaning                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `input.plan.json`           | Exact original plan bytes                                                                    |
| `steps/STEP_ID/result.json` | Each bounded action result, claim limits and child-bundle identity                           |
| `steps/STEP_ID/bundle/`     | Original RIFT child package when that action produces one                                    |
| `run-ledger.jsonl`          | Ordered run-start, step-start/step-complete and run-complete transitions                     |
| `run-manifest.json`         | Host, profile, source file hashes, step results and explicit offline-only qualifications     |
| `SHA256SUMS.txt`            | Completion marker written **last**, verifying every top-level result and child checksum list |

`verify` checks inventory count/order and file hashes, source/plan identities, step-result/ledger hashes, and runs the existing child verifiers again. New runs bind the original source inventory hash into the starting ledger event; `sourceSnapshotBound:true` is reported only when present. Older pre-commit trial packages can still verify with `sourceSnapshotBound:false`.

If a step fails, the coordinator leaves prior completed results and `run-failed.json`, but **no valid completed-run marker**. It does not silently retry or overwrite prior evidence. Crash-safe resume is deferred to M3.

All example archival outputs are stored in Workbridge's ignored `.tools` area. Do not commit raw captured gameplay evidence.

## Actual verification checkpoint

**AMD-DESKTOP, November 20, 2026:**

- M1 manifest/parser suite **17/17 passed** (part of coordinator tests).
- M2 runner/negative test additions **11/11 passed**; combined coordinator suite **28/28 passed**.
- Existing RIFT companion regression **67/67 passed** (not modified by M2). **95/95 combined.**
- Prettier code checks passed before final documentation updates; re-run formatting at commit gate.
- One complete offline run from the pinned source example: `identify → replay → patch → audit`; all child bundles verified.
- **Completed, independently verified M2 run:** `C:\work\workbridge-mcp\.tools\wb-rift001-offline-20261120-03`; `sourceSnapshotBound:true`, `gameContacted:false`, `teleportVerified:false`.
- Earlier successful trial `…-02` remains verifiable with weaker pre-checkpoint source binding, explicitly marked false. Initial `…-01` is preserved as a **failed verification investigation artifact**, not accepted evidence.
- No production service restart, addon deployment, game input, native-memory access, debugger attach, paid AI API call, VM interaction, or modification of sibling RIFT repositories.

## Next

**M3:** durable, restart-safe recovery of partially completed runs; unambiguous attempt identity and watched source hashes, no blind retry. **M4–M5:** optional Workbridge MCP/local-CLI integration using the existing bounded command-job system and the established WB-001 staged rollout/rollback gates. **M6+:** fresh physical-RIFT telemetry with exact process epoch binding.

[Full WB-RIFT-001 master roadmap](../../docs/wb-rift-001-unified-research-coordinator-roadmap-20261120.md)
