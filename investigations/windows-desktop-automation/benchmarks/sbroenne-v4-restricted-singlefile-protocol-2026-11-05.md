# M3-P9 — Sbroenne single-file MCP protocol with restricted Windows environment (2026-11-05)

Status: **PASS, protocol-only**. One preapproved bounded Windows host job completed with native OS exit 0, validated MCP `tools/list`, supervised private Job settlement to zero, and no desktop/UIA command. **This is NOT evidence of successful desktop automation or isolation of every external process/file side effect.**

## Scope and explicit prohibitions

- Existing Workbridge service and daily development workflow preserved; source lives in investigation-only `prototypes`; executable lives in ignored investigation `temp`.
- Real upstream server: `sbroenne/mcp-windows` tag `v1.3.28` source commit `655b9fc92d03ad52a270067c6844ea1231c90559`, previously built with .NET SDK 10.0.302, self-contained single-file.
- Sbroenne stdio server starts with `--tools ui_snapshot`; the Node MCP client issues ONLY `connect` and `listTools`, verifies one advertised tool named `ui_snapshot`, and closes. No `tools/call`, no `ui_snapshot` execution, no window enumeration, no screenshot, no focus/input/VM interaction, no `wincli` daemon.
- Native launcher creates a restricted, sorted, seven-key Unicode environment for Node (`PATH`, `SYSTEMROOT`, `WINDIR`, `TEMP`, `TMP`, `DOTNET_BUNDLE_EXTRACT_BASE_DIR`, `MCP_WINDOWS_TIMEOUT_MS`); MCP JS SDK adds only its hardcoded default keys from Node's already restricted environment plus explicit extraction/timeout overrides. The sampler checks the 20-bit selected-key presence mask `11111100000000000000` before starting the vendor server; this proves the selected allow/deny key names, not that all other possible keys were measured.
- Private native Job with suspended Node assignment before resume, PID census after server ready, and three stable empty samples before host exit. Host is outside its private Job. Job Active0 is stronger lifecycle proof than just Node's `close` event; it still does not by itself rule out a process escaping before/elsewhere.
- Two per-sample owner-only ignored extraction and scratch directories, checked empty initially and counted after Job settlement. Retained for audit. `DOTNET_BUNDLE_EXTRACT_BASE_DIR` sent to vendor. A zero local count does not prove .NET or native dependencies left no files **outside** those directories.

## Exact source provenance

| Artifact | SHA256 |
| --- | --- |
| `prototypes/Sbroenne-RestrictedVendor-Host-V4.cs` (new) | `2d48fbfeb49571db7310a18472b2cd14ef23ef0791f7d99df03154be8f384402` |
| `prototypes/sbroenne-v4-restricted-singlefile-protocol.mjs` (new) | `2b91b063b298c5fcc0fa8a10fe626afc163dbc7f04429b08f768bedbbed65b9c` |
| `prototypes/Sbroenne-SuspendedEnvNode-V31.cs` (unchanged) | `24ad770224d91c33e75f8abf7c152cb75e263d255447c87e971fd3349adaa0ca` |
| `prototypes/Sbroenne-PrivateJob-V2.cs` (unchanged) | `55a3571647fcb525c605d7f922e63885809ec01dffd9f3a88f00f882ff6f9b30` |
| `temp/Sbroenne-RestrictedVendor-Host-V4.exe` (ignored compiled) | `2c78c7c50f460d82e710ee43a275cdb2027cf40c1630a1e84d591c05c71c1b21` |
| `temp/sbroenne-singlefile-publish/Sbroenne.WindowsMcp.exe` (ignored, sole file, 59,893,792 bytes) | `ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128` |
| `C:\Program Files\nodejs\node.exe` (host pins) | `119d6fa70e6ae1b15b90688ab6bcc8e3a2819acea021af196895cab1843645af` |
| Installed MCP SDK `stdio.mjs` (source-audited) | `af887c8972a37b8c3fcc78192d8f1d56c099bf8ca365f4843ec51ced6f5650da` |

