# GitHub Windows CI: 8.3 temporary-directory alias recovery

**Date:** November 21, 2026 (EST)
**Host:** AMD-DESKTOP; source-only CI configuration change
**Scope:** GitHub Actions Windows/Node 24 fixture paths; no active Workbridge service deployment.

## Evidence from the previous hosted run

- Run [44561460823](https://github.com/360madden/workbridge-mcp/actions/runs/44561460823), November 19, reported 1,131 passed, 232 failed, 1 cancelled and 1 skipped in the original core suite.
- One representative failure compared an actual canonical path under `C:\Users\runneradmin\AppData\Local\Temp` to a fixture path under `C:\Users\RUNNER~1\AppData\Local\Temp`. Other failures returned `OUTSIDE_ROOT` for test fixtures, consistent with the same alias mismatch.
- `Workspace.create()` uses filesystem `realpath()` for configured roots, but tests construct inputs from `os.tmpdir()`. A short-path alias for the temporary root can therefore make a fixture's absolute path differ from the canonical Workbridge root.
- These logs establish a real reproducibility problem on the hosted runner, not proof that every failing test shares this cause.

## Narrow fix

- An initial job-level `${{ runner.temp }}` reference was rejected at workflow validation; the run [44909817387](https://github.com/360madden/workbridge-mcp/actions/runs/44909817387) created no jobs.
- A first-step PowerShell action now writes `TMPDIR`, `TMP`, and `TEMP` from `RUNNER_TEMP` into GitHub's supported `GITHUB_ENV` file. Subsequent steps inherit that fixture root without expanding Workbridge permissions.
- Add a preflight that compares `os.tmpdir()` with `fs.realpathSync.native()` before launching any core tests. A mismatch fails the job immediately and names `CI_TEMP_ALIAS_MISMATCH`.
- Keep the complete original `node --test test/*.test.mjs` invocation; no tests are skipped, disabled, renamed, or weakened.
- Keep Workbridge's protected-root and symlink/junction checks unchanged. The correction is to the hosted fixture environment, not an expansion of production permissions.
- Pin the CI job's environment contract with `test/research-ci-contract.test.mjs`.

## Validation and next gate

- Local `node --test test/research-ci-contract.test.mjs`: 2 passed, 0 failed.
- Local strict TypeScript `tsc --noEmit`, Prettier check of both changed files, and `git diff --check`: exit code 0.
- The previous November 21 CI run [44909270411](https://github.com/360madden/workbridge-mcp/actions/runs/44909270411) was still processing the core suite while the local correction was prepared. It does not include this correction.
- **Unverified until a new hosted run completes:** that `RUNNER_TEMP` resolves to a canonical path in the runner, and that the entire original core suite passes without unrelated failures.
- Even green GitHub CI does not replace the separate full-host, sealed WB-001 candidate acceptance or authorize an automatic live-service restart.

## Release candidate test-closure correction

- The isolated, committed-source candidate `wb-rift001-sat-20261121-006` passed install and desktop prebuild/prestage but failed its full test gate: **1,546 passed, 1 failed, 5 skipped, 1,552 total**. No validation receipt was written; no runtime activation occurred.
- The sole failure was the CI-contract test's `ENOENT` reading `payload/.github/workflows/build-test.yml`. The WB-001 source-copy allowlist omitted `.github`; this is a **release payload completeness defect**, independent of the hosted 8.3 path alias.
- Add `.github` to `WBSourceNames` in `scripts/Workbridge-Update.ps1`. The official release builder already uses that list to copy isolated test source, while `WBRuntimeNames` excludes `.github`, so activation copies no workflow file into the live runtime.
- Add a release-source-closure regression in `test/research-ci-contract.test.mjs`; the updated focused suite passes **3/3** locally. Rebuild and independently verify a **fresh** candidate from the eventual new committed HEAD rather than reviving failed `...-006`.

## Hosted CI failure after canonical-temp preflight

- The actual GitHub Actions run [44910852099](https://github.com/360madden/workbridge-mcp/actions/runs/44910852099) passed the temp canonicalization preflight but ended at **1,354 passed / 35 failed / 1 skipped** (1,390 original core tests). Research synthetic and sealed-runtime verification steps did not run because the core job failed.
- Four desktop-admission tests failed with `ERR_MODULE_NOT_FOUND` for `dist/desktop-turn-admission.mjs`. A clean checkout's `npm run build` stages the research runtime but does not stage the six-file desktop helper closure. The official WB-001 isolated release process stages both closures, and passed 1,548 tests / zero failures / five skips from the exact source commit.
- The hosted suite also reported failing native Git baseline and job archive fixtures, one 36-client concurrency failure, and a retention metadata timeout. Their direct cause is **not yet established**; they are separate from the missing desktop import. Hosted Node's default unbounded file scheduler differs from the official WB-001 `--test-concurrency=4` acceptance and could amplify contention.
- Correct the disposable GitHub workflow to run the existing `scripts/stage-desktop-runtime.mjs` after the regular build, then the **entire unchanged core file set** using `node --test --test-concurrency=4 test/*.test.mjs`. Do **not** stage into an active Workbridge installation and do not weaken Git, archive, or GUI admission checks.
- Run a focused serial preflight covering the same native Git baseline and archive suites that failed on the hosted worker, before the full core suite; this distinguishes a native host prerequisite from file-scheduler contention without skipping the original tests.
- Add a CI-contract regression for desktop closure, the native smoke gate, and bounded full-suite scheduling. Require a new hosted GitHub job to pass independently; remaining failures, if any, must be triaged by exact test/log rather than assumed to be scheduling noise.

## Split core-test verification (November 21, 11:33 AM EST)

- Latest hosted run [44920526481](https://github.com/360madden/workbridge-mcp/actions/runs/44920526481), SHA `96ae691`, passed **1,388 of 1,392** core tests, with three failures and one skip. The separate native Git/archive preflight passed **38/38**. Failures were the active configuration-lock check (`undefinedundefined` from the external process rather than the expected denial text), one failed client among 36 simultaneous MCP CLI clients, and an independent storage-retention `METADATA_TIMEOUT`. This suggests resource-contention interactions but does not prove a single root cause.
- A prior untracked partition draft was inspected and preserved without modification. The newly authored, formatted `scripts/ci-core-test-runner.mjs` provides a bounded deterministic test-file inventory, three explicitly isolated stress suites, and disjoint file-level coverage with no reruns after uncertain failures. All file names are passed as literal arguments, never through a shell.
- The GitHub Windows workflow now uses **two independent runner jobs** in a matrix (`parallel`, `isolated`) with `fail-fast: false`. Each job builds and stages its own desktop closure. Native Git/archive preflight runs only in the isolated job, while portable research fixtures and sealed research closure run once in the parallel job. Both jobs must pass for GitHub CI to succeed.
- New `test/ci-core-test-partition.test.mjs` covers exact partition equality, absent mandatory stress suites, nonregular test entries, invalid CLI modes, real subprocess exit-code propagation, and recursive test-context refusal. The source inventory counted **125** core test files, divided **122 parallel + 3 isolated** after adding the new test.
- A synthetic Windows Node 26.5.0 reproduction found that spawning `node --test` with inherited `NODE_TEST_CONTEXT=child-v8` can return **exit 0 without executing any selected tests**, while the same failing fixture without that marker returns **exit 1**. The new CI runner rejects recursive test context; its test harness removes the marker before checking actual spawned test counts and intentional failures. **9/9 focused tests passed**, preventing a false-green coverage claim.
- The isolated three-suite local test without a fresh build passed **18/19**; its sole failure was CS0016 when its self-build fixture attempted to overwrite `dist/command-host.exe` in the live checkout, which is owned by the active Workbridge process. This local direct-test invocation lacked the required fresh isolated build and is **not** evidence of a failed release gate. The workflow stages desktop helpers and builds before testing on disposable runners. The running installed service and its loaded executable were preserved.
- A new hosted run and full WB-001 sealed release from the eventual new commit remain mandatory before any deployment. No existing active owner was restarted or replaced.

## Metadata cold-start qualification (November 21, 11:50 AM EST)

- Hosted CI run [44925653210](https://github.com/360madden/workbridge-mcp/actions/runs/44925653210) at commit `faad075` gave a decisive split: the entire **isolated stress suite passed**, including the native Git/archive preflight. The **parallel shard failed only one** retention reference test (`known node executable references protect internal copy aliases without traversal`), reporting `METADATA_TIMEOUT`; 1,376/1,378 tests passed with one skipped. Portable research and closure steps did not run after this failure.
- The clean local WB-001 candidate `wb-rift001-sat-20261121-010` was built from an exact HEAD-pinned local clone excluding the preserved untracked draft. It failed its test gate in a **different** native retention purge recovery case and received no validation receipt. Running that exact recovery case separately subsequently passed 1/1; root cause of its intermittent failure is not independently established.
- Review identified a concrete timing mismatch: `windowsMetadata()` spawned Windows PowerShell and immediately began its **2,000 ms metadata response timeout** on the first path, even though the shell might still be initializing under hosted-runner load. This could produce a false `METADATA_TIMEOUT` before the helper was ready; the timing is a supported hypothesis for the hosted failure, not proof of its exact event ordering.
- The fixed PowerShell helper emits a single literal `READY` signal before processing paths. The JS client waits for that exact token under a **separate bounded 10,000 ms startup deadline**, then retains the **original 2,000 ms per-file reply limit**. Missing, malformed or late startup, bad replies and reparse points remain fail-closed; there is no automatic retry of an uncertain metadata read.
- Added `test/storage-metadata-readiness.test.mjs` with deterministic delayed-ready, timeout, malformed-ready, reparse and real-Windows worker checks. The focused metadata/inventory/reference/controller suites passed **36/36**, with TypeScript and formatting checks also passing. The same changes require fresh GitHub CI and a new complete WB-001 release from their final committed HEAD.

## Follow-up

After pushing this change, inspect the new GitHub Actions job's canonical temp preflight, core test summary, synthetic research tests, and sealed runtime closure. If any remain red, capture the exact failing test/error and investigate independently.
