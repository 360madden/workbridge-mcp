# WB-RIFT-001 — Unified Research Coordination Master Roadmap

**Created:** 2026-11-20 (America/New_York)  
**Owner:** Workbridge-MCP / 360madden  
**Verified machine:** AMD-DESKTOP, Workbridge `hostname.exe`, exit 0  
**Starting HEAD:** `12effe92e9f5d3a5b0539ec182ec64b6090afc3e`; clean `main`, ahead 9  
**Active owner:** Workbridge `0.16.5-dev`, 36 command/assignment slots; do not restart or modify live owner outside WB-001 staged update  
**Project root:** `C:\work\workbridge-mcp`  
**Implementation:** new generic `integrations/research/`, reusing `integrations/rift/`

## Mission

Make Workbridge a **reusable research coordinator**, with RIFT as the first production-like workload. One command should validate an explicit plan, invoke reviewed tools in dependency order, record which inputs/identities and artifact versions were used, distinguish failure from complete success, and preserve a hash-verifiable evidence package. Extend later to other reverse-engineering projects without copying the workflow engine.

**Decision:** build and test a standalone Node 24+ research-run CLI first. It must **not** launch a second Workbridge MCP owner, duplicate RIFT native readers or increase the 36-slot limit. Expose narrow MCP operations only after offline acceptance and a staged service rollout.

## Starting assets and decisions

| Existing capability            | Verified behavior                                                                                                               | How to reuse                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Workbridge 0.16.5-dev          | Bounded jobs, authenticated loopback CLI, file/snapshot workflows, 36 slots                                                     | Reuse server job infrastructure at M4 rather than building another server worker scheduler |
| RIFT companion                 | `doctor`, `session`, `patch`, `physical`, `audit` plus independent `verify` commands; 67/67 focused tests at baseline           | Use existing function contracts and exact source/receipt verification                      |
| Telemetry and RR2              | Historic JSON/JSONL player/target observations; exact native build and process-start metadata when available                    | Typed import; never silently convert missing values into zero                              |
| RRE                            | Retained RREC2 publication receipts and `rift_update_analyzer.py`                                                               | Reuse saved-generation decoder and pinned PE comparator, not new readers                   |
| RPT                            | Existing Python offline position experiment                                                                                     | Reuse `teleport_analyzer.py`; discontinuity is not proof of teleport                       |
| Real offline/physical evidence | Old hash `1935a05c…`, newer hash `df954b79…`, old RRE anchors changed in newer image, historical physical receipt for PID 34596 | Recorded acceptance examples, **not** future PID or pointer-chain authority                |

## Architecture

```text
     ChatGPT / Workbridge existing authenticated MCP service
                             |          (future M4-M5)
                       research adapter
                             |
            generic standalone research coordinator
        manifest parser — DAG validator — typed registry
               run ledger — failure receipts — hashes
                             |
       +---------------------+---------------------+
       |                     |                     |
   RIFT doctor         RIFT saved replay      RIFT patch diff
   build identity      Telemetry/RR2/RRE      existing RRE PE tool
                       + RPT classifier
       |                     |                     |
       +---------------------+---------------------+
                             |
                   optional historical audit
                             |
                 immutable run evidence package

Other repositories later add reviewed adapters to the same registry.
```

The coordinator owns ordering, provenance, error states and artifact envelopes. RR2, RRE, Telemetry and RPT remain authoritative for their own collection/parsing contracts. **No** generic shell command is accepted from user-provided plan JSON.

## Planned CLI v1

- `node integrations/research/src/cli.mjs validate --plan FILE`: strict schema and DAG validation; no tool execution or output writing.
- `node integrations/research/src/cli.mjs plan --plan FILE`: deterministic dependency order, declared inputs and outputs; read-only.
- `node integrations/research/src/cli.mjs run --plan FILE --out NEW_DIR`: run only pre-registered adapter actions and write a complete or explicitly failed run package.
- `node integrations/research/src/cli.mjs verify --bundle DIR`: independently check manifest, ledger and final hashes. No game or tool interaction.
- Later `inspect`, `resume`, `cancel` and supervised live runs require separate recovery and concurrency tests.

### Research plan v1 — intended shape

