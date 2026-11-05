# M3-P9 actual Sbroenne vendor under restricted environment — independent source gate

**2026-11-05 | 🟢 GO one bounded vendor-protocol-only `tools/list` | 🔴 HOLD all live UIA/desktop actions.** Source-only review; this reviewer did not execute the Windows host, process, GUI or vendor binary.

## Pinned sources examined

- NEW `prototypes/Sbroenne-RestrictedVendor-Host-V4.cs` SHA-256 `2d48fbfeb49571db7310a18472b2cd14ef23ef0791f7d99df03154be8f384402`.
- NEW `prototypes/sbroenne-v4-restricted-singlefile-protocol.mjs` SHA-256 `2b91b063b298c5fcc0fa8a10fe626afc163dbc7f04429b08f768bedbbed65b9c`.
- Reused unchanged restricted `prototypes/Sbroenne-SuspendedEnvNode-V31.cs` SHA `24ad770224d91c33e75f8abf7c152cb75e263d255447c87e971fd3349adaa0ca`.
- Reused unchanged child-only `prototypes/Sbroenne-PrivateJob-V2.cs` SHA `55a3571647fcb525c605d7f922e63885809ec01dffd9f3a88f00f882ff6f9b30`.
- Installed `node_modules/@modelcontextprotocol/client/dist/stdio.mjs` SHA `af887c8972a37b8c3fcc78192d8f1d56c099bf8ca365f4843ec51ced6f5650da` (Windows default env list and `windowsHide:true`).
- Exact single-file vendor **Sbroenne.WindowsMcp.exe v1.3.28** pinned to `59,893,792` bytes and SHA `ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128`; only one entry permitted in publish directory. This is a source pin declaration, **not independently rehashed executable bytes**.

## Source gate

| Item | Assessment |
| --- | --- |
| Executable pin / no alternate provider | 🟢 Host pins absolute Node path/source and exact vendor EXE hash+size+only sibling; Node independently checks publisher contents. |
| No ambient env leakage | 🟢 Win32 host reuses source-reviewed M3-P8 7-key sorted custom UTF-16 CreateProcessW block with `CREATE_UNICODE_ENVIRONMENT`; Node asserts expected mask `11111100000000000000`; MCP SDK transitive 18-key default inheritance can only forward keys present in this restricted runner. This checks **enumerated** names; it is not an arbitrary-secret oracle. |
| Crash containment | 🟢 Native Node created suspended, two explicitly inherited pipe handles, private non-inheritable kill-on-close Job assigned before Resume. Host validates runner+vendor server PID, true server executable path, owner session, Job membership, known system conhost extras; timeout/failure ForceTerminate + Job0 verdict. |
| Private extraction and temporary files | 🟢 Two sample-named owner-only ACL protected roots under research temp, prechecked empty and non-reparse; post-run inventory bounded and retained for audit; no production file cleanup. |
| Scope / focus | 🟢 Node requests direct MCP stdio server with literal `--tools ui_snapshot`, calls **only** `client.connect()` and `client.listTools()`, verifies exactly one `ui_snapshot` catalog name. Neither host nor runner calls `tools/call`, launches WinApp/UIA actions, desktop input, VMware, screenshot or RIFT operations. `stdio.mjs` uses `windowsHide:true`. |
| PII and truthful outcome | 🟢 StdErr read silently, no raw vendor stdout/MCP payload printed, only `READY:PID` then fixed `RESULT:success:PROTOCOL_ONLY:none` after catalog match and parent acknowledgment. Native host requires matching literal result, runner exit0, private Job empty, intact private roots before OS exit0; errors project sanitized uppercase codes and OS3/4. |

**Source caveats:** This is the first launch of real vendor binary under restricted seven-variable Win32 environment; application startup could fail due missing APPDATA/USERPROFILE, .NET bundle dependencies or local security product. Parent/caller must keep an outer ≤60–90-second deadline, no concurrent GUI pilot or desktop focus. As in M3-P8, `Job0` proves only members of the private job settled; it does not prove vendor made zero side effects, no out-of-job child existed, or that UIA snapshot actually works. In particular, **listing `ui_snapshot` does not invoke it** and cannot validate modal hangs, camera capture, DPI, per-window accuracy, input or latency.

**Acceptance for ONE author-controlled bounded protocol-only run:** Exact hashes and source unchanged, actual OS exit0, untruncated fixed `HOST:PRIVATE_ENV_ROOTS:2`, `HOST:ASSIGNED_SUSPENDED`, `HOST:READY_MEMBERS` with server image/Job, `RESULT:success:PROTOCOL_ONLY:none`, `HOST:PRIVATE_ITEMS:n:n:RETAINED_FOR_AUDIT:1`, `HOST:SETTLED:0`. Otherwise **HOLD**, retain evidence, classify first. No vendor/UIA tool invocation or live desktop lease action is authorized by this gate.
