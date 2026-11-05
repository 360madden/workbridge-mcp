# M3-P6 Sbroenne v2 MCP protocol-only host — independent source audit

**2026-11-05 | 🟢 GO: one isolated protocol-only, no-GUI test | 🔴 HOLD: any UIA tool call or production integration.**

Reviewed provisional pinned source (source inspection only; I did not build, launch MCP/GUI, make `tools/call`, focus a window, inspect VMware/RIFT, change GUI-turn locks or edit another agent's implementation):

| File | Observed SHA-256 |
| --- | --- |
| `prototypes/Sbroenne-SuspendedMcpNode-V2.cs` | `96982e1b64dea6560827da3df309f40810cc2d90dc84352283b6029b7f3d5ce2` |
| `prototypes/Sbroenne-Mcp-Provider-Host-V2.cs` | `7bde2dc9cb9215141aa05ea4826fd29954549e0ee437b5dd9de9f09b0805115e` |
| `prototypes/sbroenne-mcp-v2-protocol-only.mjs` | `caef6ab7dc8a961371a840c8730776f4cdb00b36b864dbc86c7cbb0aacd02078` |
| Reused `prototypes/Sbroenne-PrivateJob-V2.cs` | Prior synthetic-reviewed outside-owner private Job implementation |

## Critical source gates

| Gate | Source-level result |
| --- | --- |
| 🟢 Read-only allowlist | Final host source uses a **compile-time** `#if !ENABLE_SBROENNE_UI_SNAPSHOT` hard gate (`77–89`), and the protocol-only build omits that define; `snapshot` returns `HOST:BLOCKED:UI_SNAPSHOT_NOT_AUTHORIZED` / exit64 **before any child process launch**. Flipping a runtime flag alone cannot enable it. Protocol-only Node script validates `mode=protocol` and manifest `-` (`36–41`). It creates a direct MCP `Client`, performs initialize/connect and `client.listTools()` **only**, requiring exactly one registered `ui_snapshot` tool (`83–89`). The script contains no `client.callTool`, `ui_snapshot` invocation, focus, screenshot or input. |
| 🟢 No daemon route | `StdioClientTransport` directly launches absolute `temp/sbroenne-stdio-publish/Sbroenne.WindowsMcp.exe` with literal `['--tools','ui_snapshot']`, not the `wincli` service auto-start/pipe command; stdout protocol private to parent. This does not prove a future GUI session's lifecycle. |
| 🟢 Exact current pins | Host refuses unless known absolute Node EXE SHA, protocol script SHA and Sbroenne server EXE/DLL/runtimeconfig SHA match. Node independently rehashes the three server files and rejects symbolic link/file shape problems. Host checks server current process image path matches `ServerDir`, expected same parent session, birth time after parent and private Job membership (`111–129`). |
| 🟢 Suspended assignment and handle inheritance | Launcher reuses tested `STARTUPINFOEX` with explicit **only stdin-read + stdout-write** inherited handles and parent ends non-inheritable; `CreateProcessW` `CREATE_SUSPENDED|CREATE_NO_WINDOW|EXTENDED_STARTUPINFO_PRESENT`, then the private child Job `AssignSuspended` gate before `ResumeThread`. Failure before assignment terminates exact suspended ProcessInformation handle and never resumes it. Native supervisor itself remains outside child Job. |
| 🟢 Full descendant settlement | Host waits for `READY:<serverPid>`, validates Node + exact server PIDs exist in complete dynamic Job list, identifies any extra members only as known Windows `conhost.exe` with same session/nearby start. After `GO` it accepts exactly `RESULT:success:PROTOCOL_ONLY:none`, Node process exit0 and private Job `WaitEmpty==true` (zero members) before publishing `HOST:SETTLED:0` and returning OS exit0. Failure/unknown calls exact child termination + Job termination and returns OS **3** or **4**, with no false success after `HOST:BLOCKED`. |
| 🟢 Bounded public output | Host reads at most 4096 characters per child line with a deadline; filters fixed `READY` and constant `RESULT`, surfaces only stage/PID/count/duration/code; arbitrary server output and UIA text are never reprinted. Node `stderr` handler drains and discards provider error content. No raw JSON-RPC tool descriptions, UI values, clipboard, screenshots or arbitrary exceptions are forwarded. |

## Residual caveats (not synthetic protocol blockers)

1. **Transitive server integrity:** The EXE, managed DLL and runtimeconfig are pinned, but other files in the self-contained publish directory (including possible `.deps.json` and dependency assemblies) are not all in the hash manifest. For future GUI access, preflight the entire isolated publish tree or validated sealed copy and reject reparse directory escape. Exact image path alone does not prove all loaded dependency bytes.
2. **Snapshot manifest is not exercised:** `AcceptManifestArgument` only checks rooted prefix/suffix/file type, not full parsed PID/creation/session/lease identity; fortunately `SnapshotDispatchAuthorized=false` makes this path unreachable in protocol-only mode. Do not flip this bool without dedicated parsed manifest/expiry/lease/privacy review and independent native observer.
3. **Identity and receipt:** Success protocol output carries Node/server PIDs but not explicit request ID, start ticks, expected server binary digest or user SID. Workbridge command ID and exact args are separate receipts; a future provider-aware acceptance record must bind them and require the intact terminal `HOST:SETTLED` signal, not a bare `passed/exit0`.
4. **Environment and timeout:** Node `StdioClientTransport` specifies `env: { MCP_WINDOWS_TIMEOUT_MS:'10000' }`, which may replace normal Windows/.NET bootstrap variables rather than merging them. It is privacy-restrictive but may cause a benign startup failure; classify failure rather than adding broad ambient env by default. Client handshake has no own per-call timeout, but the native host's bounded `ReadLine` and private Job teardown limit the protocol job.
5. **Outside-Job auxiliaries:** Complete private Job accounting proves the processes *in that Job* settled; it does not independently inventory any preassignment `conhost.exe` or other process that may be outside it. For strong future GUI containment, retain the bounded OS process birth/session and Workbridge outer Job evidence advocated in the prior independent design review. Any unknown helper or incomplete list remains RED.

## First authorized protocol-only runtime receipt — independently inspected saved job, not rerun

I independently inspected Workbridge's retained `command_status` and full `command_output` for job **`wda_sbroenne_mcp_v2_protocol_only_smoke_20261105_m3p6`**; I did **not** launch anything. The job record specifies the pinned temporary native host EXE path, `mode=terminal`, a 60-second outer limit, start `2026-11-05T23:01:25.741Z`, end `2026-11-05T23:01:27.808Z`, `status=passed`, **OS exit0**, stdout 179 bytes, stderr 0, `outputTruncated=false`, and no completion pending. The exact, complete output is:

```text
HOST:ASSIGNED_SUSPENDED:2488:ACTIVE:1
HOST:READY_MEMBERS:4:RUNNER:2488:SERVER:66784
RESULT:success:PROTOCOL_ONLY:none
HOST:SETTLED:0:RUNNER:2488:SERVER:66784:DURATION_MS:1291
```

The retained output verifies the advertised stage order and lifecycle-success signal, not an independently reconstructed process tree or binary byte hash; the implementation specialist reports the two extra members were separately checked system `conhost.exe`. This is a **no-GUI protocol/lifecycle** proof, with **zero MCP UI tool calls**, not UIA correctness or latency. Do not compare 1,291 ms with WinApp UIA latency; retain the compiled-host SHA and complete outer process evidence alongside this job in the eventual acceptance packet.

## Exact approval boundary

🟢 **GO achieved for this one uniquely identified, outer-Workbridge-bounded synthetic/no-GUI protocol-only run.** Saved evidence shows `READY_MEMBERS` with runner/server, `RESULT:success:PROTOCOL_ONLY:none`, `HOST:SETTLED:0`, private Job 0, OS exit0, and complete nontruncated output. Future failure cases must return OS nonzero. This result does **not** establish UIA correctness or approve another GUI/desktop trial.

🔴 **HOLD** DesktopProbe visible launch and any `ui_snapshot`/other MCP tools, generic Windows app, RIFT/VM, screenshots, or production Workbridge provider registration. A successful protocol handshake cannot be compared as UIA latency or used to bypass the recovered shared desktop-turn rules.

Primary vendor docs: [Sbroenne Windows MCP v1.3.28](https://github.com/sbroenne/mcp-windows/tree/v1.3.28), [Microsoft UpdateProcThreadAttribute HANDLE_LIST](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute), [Microsoft nested Jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs).
