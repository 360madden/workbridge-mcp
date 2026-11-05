# M3-P8 restricted Windows environment: independent peer review

**Date:** 2026-11-05  
**Reviewer lane:** independent source-only critical path (FlaUI / alternative provider)  
**Verdict:** **GO for exactly ONE isolated, bounded synthetic-only MCP environment-presence oracle run.** **HOLD for Sbroenne vendor, live UIA, desktop input, screenshots, VM control, production Workbridge integration, or broad deployment.** No runtime was executed by this reviewer.

## Exact reviewed sources

| Component | Investigation path (under `workbridge-mcp/`) | SHA-256 |
| --- | --- | --- |
| Native synthetic host | `investigations/windows-desktop-automation/prototypes/Sbroenne-EnvOracle-Host-V31.cs` | `cd575cd24918252cf02635b5fecae2fcb69dd556070ea812da44164b3679a26e` |
| Win32 suspended Node + custom Unicode environment | `investigations/windows-desktop-automation/prototypes/Sbroenne-SuspendedEnvNode-V31.cs` | `24ad770224d91c33e75f8abf7c152cb75e263d255447c87e971fd3349adaa0ca` |
| Synthetic MCP client runner | `investigations/windows-desktop-automation/prototypes/sbroenne-v31-env-oracle-runner.mjs` | `3601b097057bd47d17e9e00226248cb47a8ea471fbe9b697779219831fb7713f` |
| Synthetic MCP server/oracle | `investigations/windows-desktop-automation/prototypes/sbroenne-v31-env-oracle-stub.mjs` | `d6f007e97a456fa2e5676998f9545c1a499e2704060a15bfc2f15da089b35fea` |
| Prior private Win32 Job helper | `investigations/windows-desktop-automation/prototypes/Sbroenne-PrivateJob-V2.cs` | `55a3571647fcb525c605d7f922e63885809ec01dffd9f3a88f00f882ff6f9b30` |
| Installed MCP SDK stdio transport | `node_modules/@modelcontextprotocol/client/dist/stdio.mjs` | `af887c8972a37b8c3fcc78192d8f1d56c099bf8ca365f4843ec51ced6f5650da` |

The author reported **build-only** C# compiler and Node syntax-check exit 0; this reviewer independently read source and did **not** compile or execute the prospective synthetic binary.

## Gate-by-gate static findings

1. **Explicit environment, no ambient pass-through — PASS (source).** `RestrictedEnvironment` lines 103–136 constructs a literal ordered block of **seven** key/value pairs only: `DOTNET_BUNDLE_EXTRACT_BASE_DIR`, `MCP_WINDOWS_TIMEOUT_MS`, `PATH` (explicit Windows + pinned Node directories), `SYSTEMROOT`, `TEMP`, `TMP`, `WINDIR`. Case-insensitive strict ordering, duplicate rejection, no NUL/CR/LF values, two terminal NULs, bounded UTF-16 buffer. `CreateProcessW` lines 188–193 passes the allocated buffer and includes `CREATE_UNICODE_ENVIRONMENT`. It never passes `IntPtr.Zero` for the child environment or inherits `Environment.GetEnvironmentVariables()`.
2. **Exact process and Win32 ABI — PASS (source).** Native helper lines 57–76 uses Unicode `CreateProcessW` with writable `StringBuilder` command; `CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT`; 64-bit-compatible `STARTUPINFOEX`; a `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` containing exactly child stdin-read and stdout-write; `bInheritHandles=true` while parent pipe ends are made noninheritable. On a partial `Create` failure, the unassigned suspended process is terminated, waited and closed; never resumed.
3. **Private Job and process settlement — PASS (source).** Host lines 142–221 creates a private kill-on-close Job before launch, calls `AssignSuspended` **before** `ResumeAfterAssignment`, verifies exact runner PID and server PID in Job with same session, known executable identity and bounded system `conhost.exe` extras. Success additionally requires exact fixed result, runner OS exit 0, Job `WaitEmpty`, and private directory validation. Error path tries owned runner termination and `TerminateJobObject`, reports `JOB_EMPTY:0/1`, OS exit 3 only for verified settlement else 4. Private Job's owner host remains outside it.
4. **No visible GUI / no mutation — PASS (source).** Both .mjs files use only synthetic MCP client/server packages and `listTools` (no `tools/call`), and neither loads the Sbroenne vendor server, UIA APIs, desktop automation, VMware, screenshot or input APIs. SDK stdio transport lines 74–87 explicitly sets `windowsHide: true` for Windows Node child. Node runner stdout is reduced to `READY:<pid>` and `RESULT:<fixed-state>:<fixed-code>:none`; native host only projects verified codes/PIDs/counts/timing, not arbitrary MCP payload or stderr.
5. **Transitive SDK environment regression test — PASS (source), runtime PENDING.** SDK stdio transport lines 10–28 and 74–78 merges up to **18 default Windows keys** from `process.env` with explicit environment overrides. By restricting the **runner process's original native environment**, the SDK cannot re-inject missing caller secrets when spawning the synthetic stub. Runner and stub compare the same 20-bit presence mask: `11111100000000000000` — first six approved keys present (PATH, SYSTEMROOT, TEMP, WINDIR, bundle root, timeout), fourteen disallowed SDK default keys absent (APPDATA, COMSPEC, HOMEDRIVE, HOMEPATH, LOCALAPPDATA, PATHEXT, PROCESSOR_ARCHITECTURE, PROGRAMDATA, PROGRAMFILES, PROGRAMFILES(X86), PROGRAMW6432, SYSTEMDRIVE, USERNAME, USERPROFILE). Only a `tools/list` tool name containing 20 binary digits is returned. No environment **values** are disclosed.
6. **Private extraction and scratch roots — PASS (source).** Host creates two sample-ID-named, owner-only DACL directories under dedicated ignored research temp; rejects existing paths and reparse points and checks ownership after run. This may **retain** small local test artifacts for audit; it does not delete user data.

