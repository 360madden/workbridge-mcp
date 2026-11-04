# Sbroenne MCP stdio lifecycle — isolated protocol-only proof

Status on 2026-11-04: ONE COORDINATOR-APPROVED PROTOCOL-ONLY RUN PASSED. This is an investigation artifact, not a Workbridge production provider.

The companion Node script, sbroenne-stdio-harness.mjs, uses installed @modelcontextprotocol/client 2.3.1 StdioClientTransport to launch the separate Sbroenne.WindowsMcp.exe MCP stdio server. It does not invoke the wincli named-pipe daemon or its auto-start path. It never calls a tool or accesses desktop/VM/RIFT state.

## Frozen artifact

- Upstream Sbroenne mcp-windows tag v1.3.28, commit 655b9fc92d03ad52a270067c6844ea1231c90559.
- Only launch path: C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-stdio-publish\Sbroenne.WindowsMcp.exe
- EXE SHA256: c74dfc9e46ee8e4db765561aa8c4b2eb5c7b7ce22b33b1300fffd3f17e47f0f9.
- Managed DLL SHA256: 99d3a37d98452f9b1d2f0ee44664ebdd0a422fcdf9f56fc869cd6fa38b6a9900.
- Runtimeconfig SHA256: 6df5b8a97420042ba676b33842afa9a19f9a4fbc2ab2c23fe5c80cec8c065e39.
- Caution: a full hash manifest of all multi-file .NET dependencies is not yet sealed. These three hashes support this disposable protocol test only.

## Exact completed Workbridge invocation (no automatic rerun)

Coordinator approved and completed job wda_sbroenne_stdio_protocol_20261104_001 through Workbridge terminal_run with cwd C:\work\workbridge-mcp, executable C:\Program Files\nodejs\node.exe, timeoutSeconds 90, and literal args:
1. investigations/windows-desktop-automation/prototypes/sbroenne-stdio-harness.mjs
2. --server
3. C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-stdio-publish\Sbroenne.WindowsMcp.exe
4. --timeout-ms
5. 20000

The Workbridge approval gate may display an Allow dialog and must not be bypassed. The executable runs through Workbridge command-host Job Object and leaves the live Workbridge owner untouched.

The script forces the SDK legacy negotiation path to avoid a second protocol-discovery process, supplies --tools ui_snapshot ONLY, and requires tools/list to return exactly one tool with this name. It does NOT call ui_snapshot; even read-only UI snapshots can traverse UI Automation and expose window content. Vendor stderr is drained and discarded, never reproduced.

## Output and failure meaning

One JSON receipt contains tool names/count, actualToolCalls=0, child PID, whether the specific owned child-process close event was observed, and protocol_passed / protocol_failed / unknown_outcome / blocked. The script waits for child close after SDK close; SDK close alone can return before the process exits.

- Verified job status=passed, exitCode=0, started 2026-11-04T21:59:55.709Z, ended 21:59:56.816Z (1.107 seconds Workbridge wall; 640ms harness runtime).
- toolNames=[ui_snapshot], toolCount=1, actualToolCalls=0, result=protocol_passed, reason=PROTOCOL_AND_ALLOWLIST_VERIFIED.
- SDK child PID 42064, ownedChildExited=true, processTreeSettlement=not-proven; Workbridge stdout 587 bytes, stderr 0, no truncation; 290 private vendor stderr bytes were drained and discarded.
- Workbridge owner stayed 0.16.4-dev PID 43508, instanceId 9aa9b65f-b34f-49a7-8b92-c7954bd4dc9a, 36 command slots. Exact evidence: benchmarks/sbroenne-stdio-protocol-2026-11-04.md.

IMPORTANT: ownedChildExited is proof only about the SDK-spawned direct child. processTreeSettlement remains NOT PROVEN because no Windows Job active-count or descendant proof is gathered. This is NOT semantic-action verification, and it does not authorize restart, retry, GUI input or deployment. A missing close confirmation is unknown_outcome and must be reconciled first.

Production remains HOLD pending a fully pinned dependency manifest, GUI session identity, cross-provider input lease, process tree settlement, target/HWND freshness, independently verified postconditions and staged WB-001 release/rollback.