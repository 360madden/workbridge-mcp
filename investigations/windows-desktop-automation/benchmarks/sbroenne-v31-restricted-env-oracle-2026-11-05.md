# M3-P8 restricted Unicode Windows environment — synthetic MCP oracle evidence

Date: **Thursday, November 5, 2026 (America/New_York)**. Status: **🟢 one bounded synthetic-only proof passed, true OS exit0/Job0 and a 20-key presence mask; 🔴 no Sbroenne vendor server/UIA/GUI was run.**

## Outcome

The isolated V3.1 native supervisor launched a **Node runner** using `CreateProcessW` with an explicit, strictly sorted **seven-key UTF-16 double-NUL environment block**, `CREATE_UNICODE_ENVIRONMENT`, `CREATE_SUSPENDED` and a `STARTUPINFOEX` whitelist of the two required inherited pipe handles. It assigned the suspended Node process to a new private child-only `KILL_ON_JOB_CLOSE` Windows Job **before resuming**. No shell, environment-variable global mutation, Windows service or installed package edit occurred.

The Node runner launched **another pinned Node executable running a synthetic MCP stdio stub** through the installed v2.3.1 MCP SDK. The stub used `McpServer`/`serveStdio` to expose one dynamically named tool carrying **only a fixed-length 20-bit *key presence* mask**, consumed by a single `tools/list`. Neither component called `tools/call`, accessed UIA, read screens/windows, or printed variable values or user data.

First six bit positions **must equal 1**: `PATH`, `SYSTEMROOT`, `TEMP`, `WINDIR`, `DOTNET_BUNDLE_EXTRACT_BASE_DIR`, `MCP_WINDOWS_TIMEOUT_MS`. Remaining fourteen **must equal 0**: `APPDATA`, `COMSPEC`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `PATHEXT`, `PROCESSOR_ARCHITECTURE`, `PROGRAMDATA`, `PROGRAMFILES`, `PROGRAMFILES(X86)`, `PROGRAMW6432`, `SYSTEMDRIVE`, `USERNAME`, `USERPROFILE`. Expected mask **`11111100000000000000`** was verified independently in the runner's own environment and from the synthetic child metadata; only an exact match was accepted as success. These names cover the installed MCP SDK's complete 18-key Windows default-forwarding allowlist plus the two explicit environment overrides, not arbitrary unlisted variables.

The native launcher itself constructs the seven literals `DOTNET_BUNDLE_EXTRACT_BASE_DIR`, `MCP_WINDOWS_TIMEOUT_MS`, `PATH`, `SYSTEMROOT`, `TEMP`, `TMP`, `WINDIR` from trusted local Windows/install roots and two freshly created owner-only ignored directories; it refuses duplicate/unsorted keys and illegal values. The `PATH` is a fixed system/Node executable search set, **not the Workbridge/user ambient PATH**. The native `CreateProcessW` call passes the allocated Unicode environment pointer (not `IntPtr.Zero`) and frees it after CreateProcess returns. Thus the source's restricted block and the 20-bit synthetic observation together address the SDK inheritance gap found in M3-P7. No raw environment values, paths, command lines, credentials or MCP descriptions were written to Workbridge output.

## Exact one-shot Workbridge evidence

- Synthetic job/request ID: `wda_m3p8_unicode_env_oracle_synthetic_20261105_a01`.
- Exact ignored native executable: `C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\Sbroenne-EnvOracle-Host-V31.exe`, **26,112 bytes**, SHA256 **`6c2d0caeb0cbe82bfcb52aeeee2ca6010bb4f8d4ba96875b243e27d72c4c3755`**.
- Literal arguments `oracle`, `-`, `mcp_v31_env_probe_20261105_a01`; cwd `C:\work\workbridge-mcp`; Workbridge outer timeout **60 seconds**.
- Result `status=passed`, **true OS exitCode=0**, started `2026-11-05T23:49:31.685Z`, finished `2026-11-05T23:49:33.039Z` (~1.35 s outer), no stderr or truncation; bounded native duration **860 ms**. **Exactly one synthetic runtime trial**; not a p95 benchmark.
- Entire retained fixed-status output (256 characters):

```text
HOST:PRIVATE_ENV_ROOTS:2
HOST:ASSIGNED_SUSPENDED:57844:ACTIVE:1
HOST:READY_MEMBERS:4:RUNNER:57844:SERVER:18332
RESULT:success:ENV_MASK_VERIFIED:none
HOST:PRIVATE_ITEMS:0:0:RETAINED_FOR_AUDIT:1
HOST:SETTLED:0:RUNNER:57844:SERVER:18332:DURATION_MS:860
```

