# sbroenne/mcp-windows — isolated MCP stdio server build receipt (2026-11-04)

Status: **PASS — compile and file metadata only; no MCP server, daemon, UI automation or desktop input launched.**
Owner: sbroenne candidate investigator. Coordinator handles commits and any later runtime authorization.

## Purpose and separation

This is the **standard MCP server executable** (`Sbroenne.WindowsMcp.exe`) built from pinned upstream `sbroenne/mcp-windows`, **not** the separately published `wincli.exe` command line frontend. The server uses the MCP JSON-RPC **stdio** transport in-process. Unlike normal `wincli window/ui` commands, its entry point does not call `DaemonClient.EnsureRunningAsync` or launch a hidden `service run` owner. It still would require an MCP client process to operate and no runtime call is yet authorized.

The build is isolated in ignored investigation `temp`, outside production `dist`, `.local`, PATH, Task Scheduler, registry, Workbridge service/configuration, and RIFT/VM processes. No installed SDK or environment settings changed.

## Pin and read-only preflight

- Upstream: https://github.com/sbroenne/mcp-windows
- Release tag: `v1.3.28`, pinned checkout HEAD commit **`655b9fc92d03ad52a270067c6844ea1231c90559`** (tag itself unsigned; commit identity is provenance, not signature).
- Existing isolated source checkout: `C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-mcp-windows-v1.3.28`.
- Confirmed HEAD via read-only `git -C <source> rev-parse HEAD` request/job **`wda_sbroenne_stdio_git_head_preflight_20261104_m2p4`**, exit 0, exact pinned commit.
- Confirmed `git -C <source> status --porcelain` empty (tracked source clean) request/job **`wda_sbroenne_stdio_git_clean_preflight_20261104_m2p4`**, exit 0.
- Exact server project source `src\Sbroenne.WindowsMcp\Sbroenne.WindowsMcp.csproj`: SHA256 **`f1afe2b8437533d41cf975102df8c61e79ae0a35e479c41bdd53a810d6a3aca1`**, 2,933 bytes.
- Exact server entry `src\Sbroenne.WindowsMcp\Program.cs`: SHA256 **`914cf9a43ab617afbc6abcb9decc5da14730dd43348825f5d1d5efb064fb75df`**, 5,891 bytes.
- Host SDK preflight previously established only .NET SDK **10.0.302**. Upstream `global.json` pins 10.0.401; invoke `dotnet publish` with current working directory `C:\work\workbridge-mcp` to avoid changing global SDKs. Proven successful in both isolated candidate builds.

## Exact authorized publish

Workbridge `terminal_run` request/job **`wda_sbroenne_mcp_stdio_dotnet_publish_v1328_20261104_m2p4`**; 240-second timeout; cwd `C:\work\workbridge-mcp`; no shell and no stdio server execution.

```text
Executable: dotnet
Arguments:
  publish
  C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-mcp-windows-v1.3.28\src\Sbroenne.WindowsMcp\Sbroenne.WindowsMcp.csproj
  -c Release -r win-x64 --self-contained true
  -o C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-stdio-publish
  -p:RestorePackagesPath=C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\nuget
```

**Result:** Workbridge job status `passed`, exit **0**, complete 423-character publish output, not truncated, reports `All projects are up-to-date for restore` and success for `Sbroenne.WindowsMcp.dll` and output. **No warnings or errors** in captured output. Separate SDK installation unnecessary.

## Files and verification (file reads only)

Canonical disposable output directory (different from any earlier variant in discussion):

`C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-stdio-publish`

| Artifact | Bytes | Independent file SHA256 |
|---|---:|---|
| `Sbroenne.WindowsMcp.exe` | **163,328** | **`c74dfc9e46ee8e4db765561aa8c4b2eb5c7b7ce22b33b1300fffd3f17e47f0f9`** |
| `Sbroenne.WindowsMcp.dll` | **1,021,440** | **`99d3a37d98452f9b1d2f0ee44664ebdd0a422fcdf9f56fc869cd6fa38b6a9900`** |
| `Sbroenne.WindowsMcp.runtimeconfig.json` | 636 | `6df5b8a97420042ba676b33842afa9a19f9a4fbc2ab2c23fe5c80cec8c065e39` |

Read-only Windows `Get-Item -LiteralPath <exe> | VersionInfo` metadata, Workbridge job **`wda_sbroenne_stdio_file_version_metadata_20261104_m2p4`**, exit 0:

