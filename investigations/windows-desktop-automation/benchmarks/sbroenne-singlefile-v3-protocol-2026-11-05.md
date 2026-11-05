# M3-P7 Sbroenne single-file v3 — supervised direct MCP protocol-only result

Date: **Thursday, November 5, 2026 (America/New_York)**. Status: **🟢 pinned single-file stdio MCP lifecycle and private Job0 observed once; 🔴 zero UIA/window/tool calls, no production readiness claim.**

## Result first

The coordinator-approved, independent-source-reviewed **single** Workbridge job launched the isolated native v3 supervisor, which created a **unique owner-only private Windows directory** under ignored investigation temp, spawned the pinned Node script **suspended**, assigned it to a fresh private kill-on-close Windows Job *before* resume, and connected Node to the separate pinned **self-contained single-file Sbroenne MCP server** using JSON-RPC stdio. The Node client checked `tools/list` returns only `ui_snapshot`; it called **no tool**, read no window or desktop state, and closed the server. The host required exact server PID/image/session, Job membership and stable empty Job before true OS exit0. This is **not an interactive benchmark or a replacement for Workbridge**.

### Authoritative one-shot receipt

- Workbridge job/request ID: `wda_sbroenne_v3_singlefile_protocol_smoke_20261105_m3p7`.
- Exact host EXE: `C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\Sbroenne-Mcp-Provider-Host-V3.exe`; binary SHA256 `204b7e3f9f5f4a5db5656c5200959bbb8f0e4eb48edd0643fbf91b90875dce4a`, **25,088 bytes**.
- Literal args `protocol`, `-`, `mcp_v3_singlefile_20261105_a01`; cwd `C:\work\workbridge-mcp`, timeout **90 seconds**.
- Workbridge result `status=passed`, **actual OS exitCode=0**, no output truncation, no stderr. Started `2026-11-05T23:26:01.655Z`, ended `2026-11-05T23:26:04.253Z` (~2.60 s outer); host-reported duration **1142 ms**. One run only; not p50/p95.
- Only bounded fixed-status output:

```text
HOST:PRIVATE_EXTRACT_ROOT:1
HOST:ASSIGNED_SUSPENDED:43884:ACTIVE:1
HOST:READY_MEMBERS:4:RUNNER:43884:SERVER:61944
RESULT:success:PROTOCOL_ONLY:none
HOST:EXTRACT_ITEMS:0:RETAINED_FOR_AUDIT:1
HOST:SETTLED:0:RUNNER:43884:SERVER:61944:DURATION_MS:1142
```

Four READY Job members = exact pinned Node and single-file .NET server PIDs plus two additional Job members accepted by the unchanged v2 host helper only if they are freshly created, same-session Windows-system-path `conhost.exe`. Complete Job PID list and active-count sampling had to agree. **Job0 proves the observed private Job is empty; not that no outside-Job helper ever existed.**

## Provenance / no source modification of other projects

| Asset | SHA256 / evidence |
|---|---|
| New `prototypes/Sbroenne-Mcp-Provider-Host-V3.cs` | `73d3f24297946f5c16ea701f58cab03314a6b5dc6b0b29e3d442db9e1a0ce068` |
| New `prototypes/sbroenne-mcp-v3-singlefile-protocol.mjs` | `79204d1230827979eb63c7c779c413a4fbfda9e917567b5de874c4905ed1409e` |
| Reused unchanged `prototypes/Sbroenne-PrivateJob-V2.cs` | `55a3571647fcb525c605d7f922e63885809ec01dffd9f3a88f00f882ff6f9b30` |
| Reused unchanged `prototypes/Sbroenne-SuspendedMcpNode-V2.cs` | `96982e1b64dea6560827da3df309f40810cc2d90dc84352283b6029b7f3d5ce2` |
| Pinned isolated single-file `temp/sbroenne-singlefile-publish/Sbroenne.WindowsMcp.exe` | `ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128`, **59,893,792 bytes**, sole directory entry |
| Upstream release source | `sbroenne/mcp-windows` v1.3.28 commit `655b9fc92d03ad52a270067c6844ea1231c90559`; SDK10.0.302 |

