# sbroenne wincli — static tool inventory and daemon-boundary audit

Date: 2026-11-04 (America/New_York). M2 Windows desktop automation investigation. **Static informational commands only; no daemon-backed UI operations executed.**

## Exact binary and observed informational commands

- Binary: `C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\wincli-publish\wincli.exe`
- Binary SHA-256 independently rechecked before this phase: `ecd1ad47a4e9d5e6bb4d55d53ed0119b42a3c1afd2e3a3e11f19afc4dbe46438`.
- Source: `sbroenne/mcp-windows` annotated tag `v1.3.28`, exact commit `655b9fc92d03ad52a270067c6844ea1231c90559`; built under host SDK `10.0.302`. Build evidence: `sbroenne-build-2026-11-04.md`.
- `wincli.exe tools --json`: job `wda_sbroenne_wincli_tools_json_v1328_20261104_m2p2`, exit 0, **72,982 characters**, untruncated, retrieved in three pages of 30,000 / 30,000 / 12,982 characters. Complete JSON parse succeeded.
- `wincli.exe guidance`: job `wda_sbroenne_wincli_guidance_v1328_20261104_m2p2`, exit 0, **7,589 characters**, untruncated.
- Both commands had 30-second bounded Workbridge `terminal_run` ceilings, cwd `C:\work\workbridge-mcp`, exact isolated executable path and unique request IDs.
- No `wincli window`, `ui`, `service`, keyboard, mouse, screenshot, process, clipboard, file, app or VMware/RIFT operation was invoked in this phase.

## Parsed MCP-equivalent tool catalog

The machine-readable catalog lists **18 tools**. This is a catalog of tool families, not a count of individual CLI subcommands; `window_management`, `keyboard_control`, `mouse_control`, etc. expose multiple actions.

| Family | Tools | Count |
| --- | --- | ---: |
| Application launch | `app` | 1 |
| Window management | `window_management` | 1 |
| UI Automation | `ui_batch`, `ui_click`, `ui_find`, `ui_read`, `ui_read_table`, `ui_select`, `ui_snapshot`, `ui_type`, `ui_wait` | 9 |
| Capture | `screenshot_control` | 1 |
| Input fallback | `keyboard_control`, `mouse_control` | 2 |
| File dialogs | `file_open`, `file_save` | 2 |
| Miscellaneous | `clipboard`, `process` | 2 |
| **Total** | | **18** |

### Functional mapping to currently deployed Workbridge

| Candidate family | Current Workbridge host MCP surface | Decision for investigation |
| --- | --- | --- |
| `window_management` | `desktop_windows` (exact HWND/PID discovery); host target checks also embedded in other tools | **Compare/replace per function**, not all window actions. Some candidate actions activate/close/move and are outside read-only gate. |
| `ui_snapshot`, `ui_find`, `ui_read` | `desktop_inspect` (bounded WinApp UIA tree of exact PID/HWND) | Compare element fidelity, target identity, complete/incomplete evidence, latency and payload. |
| `screenshot_control` | `desktop_capture_window`, `desktop_capture_vmware_host` | Keep current proven VMware capture until candidate capture is independently verified for accelerated graphics and focus restoration. |
| `ui_click`, `ui_type`, `ui_select`, `ui_batch`, `ui_wait` | No general production input MCP tool; isolated GUI-004 DesktopProbe helper exists under scripts | Possible additions/replacements behind Workbridge shared desktop lease and durable verified outcome; input is NOT authorized for this trial. |
| `ui_read_table` | No equivalent specialized host MCP tool | Consider specialized table reading only if UIA tree coverage proves reliable. |
| `file_open`, `file_save` | No first-class general dialog MCP operation | Promising native-dialog replacement candidate; supported helper labels are English-only; confirmation prompts require separate explicit decision. |
| `keyboard_control`, `mouse_control` | Synthetic guarded adapter code, not generic production tools | Requires exact target, session lease, foreground checks, after-action state and safe unknown-outcome recovery. |
| `clipboard`, `process`, `app` | Developer commands, not equivalent narrowly scoped GUI tools | Powerful but broader permissions; do not enable by default for read-only GUI pilot. |

At ~73 kB, the full JSON schema is useful for engineering discovery but unnecessarily large to include in every model request. Prefer concise `guidance`, selected command help and a narrow coordinator-advertised tool surface.

## Why information-only verbs did not start the CLI daemon

In tagged `src/Sbroenne.WindowsMcp.Cli/Program.cs`, `--help`, `--version`, `tools`/`commands` (including `--json`) and `guidance` return in a top-level switch **before** the later `DaemonClient.EnsureRunningAsync` call. `tools --json` builds MCP tool metadata using an in-process `ServiceCollection`/`WithToolsFromAssembly`; `guidance` prints static strings. The entry point sets process-local per-monitor DPI awareness. No daemon/window/UI action is dispatched by these branches.

**Important distinction:** Normal `window`, `ui`, and screenshot commands do call `EnsureRunningAsync` and may spawn an independent hidden `wincli.exe service run` process even when the requested action is read-only.

