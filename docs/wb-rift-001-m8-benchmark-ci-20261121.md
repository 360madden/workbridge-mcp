# WB-RIFT-001 M8 — Offline Research Benchmark and CI Checkpoint

**Date:** November 21, 2026 (EST)  
**Windows host:** AMD-DESKTOP, confirmed with native hostname preflight  
**State:** Source-only. Active Workbridge 0.16.5-dev owner and the previously validated M5 release are unchanged.

## Objective

Give developers an **honest, repeatable measurement** of the common Workbridge research-package verifier, without comparing different games' frame rates or mistaking archived data for live telemetry. Also make GitHub CI run synthetic research integration tests when an adapter changes.

The benchmark and GitHub Actions workflow do not start either MMO, connect to a server, use a debugger, sample live process memory, or write to installed game paths.

## One read-only command

From `C:\work\workbridge-mcp` in PowerShell 7, enter:

```powershell
npm run bench:research -- --bundle 'C:\work\workbridge-mcp\.tools\m7-star-final\research-run-01' --bundle 'C:\work\workbridge-mcp\.tools\wb-rift001-m3-recovery-20261120-01' --repeats 7
```

The script `integrations/research/bench/verify-benchmark.mjs` accepts one to four existing saved package directories and 2–30 measured verification repetitions. One independent warm-up verification precedes each package's repetitions. It prints bounded JSON to **stdout** and does not save or modify evidence or run any research action.

Each measured iteration calls the **real** `verifyResearchRun`: it checks the plan, ledger, SHA-256 inventory, completed step claims, and any nested RIFT evidence or recovery claim. The benchmark also enumerates all nested evidence files and their logical stored byte sizes using bounded no-link directory traversal, before and after the samples. It refuses invalid/changed/unverified packages. The timing clock is monotonic (`process.hrtime.bigint()`).

## Observed baseline on AMD-DESKTOP

| Saved research package                        | Evidence files | Stored bytes | Verification samples |      Min |        Median |       p90 |       Max |
| --------------------------------------------- | -------------: | -----------: | -------------------: | -------: | ------------: | --------: | --------: |
| Star Wrath historical, three completed steps  |              7 |       11,042 |                    7 | 3.632 ms |  **4.298 ms** |  5.422 ms |  5.422 ms |
| RIFT archived/recovered, four completed steps |             25 |      152,318 |                    7 | 9.402 ms | **10.766 ms** | 11.617 ms | 11.617 ms |

Actual observed sample sets (milliseconds):

- Star Wrath: `4.298, 4.160, 5.422, 3.923, 4.470, 4.355, 3.632`. Mean `4.323 ms`.
- RIFT: `11.617, 10.766, 9.877, 11.038, 11.320, 9.402, 10.741`. Mean `10.680 ms`.

These numbers are **specific to this host, sample set, cache state and artifact sizes**. The RIFT package contains nested child verifiers and a recovery claim; its work is not directly comparable with the three-step Star Wrath package. They are **not** a latency SLA, test-speed gate, performance regression verdict, or proof of current game-state freshness. A future measurement must use the same named package and process environment to be comparable. The package-byte counts are stored file sizes, not amount of data read by the verifier.

## Tests

The synthetic benchmark test suite `integrations/research/test/benchmark.test.mjs` covers duration ordering, bounded recursive inventory, exact warm-up/sample call counts, safe argument limits, unqualified verifier rejection, changed step identity, and changed evidence inventory. Unit tests use deterministic fake monotonic clocks and disposable files; the measured numbers above instead use the real saved RIFT/Star Wrath evidence packages and default verifier.

## GitHub Actions scope

Existing `.github/workflows/build-test.yml` now listens for `integrations/**` paths in addition to its original Workbridge source/tests/scripts/package paths. The **Windows/Node 24** job uses the already-existing versioned checkout/setup-node actions and runs:

1. `npm ci` and `npm run build` in a disposable GitHub runner checkout.
2. The complete original **Workbridge core** `node --test test/*.test.mjs`.
3. The portable `node --test integrations/research/test/*.test.mjs`, covering both providers' **synthetic** fixtures and the benchmark tests.
4. The sealed `dist/research-runtime` manifest verification using `node scripts/stage-research-runtime.mjs --verify --repo-root .`.