```json
{
  "schema": "workbridge.research-plan.v1",
  "planId": "rift-archival-demo",
  "expectedHost": "AMD-DESKTOP",
  "profile": "rift.offline.v1",
  "inputs": {
    "client": { "path": "C:\\work\\...\\rift_x64.exe", "sha256": "<64-hex>" },
    "telemetry": { "path": "C:\\work\\Telemetry\\...\\snapshot.json" },
    "track": { "path": "C:\\work\\Rift-Personal-Teleporter\\...\\track.jsonl" },
    "rr2": { "path": "C:\\work\\riftreader2\\...\\native.json" },
    "rre": { "path": "C:\\work\\rre\\...\\saved-publication.json" },
    "rreBinding": { "path": "C:\\work\\rre\\...\\source-binding.json" },
    "afterClient": { "path": "C:\\work\\...\\new_rift_x64.exe", "sha256": "<64-hex>" },
    "anchors": { "path": "C:\\work\\rre\\tools\\rift_update_anchors.json" },
    "physicalReceipt": { "path": "C:\\work\\workbridge-mcp\\.tools\\..." }
  },
  "steps": [
    { "id": "identify", "action": "rift.doctor", "needs": [] },
    { "id": "replay", "action": "rift.saved-session", "needs": ["identify"] },
    { "id": "patch", "action": "rift.patch-compare", "needs": ["identify"] },
    { "id": "audit", "action": "rift.compat-audit", "needs": ["replay", "patch"] }
  ]
}
```

This is the **target contract**, not a claim that the runner currently exists. Source requirements and action/dependency rules are validated before any run. Optional inputs require explicit step omission or a preflight refusal. Step references can resolve **only known predecessor outputs**, never arbitrary object expressions.

### Run artifact contract

A new ignored `.tools/research-runs/RUN_ID/` directory contains `input.plan.json` (original bytes, hash), `run-manifest.json` (schema, host, source versions, identities, outcomes), `run-ledger.jsonl` (ordered transitions), and `steps/STEP_ID/` (existing child evidence packages). `SHA256SUMS.txt` is the final success marker, written only after all prior artifacts are complete. The coordinator does not copy whole game executables. A failed or interrupted run preserves prior evidence and clear failure status without asserting completion or blindly retrying.

## Development milestones and acceptance gates

| Milestone | Priority | Deliverable                                                               | Acceptance                                                                                                                                                                                            |
| --------- | -------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0**    | P0       | This detailed roadmap under `docs/`                                       | File saved, re-read and committed with exact hash; active owner unchanged                                                                                                                             |
| **M1**    | P0       | Generic manifest validator/planner and CLI under `integrations/research/` | Unknown schema/fields/actions, invalid IDs/paths/hashes, cycles, missing dependencies, duplicate IDs and excessive size/step counts rejected; deterministic order; tests PASS                         |
| **M2**    | P0       | Typed RIFT registry adapters and sequential offline `run`                 | One command performs archived client identification, Telemetry/RR2/RRE/RPT replay, optional RRE patch compare and saved compatibility audit; original inputs unchanged; output independently verified |
| **M3**    | P0       | Durable run ledger and failure recovery                                   | Pre/post step states; final marker only for complete run; injected failure preserves earlier steps; restart/uncertain operations never auto-retried; explicit guarded resume                          |
| **M4**    | P0       | Narrow Workbridge MCP/local CLI facade                                    | Same typed contract and bounded results through existing job engine, no arbitrary shell input, isolated mock-owner acceptance                                                                         |
| **M5**    | P1       | WB-001 staged runtime rollout                                             | Isolated build, tests and rollback; precise source/deployed inventory; exclusive maintenance window; no competing service owner or live `.local` writes                                               |
| **M6**    | P1       | Fresh physical RIFT research run                                          | Fresh PID/start ticks/HWND/EXE SHA, source timestamps/gaps/build status, explicit multibox binding and evidence package; no source freshness inferred from archives                                   |
| **M7**    | P1       | Reusable second-project adapter and optional GUI                          | Different offline RE project passes same plan/run/verify engine; CLI and UI share semantics                                                                                                           |
| **M8**    | P2       | Benchmarks, CI and docs polish                                            | Deterministic bounded performance, reference fixtures, polished README, remote push only on instruction                                                                                               |