## Private daemon identity, stop boundary and failure modes (source audit only)

1. `DaemonIdentity.PipeName` hashes Windows user SID, logon SID, session ID, elevation, **full installation path**, build hash based on CLI+server assembly module IDs, and protocol version. The owner/startup named mutexes are scoped to current user/session. Our isolated publish location and specific binary build therefore imply a distinct pipe identity from a differently installed CLI. An exact-path/build/session/elevation match would be required to attach to the same owner.
2. `DaemonClient.EnsureRunningAsync` probes the exact private control pipe. If absent, it owns a startup mutex, checks owner status, then invokes **the same executable** through `Process.Start` with `UseShellExecute=true`, `WindowStyle=Hidden`, arguments `service run`; it does not register a Windows Service or startup task.
3. `wincli service status` goes through `DaemonClient.StatusAsync` **without EnsureRunningAsync**. An owned running daemon replies with `state`, `processId`, ephemeral `generation`, protocol and build. If no private owner exists it reports stopped; status alone is not proof of executable path or creation time. Verify PID/start/full image path separately before any stop.
4. `wincli service stop` uses the **same exact caller-derived pipe/mutex identity** and sends a `stop` control request, cancels that daemon's work and waits up to ten seconds for owner mutex release. The source explicitly does not terminate target applications. Do not stop an already-running or foreign owner unless the current pilot created and exclusively owns its exact PID/creation-time/image path/pipe.
5. Element IDs and automatic snapshot baselines are process-local. Daemon status generation is an in-memory GUID; no persisted CLI daemon registry/state file is established by the inspected service implementation. A daemon restart, different build, different session, or new installation invalidates observations.
6. A response lost after dispatch is explicitly **outcome unknown; do not automatically retry**. Normal actions are serialized by a process-local `_actionGate`; other MCP processes, other provider binaries and Workbridge's separate desktop input channel do **not** share that lock.
7. **Escape/hang risk:** `UseShellExecute=true` creates a separate hidden daemon that may not remain a Workbridge child or an isolated Job Object descendant. A 30-second Workbridge client timeout can leave the daemon alive. CLI UIA COM calls already in progress may overrun a timeout; `service stop` can fail on an unresponsive owner. Preserve exact evidence and quarantine rather than killing unrelated processes or overwriting the build.
8. **Rebuild hazard:** Because the pipe build key depends on assembly module IDs, replacing/rebuilding this publish directory while a daemon is running could make the new CLI unable to address the old owner. Stop and verify the specific owner **before** replacing these binaries; prefer separate immutable build directories.

Protocol IPC has a 4 MiB per-message frame cap; Workbridge developer output is separately bounded/paged. Read-only GUI results can contain private window/control names: use an in-memory allowlist projection before terminal logging rather than indiscriminately saving raw UIA trees.

## Target-selection correction and proposed next gate — NOT EXECUTED

**Source finding:** `WindowEnumerator.ShouldSkipWindow` unconditionally skips class `Shell_TrayWnd` and `Shell_SecondaryTrayWnd`, and normal `window list/find` excludes untitled windows. Furthermore, `window list` returns a slim result without PID/class. Thus the prior WinApp Explorer taskbar *discovery* benchmark is **not an equivalent candidate workflow**. Never treat missing taskbar from candidate `window list/find` as an overall automation failure or quietly substitute another window.

`ui snapshot --window <known-HWND>` follows `UISnapshotTool` → `WindowsToolsBase.CaptureSnapshotAsync` → `UIAutomationService.GetTreeAsync` → `GetRootElement`, which calls UIA `ElementFromHandle` directly. That path does **not** consult `WindowEnumerator` or call `ActivateWindowAsync`, so an exact externally supplied taskbar HWND may be inspected without candidate list discovery. This is a source-supported path, **not yet a verified host test**; read-only UIA can still block on providers.

For a strict initial **taskbar inspection-only** pilot, separately approve these guarded stages:

1. Workbridge captures a fresh read-only target oracle: `explorer.exe` PID + process creation UTC/session/path, exact taskbar HWND/class, monitor/DPI/bounds, lock state and foreground PID/HWND. Reject ambiguity, hidden/offscreen/minimized state and any identity drift; historical IDs are never reused.
2. From the verified isolated binary, run `wincli service status` with a 20-second bounded job. It must report `stopped` for this **specific install/build/logon/session/elevation** before proceeding; a running/unknown owner is an automatic stop pending identity review.
3. With separate authorization for an owned hidden daemon, run just `wincli ui snapshot --window <fresh-decimal-HWND> --max-depth 1 --mode full --include-diagnostics` from `C:\work\workbridge-mcp`, bounded 30 seconds. No `window list/find` for taskbar, no `--mode auto` unless a subsequent diff is explicitly needed; no foreground fallback (window argument mandatory). A reviewed in-memory projection should retain only structural counts, timing, selected safe control types and hashes, not raw UI text.
4. Independently re-read the Win32 oracle and require unchanged PID/start/HWND/class/session/foreground; classify no-output/partial-tree/timeout as failure or unknown, never as success merely from CLI exit 0.
5. Query private `service status`; verify running PID, generation, protocol, build and independently resolved executable full path/creation time are exclusively the trial's newly started owner. Only then run **that exact binary** `service stop` with bounded timeout, and verify status is stopped and process/pipe gone. Never terminate a preexisting owner, or run a destructive fallback if uncertain. Leave ignored evidence until reviewed.