## Scope of evidence / caveats

- The 20-bit mask is a **limited witness for enumerated keys**, not a proof of absence of **every conceivable** environment name. Security claim rests primarily on the explicit 7-key native environment block; the mask independently tests all default keys the **currently pinned** SDK transport could inherit. SDK upgrades require repeating this audit.
- First OS-level validation of suspended/assigned CreateProcessW with the explicit double-NUL UTF-16 block has **not yet occurred**. Source review cannot establish exact launch behavior, Job member count, return code or whether any local security product interferes.
- Full process and stdout evidence should not be interpreted as evidence of GUI interactivity, UIA reliability, modal behavior or improved Workbridge desktop latency.
- Fixed `C:\Windows` expectation and pinned Node executable make this pilot deliberately **host-specific**, not production-portable. Hash-check/create has ordinary file TOCTOU exposure but no hostile code is introduced in this bounded fixture.

## One-run acceptance checklist for coordinator

- Only the author/coordinator may schedule **one** no-GUI synthetic run, with an explicit timeout and exactly pinned compiled binary; no vendor executable, VM, window focus or interactive desktop lease should be involved.
- Require actual OS exit **0**, literal `RESULT:success:ENV_MASK_VERIFIED:none`, known runner/server PIDs + only known `conhost` members, and `HOST:SETTLED:0` after verified Job0. Require the private roots evidence. Compare fixed stdout to known patterns; don't reproduce raw child MCP output.
- Any missing stage, unexpected process, unexpected env mask, nonzero exit, unknown settlement or timeout is **HOLD**; retain evidence and investigate before any retry.
- Even a successful oracle clears **environment inheritance only**. The Sbroenne vendor/UIA/screenshot/desktop piloting gate stays **HOLD** pending separate desktop lease/quarantine and privacy safety reviews.

## Independently verified saved runtime receipt (post-review)

After the author ran the **one approved synthetic** trial, this reviewer independently read Workbridge `command_status` and `command_output` for job `wda_m3p8_unicode_env_oracle_synthetic_20261105_a01`; **no rerun**:

- Workbridge reports **passed, actual OS exit 0**, complete untruncated stdout **256 bytes**, stderr **0 bytes**, timeout bound **60s**, observed job from `2026-11-05T23:49:31.685Z` to `23:49:33.039Z`.
- Complete six-line fixed receipt (no raw MCP payload): `HOST:PRIVATE_ENV_ROOTS:2`; `HOST:ASSIGNED_SUSPENDED:57844:ACTIVE:1`; `HOST:READY_MEMBERS:4:RUNNER:57844:SERVER:18332`; `RESULT:success:ENV_MASK_VERIFIED:none`; `HOST:PRIVATE_ITEMS:0:0:RETAINED_FOR_AUDIT:1`; `HOST:SETTLED:0:RUNNER:57844:SERVER:18332:DURATION_MS:860`.
- This **confirms this one synthetic host run** achieved the expected enumerated environment-key mask, process Job settlement and zero private extracted/scratch items. It **does not** establish arbitrary-key absence, repeatability, provider stability, correct live UIA behavior or production deployment readiness. Sbroenne/live desktop **remains HOLD**.

## Sources

Local pinned primary source paths and SHA above, especially `Sbroenne-SuspendedEnvNode-V31.cs` lines 103–193; `Sbroenne-EnvOracle-Host-V31.cs` lines 128–221; `Sbroenne-PrivateJob-V2.cs` lines 68–108, 169–218; `sbroenne-v31-env-oracle-runner.mjs` lines 17–124; `sbroenne-v31-env-oracle-stub.mjs` lines 7–35; and installed MCP SDK `stdio.mjs` lines 10–28, 74–86.
