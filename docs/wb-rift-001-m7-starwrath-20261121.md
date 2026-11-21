# WB-RIFT-001 M7 — Second Research Project: Star Wrath

**Date:** 2026-11-21 (EST)  
**Verified machine:** AMD-DESKTOP, via actual `hostname.exe` exit 0 before inspecting the repository.  
**Scope:** Offline archived **Star_Wrath_RE** work using the same Workbridge planner, runner, SHA evidence verifier and M3 recovery engine as RIFT. No production Workbridge update, installed game interaction or change to the sibling Star Wrath repository.

## Choice and goal

`C:\work\Star_Wrath_RE` is an existing local Git repository with tested Python 3.14 scanners, dated saved static reports and a documented PE/physics research workflow. `wotb_reader` has no equivalent current source/test/report surface. Star Wrath is thus a real **non-RIFT** consumer, not a second adapter built on RIFT files.

The M7 acceptance target is concrete: a reviewed second profile must pass the original research-plan DAG validator, execute known existing offline helpers, create a bounded, complete evidence package, pass independent `verify`, reject changed sources, and support interrupted-run `inspect`/`resume` without replay of previously committed actions.

## Built-in profile

Profile `starwrath.offline.v1` has exactly seven pinned input roles and three fixed actions.

| Input role                       | Source                                                               | Pinned evidence                                                    |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `snapshot`                       | `Star_Wrath_RE/reports/snapshots/star-wrath-0.10.10-2026-11-19.json` | `6bfc70e2a9a42ce6e48bc07ce05da668ba692fb7f409bd238384cf18488cd45f` |
| `physicsBefore` / `physicsAfter` | `Star_Wrath_RE/reports/physics-0.10.10-2026-11-19.json`              | `0c6398b5a8075d05976057882e548f52f05db830574d61ae63677f67966cc557` |
| `comparator`                     | `Star_Wrath_RE/tools/compare_physics_runs.py`                        | `fa65a376e7689f0aa64146a8e075edac14b1b01e2b27846fc066236a8df022ae` |
| `physicsInspector`               | `Star_Wrath_RE/tools/inspect_physics_params.py`                      | `8e145268032ac2ec48b2da860bb67b42c9e5640f548750ab30fe9246cfe8557e` |
| `indexInspector`                 | `Star_Wrath_RE/tools/inspect_tgp2_index.py`                          | `d4d0d12a19af0a8165d0b891844c1ed1bebfffd18c3d850fa8c5edf3cff5b31c` |
| `gamedataInspector`              | `Star_Wrath_RE/tools/inspect_gamedata.py`                            | `ca7fcfa68f5c2774f60a47d5dcc19db305ac808aee058ee67526bd6bdac3746d` |

The Python scripts are **existing Star_Wrath_RE source**, not new Workbridge replicas. All roles are SHA-pinned; the comparator can execute only at the fixed project `tools/` path. The input parser enforces canonical local Windows paths and an exact AMD-DESKTOP hostname. Parent directories must not be symlinks/junctions, and file identity plus bytes are checked while reading. Imported script SHA values are **rechecked immediately before invocation**. Plan and source snapshots are checked again before final publication.

| Step                                    | Needs                    | Result                                                                                                   |
| --------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `identify` → `starwrath.snapshot-audit` | None                     | Validated saved metadata, EXE version/hash, gamedata hashes, static-only confidence                      |
| `compare` → `starwrath.physics-compare` | `identify`               | Existing Python `compare_physics_runs.py --allow-incomplete`; controlled count/hash changes and coverage |
| `correlate` → `starwrath.correlate`     | `identify` and `compare` | Cross-source archive/index fingerprint agreement or explicit mismatch; no current-runtime inference      |

`--allow-incomplete` is deliberately explicit because the historical physics report recorded XML parse/skip gaps. The output must preserve `incomplete:true` and `exhaustive:false`; a non-exhaustive self-check does **not** prove values in all XML assets match or that a server accepts client-generated state.

## What the real offline execution proved

**Plan:** `integrations/research/examples/starwrath-historical-20261121.plan.json`. The plan file was validated and ordered `identify → compare → correlate` by the normal CLI (plan SHA-256 `502be3ce5c27b7e55ce388adce49a6ce7128fbc68d150daa402321ee1d5731f7`).

**Original saved-report run:** `C:\work\workbridge-mcp\.tools\wb-m7-starwrath-historical-20261121-01` — executed all three steps, then independently verified with `sourceSnapshotBound:true`.

**Sealed runtime smoke:** staged the new **23-file** Workbridge closure at `.tools/m7-star-isolated/dist/research-runtime` (initial SHA-256 manifest `12715a30fa49dfeaf9ec100378206a39dbd9c6da287934558f131c6a1a3d3b86`). The staged CLI also ran all three steps and verified its complete evidence package under `.tools/m7-star-isolated/sealed-run-01`.

### Actual historical findings (not new game discoveries)