### M1: exact implementation requirements

1. Pin `workbridge.research-plan.v1` and `rift.offline.v1`, explicit hostname and finite run ID. Whitelist input roles and immutable action IDs; never accept shell commands or arbitrary executable paths as actions.
2. Reject missing/unknown properties, invalid SHA-256, invalid path shape, repeated or missing steps, unknown actions, duplicate edges, self-dependency, cycles and excessive plan size. Validate RRE publication/binding pairing and patch input dependencies.
3. Build an explicit DAG/topological sorter with stable ordering from the plan; refuse ambiguous action graph dependencies and duplicate action kinds.
4. Provide `validate` and `plan` commands; they do not run the game, mutate any source or create evidence directories.
5. Tests must prove valid manifests, invalid schema/fields, wrong host, invalid path/hash, unknown action, duplicate ID, missing dependency, cycles and deterministic output.

### M2: functional end-to-end research run

1. Execute existing RIFT companion **functions or fixed CLI actions** by explicit registry key, not new native memory readers or byte-decoding implementations.
2. Preflight source paths, before/after expected SHA hashes, archive contracts and RRE binding pair. Dependencies must run in order; independent read-only operations may later run concurrently only with separate output ownership.
3. Generate a no-clobber run directory with source and artifact hashes. Do not edit archive files, deploy addons or contact RIFT.
4. Run with existing real archived RIFT builds, saved Telemetry snapshot, RR2/RRE receipts, and RPT position sample. Optional physical receipt is historical and is audited as such.
5. Verify final package and reproduce result. Include negative fixtures for wrong host/build, missing data, malformed telemetry, partial tool failure and concurrent directory creation.

### M3: reliability and recovery

- Explicit states `planned → running → completed|failed|interrupted`, exact step attempt IDs, manifest/file hashes, preserved exit or exception codes and timestamps. Success marker is written last.
- Recovery requires source hash and previous step receipt revalidation. Missing/ambiguous prior outcome refuses automated retry; do not reset or delete someone else's artifacts.
- Test injected interruption, changed input between planning/execution, repeated run ID, output tampering, and incomplete checkpoint.

### M4–M5: actual Workbridge upgrade

- Expose narrow commands such as `research_plan`, `research_run`, `research_status` and `research_verify` only after source CLI acceptance, never unrestricted process-memory writes or arbitrary shell commands.
- Reuse existing Workbridge command jobs, leases, timestamps, recovery/rollback, authenticated loopback CLI and existing 36-slot limits. Workbridge assignment records **do not spawn reasoning agents**.
- Deploy through WB-001 isolated validation. Historical attempts to replace an in-use native command-host executable are not a reason to kill/restart the active owner. Hold rollout until an exclusive service maintenance gate is verified.

## Policy, constraints and non-goals

- **AMD-DESKTOP only** for this session. Verify actual Windows hostname first and again on any machine connector switch. LEGION and VMware are out of scope.
- **No game input or native game-memory changes** in M0–M3. No movement, casting, UI reload, memory writes, debugger attachment, or game network protocol work.
- **No paid/API/local model dependency:** No OpenAI API credits, Codex, OpenCode, Ollama or FreeBuff. Internal ChatGPT workers only if actually available; don't relabel Workbridge assignments as AI agents.
- **No Workbridge service restart, production dist replacement or .local edits** until M5.
- **No stale-source promotions:** matching executable bytes or archived PID never proves current frame, loaded pointer chain, causal cross-repo observation, independently completed teleport or server-accepted relocation.
- **No destructive Git operations:** preserve unrelated user work, exact-file commits and source hash guards. Local commits do not equal GitHub push.

## Risks and fallback

| Risk                                     | Mitigation                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Mixed executable builds or source epochs | Exact SHA and process-start ticks; preserve incompatible source verdicts                    |
| Multibox / PID reuse                     | Fresh PID/start/HWND/EXE identity with explicit selection, never auto-rebind                |
| RRE 64-bit ticks                         | Preserve original decimal strings; never JS doubles                                         |
| Tool stalls or oversized output          | Bounded execution/output; M4 uses Workbridge's existing jobs                                |
| Partial output / interrupted run         | Durable ledger, incomplete state, marker-last finalization and no blind retries             |
| Concurrent jobs sharing files            | Exclusive output folders, source checks, one owner for shared GUI input                     |
| Existing Workbridge EXE locked           | Standalone no-deployment source/test work; later WB-001 staged rollout                      |
| Historical gameplay data in Git          | Keep captured data under ignored `.tools`; commit only source, tests, doc and safe fixtures |