This taskbar check is **inspect-only**, not an apples-to-apples discovery→inspect speed comparison. For the latter, use the existing titled disposable WinForms fixture (`scripts/helpers/DesktopProbe/Program.cs`, title `Workbridge GUI-004 Native Input Probe`, executable process `DesktopProbe`) under a separately approved limited-interactive launch/teardown gate. Example future read-only commands: `wincli window list --filter "Workbridge GUI-004 Native Input Probe"` (slim candidates), `wincli window find --title "Workbridge GUI-004 Native Input Probe" --process DesktopProbe` (all matching rich Windows `WindowInfo`, require one exact PID/HWND), `wincli ui snapshot --window <verified-HWND> --max-depth 1 --mode full --include-diagnostics`. Fixture auto-closes after 120 seconds and writes its own independent PID/HWND/counter journal. Never run it while Joey needs the game desktop.

## M2-P3 no-start status receipt and tightened pilot safety gate (2026-11-04)

- **Approved static-only invocation:** exact isolated SHA-pinned `wincli.exe service status`, Workbridge job `wda_sbroenne_wincli_no_start_service_status_20261104_m2p3`, `cwd=C:\work\workbridge-mcp`, 30-second cap, exit **0**, output **`{"state":"stopped"}`** (21 characters including CRLF), no daemon/GUI/VM action. This is evidence of *this installation/build/user/session/elevation* having no reachable daemon at the instant checked, not proof that future commands cannot create one.
- **RED discovery caveat (re-emphasized):** `WindowEnumerator.ShouldSkipWindow` filters Windows taskbar classes `Shell_TrayWnd` and `Shell_SecondaryTrayWnd`. Therefore candidate `window list/find` cannot fairly reproduce a taskbar discovery→inspection benchmark. Only `ui snapshot --window <fresh externally verified HWND>` directly addresses the known taskbar HWND, and that covers **inspection only**, not candidate discovery. Use the titled disposable DesktopProbe for a separate fair discovery benchmark if authorized.
- **RED daemon ownership hazard:** Normal `wincli window/ui ...` executes `DaemonClient.EnsureRunningAsync` before the operation; a missing/unresponsive owner triggers `Process.Start(CreateStartInfo())` with `UseShellExecute=true` to launch a hidden potentially detached daemon. Merely proving `service status` stopped before a command is **not** sufficient rollback protection. `service stop` is scoped to installation identity but has no caller-owned expected PID/generation argument.
- **Source-supported safer direction, NOT EXECUTED:** Workbridge's bounded `terminal_run` launches `scripts/Command-Host.cs` (which uses `Workbridge.ProcessLifetime.Attach()` and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) → `src/command-worker.ts` (native `spawn` with `shell:false`). Starting the exact isolated `wincli.exe service run` **as the foreground root command** in one bounded Workbridge job should let that Job Object own the daemon process, avoiding the hidden ShellExecute launch *for that startup*. Confirm process identity, session, path, creation time, Job membership and independent status first; shutdown must settle that one job and pipe. **However**, an unmodified second `wincli ui ...` client would still auto-start a detached daemon if the supervised owner exits during a race. Therefore require a separately approved **investigation-only fail-closed/no-auto-start client variant** (or an equivalently proven parent-owned direct RPC wrapper), plus synthetic escape/timeout tests, before any daemon-backed desktop inspection. Keep pristine pinned build and production Workbridge untouched.
- **Source evidence (all pinned/repo local):** candidate `Program.cs:75-110`, `Service/DaemonHost.cs:24-54,273-291`, `Service/DaemonClient.cs:52-112,115-157`, `Service/DaemonIdentity.cs:69-90`; Workbridge `scripts/Command-Host.cs:17-47`, `scripts/Tunnel-ProcessLifetime.cs:50-65`, `src/jobs.ts:438-503`, `src/command-worker.ts:48-55`. Workbridge `terminal_run` max 600 s; no process or runtime alteration performed in this receipt.

## Source references

- CLI entry/dispatch: https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp.Cli/Program.cs
- Daemon identity and hidden launch: https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp.Cli/Service/DaemonIdentity.cs
- Daemon IPC, autostart and stop: https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp.Cli/Service/DaemonClient.cs
- Daemon request handling/control: https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp.Cli/Service/DaemonHost.cs
- IPC frame bound: https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp.Cli/Service/DaemonProtocol.cs
- Window filter/source identity: https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp/Window/WindowEnumerator.cs
- Snapshot direct HWND root: https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp/Automation/UIAutomationService.Helpers.cs
- Snapshot dispatch: https://github.com/sbroenne/mcp-windows/blob/v1.3.28/src/Sbroenne.WindowsMcp/Automation/UIAutomationService.Tree.cs