| Checked field                            | Saved-source result                                                | Meaning                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Client product version                   | `0.10.10.53828(f37cda82a)`                                         | Saved file version label, not a fresh client probe                                      |
| EXE SHA-256                              | `0eb0d58b716b78b9e8f858e77dda0454f66f2161a7c8087fefa83daccc5b59e5` | Historical snapshot digest; no EXE read this session                                    |
| Archive SHA-256                          | `f066fb5f41a9a4a17fb0981d45801580e27952187c0c057c8717e60515c490d9` | Same in snapshot and physics report                                                     |
| Index SHA-256                            | `5814c0ad4398929856d3af62d86fc4cb1f7281b85ac750c768030f3bc5631f32` | Same in snapshot and physics report                                                     |
| Bounded XML count (snapshot)             | **908**                                                            | Separate static metadata scan scope                                                     |
| Parsed XML documents (physics inspector) | **874**, marked incomplete                                         | Different sampled scope; do not equate the counts                                       |
| Python comparator                        | All measured report differences **0**                              | Deliberate **same saved file on both sides**, not a new-build comparison                |
| Client/server authority                  | **Not verified**                                                   | Static source cannot establish active enforcement, physics trust or damage adjudication |

### Real crash/recovery acceptance on the second profile

A separate Node process invoked the normal `runResearch` with a test-only hook to exit **73** immediately after `identify` had committed. The remaining steps had not started. The next process invoked `inspect` and verified the original attempt ID, unchanged source hashes, stopped owner, one completed result receipt and `eligibleForGuardedResume:true`.

It then ran `resume` with the exact original UUID and ledger SHA. The recovered bundle at `C:\work\workbridge-mcp\.tools\m7-star-isolated\interrupted-run-01` reports:

- **1** completed prior step retained, **2** never-started steps executed under a distinct recovery attempt.
- `completedStepsReexecuted:false` and independent verification `resumedWithClaimVerified:true`, `completedPrefixReplayed:false`.
- No live RIFT/Star Wrath process, VM, network capture, game input, debugger, Ghidra session or native memory read/write.

## Tests and release integration

`integrations/research/test/starwrath.test.mjs` adds controlled synthetic scenarios for plan contracts, exact input/code hashes, wrong host, invalid/redirected paths, changed Python code **before and between steps**, semantic cross-source disagreement, incomplete/complete scope labeling, tampered comparator output and evidence verification.

Generic `run`, `verify`, `readRecoveryCheckpoint`, `resume` and the existing CLI now resolve **only** a known built-in provider by profile. The existing generic test-dependency injection still works without turning the plan JSON into a programmable script launcher.

The repository's `package.json` test commands now include the full `integrations/research/test/*.test.mjs` and `integrations/rift/test/*.test.mjs` suites in the default, serial and four-worker WB-001 release profiles. A future release will therefore test both real adapters automatically. The sealed-runtime manifest allowlist includes both new modules (`providers.mjs` and `adapters/starwrath.mjs`), expanding the source closure from 21 to **23 files**.

**This is new source after the previously validated M5 candidate.** Release `wb-rift001-m5-20261121-003` remains sealed, validated and **unapplied**, but does **not** include M7. Any M7 production deployment needs a **new unique WB-001 release candidate with full green gates and separate exclusive Apply authorization**. Source changes and ignored test runs are not production deployment.

### Final independent M7 gate — PASS

- **56/56** coordinator and Star Wrath tests, including **16/16** Star-specific synthetic/negative tests.
- **70/70** existing RIFT tests, confirming continued operation of the original RIFT provider.
- **22/22** Workbridge facade, release staging and profile tests passed, with **one optional PowerShell 7 standard-path test skipped** (Store-installed PowerShell is available under WindowsApps).
- **148 tests passed, 0 failed, 1 skipped** across these focused suites. Strict TypeScript `--noEmit`, Prettier and `git diff --check` exited 0.
- The final post-hardening **23-file** isolated stage at `.tools/m7-star-final/dist/research-runtime` verified with manifest SHA-256 `16dadd5aacaea3b7a63fc51ba9ad2f352b174ca2814cc56989674622428bd1ee`. Its packaged CLI executed the actual historical Star Wrath 3-step workflow in `.tools/m7-star-final/research-run-01`; a separate invocation of the packaged verifier returned `verified:true`, `sourceSnapshotBound:true`, `gameContacted:false`.
- `Star_Wrath_RE` remained Git-clean (`## main`). No real game/client access or installed Workbridge service update occurred.

## Usage (PowerShell on AMD-DESKTOP)

```powershell
cd 'C:\work\workbridge-mcp\integrations\research'
node .\src\cli.mjs plan --plan .\examples\starwrath-historical-20261121.plan.json
node .\src\cli.mjs run --plan .\examples\starwrath-historical-20261121.plan.json --out 'C:\work\workbridge-mcp\.tools\starwrath-NEW_UNIQUE_RUN'
node .\src\cli.mjs verify --bundle 'C:\work\workbridge-mcp\.tools\starwrath-NEW_UNIQUE_RUN'

# Focused regression, no game/client access:
node --test test\*.test.mjs
```

Never reuse a prior run directory. To use two actual game versions, first produce two validated, independently sourced saved physics reports and adjust both path/SHA pins. Do not interpret the archived reference's self-check as evidence that an update changed nothing.

## Next gates

1. Commit the exact M7 source/docs/test set with SHA guards and verify clean `main`.
2. M8 benchmark/CI polish, or prepare a **new** sealed WB-001 candidate from the committed M7 code; no automatic Apply.
3. Separately, M6 can investigate fresh physical RIFT identity and live telemetry; historical RIFT/Star Wrath source must not be promoted to current-session evidence.

[Master coordination roadmap](wb-rift-001-unified-research-coordinator-roadmap-20261120.md) · [M5 validated release checkpoint](wb-rift-001-m5-sealed-release-gate-20261120.md)