## Verification and commitment rhythm

Run `node --test integrations/research/test/*.test.mjs` for the new coordinator and `node --test integrations/rift/test/*.test.mjs` if changing RIFT companion. Use pinned Prettier, `git diff --check`, exact SHA-256 preconditions and a narrow local commit per verified milestone. No GitHub push until separately directed.

Report timestamped status and actual test counts, source/owner health, error/failure evidence and what remains. Make progress on the next useful unblocked milestone rather than expanding documents or worker slots unnecessarily.

## Checkpoints

- **M0 — complete:** detailed roadmap saved in `docs/wb-rift-001-unified-research-coordinator-roadmap-20261120.md`, re-read and committed as `0b90a481212fc250a8b5f1e4448336bb37c9f0ed`. Machine verified AMD-DESKTOP; existing owner unchanged.
- **M1 — implemented, validation PASS:** created `integrations/research/src/registry.mjs`, `plan.mjs`, `plan-file.mjs`, `cli.mjs`, versioned example plan, package metadata and 17 focused tests. Planner enforces fixed action/input schema, exact host, pinned client hashes, Windows paths, RRE source pairing, prerequisites, DAG ordering and no executable commands from plan JSON.
  - **17/17 tests passed** using Node on AMD-DESKTOP.
  - Actual example `plan` and `validate` CLI calls both exited 0. Preview: four steps `identify → replay → patch → audit`, SHA-256 `b416a46ec7f3cc59ab0f543fb3741d5b399ed670c355b016db75f84377aa2015` and `toolsInvoked=false`.
  - Initial test run failed two assertions with incorrect test expectations (missing dependency precedence and valid 64-character ID boundary); corrected the test expectations, not the implementation contract.
  - Source-only M1: no live RIFT, service restart, deployment, paid API, game input or evidence acquisition.
  - M1 final formatting/test/diff gates passed; committed as `61d2f22c2164eff44bd7fe20a40b30cc702bd09c`. The active Workbridge owner remained untouched.
- **M2 — implemented and verified (offline):** added `src/adapters/rift.mjs` and generic `src/run.mjs`, extended `src/cli.mjs` with `run` and `verify`, and added injected-adapter regression tests. The coordinator invokes the existing RIFT doctor, Telemetry/RR2/RRE+RPT saved replay, RRE PE patch comparator, and historical compatibility audit in deterministic DAG order. No new native reader, debugger or server owner.
  - Real AMD-DESKTOP example run `C:\work\workbridge-mcp\.tools\wb-rift001-offline-20261120-03` completed all four steps and passed an independent `verify` call: `sourceSnapshotBound:true`, `gameContacted:false`, `teleportVerified:false`. Nested RIFT child bundles and final run inventory were verified.
  - Final coordinator tests **28/28 passed**, RIFT companion regression **67/67 passed** — **95/95 total**. Tests cover wrong plans/hosts/builds, generic injected adapter workflows, forced failed step, incomplete marker, duplicate output refusal, changed plan/source during execution, tampered results, source inventory consistency, legacy bundle status, and late final-verifier refusal with successful marker withdrawal.
  - First real trial `…-01` ran all existing RIFT tools but failed the _outer_ checksum parser because an expected `SHA256SUMS.txt` entry contains uppercase characters; retained as a failed investigation, not reported as success. After fixing that parser, trial `…-02` succeeded. The strengthened run-start source inventory hash was then added; trial `…-02` still verifies, but correctly reports `sourceSnapshotBound:false`. Accepted `…-03` contains the strengthened binding and verifies `true`.
  - A completed package contains original plan, ordered step results, child evidence packages, ledger, manifest and a last-written SHA256SUMS marker. Failed attempts retain earlier step artifacts and `run-failed.json` without a _valid_ completion marker. Full crash/restart-safe resume is **not** yet implemented.
  - Neither the real M2 run nor these tests contacted physical RIFT, transmitted game input, sampled game memory, restarted Workbridge, altered sibling repositories, installed models or required API credits.

