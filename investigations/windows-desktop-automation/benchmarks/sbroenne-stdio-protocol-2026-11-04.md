# Sbroenne MCP stdio — bounded protocol-only verification

Date: 2026-11-04. Status: PASSED, one coordinator-approved isolated run. This is an MCP handshake/allowlist/process-lifetime probe, not a GUI, UIA, VMware, RIFT or application-outcome test.

## Exact test provenance

- Source upstream: sbroenne/mcp-windows tag v1.3.28, commit 655b9fc92d03ad52a270067c6844ea1231c90559.
- Harness: investigations/windows-desktop-automation/prototypes/sbroenne-stdio-harness.mjs; SHA-256 31ffeabf203676196bfe611b8d1eec22df685ac2f1a5d9ab9fcda8357cceb393. Confirmed unchanged immediately before run.
- Workbridge job ID: wda_sbroenne_stdio_protocol_20261104_001.
- Native command: C:\Program Files\nodejs\node.exe.
- Cwd: C:\work\workbridge-mcp.
- Literal args: investigations/windows-desktop-automation/prototypes/sbroenne-stdio-harness.mjs ; --server ; C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\sbroenne-stdio-publish\Sbroenne.WindowsMcp.exe ; --timeout-ms ; 20000.
- Workbridge timeoutSeconds: 90. Harness internal deadline: 20,000ms. Normal Workbridge Chat-mode approval gate retained.
- Artifact pin check passed: EXE c74dfc9e46ee8e4db765561aa8c4b2eb5c7b7ce22b33b1300fffd3f17e47f0f9; managed DLL 99d3a37d98452f9b1d2f0ee44664ebdd0a422fcdf9f56fc869cd6fa38b6a9900; runtimeconfig 6df5b8a97420042ba676b33842afa9a19f9a4fbc2ab2c23fe5c80cec8c065e39.

## Independently observed Workbridge job result

| Field | Result |
| --- | --- |
| startedAt UTC | 2026-11-04T21:59:55.709Z |
| endedAt UTC | 2026-11-04T21:59:56.816Z |
| Job wall time | 1.107 seconds |
| status / exitCode | passed / 0 |
| completionPending | false |
| stdout / stderr | 587 / 0 bytes |
| outputTruncated | false |
| Harness elapsed | 640ms |
| Vendor stderr drained privately | 290 bytes; none leaked as text |
| Result / reasonCode | protocol_passed / PROTOCOL_AND_ALLOWLIST_VERIFIED |
| MCP toolNames / toolCount | [ui_snapshot] / 1 |
| MCP actualToolCalls | 0 |
| SDK-spawned direct child PID | 42064 |
| Specific child close event | observed, ownedChildExited=true |
| Entire Windows Job descendant tree | NOT PROVEN |

The harness used Model Context Protocol Client SDK 2.3.1 with StdioClientTransport and explicit legacy negotiation. The published Sbroenne MCP stdio server is a separate process from wincli named-pipe daemon. It was launched with the one-tool allowlist only, and no ui_snapshot or other tools/call was invoked. The tool name was returned during tools/list; it was NOT used to read any windows.

The direct child close callback supports that the particular SDK child process exited. Workbridge command-host was used to supervise the command. However, this one receipt did NOT read the Windows native Job Object active-process count, so grandchildren/process-tree settlement remains explicitly unproved. Protocol_passed is not semantic-action verified_success, and neither a provider ACK nor a process exit proves a target application's outcome.

## Post-run health and decision

A read-only Workbridge workspace_info immediately afterward still reported 0.16.4-dev, owner PID 43508, unchanged instanceId 9aa9b65f-b34f-49a7-8b92-c7954bd4dc9a and 36 command slots. No Workbridge owner service update, daemon start/stop, UIA/COM read, focus, keyboard/mouse injection, host/guest VM operation or live RIFT interaction occurred.

Decision: GREEN for the narrowly scoped MCP initialization plus single-tool exposure; YELLOW for unproven descendant settlement and incomplete full .NET dependency manifest; RED/HOLD for unattended input and production desktop backend replacement. Before any GUI comparison, independently prove target PID+creation time/HWND/session, full process containment, lease coordination, after-action evidence and unknown-outcome recovery. No automatic rerun or further server command is authorized by this result.