The host verifies exact Node/script/file hashes, exact single-file publish directory inventory (no siblings), size and no reparse; the Node client independently repeats EXE size/hash and only invokes `Sbroenne.WindowsMcp.exe --tools ui_snapshot` as a direct `StdioClientTransport`, not `wincli` or hidden daemon. It explicitly supplies **four environment overrides** to the .NET child: `SystemRoot`, `WINDIR`, `DOTNET_BUNDLE_EXTRACT_BASE_DIR`, `MCP_WINDOWS_TIMEOUT_MS`; however, **it does NOT confine the child's environment to four keys**. Source inspection of installed `node_modules/@modelcontextprotocol/client/dist/stdio.mjs` SHA256 `af887c8972a37b8c3fcc78192d8f1d56c099bf8ca365f4843ec51ced6f5650da` shows `StdioClientTransport.start()` merges `...getDefaultEnvironment()` before caller `...env` (lines 74–78). On Windows that default allowlist can also inherit `APPDATA`, `COMSPEC`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `PATH`, `PATHEXT`, `PROCESSOR_ARCHITECTURE`, `PROGRAMDATA`, `PROGRAMFILES`, `PROGRAMFILES(X86)`, `PROGRAMW6432`, `SYSTEMDRIVE`, `SYSTEMROOT`, `TEMP`, `USERNAME`, `USERPROFILE`, `WINDIR` when set (lines 10–28). The bundle-extraction override is explicitly provided, but **effective environment confinement is unverified**. No machine-global environment variable was modified.

Native host creates per-sample `temp/sbroenne-v3-extract-mcp_v3_singlefile_20261105_a01` using a protected owner-only Windows DACL; checks no reparse in the canonical parent chain, exact current SID owner and no inherited broad entries, and initially empty directory. The same sample ID is derived by Node; Node refuses an absent/nonempty/reparse extraction root. After Job0 the host checks root ownership/ACL and rejects reparse/excessive inventory, reports **0 retained items** and leaves the empty ignored root for audit rather than removing it.

**Important extraction caveat:** An observed `EXTRACT_ITEMS:0` is **not** proof that the bundled runtime never extracted anywhere else, nor proof that .NET honored `DOTNET_BUNDLE_EXTRACT_BASE_DIR`; it only proves this exact controlled directory was empty when surveyed. Microsoft documents that native bundled libraries can self-extract on Windows, defaulting to `%TEMP%\.net` unless a base dir is set. Source passes the variable to the vendor child, **alongside SDK default-inherited variables** as identified above, but no independent process environment or file-creation trace was collected. An empty private extraction base does not exclude default `%TEMP%` extraction or absence of extraction. [Microsoft .NET single-file deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/).

## Scope, checks and review

| Gate | Result |
|---|---|
| Native host compiled via `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` `/target:winexe /platform:x64` with only V3 host + unchanged V2 private Job/child source | `wda_sbroenne_v3_host_compile_20261105_m3p7`: exit0, no warnings |
| Node `--check` source | `wda_sbroenne_v3_protocol_syntax_20261105_m3p7`: exit0 |
| Independent FLAUI source reviewer | 🟢 GO for **one protocol-only** smoke with stated residual cautions; 🔴 HOLD UIA/GUI/production |
| One supervised protocol smoke | `wda_sbroenne_v3_singlefile_protocol_smoke_20261105_m3p7`: actual OS exit0, exact sanitized result and Job0 |
| GUI/window detection, `tools/call`, OCR, screenshot, mouse/keyboard, VMware/RIFT | **Not performed or authorized** |
| Tamper-pin negative variant and live snapshot dispatch | **Not executed**; v3 has no snapshot entry point, and `SBROENNE_TEST_BAD_PIN` exists only as an optional synthetic compile-time test gate |

No system service, scheduled task, PATH, registry, production Workbridge `.local`/dist, game, VM, shared GUI lease, old multi-file server, SDK installation or desktop focus was touched.

## Honest unresolved risks and next investigation

1. **Bundle extraction destination:** separate source/Win32 environment-propagation review or separately authorized read-only file-creation evidence is needed before claiming confinement; 0 items may represent no extraction, cleanup, or redirection.
2. **No complete ancestry proof outside Job:** private Job0 covers observed members only; independent parent/PID path observations would be needed to exclude escaped console/helper processes and to prove no lingering default-temp extract file.
3. **Same-user ACL limitation:** protected SID-only DACL excludes other ordinary accounts, but another process with the *same* user SID may still write; race-safe handle identity would further strengthen integrity.
4. **No GUI/UIA permission:** actual no-focus `ui_snapshot` is untested. Revisit identity/lease, fresh-window bounds, host error normalization, process timeouts, explicit user focus permission and observer invariants at separate coordinator gate.
5. **The single sample is not a latency win:** 1142 ms host duration includes metadata handshake/cold startup/possible extraction; compare against M3-P6 v2's 1291 ms only as two isolated protocol observations, not a statistically valid speed test. More samples are not authorized in this milestone.

**Recommendation:** Keep v3 research-only and pinned, treat complete one-file publish provenance as 🟢, **explicit extraction-base override as source-verified but effective destination/environment confinement as UNVERIFIED**, and live desktop backend adoption as 🔴 HOLD until target-specific safety/side-effect benchmark. This explicit correction preserves the observed OS0/Job0 protocol result; it retracts only the earlier four-key-only claim.
