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

## Follow-up

After pushing this change, inspect the new GitHub Actions job's canonical temp preflight, core test summary, synthetic research tests, and sealed runtime closure. If any remain red, capture the exact failing test/error and investigate independently.
