# Windows-native fixture diagnostic (November 21, 2026)

This probe targets a discrepancy between AMD-DESKTOP's passing local Workbridge tests
and the public GitHub Windows/Node 24 runner. It is **diagnostic only**. The
preexisting Build and Test workflow remains the actual CI release gate.

## Recorded starting point

- Workbridge `main` at `6109850` was clean and synchronized.
- GitHub Actions run `44912490799`: the serial Git/archive preflight produced
  **10 passed, 27 failed**. The subsequent complete core suite produced
  **1,358 passed, 30 failed, 1 cancelled, 1 skipped**.
- Git-baseline tests reported generic `AUDIT_FAILED` and archive fixtures
  reported `PRIVATE_DIRECTORY_HELPER_FAILED` or `JOB_ARCHIVE_CONFLICT`.
  The underlying native error types were not visible in those logs.
- The earlier WB-001 candidate `wb-rift001-sat-20261121-007`, based on
  committed `9313e25`, had independently passed **1,548 tests, 0 failures,
  5 skips**, with 7,509 payload files. It was not deployed.

## First independent hosted result

GitHub diagnostic run [44917406367](https://github.com/360madden/workbridge-mcp/actions/runs/44917406367) reproduced both differences in eight seconds on **Node 24.22.3 / Windows 2025**:

- Git audit: **0 of 8 passed**; sanitized `AUDIT_DIAG_CommandNotFoundException_L169`. In the pinned source, line 169 invokes `Get-FileHash` from Windows PowerShell's built-in utility module. The explicit module import used elsewhere in Workbridge is a narrow correction to test.
- Private archive helper: `READY` observed, zero `VERIFIED` replies, exit 1, `PRIVATE_DIRECTORY_DIAG_RuntimeException_L53`. In the pinned source, line 53 checks that the new directory owner equals the current user's SID. The code remains unchanged until the actual failure category is independently confirmed.
- AMD-DESKTOP under Node 26.5.0: **8/8** audit passes and **2/2** archive VERIFY replies, clean exit.

The second diagnostic run [44917842813](https://github.com/360madden/workbridge-mcp/actions/runs/44917842813) verified that the explicit built-in PowerShell module import fixes the Git audit: **9/9 tests passed** on Node 24. The archive helper yielded `PRIVATE_OWNER_INVALID` on the default `D:` runner temp even after a separate temporary-only `SetOwner` attempt; no production archive check was changed.

A third diagnostic run [44918138202](https://github.com/360madden/workbridge-mcp/actions/runs/44918138202) showed the same `PRIVATE_OWNER_INVALID` on the profile's canonical `LOCALAPPDATA\\Temp` volume, as on the default `D:` volume. The original problem is therefore not limited to the default temporary volume.

A fourth temporary-only variant separately compares the current user's SID with Windows' token default-owner SID: it retains the strictly limited **current user + SYSTEM** DACL but creates and verifies the directory with the token-owner identity. This is still just a disposable test of an OS ownership hypothesis; it neither changes production code nor makes a GitHub workflow's green diagnostic outcome into a release acceptance receipt.

## Running

On **AMD-DESKTOP**, after verifying `hostname.exe` and from
`C:\work\workbridge-mcp` in PowerShell:

```powershell
node .\investigations\ci-native-runner\native-probe.mjs
```

On GitHub, manually dispatch
`.github/workflows/native-diagnostics.yml` with the workflow picker.
It is deliberately `workflow_dispatch` only, with read-only repository
permission, pinned Node 24, canonical `RUNNER_TEMP`, and no live Workbridge
service or RIFT access.

## Boundaries

The probe copies `Audit-WorkbridgeGit.ps1`,
`plan-scoped-git-checkpoints.mjs`, and its existing synthetic test into a
newly created temporary folder. Only the **temporary** audit script's generic
catch is instrumented to yield `AUDIT_DIAG_<type>_L<line>`; production audit
code and the normal error contract are not altered.

A second temporary copy of `Job-Archive-Private.ps1` exercises creation of
a private disposable directory, two synthetic files, the `READY`/`VERIFIED`
protocol, and clean EOF. It reports only bounded result fields and sanitized
`PRIVATE_DIRECTORY_DIAG_<type>_L<line>` markers. Raw exception messages,
user paths, credentials, and contents are not published. The owned temporary
folder is cleaned up at the end of the run.

A diagnostic workflow may finish successfully while reporting individual
probe failures: its exit status is **not** an acceptance receipt. A passing
probe cannot substitute for the unchanged full core suite, research provider
tests, or WB-001 sealed-release validation.

## Outcome gate

Compare the exact JSON summary from the AMD and GitHub runs. Use the reported
source line and error type to identify the first divergent native operation.
Change production code only when an independently reproduced cause is
understood; add focused regression tests, commit narrowly, and rerun the
complete hosted CI. Delete the temporary diagnostic workflow later if it no
longer provides useful independent evidence.