The READY four-member snapshot includes exact Node runner PID57844, exact child Node PID18332 and two additional Job members accepted by the unchanged helper only if freshly created, same-session system-path `conhost.exe`. The private Job repeatedly returned **active0 and empty complete PID list** at settlement. This proves observed **private Job process settlement**, not a complete systemwide ancestry event history. Two unique owner-only research roots (bundle-extraction placeholder and private TEMP/TMP scratch) were inspected after Job0 and each had **0 remaining entries**; they were retained under ignored investigation temp as evidence.

## Pinned source and offline checks

| Asset | SHA256 |
|---|---|
| New `prototypes/Sbroenne-EnvOracle-Host-V31.cs` | `cd575cd24918252cf02635b5fecae2fcb69dd556070ea812da44164b3679a26e` |
| New `prototypes/Sbroenne-SuspendedEnvNode-V31.cs` | `24ad770224d91c33e75f8abf7c152cb75e263d255447c87e971fd3349adaa0ca` |
| New `prototypes/sbroenne-v31-env-oracle-runner.mjs` | `3601b097057bd47d17e9e00226248cb47a8ea471fbe9b697779219831fb7713f` |
| New `prototypes/sbroenne-v31-env-oracle-stub.mjs` | `d6f007e97a456fa2e5676998f9545c1a499e2704060a15bfc2f15da089b35fea` |
| Unchanged child-only Job helper `prototypes/Sbroenne-PrivateJob-V2.cs` | `55a3571647fcb525c605d7f922e63885809ec01dffd9f3a88f00f882ff6f9b30` |
| Installed MCP SDK `node_modules/@modelcontextprotocol/client/dist/stdio.mjs` | `af887c8972a37b8c3fcc78192d8f1d56c099bf8ca365f4843ec51ced6f5650da` |
| Pinned Node executable used twice | `119d6fa70e6ae1b15b90688ab6bcc8e3a2819acea021af196895cab1843645af` |

- `wda_m3p8_env_oracle_native_compile_20261105_a01`: Windows .NET Framework C# compiler `/target:winexe /platform:x64`, native host+new Unicode launcher+unchanged private Job helper; **actual OS exit0, no warnings**.
- `wda_m3p8_env_oracle_runner_syntax_20261105_a01`: Node `--check`, **exit0**.
- `wda_m3p8_env_oracle_stub_syntax_20261105_a01`: Node `--check`, **exit0**.
- Independent FLAUI reviewer inspected exact SHA-pinned sources and approved **one synthetic-only no-GUI** trial after validating sorted, double-NUL Unicode block, `CREATE_UNICODE_ENVIRONMENT`, restricted handles, assign-before-resume, Job0, exact result projection and no vendor/UIA/tool invocation.
- `wda_m3p8_unicode_env_oracle_synthetic_20261105_a01`: **actual OS exit0**, verified fixed mask result, both private directories empty, Job0.

## Boundaries and follow-up

1. This proves **one synthetic Node→MCP-stub** path. It does **not** prove that the actual Sbroenne single-file vendor EXE uses the bundle extraction base, avoids default `%TEMP%\.net`, or can operate under the stricter environment. No new Sbroenne process was launched in this milestone.
2. The 20-bit mask is a **selected-key presence witness**; it cannot prove absence of arbitrary keys not in the 20-element set. The native explicit seven-key block is the stronger source-level fact.
3. Same-SID processes may still access per-user ACL-protected folders; that is not an independent process security boundary. No additional ETW/filesystem ancestry trace was authorized.
4. A future separately approved opt-in V3.2 single-file vendor protocol-only trial would reuse the **new restricted native launcher** under a fresh isolated host with exact Sbroenne SHA; it must be independently reviewed and must not enable `ui_snapshot` tool calls without a fresh target/lease gate. Do not mutate the successful V3 reference or production Workbridge.
5. No GUI, UI Automation, mouse/keyboard, RIFT, VMware, TaskScheduler, service, registry, PATH or system-global environment changes were made. Nothing was added to production Workbridge tool registration.

**Decision: 🟢 Windows restricted Unicode environment + synthetic MCP SDK inheritance evidence successful; 🟡 vendor single-file compatibility under that block remains untested; 🔴 desktop/UIA adoption remains HOLD.**