**The full physical-host RIFT companion suite is deliberately separate:** some RIFT tests use sibling Python RRE/RPT tools and `C:\work` archives not supplied by a clean GitHub checkout. The pre-existing `npm test`/`test:bounded`/`test:serial` scripts **remain comprehensive**, running original root tests plus both integration test directories for official WB-001 sealed release validation on the verified development host. The hosted workflow uses a clearly documented **portable subset** rather than silently treating external project assets as present in CI.

`test/research-ci-contract.test.mjs` enforces that the workflow retains its pinned Windows runner/Node version, research path filter, synthetic tests, and sealed runtime verification. Local unit tests and a valid YAML source cannot prove the remote GitHub Action actually passed until the workflow runs on GitHub; no remote push is part of this milestone.

## Final local validation checkpoint

- The benchmark's **7/7** synthetic tests passed, including measurement-count, inventory-change and verifier-rejection cases.
- The complete coordinator suite passed **63/63**; existing RIFT companion suite passed **70/70**; selected Workbridge facade, release-profile, staging and CI-contract suite passed **24/24** with one optional PowerShell standard-path test skipped. **Total: 157 passed, zero failed, one skipped**.
- Strict TypeScript `tsc --noEmit`, Prettier source/doc checks, and `git diff --check` completed successfully on AMD-DESKTOP.
- Both real saved-package benchmark commands exited 0 and verified every sample. No benchmark data was written into game repositories.
- Source and test verification is **not** proof that the GitHub hosted workflow has run or the installed Workbridge service has changed.

## Boundaries and deployment

The validated M5 candidate `wb-rift001-m5-20261121-003` remains immutable, sealed and **unapplied**, and does not include M7 or M8 source. M8 is a **new source-only milestone**. An actual live Workbridge upgrade requires a new clean WB-001 candidate from the committed M8 checkout, complete release gates, an exclusive idle/rollback window, and independent hosted ChatGPT tool discovery.

## Next

- Commit only the exact benchmark, CI workflow, tests and documentation set with SHA guards, then verify the local working tree is clean.
- CI status is not known until GitHub runs the workflow after a future authorized push.
- For the next practical research step, capture a fresh, pinned build and evidence package for RIFT or Star Wrath, keeping historical comparisons separate from live behavior.

[Master roadmap](wb-rift-001-unified-research-coordinator-roadmap-20261120.md) · [Star Wrath M7](wb-rift-001-m7-starwrath-20261121.md) · [M5 validated candidate](wb-rift-001-m5-sealed-release-gate-20261120.md)

## Hosted CI portability correction — November 21, 2026

The real GitHub Windows/Node 24 run [44919036056](https://github.com/360madden/workbridge-mcp/actions/runs/44919036056) passed the complete **core** suite (1,390 passed, zero failures, one skip), but exposed one unintended host dependency in the purportedly portable research suite: 62 research tests passed and one real RIFT doctor test failed because the clean checkout did not contain sibling `Rift-Personal-Teleporter/src/teleport_analyzer.py`.

This was a **test ownership/placement defect**, not an excuse to disable or mock away the real RIFT integration. The original real-doctor case was relocated from `integrations/research/test/run.test.mjs` into `integrations/rift/test/research-doctor.test.mjs`, retaining the same synthetic PE witness, real `rift.doctor` adapter, SHA-256 assertion, read-only result and offline verification. It remains included in all full WB-001 `npm test`, `test:bounded`, and `test:serial` routes that run on AMD-DESKTOP with existing sibling projects. The hosted `integrations/research/test/*.test.mjs` glob no longer needs that external project.

Focused AMD validation after relocation: **62/62 portable research tests**, **1/1 real RIFT doctor host test**, and **4/4 CI-contract tests**. The CI contract now explicitly checks that the real test is not in the portable glob and is still present in the full host suite. No implementation, addon, game client, or running Workbridge service was modified by this test reorganization.

A new GitHub Actions run must independently verify the updated portable suite and sealed closure; this local correction is not a remote CI pass.