Compilation and JS syntax checks (no server launch):
- `wda_m3p9_vendor_host_source_compile_20261105_a01` — .NET Framework64 C# compiler, `target:winexe`, V4 host + unchanged native V31 launcher/Job helper, exit 0, no warnings; ignored binary as pinned above.
- `wda_m3p9_vendor_protocol_syntax_20261105_a01` — `node.exe --check` V4 Node source, exit 0.
- Independent FLAUI source audit approved **one** narrowly bounded protocol-only compatibility smoke, with GUI/UIA HOLD.

Large binary SHA preflight:
- `wda_m3p9_vendor_pinned_hash_20261105_a01`: direct `certutil.exe -hashfile <exact isolated Sbroenne.WindowsMcp.exe> SHA256`, exit 0, matches `ce18a73e...`. Workbridge's file_info editable-size limit cannot hash this 59.9 MB file, so certutil was used.
- Directory listing found exactly one EXE in isolated `temp/sbroenne-singlefile-publish`; no global PATH, machine SDK, service or production changes.

## One preapproved runtime receipt

| Field | Observed |
| --- | --- |
| Workbridge request/job ID | `wda_m3p9_vendor_restricted_protocol_smoke_20261105_a01` |
| Executable | `C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\Sbroenne-RestrictedVendor-Host-V4.exe` |
| Args | `protocol - mcp_v4_restricted_20261105_a01` |
| cwd | `C:\work\workbridge-mcp` |
| Bound | 90 s (normal Workbridge approval gate) |
| Start / end (UTC) | 2026-11-05 23:58:42.821 / 23:58:44.646 |
| Workbridge state / actual OS exit | `passed` / `0` |
| Native result | `RESULT:success:PROTOCOL_ONLY:none` |
| Job assigned after suspended create | `HOST:ASSIGNED_SUSPENDED:69224:ACTIVE:1` |
| Job member census at ready | `HOST:READY_MEMBERS:4:RUNNER:69224:SERVER:62892` |
| Private extraction/scratch after settlement | `HOST:PRIVATE_ITEMS:0:0:RETAINED_FOR_AUDIT:1` |
| Final settlement | `HOST:SETTLED:0:RUNNER:69224:SERVER:62892:DURATION_MS:1328` |
| Output / stderr | 253 bytes fixed host stdout / 0 stderr bytes |
| Follow-up attempts | None. One vendor runtime only. |

Exact sanitized host stdout:

```text
HOST:PRIVATE_ENV_ROOTS:2
HOST:ASSIGNED_SUSPENDED:69224:ACTIVE:1
HOST:READY_MEMBERS:4:RUNNER:69224:SERVER:62892
RESULT:success:PROTOCOL_ONLY:none
HOST:PRIVATE_ITEMS:0:0:RETAINED_FOR_AUDIT:1
HOST:SETTLED:0:RUNNER:69224:SERVER:62892:DURATION_MS:1328
```

## Verdict and next gate

**M3-P9 = GREEN (single-file vendor MCP protocol compatibility under restricted Node environment and private Job, with observed Job0).** Synthetic M3-P8 had previously proven the expected environment-mask oracle; this run also asserts Node-side presence, but does not expose environment values or vendor-side environment diagnostics. Neither is a live GUI/UIA result.

**GUI/UIA remains HOLD:** Before any real `ui_snapshot` call, independently confirm no foreign active desktop-input lease/quarantine; exact desktop target PID/process start/HWND/session/owner SID; fixture watchdog and read-only observer; pin full binary/extraction/launcher identity; explicit no-focus, bounded latency and before/after UI+foreground+native journal checks; establish ability to contain any outside-Job process and external extraction path. A passing catalog handshake alone must not be promoted to desktop capability.

No Workbridge service, Windows registry, PATH, TaskScheduler, desktop window, physical RIFT client, VM or production source was changed.
