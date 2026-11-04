# sbroenne/mcp-windows — isolated Windows CLI build evidence

Date: 2026-11-04 (America/New_York). Scope: M2 candidate feasibility only. **No production deployment or desktop automation test.**

## Result

| Check | Independently observed result |
| --- | --- |
| Installed .NET SDK | `10.0.302` only, from `C:\Program Files\dotnet\sdk` (`dotnet --list-sdks`, exit 0) |
| Source release | `sbroenne/mcp-windows` annotated tag `v1.3.28` |
| Tag object SHA | `963da430d601793140669aad10e7a6da82a036f6` |
| Exact source HEAD | `655b9fc92d03ad52a270067c6844ea1231c90559` — exact match to GitHub tag target |
| Shallow clone | PASS, exit 0, 2026-11-04T21:25:14.453Z–21:25:15.772Z |
| CLI publish | **PASS**, exit 0, 2026-11-04T21:25:44.056Z–21:26:00.054Z (15.998 s) |
| Publish diagnostics | No warnings or errors in the retained 953-character build output; both CLI and server projects restored |
| Published executable | `temp\wincli-publish\wincli.exe`, size **163,328 bytes** |
| Published executable SHA-256 | `ecd1ad47a4e9d5e6bb4d55d53ed0119b42a3c1afd2e3a3e11f19afc4dbe46438` |
| `wincli.exe --help` | PASS exit 0; 2,112 characters of command help |
| `wincli.exe --version` | PASS exit 0; prints `wincli (Windows MCP 1.0.0+655b9fc92d03ad52a270067c6844ea1231c90559)` |
| Running Workbridge owner | Unchanged: `0.16.4-dev`, PID `43508`, instance `9aa9b65f-b34f-49a7-8b92-c7954bd4dc9a` |
| Workbridge tracked Git status after trial | `## main`, only pre-existing unrelated `M scripts/freebuff-conpty-probe.py`; staged source artifacts ignored under `temp/` |

The apparent version mismatch is source metadata, not a revision mismatch: the tag is `v1.3.28`, but the CLI/server source project still declares assembly version `1.0.0`. The full embedded Git SHA matches the verified tag commit. Do not label the binary version `1.3.28` without this qualification.

## Staging and actual build commands

All paths are under `C:\work\workbridge-mcp\investigations\windows-desktop-automation\`. The existing Workbridge `.gitignore` contains `temp/`; the source, NuGet restore cache, intermediate files and published runtime remain in this ignored disposable subtree.

- Staging parent: `temp\`
- Source checkout: `temp\sbroenne-mcp-windows-v1.3.28\`
- Publish output: `temp\wincli-publish\`
- NuGet packages: `temp\nuget\`
- Workbridge terminal working directory throughout: `C:\work\workbridge-mcp` — intentionally outside the candidate repo containing `global.json` pinned to SDK `10.0.401`. Microsoft's SDK selection rule searches upward from current working directory.

```powershell
dotnet --list-sdks
git clone --depth 1 --branch v1.3.28 https://github.com/sbroenne/mcp-windows.git "C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-mcp-windows-v1.3.28"
git -C "C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-mcp-windows-v1.3.28" rev-parse HEAD
dotnet publish "C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-mcp-windows-v1.3.28\src\Sbroenne.WindowsMcp.Cli\Sbroenne.WindowsMcp.Cli.csproj" -c Release -r win-x64 --self-contained true -o "C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\wincli-publish" -p:RestorePackagesPath="C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\nuget"
& "C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\wincli-publish\wincli.exe" --help
& "C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\wincli-publish\wincli.exe" --version
```

Each command was a separate bounded Workbridge `terminal_run` job with literal argument array and unique request ID; this block is a reconstruction of those arguments, **not** a one-shot shell script. The parent `temp` directory was created via Workbridge `create_directory` (`wda_sbroenne_create_temp_20261104_m2p1`, state `applied`).

| Operation | Durable Workbridge request/job ID | Exit/result |
| --- | --- | --- |
| SDK inventory | `wda_sbroenne_dotnet_list_sdks_20261104_m2p1` | 0 |
| Clone | `wda_sbroenne_git_clone_v1328_20261104_m2p1` | 0 (90 s timeout cap) |
| Resolve HEAD | `wda_sbroenne_git_verify_head_20261104_m2p1` | 0 |
| Publish | `wda_sbroenne_dotnet_publish_v1328_20261104_m2p1` | 0 (240 s timeout cap) |
| Local help | `wda_sbroenne_wincli_help_v1328_20261104_m2p1` | 0 |
| Local version | `wda_sbroenne_wincli_version_v1328_20261104_m2p1` | 0 |

## Safety and provenance

- Release repository: https://github.com/sbroenne/mcp-windows ; source tag: https://github.com/sbroenne/mcp-windows/releases/tag/v1.3.28 .
- GitHub annotated tag object dereferences to the exact SHA above; the tag verification status is `unsigned`. SHA validation detects mismatch against inspected GitHub metadata but is **not cryptographic publisher attestation**.
- The tag's `LICENSE` is MIT (Copyright 2025 Sbroenne); preserve the notice if later redistributed.
- Official release ZIP assets contain the MCP server, **not** `wincli`; this build used pinned source and standard NuGet package restoration.
- The build evaluated third-party .NET project/package targets within the approved isolated folder. No SDK 10.0.401 install was necessary; no system-wide runtime, SDK, PATH, registry, scheduled task or service was modified.
- Only documented local informational CLI verbs (`--help`, `--version`) were run. No `wincli service`, GUI enumeration, desktop input, screenshot, VMware guest action, RIFT action or MCP connection was invoked.
- Verified post-trial Workbridge owner and root Git status; no restart or deployment against `dist/` or `.local/`. Preserve ignored staging until coordinator review; cleanup is a separate explicitly scoped operation.

## Informational-verb source audit and next gate

At tagged `src/Sbroenne.WindowsMcp.Cli/Program.cs`, `--help`, `--version`, `tools`/`commands` (including `--json`) and `guidance` are handled in the top-level switch and return **before** the `DaemonClient.EnsureRunningAsync` call. `tools --json` serializes the shared `ToolCatalog`, `tools` prints static `HelpText.Tools`, and `guidance` prints static ID-lifetime and automation guidance. Calling any normal `window`, `ui`, screenshot or input action proceeds through `EnsureRunningAsync`, which can start the hidden CLI daemon; those actions remain outside this pilot authorization.

Next proposed **separately authorized read-only** step: capture `wincli tools --json` and `wincli guidance` to bounded output, still without daemon; then choose a disposable, exactly identified Windows test app, measure `window find`/`ui snapshot` latency and state evidence against installed WinApp CLI 0.7.1. UIA reads would auto-start the CLI daemon and therefore require a new explicit coordination decision and post-test owner cleanup. Do not use live RIFT or VMware guests for initial comparisons.

Sources: https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp.Cli/Program.cs ; https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp.Cli/Service/DaemonClient.cs ; https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp.Cli/README.md ; https://learn.microsoft.com/en-us/dotnet/core/versions/selection .
