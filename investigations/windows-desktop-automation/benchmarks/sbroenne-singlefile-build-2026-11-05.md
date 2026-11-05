# M3-P7 Sbroenne pinned self-contained single-file publish — build-only evidence

Date: **Thursday, November 5, 2026 (America/New_York)**. Status: **🟢 built and SHA-pinned; 🟡 single-file runtime and GUI/UIA untested**. This is a separate research artifact, not a replacement of the previously tested multi-file stdio server or Workbridge production desktop integration.

## Outcome

- The pinned upstream `sbroenne/mcp-windows` **v1.3.28** source commit is `655b9fc92d03ad52a270067c6844ea1231c90559`.
- Read-only inspection of that exact local source verified `build-standalone.ps1` SHA256 `251ab85cb97669fad6c34761582bb763c888f1a26ae00c74152fd6472d12deb5`, which recommends `-p:SelfContained=true`, `-p:PublishSingleFile=true`, `-p:EnableCompressionInSingleFile=true`, `-p:IncludeNativeLibrariesForSelfExtract=true`, `-p:PublishReadyToRun=false`. The server project `src/Sbroenne.WindowsMcp/Sbroenne.WindowsMcp.csproj` SHA256 is `f1afe2b8437533d41cf975102df8c61e79ae0a35e479c41bdd53a810d6a3aca1`; it targets `net10.0-windows10.0.22621.0`, WinForms and no WPF dependency.
- The earlier isolated multi-file publish had **304 files and 13 directories**, all enumerated without truncation by Workbridge. Only its three primary artifacts had been pinned in the M3-P6 protocol host. Thus that older host does **not** establish complete transitive dependency integrity.
- The new isolated publish yielded **exactly one file**: `temp/sbroenne-singlefile-publish/Sbroenne.WindowsMcp.exe`. Size **59,893,792 bytes** (~57.1 MiB), SHA256 **`ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128`**. Whole-directory recursive enumeration reported one file, no additional outputs. The old `temp/sbroenne-stdio-publish` directory was not replaced or modified.
- No attempt was made to run the new EXE; no UIA, WinApp, desktop, RIFT/VM, keyboard/mouse, service, system PATH, registry or boot configuration was changed.

## Commands and Workbridge receipts

Executed only inside the approved `C:\work\workbridge-mcp` project, with the previously confirmed .NET SDK **10.0.302**, no SDK installation, dedicated previously used task-local NuGet cache. New ignored output: `C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-singlefile-publish`.

```text
C:\Program Files\dotnet\dotnet.exe publish C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-mcp-windows-v1.3.28\src\Sbroenne.WindowsMcp\Sbroenne.WindowsMcp.csproj
  -c Release -r win-x64 --self-contained true
  -p:PublishSingleFile=true
  -p:EnableCompressionInSingleFile=true
  -p:IncludeNativeLibrariesForSelfExtract=true
  -p:PublishReadyToRun=false
  -p:PublishTrimmed=false
  -p:RestorePackagesPath=C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\nuget
  -o C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-singlefile-publish
```

- Build job `wda_sbroenne_v1328_singlefile_publish_20261105_m3p7`: **actual OS exit0**, ~15.1 seconds, no stderr/warnings, nontruncated log; bounded 240s.
- Workbridge `list_directory` recursive `limit=60` of exact new ignored output: one `Sbroenne.WindowsMcp.exe`, no truncation/skips.
- Workbridge `file_info` independently measured **59,893,792 bytes**; its `hash=true` guard returned `INVALID_ARGUMENT` for this large file, so a read-only bounded Windows PowerShell `Get-FileHash -Algorithm SHA256` was used instead.
- SHA job `wda_sbroenne_singlefile_hash_ps51_20261105_m3p7`: **actual OS exit0**, ~0.67 seconds, exactly `ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128`, no stderr/truncation. First `pwsh.exe` absolute-path attempt was not found and did not launch; the successful command was Windows `powershell.exe` from PATH.

## Important limitations / next gate

1. **Packaging and execution are distinct.** One file in publish is confirmed, but no startup, MCP handshake, `tools/list`, or GUI action from this new binary has been tested. The M3-P6 supervised successful protocol smoke used the **different existing multi-file server**.
2. Microsoft documents that `IncludeNativeLibrariesForSelfExtract=true` causes native runtime libraries to extract on startup. On Windows the default is `%TEMP%\.net`; a supervised, separate single-file pilot should set `DOTNET_BUNDLE_EXTRACT_BASE_DIR` to an **explicit owned, unique, ignored investigation subdirectory** before starting the .NET child, verify ownership and cleanup/settlement, and never assume the one-file publish means zero runtime files. [Microsoft .NET single-file deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/).
3. Pin the entire one-file binary by exact path/size/SHA, prohibit reparse/symlinks and unexpected sibling files, check before creating any child. An actual hash-mismatch negative test should use a **throwaway copy or an intentionally wrong expected digest**, never overwrite this pinned binary. A real integration must additionally bind the expected source commit, host binary and Node script hash.
4. Do not expose `ui_snapshot` execution until independent review of target manifest/lease freshness, no-focus semantics, sanitized result receipt, bounded cancellation and private Job0. The native v2 host remains compile-time **snapshot-disabled**.
5. Potential one-file startup cost and extraction behavior should be measured separately from provider/UIA latency; a single sample must not be treated as p95 or a production reliability result.

**Recommendation:** Promote this **single-file pinned artifact** to a separate opt-in, protocol-only v3 supervised candidate after private extraction-base design and source review. Retain the verified v2 multi-file protocol reference and leave Workbridge fully operational.