```json
{"FileVersion":"1.0.0.0","ProductVersion":"1.0.0+655b9fc92d03ad52a270067c6844ea1231c90559","OriginalFilename":"Sbroenne.WindowsMcp.dll"}
```

**Version caveat:** Upstream checkout's `.csproj` contains source Version `1.0.0` despite Git release tag `v1.3.28` (release workflow may stamp versions). The exact pinned **commit SHA in ProductVersion** is the stronger build identity. Neither `Sbroenne.WindowsMcp.exe --version` nor a JSON-RPC handshake was executed; server's `--version` path instantiates services and is **not** a metadata-only substitute.

## Why stdio is safer for the planned read-only first pilot

- Pinned `src/Sbroenne.WindowsMcp/Program.cs:65-79`: `AddMcpServer().WithStdioServerTransport().WithToolsFromAssembly()` and no CLI daemon client. `Program.cs:81-89` parses `--tools` allowlist. `ToolFilter.cs:10-15,58-89` removes disabled tools from protocol `tools/list` and invocation before building the MCP host. Coordinator-approved **initial runtime allowlist: `--tools ui_snapshot` ONLY**, excluding all other tools (especially `ui_read`, which a separate review found can fallback to `Graphics.CopyFromScreen` OCR of overlapped pixels; and `ui_find`, not needed for an exact known HWND). Excludes keyboard/mouse, process, window-management, UI actions, clipboard and file tools.
- App manifest is standard user `asInvoker`, `uiAccess=false`; no elevation should be attempted.
- `Program.cs:116-121` runs MCP host in this same process. This entry point does not run the CLI `DaemonHost.Dispose()` path that calls `ReleaseAllKeysAsync`. The shared static services still initialize lazily on use; UI Automation read-only operations can hang in external COM providers or expose private text, so owner/process timeout, target identity, output redaction and approval gates remain.
- Workbridge already depends on Node `@modelcontextprotocol/client@2.3.1` with stdio child transport `@modelcontextprotocol/client/stdio` exposing `StdioClientTransport` command/args/cwd/env, `pid` and `close()`. A small bounded one-shot MCP harness may spawn the **exact hashed** server exe as child of Workbridge's native Job-Object-owned `terminal_run` process tree, without a resident daemon or changes to installed Workbridge.
- Workbridge `scripts/Command-Host.cs` → `scripts/Tunnel-ProcessLifetime.cs` includes `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; `src/command-worker.ts` starts a native child with `shell:false`. Existing synthetic containment tests do **not** prove real hung UIA COM cleanup. Test process settlement and client close on a synthetic/stdout-only scenario before any GUI snapshot.
- Taskbar caveat: upstream `WindowEnumerator.ShouldSkipWindow` excludes `Shell_TrayWnd` and `Shell_SecondaryTrayWnd` from normal candidate discovery. A known exact HWND `ui_snapshot` can inspect directly but **cannot** be counted as a successful candidate taskbar `window list/find` comparison. For fair discovery use separately approved titled disposable `DesktopProbe`.

## Next gate — not executed

1. Coordinator/independent reviewer approve inspection-only Node MCP stdio harness source and no-start `tools/list` handshake first, with bounded 20–30s job and verified process child lifetime/clean shutdown.
2. Separately confirm Windows desktop session/elevation, matched external PID+process start+HWND/class/foreground oracle, and no active game focus/in-input interference before GUI-only snapshot.
3. Allow a **single read-only** `ui_snapshot` for a pinned fresh HWND; hold raw element names/text private, retain timing, structural counts/hashes, and post-action identity/foreground oracle only. Strictly no keyboard/mouse/focus/VM command or broad cross-window discovery.
4. Re-check Workbridge live health and that **no Sbroenne daemon** appeared, kill only our Job-owned process descendants after timeout, and do not republish/copy this build into production without separate decision.

**Runtime boundary: no daemon, service start/stop, MCP handshake, window capture, UIA, desktop focus or input was executed as part of this build.**

## Primary sources

- https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp/Program.cs
- https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp/Catalog/ToolFilter.cs
- https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp/app.manifest
- Local Workbridge `src/jobs.ts`, `src/command-worker.ts`, `scripts/Command-Host.cs`, `scripts/Tunnel-ProcessLifetime.cs` and installed TypeScript MCP SDK `@modelcontextprotocol/client/dist/stdio.d.mts`.
