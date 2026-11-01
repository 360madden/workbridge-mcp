# GUI-006 — Native desktop and VMware MCP tools

Date: October 26, 2026 (America/New_York). Repo: `C:\work\workbridge-mcp`.
Status: **0.16.4-dev sealed candidate; deployment/hosted acceptance is a separate gate**.

## Scope and five real subagents

Five separate, authenticated Codex CLI agent jobs ran concurrently via the existing Workbridge terminal tools, using exclusively owned paths:

1. Fixed-allowlist Node child execution: `src/desktop-cli-runner.ts` and tests.
2. Microsoft WinApp CLI read-only window listing/UIA inspection: `src/desktop-windows.ts` and tests.
3. Validated exact-window capture adapter: `src/desktop-capture-tool.ts` and tests.
4. Pinned RIFT-Lab-1 VMware host-frame capture: `src/desktop-vmware-tool.ts` and tests.
5. Hash-pinned PNG response loader: `src/desktop-image.ts` and tests.

Codex jobs: `wb-gui006-codex-worker1-20261026-01` through `worker5`. Every job completed with exit 0 and wrote its own receipt last under ignored `.tools/gui006-subagents-20261026-01/`. Source edits and tests were reviewed by the coordinator; workers made no live VM/game input, deployment or Git commits. There were no shared file writers.

Coordinator-owned integration: `src/desktop-registration.ts`, new registration tests, two-line `src/server.ts` registration, catalog tool-count tests, narrowly scoped process/GUI-turn security tests and release version/acceptance adjustments. WinApp and VMware prototype scripts are **reused, not rewritten**.

## New MCP tools (candidate has 56 total, from 52 installed)

- `desktop_windows`: bounded read-only WinApp window enumeration.
- `desktop_inspect`: exact fresh PID/HWND/process UI Automation tree inspection.
- `desktop_capture_window`: screenshot of a selected visible Windows window. A shared desktop input-turn lock now serializes this potentially foreground-changing operation with the already guarded VMware host-capture adapter.
- `desktop_capture_vmware_host`: exact RIFT-Lab-1 VMware Workstation host-frame screenshot through vmrun inventory and WinApp UIA state restoration. **No VMware guest input or guest receiver status is implied.**

Screenshots are emitted as MCP `image/png` content only after a second strict hash/bytes/dimensions/path/symlink check on the saved PNG, with bounded image size. Base64 image content is not duplicated into JSON metadata. Each capture is identified by a durable request ID and refuses stale/mismatched receipts.

Desktop scripts are selected from a fixed allowlist, executed without a shell or stdin, bounded by time and output size, and cannot receive tunnel/model/cloud/Git credential environment variables. Errors expose safe typed codes rather than arbitrary raw command output. No background service, new dependency, firewall or VM setting was added.

**General-purpose keyboard/mouse input is NOT part of this release.** The existing GUI-004b disposable DesktopProbe input proof remains source-only and is deliberately not exposed as an unrestricted MCP tool. Full arbitrary desktop/guest control requires a separate explicit lease, locked-desktop/race tests, and staged acceptance.

## Actual acceptance

- Source TypeScript build and formatting passed.
- Existing GUI tests and five worker adapter tests: **86 pass, one Windows file-symlink test skipped**; subsequent focused security suite **49 pass, one skip**. Added registration and exclusive GUI turn tests passed.
- Full source suite at 0.16.3-dev: **599 pass / one skip**.
- Versioned 0.16.4-dev suite final run: **600 pass / one skip / zero fail**, after one inherited timing-sensitive workflow test exposed a one-second retry startup budget. Its isolated suite passed 8/8 and its fixture-only timeout was changed to three seconds. The first failed full run remains preserved; production workflow semantics were untouched.
- **Live private MCP acceptance passed** with a disposable state directory, independent of deployed `.local`. The new 56-tool catalog listed all four tools. Exact-window WinApp discovery and UIA inspection succeeded. The new MCP VMware tool returned a **1215×878 PNG, 1,453,754 bytes, SHA-256 `c5fa26ad8aa39436c74a3b4eb6f2820f90e265a8af932450c6ad36ea6c1d0526`**. Image bytes and dimensions matched the tool metadata. Existing host window PID 9476/HWND 2230572 was initially minimized and restored to minimized, with no guest input. A separate follow-up enumeration confirmed the original 160×28 minimized state. Paths and PIDs are historical; rediscover before any future call.
- Evidence for this private MCP trial: `.tools/gui006-subagents-20261026-01/private-mcp-live-acceptance.json`.

