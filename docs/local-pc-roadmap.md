# ChatGPT chat mode: practical local PC capabilities

Requested October 18, 2026. Build on Workbridge 0.6.0 and its existing
Secure MCP Tunnel, file tools, and terminal jobs. The objective is to let
ChatGPT create and save tools, run PowerShell and C#/.NET 10 helpers,
install needed software, and edit existing software configuration.

## Roadmap and completion gates

| Phase                          | Work                                                                                                                                                          | Completion evidence                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Inventory                   | Check live catalog, runtime version, roots, PowerShell, SDK, package manager                                                                                  | Passed through connected Workbridge; browser job token is not elevated                                         |
| 2. Helper lifecycle            | Save C# source, build net10.0, run helper, inspect generated JSON; edit and restore a disposable configuration                                                | Passed from ordinary browser Chat mode; exit 0 and .NET 10.0.10                                                |
| 3. Reusable workflow           | Use existing file tools and terminal jobs; keep helpers in named folders under C:\work; record purpose, commands, outputs and dependencies                    | Repeatable scripts and [ChatGPT operating guide](chatgpt-local-workflow.md)                                    |
| 4. Third-party software        | Inspect installed tools, exact publisher/package/source/version and scope; install and verify a useful JSON utility                                           | jq 1.8.2 installed in user scope through WinGet from ordinary ChatGPT; hash/version and JSON processing passed |
| 5. Real configuration          | Locate the exact application's effective config and reload mechanism; back up bytes, perform a targeted edit, validate, reload if needed, and verify behavior | Git core.quotePath behavior and byte-exact restore passed in a new isolated repository                         |
| 6. Ordinary ChatGPT acceptance | In a fresh browser chat with Workbridge selected, create/build/run a new helper and inspect its saved output                                                  | Passed in the Chat composer mode, using actual browser tool calls and saved artifacts                          |

No additional model API integration or API key is needed for the helper itself.
The existing tunnel continues to use its separately managed credential.
No runtime deployment or catalog expansion is required for the existing capabilities.

## Current implementation and limits

- `write_file`, `edit_file`, and directory tools support recoverable source/config
  changes inside configured roots, with hashes and operation IDs.
- `terminal_run` explicitly invokes PowerShell, dotnet, WinGet or another installed
  executable, with a literal argument array and workspace working directory.
- Commands run under the bridge's Windows account/token. A valid workspace cwd
  does not confine their filesystem/network effects to that directory.
- Jobs are noninteractive with closed stdin, up to 600 seconds and six concurrent
  jobs. Output is bounded and descendants are terminated when the root command
  exits, times out, is cancelled, or loses the server. Use polling and inspect
  the true exit code. Do not launch persistent apps/services as detached children
  and expect them to survive this lifecycle.
- Administrator privileges, UAC interactions, installer dialogs, reboot/resume,
  and long-running services require a concrete workflow beyond this probe.
  Do not assume the current token has administrator access or attempt a UAC bypass.
- Process writes are outside the file tool's undo journal. A PowerShell config
  edit needs its own backup/restore. Package installation needs the vendor's
  uninstall/recovery procedure and may not be fully reversible.
- Reuse the independent updater for Workbridge deployment/restart.

## Repeatable helper proof

Run from an existing allowed working directory through `terminal_run`:

```json
{
  "cwd": "C:/work/workbridge-mcp",
  "executable": "powershell.exe",
  "args": [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-File",
    "C:/work/workbridge-mcp/scripts/Test-LocalCapabilities.ps1",
    "-OutputDirectory",
    "C:/work/workbridge-helper-proof-UNIQUE"
  ],
  "requestId": "helper-proof-UNIQUE",
  "timeoutSeconds": 180
}
```

Use a new output directory for each deliberate run. After an uncertain response,
reuse the same requestId and arguments; do not start another installation or job.
Poll `command_status`, then `command_output`, and inspect `acceptance.json`.
The script retains its C# source, executable build, JSON result, config fixture,
backup, and acceptance report. It installs nothing and edits no real app config.

For actual tasks, have ChatGPT inspect installed capabilities, select or create
a small helper, save its source in a named C:\work folder, build/run it, and
verify its output before claiming success. Use supported CLIs before custom code.
Keep secrets out of source, arguments and captured output.

## Remaining evidence

Record live results below after running the probe. An installed WinGet executable
proves availability only; it does not prove package installation, source access,
elevation, or reboot handling. A fixture edit proves the mechanism only, not a
specific application's configuration semantics.

### Verified October 18, 2026

Connected Workbridge reports 0.6.0, readOnly=false, and roots C:\work and
C:\rift modding. Job `local-capabilities-inventory-20261018` passed with
PowerShell 5.1.26100.9711, .NET SDK 10.0.302, and WinGet v1.29.380.

Job `local-helper-proof-20261018-01` passed with exit code 0. It built the
saved C# project with zero warnings/errors, executed on .NET 10.0.10 X64,
returned `WORKBRIDGE_DOTNET10_HELPER_OK`, and verified the fixture config's
edit and byte-exact restoration. Retained artifacts:

- `C:\work\workbridge-helper-proof-20261018-01\Program.cs`
- `C:\work\workbridge-helper-proof-20261018-01\HelperProbe.csproj`
- `C:\work\workbridge-helper-proof-20261018-01\helper-result.json`
- `C:\work\workbridge-helper-proof-20261018-01\acceptance.json`

