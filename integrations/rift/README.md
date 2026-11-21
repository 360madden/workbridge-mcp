# RIFT Research Companion — offline research and read-only physical identity

Standalone Node.js 24+ CLI inside Workbridge-MCP. It reuses the existing RIFT Personal Teleporter Python position analyzer and reads **saved** Telemetry JSON/JSONL. Optional archived RiftReader2 and RRECollector evidence can join the same research package, without building another native reader, addon, debugger or input controller.

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

# Focused tests (including historical RR2/RRE adapters):
node --test test/*.test.mjs
```

The example Telemetry snapshot is historic and the RPT position track is a sample fixture. They are **not** simultaneous or live readings.

### Optional saved RR2 and RRE evidence

Append these options to the **session** command (not the doctor command) to include additional previously captured data:

```powershell
--rr2 'C:\work\riftreader2\artifacts\beacon-baseline-after-native.json' `
--rre 'C:\work\rre\artifacts\sc628-live-context-20261107-1533\saved-publication.json' `
--rre-binding 'C:\work\rre\artifacts\reader-checks-12580b853ce848cfb79bf83c9166fb7a\source-set-binding.json'
```

These represent **historical** observations, not a newly connected RR2/RRE client or a new capture. RRE requires both a publication receipt and its matching binding receipt; unsupported versions, mismatched sessions/sequences, or inconsistent process identities are rejected. RR2's original 64-bit process-start tick digits are preserved exactly (not rounded as JavaScript numbers). An epoch comparison distinguishes **different declared process lifetimes** from matching fields with unverified host identity; it never claims current freshness or cross-source causality.

## Bundle

| File                          | Contents                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| manifest.json                 | Verified host, selected disk build identity, source paths/hashes, records, results, and explicit offline-only claims |
| telemetry.source              | Exact bytes of saved Telemetry input                                                                                 |
| track.source                  | Exact bytes of saved RPT position track                                                                              |
| analyzer-source.py            | Exact source code of the RPT analyzer used                                                                           |
| analysis.jsonl                | Analyzer's original classification results                                                                           |
| evidence.jsonl                | Normalized observations, index, source hash, timestamp, missing fields, build information and provenance             |
| SHA256SUMS.txt                | SHA-256 hashes of all present artifacts, independently checked by verify                                             |
| rr2.source (optional)         | Exact archived RR2 native candidate report bytes                                                                     |
| rre.source (optional)         | Exact RRECollector saved-publication receipt bytes                                                                   |
| rre-binding.source (optional) | Exact matching RRE publication-binding receipt bytes                                                                 |

An existing output folder is never overwritten. File reads, input sizes and analyzer output are bounded. RPT invalid observations reject the session. Saved source-reported state "live" refers to **the original capture**, not a new session; demo-source records are labeled simulated. No process PID, process lifetime, HUD response, live pointer-chain validity or server-confirmed teleportation is inferred.

Limits: <=1 GiB on-disk executable; <=4 MiB per saved telemetry/track/archive file; 1–4096 Telemetry and track JSON object records each; <=20 seconds for the analyzer. Keep evidence under the ignored Workbridge .tools area; do not commit raw gameplay data. Checksum verification detects accidental changes but is not a cryptographic signature.

## Verified November 20, 2026 milestone

- Host: AMD-DESKTOP, verified with hostname.exe, exit 0.
- Workbridge: 0.16.5-dev live owner left unchanged.
- Focused tests: **14 pass, 0 fail**.
- Pinned archived executable: 60,493,640 bytes, SHA-256 1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8.
- Actual offline end-to-end run: 1 historical Telemetry snapshot; 4 sample RPT positions; classifications baseline 1, continuous_candidate 1, candidate_discontinuity 1 and boundary 1.
- Saved package: C:\work\workbridge-mcp\.tools\rift-research-session-20261120-first, successfully verified. transportOrTeleportVerified is **false**.
- No running game, API calls, addon deployment, Workbridge restart or changes to sibling repositories.

### November 20, 2026 — archived-source integration checkpoint

- **24/24 focused tests passed**, and formatting checks passed. The earlier six-file package continues to verify without migration.
- The RR2 archived candidate contains an exact process-start tick value `639301206978915233`, a saved position candidate, and source-reported headings not yet qualified.
- The historical RRE publication and binding agree on addon version `0.4.13`, a 32-hex publication session, sequence `7`, and five declared parts/54 abilities. The adapter preserves these as saved receipt claims; it does **not** decode or authenticate the RREC2 wire payload.
- Both archives report the same archived executable SHA-256, but RR2's PID `40452` differs from RRE's PID `9752`, and start epochs differ. The combined manifest reports `different_declared_epoch` and never fuses their XYZ values into a shared track.
- The expanded, checksum-verified **nine-artifact** package is `C:\work\workbridge-mcp\.tools\rift-research-session-20261120-rr2-rre-01`. Its Telemetry record and RPT sample track are from other times. No live RIFT client, VMware lab, network transport, or paid model was contacted.

## Offline executable patch-drift workflow

The `patch` CLI command **invokes** the existing RRE Python PE update analyzer. It does not duplicate Ghidra, disassemble an entire file, open a live game process or restore memory offsets.

In **PowerShell 7**, from `C:\work\workbridge-mcp\integrations\rift`:

```powershell
$before = 'C:\work\RIFT-Build-Baselines\1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8\rift_x64.exe'
$after = 'C:\work\RIFT-Build-Baselines\df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01\rift_x64.exe'
$out = "C:\work\workbridge-mcp\.tools\rift-patch-$(Get-Date -Format yyyyMMdd-HHmmss)"

node .\src\cli.mjs patch `
  --before $before `
  --after $after `
  --out $out `
  --expect-host AMD-DESKTOP `
  --expected-before-sha 1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8 `
  --expected-after-sha df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01 `
  --anchors 'C:\work\rre\tools\rift_update_anchors.json'

node .\src\cli.mjs verify-patch --bundle $out
```

The companion pins the selected old and new on-disk PE hashes and archives a reproducible, self-checking comparison package. RRE's comparator independently checks the original bytes and declared anchor signatures; it reports exit code `2` for a **CHANGED** executable. The wrapper accepts that as a successful _analysis result_; unrelated errors fail. It then preserves `report.json`, `report.md`, `analyzer-source.py`, optional `anchors.source`, `patch-manifest.json` and `SHA256SUMS.txt` under a never-overwritten directory. A separately invoked `verify-patch` validates the stored bytes and report/manifest consistency.

A `MATCH` means the compared files have matching bytes; it does not prove the current process or any pointer chain. `CHANGED` invalidates old-build conclusions until individually requalified; a different byte sequence at the same RVA does not locate the moved function.

### Saved executable acceptance — November 20, 2026

Two genuine **archived** `rift_x64.exe` files (SHA-256 prefixes `1935a05c` and `df954b79`) were compared without contacting the running game. RRE reported `CHANGED`: seven PE sections changed by bytes/layout, including 608 changed 64-KiB comparison blocks in `.text` and 152 in `.rdata`. Four SHA-bound ROOT-001 byte anchors **all differed at their historical RVAs**. No relocated-function identity or native pointer was qualified.

The archive is `C:\work\workbridge-mcp\.tools\rift-pe-drift-20261120-01`; its five saved artifacts independently verified. After this implementation, the companion's three suites passed **34/34 focused tests** (baseline offline sessions, RR2/RRE archived evidence and patch drift). No new dependencies, Workbridge restart, physical RIFT action or VMware access was needed.

## Read-only physical RIFT process identity (November 20, 2026)

The `physical` command is the first **read-only physical-client** collector. It reuses Workbridge's pinned **WinApp CLI 0.7.1 window enumeration** and queries Windows process metadata through a fixed PowerShell command. It does **not** focus a window, click, type, attach a debugger, read game-memory bytes, or control the RIFT client.

From **PowerShell 7**, starting in `C:\work\workbridge-mcp\integrations\rift`:

```powershell
# Discover the current physical RIFT process and exact window.
node .\src\cli.mjs physical --expect-host AMD-DESKTOP

# For multiboxing, repeat with one fresh PID from the above inventory.
# This example PID and SHA were observed November 20 and can become stale.
node .\src\cli.mjs physical --expect-host AMD-DESKTOP --pid 34596 --expect-sha df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01 --out 'C:\work\workbridge-mcp\.tools\rift-physical-epoch-NEW_UNIQUE_ID'

# Verify an existing saved process-identity record; this does not re-probe RIFT.
node .\src\cli.mjs verify-physical --bundle 'C:\work\workbridge-mcp\.tools\rift-physical-epoch-NEW_UNIQUE_ID'
```

The collector fails closed on incorrect host, ambiguous window, changed process PID/start/module identity, missing module information, invalid executable, mismatched expected SHA-256 or changed HWND. It preserves the full **64-bit process-start tick value as text**, avoiding JavaScript integer precision loss. When several RIFT processes are present, an explicit `--pid` is required. No process found is reported as `no_process_observed`, not as proof that the game could never be running.

With `--out` it saves the observed record and a checksum completion marker; `verify-physical` checks saved bytes and consistency. A frozen record is **historical**: verification does not prove its PID/HWND still exists. Main-module base and size are Windows-reported **metadata**; the collector does not verify loaded memory bytes, pointer chains, gameplay state or identity of an in-game character.

### Physical-host acceptance on AMD-DESKTOP

The observed physical client at 11:06–11:07 PM EST had PID `34596`, HWND `658476`, Windows process-start ticks `639308249563595623`, module base `0x7FF60DF30000`, and executable SHA-256 `df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01`. The before/after Windows process identity and window identity agreed around the on-disk hash. This is the **newer** archived build. Pinning the older `1935a05c…` executable produced the expected `BUILD_MISMATCH` rather than silently treating old RR2/RRE findings as compatible.

The independently checked receipt is `C:\work\workbridge-mcp\.tools\rift-physical-epoch-20261120-01`. After implementing the collector and receipt package, **59/59 focused tests passed** (36 earlier companion tests, 17 process/window tests, 6 saved-receipt tests).

Next gates: independently correlating fresh RR2/Telemetry data to a current verified physical process epoch, then screenshot/debugger receipt correlation and targeted Ghidra analysis. No input or memory writes are part of this milestone.

See [the full RIFT RE integration roadmap](../../docs/rift-re-integration-roadmap-20261120.md).