## Sealed release and deployment boundary

WB-001 release candidate:
`C:\work\workbridge-mcp\.local\releases\gui006-20261026-01`.

`validated.json` reports version **0.16.4-dev**, **56 tools**, and **all seven release gates exited 0** (install, tests, startup, updater, format, generic, acceptance). Sealed manifest contains **3,062 files**, including all seven required GUI runtime/script paths plus server and release metadata. Independent source preflight normalized Windows manifest separators and confirmed original Git HEAD `fe841c46f9f41282a9dbcd36aed63394c05e76af` and an empty Git staging index. Existing extensive user-owned working-tree changes were preserved. No remote push, password, user Git staging or cross-repo edits.

**Current deployed version before activation is 0.16.3-dev / 52 tools.** Do not describe source/built 0.16.4 as deployed without a completed independent WB-001 update and a fresh connected/hosted `workspace_info` + tool discovery/acceptance.

Planned activation, only when active command slots are empty:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File scripts/Update-Workbridge.ps1 -Action Apply -OperationId gui006-activate-20261026-01 -ReleasePath 'C:\work\workbridge-mcp\.local\releases\gui006-20261026-01'
```

The independent Scheduled Task controller owns service shutdown, install, readiness and rollback; a Workbridge connection may briefly disappear. Afterwards inspect:
`powershell.exe -NoProfile -NonInteractive -File scripts/Update-Workbridge.ps1 -Action Status -OperationId gui006-activate-20261026-01`.
Preserve the operation ID and release seal; do not retry with a new ID on uncertain response. A fresh ChatGPT tool call is necessary to establish hosted availability; the browser/tool catalog may need refresh.

## Activation attempt — refused safely before changing the runtime

The independent updater was dispatched once as operation
`gui006-activate-20261026-01` on October 26, 2026. It returned a controller
preflight error at **2026-10-26T07:51:34.8305127Z**, with **no journal**,
no runtime replacement, no rollback, and the existing Workbridge service still
reporting **0.16.3-dev / 52 tools**. The Scheduled Task is no longer running.

The updater's local UTF-16 `probe.log` reported **0.16.4-dev / 56 tools**.
That is the *on-disk* rebuilt candidate in the same checkout used for the
currently running 0.16.3 service. Its health comparison correctly refused to
treat the disk and live owner as the same installed version. Running `npm build`
in this source/install root had advanced on-disk `dist/` ahead of the loaded
service. This is a deployment-topology issue, **not** evidence of a broken GUI
capture, absent VM, or failed seven-gate release candidate.

Retained incident record:
`.local/update-operations/gui006-activate-20261026-01/controller-error.json`;
the exact operation ID and `request.json` are preserved. Do **not** blindly
retry Apply with a new operation ID, weaken the preflight, force-restart the
currently healthy task into the mismatched disk build, or manually overwrite
a user-owned dirty checkout merely to satisfy the version comparison. The
original `wb022` rollback path needs to be identified and verified from
backups; a bounded read-only check found no separately validated
0.16.3 release in the current `.local/releases` inventory. Investigate
retained WB-001 backup history and plan a guarded restoration/cutover before
using this same update operation's supported recovery path.

**GUI-006 implementation, private MCP image acceptance and sealed release remain
valid. Live hosted GUI-006 availability is still UNVERIFIED/NOT DEPLOYED.**

Source commit is separately pending because `src/server.ts`, package files and prior 0.16.x implementation were already extensively modified/untracked by preceding work. Staging them wholesale into a new commit would include unrelated user-owned work. Do not `git add -A`, reset, stash or force-commit for this milestone.
