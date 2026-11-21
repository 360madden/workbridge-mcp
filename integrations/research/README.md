# Workbridge Research Coordinator

A standalone, dependency-free **Node.js 24+** research coordination engine. Workbridge uses RIFT as the first workload; the plan/DAG validator, source reconciliation, execution ledger, evidence packages, inspection and recovery are designed to serve other approved research adapters too.

**Status November 20, 2026:** **M0–M3 implemented and tested in the standalone integration**. M4 live Workbridge MCP facade and M5 staged service deployment remain pending. Nothing has restarted or modified the existing Workbridge 0.16.5-dev owner.

## Commands — PowerShell 7 on AMD-DESKTOP

Run in \`C:\work\workbridge-mcp\integrations\research\`:

\`\`\`powershell

# Validate an explicit plan; no steps or saved inputs are executed.

node .\src\cli.mjs validate --plan .\examples\rift-offline-20261120.plan.json
node .\src\cli.mjs plan --plan .\examples\rift-offline-20261120.plan.json

# Execute reviewed OFFLINE RIFT actions in order; use a NEW output directory.

node .\src\cli.mjs run --plan .\examples\rift-offline-20261120.plan.json --out 'C:\work\workbridge-mcp\.tools\wb-rift001-offline-NEW_RUN_ID'

# Independently verify completed evidence without rerunning a tool.

node .\src\cli.mjs verify --bundle 'C:\work\workbridge-mcp\.tools\wb-rift001-offline-NEW_RUN_ID'

# M3: inspect a saved run that might have been interrupted.

node .\src\cli.mjs inspect --bundle 'C:\work\workbridge-mcp\.tools\EXACT_INCOMPLETE_RUN'

# ONLY if inspect reports eligibleForGuardedResume: true, manually copy the

# printed originalAttemptId and ledgerSha256 values into this exact command.

node .\src\cli.mjs resume --bundle 'C:\work\workbridge-mcp\.tools\EXACT_INCOMPLETE_RUN' --plan .\examples\rift-offline-20261120.plan.json --expect-attempt 'EXACT_ORIGINAL_UUID_FROM_INSPECT' --expect-ledger 'EXACT_64_HEX_SHA_FROM_INSPECT'

# All focused coordinator tests:

node --test test\*.test.mjs
\`\`\`

\`validate\` and \`plan\` inspect the plan only; \`run\` performs trusted offline functions and writes an evidence package; \`verify\` and \`inspect\` read saved evidence. The \`resume\` command can execute **only work that never started** in a former attempt, and is unavailable when its source, process owner or step outcome is ambiguous. No command accepts arbitrary executable commands from JSON.

## Reviewed RIFT adapter actions

| Registered action      | Existing implementation reused                               | Output                                                                   |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| \`rift.doctor\`        | RIFT companion AMD64 PE32+ disk image inspector              | Archived image/build SHA and analyzer identity                           |
| \`rift.saved-session\` | Telemetry + RR2/RRE import and RPT Python saved track replay | Preserved source files, normalized results and child SHA checks          |
| \`rift.patch-compare\` | Original RRE Python \`rift_update_analyzer.py\`              | Pinned old/new section and original-RVA anchor drift                     |
| \`rift.compat-audit\`  | Existing physical-receipt/archive comparison                 | Explicit incompatible build/epoch findings and unqualified offset status |

Historical RIFT process receipts are _saved observations_, not fresh process proofs. RPT discontinuities are _candidates_, not completed teleports. This profile does not send game input, attach a debugger, inspect native game memory or use API credits.

## Versioned plan contract

- \`workbridge.research-plan.v1\` requires \`planId\`, explicit \`expectedHost\`, reviewed \`profile\`, typed \`inputs\`, \`steps\` and \`needs\`.
- Windows-local absolute source paths only (no \`..\`, UNC or control characters). SHA-256 mandatory on \`client\` and \`afterClient\`. \`rre\`/ \`rreBinding\` must come as a pair.
- Up to 12 steps; unknown actions/properties, duplicate steps, missing dependencies, cycles and wrong host fail before execution.
- \`run\` pins all source hashes and the saved historical physical receipt, then rechecks the original plan and source hashes before publication.

## Evidence package and M3 recovery contract

| Artifact                      | Role                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| \`input.plan.json\`           | Exact original plan bytes                                                                                                           |
| \`run-ledger.jsonl\`          | Ordered event stream with source snapshot digest and process owner/attempt ID                                                       |
| \`steps/STEP_ID/result.json\` | Status, exact result hash and any verified child bundle                                                                             |
| \`steps/STEP_ID/bundle/\`     | Original RIFT child's independent evidence package (where applicable)                                                               |
| \`run-manifest.json\`         | Completed host, source, step identities and result limitations                                                                      |
| \`recovery-claim.json\`       | **Only on a resumed run:** unique attempt ID, original ledger SHA, completed prefix count, plan/source hashes and no-replay promise |
| \`run-failed.json\`           | Failed run with last error code and preserved completed prefix                                                                      |
| \`SHA256SUMS.txt\`            | Final **successful completion marker**, written only after the last step                                                            |

\`verify\` checks the ledger, saved source identity, step hashes, optional recovery claim and previously verified child packages. \`sourceSnapshotBound:true\` is reported for new runs; older M2 trial packages remain readable and explicitly report weaker source binding.

**M3 guarded recovery** requires an inspectable prefix of exact \`step_started → step_completed\` event pairs, a valid matching result receipt and child verifier for **every** preserved step, unchanged original plan and source hashes, and a stopped original process. \`resume\` requires the printed original attempt UUID and exact ledger hash; it uses exclusive \`wx\` creation of \`recovery-claim.json\`. It appends a _new attempt identity_ only for the remaining, never-started steps. The preserved original prefix is neither overwritten nor re-executed.

**Automatic resume is refused** when a step was started but not verified complete, a failure was recorded, a completion marker or prior recovery claim exists, the old runner still appears alive, a source hash changes, the plan changes, or the next step has ambiguous filesystem artifacts. A second interruption _during recovery_ leaves the claim in place and needs a new manual investigation; there is **no automatic second resume or cleanup**. If all steps finished but finalization was interrupted, M3 conservatively reports \`finalization_uncertain\` rather than guessing whether output publication occurred. Do not manually delete a recovery claim just to bypass a refusal.

All actual gameplay archives and research runs stay under ignored \`.tools\`; Git commits contain code, tests and docs, not private raw captures. These SHA packages detect changes but are not signed provenance proofs.

## Verified development checkpoints

### M0–M2 (November 20, 2026)

- Master roadmap saved and committed in \`docs/wb-rift-001-unified-research-coordinator-roadmap-20261120.md\`.
- M1 planner source/test commit \`61d2f22\`; M2 offline engine commit \`ca7beb4\`.
- M2 4-step research package \`C:\work\workbridge-mcp\.tools\wb-rift001-offline-20261120-03\` independently verifies; original saved evidence remains unchanged.
- Initial failed M2 trial \`…-01\` is retained; the inspector classifies its inconsistent final hashes as **manual review required**, never a resume candidate.

### M3 (November 20, 2026)

- A real separate Node subprocess was deliberately terminated with exit code **73** after the \`identify\` receipt was committed, before \`replay\` started.
- \`inspect\` of \`C:\work\workbridge-mcp\.tools\wb-rift001-m3-recovery-20261120-01\` reported one completed step, source hashes matching, original owner no longer running and an exact resume-eligible ledger hash.
- \`resume\` with the captured original attempt UUID and SHA continued only **three unstarted actions**, preserved \`identify\`, and independently verified the completed bundle; \`completedPrefixReplayed:false\`, \`resumedWithClaimVerified:true\`, \`sourceSnapshotBound:true\`.
- **12/12 M3 recovery tests passed**, including two additional cases for a rewritten but semantically contradictory recovery claim and a saved input changing during resume. Final suites: **40/40 coordinator**, **67/67 RIFT**, **107/107 combined**; Prettier and Git whitespace checks passed. The local commit is recorded in Git history.
- No Workbridge restart, live RIFT game action, memory access, VM use or paid model call was required.

## Next roadmap work

**M4:** expose only typed \`research_plan\`, \`research_run\`, \`research_status\` and \`research_verify\` operations through Workbridge's existing authenticated MCP/local CLI/job infrastructure. Follow **M5 / WB-001 staged release and rollback** before replacing any in-use executable or service. Only afterward consider fresh PID-bound RIFT telemetry (M6) and non-RIFT adapter pilots (M7).

[WB-RIFT-001 master roadmap](../../docs/wb-rift-001-unified-research-coordinator-roadmap-20261120.md)