- **M3 — guarded checkpoint recovery implemented; final gate pending:** Added `src/recovery.mjs`, `src/resume.mjs`, CLI `inspect`/`resume`, per-run/per-step UUIDs and PID owner receipts in `run-ledger.jsonl`, and SHA-bound `recovery-claim.json` in independently verified completed packages.
  - Strict inspection verifies each prior `step_started → step_completed` pair, result SHA, optional existing RIFT child bundle, exact plan bytes, original source-snapshot digest and whether the original process is still present. Uncertain started actions, recorded failures, incomplete finalization, preexisting claims/markers, changed inputs, still-running owners and ambiguous next-step directories remain **blocked**.
  - Resume requires the **exact original attempt UUID** and **exact ledger SHA-256** printed by `inspect`. A claim is created using exclusive `wx` before executing the first remaining step; only never-started steps execute under a new UUID. Original committed steps are not replayed, and the final verifier cross-checks the claim plus original ledger-prefix hash. A second interruption during recovery leaves the claim and requires manual review, **not** automatic retry.
  - A real Node subprocess exit **73** was injected after original RIFT `identify` had committed, leaving no `replay` start event. Read-only inspection reported `interrupted_at_checkpoint` with `eligibleForGuardedResume:true`, matching sources and an exited original owner. The verified `resume` continued the remaining three RIFT archived-analysis steps without rerunning `identify`.
  - Durable real archived RIFT package: `C:\work\workbridge-mcp\.tools\wb-rift001-m3-recovery-20261120-01`. Independent `verify` returned `verified:true`, `sourceSnapshotBound:true`, `resumedWithClaimVerified:true`, `completedPrefixReplayed:false`, `teleportVerified:false`.
  - Historical failed first M2 trial (`…offline-20261120-01`) was inspected and correctly classified `manual_review` with `verificationErrorCode:RUN_HASH_MISMATCH`, never a repeatable checkpoint.
  - Final M3 recovery suite **12/12 passed**, combined coordinator suite **40/40 passed**, RIFT regression **67/67 passed**, **107/107 total**. Prettier and Git diff checks passed. New regression cases cover a rehashed but contradictory recovery claim and changing saved inputs during resumed execution.
  - No game input, live memory sampling/writes, debugger attach, VMware access, paid model usage, or Workbridge live service update was performed.
- **M4 — source-only MCP facade implemented; deployment HOLD:** Added `src/research-registration.ts` and registered the module in `src/server.ts` source with four narrow tools, `research_plan`, `research_run`, `research_status`, `research_verify`.
  - Research-plan and saved-package commands are fixed Node CLI verbs. `research_run` accepts only a validated run ID and writes beneath ignored `.tools/research-runs/`; the facade routes requests through existing `Jobs.terminal` with the normal request IDs, bounded job slots, status/output, and restart semantics. No new server owner or second scheduler.
  - Source-only acceptance: strict TypeScript `tsc --noEmit` **PASS**; separate emitted TypeScript candidate `.tools/research-m4-isolated-dist` **PASS**, with no rewrite of live `dist` or in-use native command host. Fake-owner `test/research-facade.test.mjs` suite **7/7 PASS** covers fixed program/arguments, bounded output identity, invalid run IDs, status ownership, shutdown and Zod MCP tool registrations.
  - Neither the active Workbridge `0.16.5-dev` owner nor connected ChatGPT MCP tools have been updated. These names exist **in source only** until a staged WB-001 service deployment is independently verified. No game/VM input, process memory action or API credit usage.
