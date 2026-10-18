# Workbridge MCP

Inspect and edit local coding projects from **browser ChatGPT**, through OpenAI Secure MCP Tunnel. Default root: `C:\work`. Version **0.6.0** adds operator-managed roots, bounded nested repository discovery, scoped project context, and self-contained acceptance alongside developer commands, recoverable edits, Git inspection, and saved snapshots. See [multiple roots](docs/workspace-roots.md) for `C:\work` plus `C:\rift modding` access.

```text
Browser ChatGPT → OpenAI Secure MCP Tunnel ← outbound tunnel-client
                                                    ↓ stdio
                                              Workbridge MCP
                                                    ↓
                                                C:\work
```

One small TypeScript server and the official tunnel client. No Supergateway, public listener, custom HTTP layer, database, Docker, or model API integration is needed. `tunnel-client` owns the server child process. The tunnel needs its own runtime API key and account permissions; the MCP server itself needs no key.

This installation is active at **0.6.0**, with **33 tools** and two allowed roots: **`C:\work`** (default) and **`C:\rift modding`**. Windows sign-in startup and **Allow all actions for Workbridge** are preserved. WB-004 generic and hosted acceptance passed using disposable unrelated projects; both existing roots were preserved and neither real RiftReader repository was modified. See [hosted validation evidence](docs/validation.md).

## Windows setup

Requirements: Windows, PowerShell 5.1+ (PowerShell 7 recommended), Node.js 24+ with npm, and Git for Windows on PATH. Building the command host uses the built-in Windows .NET Framework C# compiler; the build fails clearly if it is unavailable. This checkout was tested with Node 26.5.0, npm 12.2.0, Git 2.55.0, MCP SDK 2.3.1, and tunnel-client 0.0.16.

```powershell
Set-Location C:\work\workbridge-mcp
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
.\scripts\Install-TunnelClient.ps1
```

