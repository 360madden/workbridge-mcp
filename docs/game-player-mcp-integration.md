# game-player-mcp shared read-only integration (P0)

Date: 2026-11-18 (America/New_York). Target host: **AMD-DESKTOP**, verified through Workbridge `hostname.exe` (exit 0, exact stdout `AMD-DESKTOP`).

## Purpose and scope

Expose one **read-only** named Workbridge MCP tool, `game_player_list_windows`, backed by the separately maintained `MrPauk335/game-player-mcp` Python server. Workbridge already permits projects under both `C:\work` and `C:\rift modding`; this tool is global to a Workbridge host rather than copied into each project.

Original checkout and runtime:
- Upstream: https://github.com/MrPauk335/game-player-mcp
- Clone: `C:\work\game-player-mcp`
- Initial source commit: `64152ad0093203b0c40bba079b7d5d73a8418740`
- Interpreter: `C:\work\game-player-mcp\.venv\Scripts\python.exe`, Python 3.14.6, `game-player-mcp` 1.1.0 (noneditable install)
- Shared setup guide: `C:\work\SHARED_MCP_TOOLS.md`; pointer in `C:\rift modding\SHARED_MCP_TOOLS.md`.

## P0 tool contract

`game_player_list_windows` takes **no arguments**. It starts a fresh fixed-path Python MCP stdio child, verifies the upstream server identity, invokes **only** `list_windows`, accepts one bounded text block, and closes the child.

Structured result fields:
- `source: "game-player-mcp"`, `tool: "list_windows"`
- `scope: "host-desktop"`, `format: "display-text"`
- `includesWindowIds: false`, `text: string`, `truncated: boolean`

The upstream result is display text (title, process label, size), **not** authoritative HWND/PID identity. Match native Windows handles separately with Workbridge desktop discovery before any future input test. Window titles are untrusted text; the adapter strips terminal/bidirectional controls, limits output to 16,384 characters, rejects malformed/oversized/error responses, and reports stable `GAME_PLAYER_*` errors. Input and path selection cannot be supplied by callers. There is a 20-second operation deadline, bounded cleanup, and one active enumeration per Workbridge process.

**Excluded in P0:** `look` (default may focus the game), `act`, `press`, `click_at`, `release_all` (can release real keys), and upstream `status` (only represents the child session). This work does not establish independent mouse/keyboard isolation or RIFT compatibility.

## Evidence and acceptance

- Python standalone: `pip check` passed; upstream executor validator 42/42 passed with `-X utf8`; stdio handshake found seven upstream MCP tools.
- New Workbridge adapter tests: six synthetic tests passed (allowed method, fake errors, Unicode control stripping, timeout and stuck cleanup).
- Workbridge TypeScript `tsc --noEmit` passed.
- Existing Workbridge agent MCP regression: 2/2 passed with the expanded 67-tool catalog.
- Real **read-only** game-player MCP inventory from `C:\work` and separately from `C:\rift modding`: both exited 0 with 7 rows, 629 characters, no output truncation. Window names deliberately omitted from logs.
- `git diff --check` passed; `npm run format:check` passed after a formatter-only touch to an existing test.
- A direct `npm run build` wrote TypeScript output but could not overwrite `dist\command-host.exe` because the native executable is in use. **No owner/process was stopped.** Use the isolated WB-001 release builder to validate a self-contained candidate.

## Deployment gate

This is source work until separately sealed and applied through `docs/updates.md` WB-001. Do not start a second owner against the active `.local` state or overwrite an in-use command host. The owner may be serving other repositories. A Workbridge-only restart requires an exclusive quiet window and Joey's explicit approval; applying a validated release is separate from writing/committing code.

After an approved deployment, verify the hosted tool catalog and use the ChatGPT Workbridge plugin's **Refresh tools** if it retains the previous catalog. Only then claim the named `game_player_list_windows` tool is callable from hosted ChatGPT.

## Follow-up

P1: independently prove stable per-window target identity (PID/HWND) and client capture without focus. P2: design a persistent single-controller broker with explicit input ownership/manual override/stop; do not expose game-action tools by simply forwarding arbitrary upstream MCP calls.