- **M5 — sealed research runtime / offline release preparation implemented; Apply HOLD:** The WB-001 source inventory originally omitted `integrations`, while `src/research-registration.ts` referred to mutable source files and `scripts/release-acceptance.mjs` expected the old tool count. This would prevent an auditable, self-contained deployment even if the four research MCP registrations compiled.
  - Updated `scripts/Workbridge-Update.ps1` to include `integrations` in source/recovery backup. Updated `package.json` build to stage an explicit 21-file research/RIFT runtime closure into `dist/research-runtime` with SHA-256 manifest through `scripts/stage-research-runtime.mjs`. The source facade now resolves the **sealed** `dist/research-runtime/research` CLI instead of live mutable `integrations`.
  - Added `integrations/rift/src/workspace-path.mjs` and updates to the RIFT replay and patch adapters to find sibling projects correctly from installed sealed code. External RIFT project files are separately hashed inputs; the RIFT client/game is not touched.
  - Release acceptance now permits zero research tools for compatible rollback versions but requires all four correct typed/annotated research tools plus a verified staged closure when they are advertised. Tool-count expectations account for the four additions.
  - Tested **12/12** release-staging/catalog checks, **70/70** RIFT tests, **40/40** coordinator tests, **8/8** mock-owner MCP tests: **130/130 focused PASS**. Strict TypeScript no-emit and isolated compile passed. The fixed 21-file runtime was actually staged into ignored `.tools/m5-research-isolated/dist/research-runtime` and ran one real **four-step archival RIFT workflow**, with independent final bundle verification.
  - No active Workbridge owner, production `dist`, native command host, scheduled service or game state was modified; this is **source and isolated candidate verification only**. Complete WB-001 `New-WorkbridgeRelease` validation/receipt and later service Apply remain distinct outstanding gates.
  - M5 detailed release/operator guide: [sealed runtime and WB-001 acceptance](wb-rift-001-m5-sealed-release-gate-20261120.md). Follow `docs/updates.md` for unique committed-source release ID, manifest/receipt verification, exclusive quiet window, rollback and post-deploy hosted verification. **Do not Apply automatically.**
- **M5 official candidate validation (in progress):** isolated candidates `wb-rift001-m5-20261121-001` (serial suite cancelled before completion) and `...-002` (full parallel 1,384-test gate failed: 1,367 passed, 12 failed, 5 skipped) produced **no valid release receipt**. Eight stale full-suite test files expected 67 MCP tools instead of the now-correct 71; these assertions were fixed. A distinct native retention-proof failure under full parallel load passed standalone **2/2** without altering implementation. Introduced opt-in `-BoundedTests` (all test files, concurrency four) and `test:bounded` to reduce fixture interference while retaining all release gates. These source/test/docs changes require a narrow commit, then a new unique WB-001 candidate with all checks green. **Apply remains HOLD.**
- **M5 official validated release — COMPLETE; Apply HOLD:** Clean source commit `d5701b4bde206c6b6a5e4a4269134ade399c2dbc` produced candidate `wb-rift001-m5-20261121-003` under the opt-in four-worker full test profile. Builder exit 0; full suite **1,379 passed, 0 failed, 5 skipped**, all other release gates exit 0. Independent `Get-WBRelease` verified **7,485 files** and canonical SHA manifest `67F1F4E412EF681EF8DC6DA3942708D7AAB0A9E5ED08CC1B56831C95D1E4544E`. Sealed research closure **21 files** verified (manifest `ac363ec0b540eb212dd4fb84eb67286fa5e8e4fba810a975800d00f34dad4cef`); stdio probe confirmed **71 MCP tools**, including **four research tools**. Running owner still **0.16.5-dev PID 25828**; `hostedVerified=false` and **no Apply**. Detailed handoff: [M5 release gate](wb-rift-001-m5-sealed-release-gate-20261120.md).
- **Next deployment gate (separate):** acquire an exclusive Workbridge-only maintenance window, verify idle admissions/rollback readiness, apply the appropriate immutable candidate using the WB-001 updater only, then confirm hosted ChatGPT's tool catalog. Fresh RIFT telemetry M6 remains a separate live-data workstream.
- **M7 — non-RIFT Star Wrath research adapter, source and offline acceptance:** `Star_Wrath_RE` has a maintained, tested offline Python toolchain, real archived reports and a documented immutable baseline. Registered `starwrath.offline.v1` as a reviewed second profile with seven SHA-pinned saved inputs and three actions: `snapshot-audit → physics-compare → correlate`. The original RIFT profile remains available and its historical completed/recovered evidence packages still pass independent verification.
  - The three steps ran through the same `plan/run/verify` engine against saved Star Wrath `0.10.10.53828(f37cda82a)` files. Baseline plan: `integrations/research/examples/starwrath-historical-20261121.plan.json`, plan SHA `502be3ce5c27b7e55ce388adce49a6ce7128fbc68d150daa402321ee1d5731f7`. Complete local package: `.tools/wb-m7-starwrath-historical-20261121-01`. No game or client-memory interaction.
  - An initial staged `23-file` runtime under ignored `.tools/m7-star-isolated/dist/research-runtime` ran the same three-step Star workflow. The **final post-hardening** sealed copy `.tools/m7-star-final/dist/research-runtime` verified with manifest SHA `16dadd5aacaea3b7a63fc51ba9ad2f352b174ca2814cc56989674622428bd1ee` and executed the three-step Star workflow, independently verifying `.tools/m7-star-final/research-run-01`. Isolated source builds, **not** deployment.
  - A real subprocess exit **73** immediately after the first step left an exact recoverable ledger; `inspect` reported `eligibleForGuardedResume:true` with original owner stopped and all source hashes unchanged. `resume` executed only the **two never-started** steps and independently verified `resumedWithClaimVerified:true`, `completedPrefixReplayed:false` at `.tools/m7-star-isolated/interrupted-run-01`.
  - The archived snapshot and physics report agree on archive/index hashes, but the saved physics report is incomplete and the example deliberately compares identical bytes to themselves. **No new game-build change or server authority was established.**
  - The Star adapter only invokes the existing, pinned `compare_physics_runs.py` in the reviewed repository. Negative tests cover invalid/symlinked paths, wrong host, changed source Python between steps, mismatched comparator metadata and tampered saved evidence. Star-focused hardened suite **16/16 PASS**; final coordinator **56/56**, RIFT **70/70**, Workbridge facade/release stage **22/22 passing with one optional PowerShell-path skip**: **148 passed, 0 failed, 1 skipped**. TypeScript no-emit, Prettier and Git diff checks passed.
  - Release `wb-rift001-m5-20261121-003` remains **sealed, validated and unapplied** with the older 21-file closure; it does **not** include the new M7 modules. The WB-001 default/serial/bounded test scripts now include both integration test suites for a **future new candidate**.
  - [Detailed M7 source/evidence contract](wb-rift-001-m7-starwrath-20261121.md).
