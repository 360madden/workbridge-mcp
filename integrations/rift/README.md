# RIFT Research Companion — offline P0

Standalone Node.js 24+ CLI inside Workbridge-MCP. It reuses the existing RIFT Personal Teleporter Python position analyzer and reads **saved** Telemetry JSON/JSONL. It does not build another native reader, addon, debugger or input controller.

The coordinated offline research session identifies an **on-disk** AMD64 PE32+ executable, imports historical telemetry, replays an offline position track, and saves exact inputs, original analyzer results, normalized evidence, executable identity, hashes and verification artifacts.

This tool never attaches to RIFT, sends input, reads live process memory, changes game files, contacts any API, or asserts that coordinate discontinuities prove teleportation.

## Prerequisites

Node.js 24+, existing RPT script (C:\work\Rift-Personal-Teleporter\src\teleport_analyzer.py), Python 3.14 (C:\Python314\python.exe, or supply --python), archived RIFT executable, saved Telemetry JSON/JSONL, and a saved RPT position-track JSONL. Verify the machine and pass --expect-host. No npm install, Ghidra, OpenAI credits or game process is required.

## CLI usage

Run from C:\work\workbridge-mcp\integrations\rift using PowerShell 7.

```powershell
# Inspect an archived client without opening the game:
node .\src\cli.mjs doctor --client 'C:\work\RIFT-Build-Baselines\1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8\rift_x64.exe' --expect-host AMD-DESKTOP --expect-sha 1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8

# Replay one saved research session; choose a new output folder each time:
node .\src\cli.mjs session --client 'C:\work\RIFT-Build-Baselines\1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8\rift_x64.exe' --expect-host AMD-DESKTOP --expect-sha 1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8 --telemetry 'C:\work\Telemetry\artifacts\bridge-live\cli-snapshot.json' --track 'C:\work\Rift-Personal-Teleporter\tests\sample_track.jsonl' --out "C:\work\workbridge-mcp\.tools\rift-replay-$(Get-Date -Format yyyyMMdd-HHmmss)"

# Independently verify a completed bundle:
node .\src\cli.mjs verify --bundle 'C:\work\workbridge-mcp\.tools\EXACT_SESSION_DIRECTORY'

# Focused tests:
node --test test/session.test.mjs
```

The example Telemetry snapshot is historic and the RPT position track is a sample fixture. They are **not** simultaneous or live readings.

## Bundle

| File               | Contents                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| manifest.json      | Verified host, selected disk build identity, source paths/hashes, records, results, and explicit offline-only claims |
| telemetry.source   | Exact bytes of saved Telemetry input                                                                                 |
| track.source       | Exact bytes of saved RPT position track                                                                              |
| analyzer-source.py | Exact source code of the RPT analyzer used                                                                           |
| analysis.jsonl     | Analyzer's original classification results                                                                           |
| evidence.jsonl     | Normalized observations, index, source hash, timestamp, missing fields, build information and provenance             |
| SHA256SUMS.txt     | SHA-256 hashes of the previous six files, independently checked by verify                                            |

An existing output folder is never overwritten. File reads, input sizes and analyzer output are bounded. RPT invalid observations reject the session. Saved source-reported state "live" refers to **the original capture**, not a new session; demo-source records are labeled simulated. No process PID, process lifetime, HUD response, live pointer-chain validity or server-confirmed teleportation is inferred.

Limits: <=1 GiB on-disk executable; <=4 MiB per telemetry/track file; 1–4096 JSON object records each; <=20 seconds for the analyzer. Keep evidence under the ignored Workbridge .tools area; do not commit raw gameplay data. Checksum verification detects accidental changes but is not a cryptographic signature.

## Verified November 20, 2026 milestone

- Host: AMD-DESKTOP, verified with hostname.exe, exit 0.
- Workbridge: 0.16.5-dev live owner left unchanged.
- Focused tests: **14 pass, 0 fail**.
- Pinned archived executable: 60,493,640 bytes, SHA-256 1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8.
- Actual offline end-to-end run: 1 historical Telemetry snapshot; 4 sample RPT positions; classifications baseline 1, continuous_candidate 1, candidate_discontinuity 1 and boundary 1.
- Saved package: C:\work\workbridge-mcp\.tools\rift-research-session-20261120-first, successfully verified. transportOrTeleportVerified is **false**.
- No running game, API calls, addon deployment, Workbridge restart or changes to sibling repositories.

Next gates: live process epoch validation as a separate source, RR2/RRE archive adapters, RRE patch-drift integration, and later screenshot/debugger evidence correlation.

See [the full RIFT RE integration roadmap](../../docs/rift-re-integration-roadmap-20261120.md).