These initial calls used the hosted Workbridge connector from Codex. At that
initial milestone, no third-party package was installed and no real application
configuration was modified. The subsequent ordinary-chat evidence follows.

### Ordinary ChatGPT browser acceptance

[Verification chat](https://chatgpt.com/c/6ad5270d-cb88-83ea-94db-30cd76f51453)
was created in Chrome with composer **Chat** selected and **Work** unselected.
Workbridge was selected from the composer plugin menu. Command approvals used
**Allow once**; persistent permissions were not changed.

Job `browser-helper-proof-20261018-01` passed with exit 0, zero build warnings
or errors, and empty stderr. ChatGPT read both Program.cs and acceptance.json
through the actual file tools. Its report confirms .NET 10.0.10 X64, SDK
10.0.302, and byte-exact fixture restoration. Independent local readback also
confirmed equal fixture/backup SHA256 hashes. Artifacts are under:
`C:\work\workbridge-helper-proof-browser-20261018-01`.

Job `browser-config-proof-20261018-01` passed with exit 0. The installed Git
application changed its status display for a Unicode filename when its real
repository-local `core.quotePath` configuration changed from true to false.
The original `.git/config` was restored with matching before/after SHA256
`05BECDB83BB897F6103C8D91439E2E9092144EDF5B3955A746FCE4975C12BFDC`.
Artifacts and acceptance report are under:
`C:\work\workbridge-config-proof-browser-20261018-01`.
The process token reported elevatedAdministrator=false; elevation was not
attempted. This verifies a real tool's configuration in an isolated new
repository, not arbitrary existing-application settings or administrator access.

Job `browser-install-proof-20261018-01` installed **jqlang.jq 1.8.2** from the
`winget` source in **user** scope. `installed-before.txt` recorded no existing
package; `installation.txt` records successful download/hash verification and
installation. The script then verified `jq-1.8.2`, SHA256
`A6FC67FEDAF9128A3309A1E2EBB8B986AECCF70122EE46D2CB4849E423F0C627`, and
actual extraction of `WORKBRIDGE_DOTNET10_HELPER_OK` from the helper's JSON.
Saved evidence is under `C:\work\workbridge-install-proof-browser-20261018-01`.
The executable is
`C:\Users\mrkoo\AppData\Local\Microsoft\WinGet\Packages\jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe\jq.exe`.
WinGet added its user command alias/PATH entry; the running bridge was not
restarted, and the script used the actual executable path immediately.
The installed utility is retained for local workflows. Removal, if desired:

```powershell
winget uninstall --id jqlang.jq --exact --source winget --scope user --disable-interactivity
```

The publisher documents this WinGet route at
[Download jq](https://jqlang.org/download/). Microsoft documents the exact
ID/source/version/scope options in [WinGet install](https://learn.microsoft.com/en-us/windows/package-manager/winget/install).

### ChatGPT-authored helper

In the same ordinary browser chat, ChatGPT used `create_directory` and
`write_file` to author its own standard-library-only .NET 10 JSON inspection
helper, rather than invoking another prepared test. It retained these files in
`C:\work\workbridge-authored-helper-browser-20261018-01`:

- `AuthoredJsonHelper.csproj`
- `Program.cs`
- `README.md`
- `Run-Helper.ps1`
- `report.json` and the Release build output

The generated application parses an input JSON file and records its byte
length, root property count, SHA256, and executing runtime. The runner checks
the native build and helper exit codes. The saved report contains marker
`CHATGPT_AUTHORED_HELPER_OK`, 136 input bytes, four root properties, .NET
10.0.10, and SHA256
`08DC7EE3B32BCEB7340009FF8EC5FB9D7354E0B52CAF1462D006AD946D617461`.
Independent PowerShell readback compared all three file-derived values against
the original input and passed. Source and compiled output are retained for reuse.

Job `browser-authored-helper-20261018-01` passed with overall exit 0,
`BUILD_EXIT_CODE=0`, `HELPER_EXIT_CODE=0`, zero warnings/errors, and empty stderr.
The verification browser chat remains available at the link above. A screenshot
of its completed result is saved locally at
`C:\work\workbridge-mcp\.local\verification\chatgpt-local-pc.png`.

### Remaining task-specific scope

The baseline phases have ordinary-browser-chat evidence. The subsequent
[administrator/UAC and persistent helper phase](admin-and-persistent-helpers.md)
adds verified user-task persistence and locally approved/cancelled UAC diagnostics.
Real machine-changing elevated actions, GUI automation, pre-login services,
reboot continuation, and a particular existing application's settings remain
task-specific follow-on work. The fixed token diagnostic does not certify a
general privileged agent. Existing long-job limits do not require a new daemon
unless an actual task exceeds them.

Suggested fresh-browser-chat acceptance request:

> Use Workbridge to inspect docs/local-pc-roadmap.md in C:\work\workbridge-mcp.
> Run scripts/Test-LocalCapabilities.ps1 through terminal_run with a new unique
> C:\work\workbridge-helper-proof output folder. Poll the job to completion,
> inspect acceptance.json, and report the runtime, saved source/output paths,
> config restoration result, and actual exit code. Use the existing tools.

## Official connection references

- [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

These document ChatGPT MCP tools and the tunnel connection to private/local
servers. Account/workspace tool permissions still apply; source edits alone do
not refresh a connected catalog or deploy a runtime.