- **M8 — repeatable saved-evidence benchmark and portable CI source implemented:** Added `integrations/research/bench/verify-benchmark.mjs`, with a no-mutation/full-verifier loop, bounded archive inventory, monotonic durations and explicit non-SLA limits, plus seven synthetic negative/utility tests. Measured the real Star Wrath three-step and RIFT recovered four-step packages with **one warm-up + seven verified samples each**: median **4.298 ms** (7 files, 11,042 bytes) and **10.766 ms** (25 files, 152,318 bytes) respectively. Different package contents prevent a direct performance ranking.
  - Existing `.github/workflows/build-test.yml` now triggers for `integrations/**` changes and separates the complete original Workbridge root suite from portable synthetic two-provider coordinator tests. It verifies the sealed research closure after a disposable Windows/Node 24 build. Full host-dependent RIFT companion tests remain in the unchanged comprehensive `npm test`/`test:bounded` release gates, not treated as available on a clean hosted runner.
  - `test/research-ci-contract.test.mjs` (two checks) asserts the workflow does not accidentally omit integration trigger paths or research tests. M8 benchmark tests **7/7 PASS**, final coordinator suite **63/63 PASS**, RIFT suite **70/70 PASS**, Workbridge facade/CI/release subset **24/24 PASS + 1 optional skipped**: **157 passing, 0 failing, 1 skipped**. TypeScript no-emit, Prettier, Git whitespace checks all passed.
  - A real hosted GitHub Actions run **has not occurred**; do not claim CI green until an authorized push triggers the workflow. The active Workbridge service and historical M5 validated candidate remain unchanged and unapplied. [Detailed benchmark/CI evidence](wb-rift-001-m8-benchmark-ci-20261121.md).
- **Next:** exact-file local commit, then either a new sealed WB-001 release from the updated source (still no Apply) or an independently pinned current-build research acquisition. Existing validated `wb-rift001-m5-20261121-003` does not contain M7/M8.