The installer downloads the latest official Windows release from [openai/tunnel-client](https://github.com/openai/tunnel-client/releases/latest), verifies its published SHA256, and keeps the complete archive's binaries under ignored `.tools`. It records the executable location under ignored `.local`. No system PATH changes. Stop a running tunnel before updating its binaries.

If local policy blocks scripts, use a session-only setting, if your organization permits it:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
```

## Account setup — manual in your browser

1. Open [Platform Tunnels](https://platform.openai.com/settings/organization/tunnels), select the intended Platform organization, and create a private tunnel named **Workbridge** (or reuse a suitable existing tunnel). Copy the complete `tunnel_id`.
2. Associate the tunnel with **both** that Platform organization and the ChatGPT workspace where you will use it. Organization association alone may not make it appear in ChatGPT.
3. The creator needs **Tunnels Read + Manage**. The runtime-key principal and ChatGPT operator need **Tunnels Read + Use**. Workspace permission to add custom MCP servers is separate. If these controls are unavailable, resolve account/workspace access first.
4. In [Platform runtime API keys](https://platform.openai.com/settings/organization/api-keys), obtain a runtime key with the required tunnel access. Keep it for the hidden prompt below; do not paste it into chat, commands, or YAML. Do not use an admin key for the daemon.

These are account-specific steps. The initial Workbridge tunnel and ChatGPT plugin were created during guided setup; see [validation evidence](docs/validation.md) for current test status. Installation scripts do not create OpenAI account resources or credentials automatically.

## Configure and run

Replace the example ID with your real ID:

```powershell
Set-Location C:\work\workbridge-mcp
.\scripts\Configure-Tunnel.ps1 -TunnelId 'tunnel_YOUR_REAL_ID'
.\scripts\Start-Tunnel.ps1
```

`Configure-Tunnel` uses the official `init --sample sample_mcp_stdio_local` command and writes `.local\profiles\workbridge.yaml`. It uses absolute, quoted Node/server paths with forward slashes because the tunnel client's command parser treats backslashes as escapes. The script refuses to overwrite an existing profile. To change it, edit the ignored YAML deliberately; rerun configuration only after renaming your old profile.

`Start-Tunnel` uses `CONTROL_PLANE_API_KEY` if set, otherwise a saved Windows-protected key (see automatic startup below), otherwise a hidden prompt. A prompted key stays in the process environment only. It runs `doctor --explain`, then starts the foreground tunnel. **Keep this terminal open for manual runs.** Ctrl+C stops it. Restart the tunnel after a server build or failed child process. The launcher prevents two updated launchers from running from this checkout simultaneously.

The equivalent generated profile is:

```yaml
config_version: 1
control_plane:
  base_url: https://api.openai.com
  tunnel_id: tunnel_YOUR_REAL_ID
  api_key: env:CONTROL_PLANE_API_KEY
health:
  listen_addr: 127.0.0.1:0
log:
  level: info
  format: json
mcp:
  commands:
    - channel: main
      command: '"C:/Program Files/nodejs/node.exe" "C:/work/workbridge-mcp/dist/server.js"'
```

The launcher also passes `--mcp.stdio-send-initialized-notification` and writes the resolved health URL to `.local\health-url.txt`. The random loopback health port avoids conflicts with other tools.

In a second PowerShell terminal:

```powershell
Set-Location C:\work\workbridge-mcp
.\scripts\Get-TunnelHealth.ps1
```

Open the printed `/ui` address. Check `/healthz` and `/readyz`; the latter should return HTTP 200. `doctor` validates local configuration/executable paths; **it does not verify your key, tunnel permissions, hosted connectivity, or a successful stdio tool call**. Check the running client's readiness and logs too. `/health/mcp` may say `not_observed` until discovery has actually been forwarded.

## Automatic Windows startup

After the tunnel is configured, save your **existing tunnel runtime key** once and install the sign-in task:

```powershell
Set-Location C:\work\workbridge-mcp
.\scripts\Save-TunnelCredential.ps1
.\scripts\Install-Autostart.ps1
# Stop an existing foreground tunnel with Ctrl+C before starting this task.
Start-ScheduledTask -TaskName 'Workbridge MCP'
.\scripts\Get-TunnelHealth.ps1
```

The save script displays its destination, asks you to type `YES`, then accepts the key through hidden input. It stores ciphertext at `%LOCALAPPDATA%\Workbridge\runtime-key.dpapi`, outside the repo, using Windows DPAPI without a separate encryption key. Only the same Windows account on this computer can normally decrypt it. The directory grants access to that account and SYSTEM. No key is placed in task arguments, YAML, or a plaintext env file.

The **Workbridge MCP** task starts silently about 20 seconds after you sign in. It runs as your ordinary Windows user, without elevation or a saved Windows password, and uses built-in Windows PowerShell. `RemoteSigned` applies only to that task process; machine/user execution policies are unchanged. The task has no three-day time limit, can run on battery, ignores duplicate starts, and retries an unexpected exit up to three times at one-minute intervals. This is sign-in startup, not a service before login. Your computer must be awake and online for ChatGPT to reach it.

Implementation references: [Windows user-bound secure-string storage](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/convertfrom-securestring) and [Task Scheduler settings](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset).

The process-lifetime helper uses [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) only to ensure that stopping the task also terminates its native descendants.

Diagnostics go to UTF-8 `.local\logs\autostart.log`. At startup a log larger than 5 MiB is moved to `.previous`, retaining one previous file. A small Windows Job Object helper keeps the tunnel/server processes attached to the background wrapper: stopping the task terminates its children too. This addresses a verified Task Scheduler behavior that otherwise left the tunnel running. The normal tunnel reconnect behavior handles brief network interruptions; if its retries or task retries are exhausted, restart the task and inspect the log. A hosted request timed out immediately after one forced restart during testing; subsequent calls succeeded. Allow roughly 30 seconds for reconnection before retrying.

```powershell
# Status and recent logs
Get-ScheduledTask -TaskName 'Workbridge MCP'
Get-ScheduledTaskInfo -TaskName 'Workbridge MCP'
Get-Content .\.local\logs\autostart.log -Tail 40

# Restart, including after rebuilding the server or replacing the saved key
.\scripts\Restart-Workbridge.ps1

# Turn automatic startup off (also stop the current background instance)
Disable-ScheduledTask -TaskName 'Workbridge MCP'
Stop-ScheduledTask -TaskName 'Workbridge MCP'

# Turn automatic startup on again
Enable-ScheduledTask -TaskName 'Workbridge MCP'
Start-ScheduledTask -TaskName 'Workbridge MCP'
```

To replace the runtime key, rerun `Save-TunnelCredential.ps1` at its recorded credential path (see below) and restart the task. To remove the saved key, stop the task and delete only the credential file recorded in `.local\autostart.json`. A missing/unreadable saved key makes unattended startup fail clearly rather than hang on a prompt. Rerunning `Install-Autostart.ps1` updates this checkout's task; it refuses to replace a differently configured task of the same name.

**Packaged-app setup:** A prompt opened by packaged Codex can save into Codex's redirected `AppData`, while Task Scheduler sees the ordinary profile. This was observed during setup. The installed task therefore uses the existing encrypted file's physical path explicitly; no key was copied or entered again. `.local\autostart.json` records that path as metadata, and reinstalling the task preserves it. For key rotation or a manual foreground run, use the recorded path:

```powershell
$workbridgeStartup = Get-Content .\.local\autostart.json -Raw | ConvertFrom-Json
# Replace the saved key, if needed; use its existing location.
.\scripts\Save-TunnelCredential.ps1 -CredentialPath $workbridgeStartup.credentialPath
# Or run manually after stopping the scheduled task.
.\scripts\Start-Tunnel.ps1 -CredentialPath $workbridgeStartup.credentialPath
```

If setting up from a packaged application in the future, confirm the physical ciphertext path and pass `-CredentialPath` to `Install-Autostart.ps1`. Do not copy ciphertext to a new location or replace a working task's path just because a different process cannot see the logical path.

Windows startup tests use temporary, noncredential fixtures, including a separate Windows PowerShell process to verify DPAPI decryption:

```powershell
npm run test:startup
if ($LASTEXITCODE -ne 0) { throw 'Startup tests failed' }
```

## Connect browser ChatGPT — manual UI step

With the tunnel running:

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins) in your intended workspace. Current OpenAI docs call this **Plugins**; some UI rollouts still use **Apps/Connectors**. Enable developer mode if the custom-MCP control requires it and your account permits it.
2. Select **+ → Add custom MCP server**. Name it **Workbridge**.
3. Under **Connection**, choose **Tunnel**. Select the same tunnel or paste its complete ID. Do not enter `localhost` as a remote URL.
4. Choose **No authentication** for this stdio server, if the form asks about server authentication. OpenAI tunnel access is separately enforced by your key and organization/workspace associations; Workbridge has no additional OAuth layer.
5. Review the warning, select **I understand and want to continue**, and **Create as a plugin**. Complete any install/connect step the UI presents.
6. In a new browser chat, enable/select Workbridge from the available plugins/tools. Ask:

   > Use Workbridge. Show the configured roots, discover projects in my chosen folder, inspect its README and source, and report the relevant file paths and line numbers.

Version 0.6.0 advertises **33 tools**. A local test or a ready health endpoint alone does not prove hosted retrieval. See [validation evidence](docs/validation.md).

For an existing connected plugin, prepare and apply a validated release through the independent [WB-001 updater](docs/updates.md), then open **Manage Workbridge → Refresh tools** in ChatGPT. Review the expanded write/command access before enabling it. ChatGPT's plugin permissions determine whether actions ask first. The bridge does not bypass those controls. The existing tunnel and saved key are reused.

## Tools and behavior

| Tool | Purpose |
| --- | --- |
| `workspace_info` | Primary root, all allowed roots, limits, path rules |
| `discover_projects` | Immediate folders or bounded recursive discovery; repository/worktree identity |
| `list_directory` | Optional recursion, filename substring filter, offset pagination |
| `read_file` | Source text with one-based line numbers and continuation |
| `search_text` | Recursive literal text search, paths/lines/excerpts |
| `git_status` | Branch and staged/unstaged/untracked status |
| `git_diff` | Unstaged, staged, or base-commit diff; optional path filter |
| `git_history` | Commit hashes/dates/authors/subjects, path filter and pagination |
| `file_info`, `project_overview`, `diagnostics` | Metadata/hashes, manifest evidence, bridge health |
| `write_file`, `edit_file`, `create_directory` | Create text/directories and exact conflict-checked edits |
| `move_file`, `delete_file` | Individual file renames/moves and recoverable deletion; empty directories only |
| `change_list`, `change_status`, `undo_change` | Durable operation IDs, current-file checks, conflict-aware undo |
| `terminal_run` | Explicit executable, arguments, and project working directory; bounded noninteractive developer commands |
| `commands_list`, `command_run`, `command_status`, `command_output`, `command_cancel` | Fixed profiles and shared job polling/cancellation; combined or separate stdout/stderr |
| `git_read_file`, `git_compare`, `git_blame`, `git_commit` | Historical source, commit comparisons/blame, selected-file local commits |
| `snapshot_manifest`, `snapshot_cache`, `snapshot_read`, `snapshot_search` | Saved raw/gzip dumps, pose/segment/address mapping, streaming decompression, typed values and byte searches |

File/directory paths are primary-root-relative (`example/src`) or absolute inside any allowed root. Git `project` identifies the checkout; Git `path` filters are relative to that checkout. Projects within an allowed root need no registration. Use the [local root manager](docs/workspace-roots.md) to add an unrelated folder. `discover_projects` defaults to immediate children; set `recursive=true`, `maxDepth` (1–12, default 4), and follow `nextOffset` for grouped/nested repositories. Its bounded scan reports truncation. `project_overview` distinguishes folders, repositories, and worktrees and identifies scoped AGENTS/README evidence without executing it.

- UTF-8/BOM UTF-16 reads are streamed with no total file-size cap. Output is capped at 60,000 characters; each call scans at most 64 MiB/about five seconds. Supply the returned `cursor` with the same path for efficient continuation; cursors expire when the file changes or server restarts. `totalLines` is null until EOF. Enormous lines can be clipped and a preceding line exceeding a whole scan budget returns `LINE_LIMIT`. These are bounded text reads, not a binary inspection API.
- SHA256 is returned by reads for files up to 16 MiB; `file_info(hash=true)` also hashes editable-size files. Creates/edits/moves/deletes and their undo backups are limited to 16 MiB per file. This is separate from large-text read support. Existing encoding/BOM/EOL are preserved when editing/replacing text.
- Saved binary snapshots use separate byte-range tools with no whole-file size cap. Raw files need no preparation; gzip is streamed into a private disk cache with a 32 GiB total budget. Reads return at most 4 KiB, typed decoding at most 128 values, and byte searches at most 64 MiB/about five seconds per page. These are per-call output/work bounds, not a 2 MiB snapshot limit. See [snapshot workflow](docs/snapshots.md), including cache cleanup and capacity configuration.
- Listing/search excludes `.git`, links/junctions and generated folders by default. `includeGenerated` includes generated folders. Search additionally honors Git ignore rules unless `includeIgnored=true`; listing does not interpret `.gitignore`. Workbridge runtime state is protected from file tools. There is no blanket filter for other project credential/hidden files.
- Search uses pinned, bundled Microsoft ripgrep: literal by default, optional Rust regex/globs, sorted live offset pages, at most 100 matches/page, 20 seconds and 2 MiB of captured search-protocol output. Time/output truncation requires a narrower search; `nextOffset` is only provided for result-count pagination. Skipped counts unavailable from the backend are null, rather than invented.
- Listing offsets refer to live filesystem enumeration, not a sorted snapshot. Files changing during inspection can shift pages. Read/search results also reflect live files.
- Git uses fixed arguments and no shell; optional index locks, fsmonitor, external diff/textconv helpers, signature display, and submodule traversal are disabled. Git commands have a 15-second timeout and 1 MiB capture limit; displayed output is capped at 60,000 characters. These commands inspect already trusted local checkouts; this is not an OS security sandbox against concurrent malicious filesystem/config changes.
- Tool annotations distinguish reads from mutations. File edits are recoverable; configured commands execute trusted project code and may write files or access the network. Root/path checks are not a process sandbox. Git commits use normal hooks/signing and never push. Retrieved text remains untrusted data; requested project data is shared with ChatGPT.
- Diagnostics go to stderr as JSON (tool, success/error code, elapsed time), without source bodies or key values. stdout is exclusively MCP. Do not enable tunnel raw-HTTP logging for ordinary troubleshooting.

Change the root for a run, if needed:

```powershell
.\scripts\Start-Tunnel.ps1 -Root 'D:\Projects'
```

## Editing, undo, and validation commands

See [coding workflow and tool examples](docs/coding-workflow.md) for operation IDs, hashes, command profiles, recovery, and local commits; [snapshot inspection](docs/snapshots.md) covers saved memory files. Double-click **Workbridge Status.cmd** for task/tunnel/version diagnostics without Codex.

For runtime updates, use the [staged update and recovery workflow](docs/updates.md): validate a separate release, then let an independent scheduled controller install it with backup, health checks, and automatic rollback. Source edits do not deploy a release. The original `.\scripts\Restart-Workbridge.ps1` remains available for a deliberate restart of the current runtime; it waits for Task Scheduler to finish stopping the old process and reuses the saved key.

Configure the bridge's own fixed validation commands once:

```powershell
Set-Location C:\work\workbridge-mcp
node .\scripts\configure-self-commands.mjs
```

Profiles run the full package build/test lifecycle, including the Windows command host. The default project key is the installation’s absolute path. Existing relative project profiles retain precedence over same-named absolute profiles. Differing existing profiles are reported and preserved; migrate them explicitly when ready. `WORKBRIDGE_STATE_DIR` selects another private state directory. Profiles are stored in ignored, operator-owned `.local\commands.json`. File tools cannot edit runtime state. Existing command profiles are preserved. Dynamic developer commands use `terminal_run` without a profile; its cwd validation is not an OS sandbox. See [terminal workflow and limits](docs/coding-workflow.md).

## Validate and troubleshoot

```powershell
npm test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
npm run test:startup
if ($LASTEXITCODE -ne 0) { throw 'Windows startup tests failed' }
npm run format:check
if ($LASTEXITCODE -ne 0) { throw 'Formatting failed' }
npm run acceptance
if ($LASTEXITCODE -ne 0) { throw 'Generic acceptance failed' }
```

Tests use temporary repositories and a real MCP stdio client; no account key is required. Default acceptance owns an isolated arbitrary root/state outside the existing roots, exercises Node failure → guarded fix → pass, plain folders, Git, undo and gzip snapshots, then removes its fixtures. Evidence is saved to `WORKBRIDGE_STATE_DIR/acceptance.json` (default `.local/acceptance.json`). It does not inspect either real RiftReader checkout.

Optional existing-project inspection requires explicit inputs: `npm run acceptance:project -- <project-path> <literal-query>`. The saved-snapshot scenario is opt-in with `npm run acceptance:snapshot -- <manifest-path>`. These are read-only compatibility scenarios, not prerequisites for installing Workbridge.

| Symptom | Next check |
| --- | --- |
| Tunnel absent from ChatGPT | Intended workspace association and operator Tunnels Read + Use; paste exact ID if supported |
| Missing custom MCP / Tunnel controls | ChatGPT account rollout, developer mode, workspace controls, Platform permissions |
| Polling 401/403/404 or readiness failure | Correct runtime key, owning organization, tunnel ID/associations; inspect `/ui` logs |
| Connection refused at health URL | Tunnel stopped or stale health file; restart `Start-Tunnel` and rerun health script |
| Tools absent or child exits | Rebuild; check Node/server paths in YAML and stderr. Start server via `node dist/server.js`, without npm banners |
| `read_file` returns `{}` in ChatGPT | Use version 0.1.1 or later, rebuild, restart the tunnel, then Manage Workbridge → Refresh tools; try a fresh chat |
| `This response couldn't load` after tool calls | A fresh chat and one reload displayed the verified answer during setup; check tunnel health separately. Repeated failures can be a ChatGPT display issue even when retrieval succeeds |
| `OUTSIDE_ROOT` / `LINK_NOT_ALLOWED` | Use the actual path within root; junction targets are not followed |
| Search incomplete | Read `truncated`/skip counts; narrow the directory, glob, or query |
| Git error | Read the returned Git diagnostic; verify Git PATH and trusted checkout ownership; do not globally disable Git ownership checks |

`npm start` by itself waits for an MCP client on stdin; that is expected. For manual protocol-independent startup only: `$env:WORKBRIDGE_ROOT = 'C:\work'; node .\dist\server.js`.

## Design and verified status

All application code is new. Only the old `mcp2` README/package metadata were inspected for lessons; none of its code or architecture was copied. Direct tunnel-to-stdio support removes the need for a gateway/HTTP lifecycle. [Microsoft's ripgrep package](https://github.com/microsoft/vscode-ripgrep) supplies the platform binary through npm, without runtime downloads; [jsdiff](https://github.com/kpdecker/jsdiff) supplies bounded source diffs. Small modules separate paths/Git, text paging, changes/undo, search, jobs, and overview. See [validation evidence](docs/validation.md) for completed tests and hosted rollout status.

Requirements checked on **October 17, 2026**: [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [official tunnel onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md), and [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk). Browser UI labels and account availability can differ; the installed CLI's help and current official documentation are the setup references.
