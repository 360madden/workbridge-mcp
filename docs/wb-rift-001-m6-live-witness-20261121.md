# WB-RIFT-001 M6a — Live RIFT Process / Telemetry Witness

**Date:** November 21, 2026 (EST)  
**Verified machine:** AMD-DESKTOP (native hostname.exe, exit 0)  
**Scope:** Read-only physical process identification, native-only Telemetry snapshot, source/epoch comparisons and sealed evidence. M6b supported-build live numeric telemetry is **not** completed.  
**Deployment:** Source-only, isolated tests and staged-runtime verification; no live Workbridge service update, no game input or memory writes.

## Why M6 needs separate provenance

The RIFT companion already knows how to verify a physical process: exact PID, process-start UTC **tick digits**, on-disk executable SHA-256 from the actual Windows process path, native module identity, HWND and window class. It rechecks process and window identity after hashing.

Telemetry v0.5.0 is a separate .NET 10 companion. Its read-only native reader is limited to a specific RIFT executable SHA-256. **A Telemetry JSON sample does not currently carry the producer PID and start ticks**, so even a source-reported "live" observation cannot independently be fused with a Workbridge physical epoch without further native-source provenance.

We therefore added a **witness**, not a new game reader. Its capture order:

1. Verify **AMD-DESKTOP** and require explicit selected RIFT PID, exact start ticks, executable SHA-256, the vetted Telemetry CLI path, its exact SHA-256 and a never-existing output folder.
2. Hash the approved .NET CLI executable. Verify the live physical RIFT process, module and window through the existing Windows/WinApp 0.7.1 code.
3. Invoke the already built Telemetry CLI with the **fixed** arguments `snapshot --native-only --wait 0`. It cannot be substituted with an arbitrary executable, shell command, demo source or RR2 publisher.
4. Verify the same selected physical RIFT identity and HWND a second time. Ensure the Telemetry sample timestamp lies between the physical probes within the bounded capture window. Rehash the Telemetry CLI after sampling.
5. Save physical-before and physical-after **original receipts**, exact Telemetry JSON bytes, a semantic manifest and SHA256SUMS. No-clobber writes; completion inventory published **last**.
6. Independently verify the entire saved package, including its two physical subreceipts and semantic claims, without needing the process to remain alive.

**Important classification:** Workbridge verifies the physical process at capture time, but the Telemetry v0.5.0 sample itself contains no exact PID/start-ticks identity. Thus `sourceEpochBound:false`, `livePlayerTelemetryVerified:false` and `liveTargetTelemetryVerified:false` remain mandatory **even if Telemetry reports some fields live**. A saved witness cannot prove that the process is still alive at later verification.

## Actual current physical RIFT identity

The original physical probe returned one matching RIFT client:

| Item                           | Confirmed live read-only observation                                   |
| ------------------------------ | ---------------------------------------------------------------------- |
| PID                            | `34596`                                                                |
| Process start UTC              | `2026-11-21T02:29:16.3595623Z` (November 20, 9:29 PM EST)              |
| Exact .NET/Windows start ticks | `639308249563595623` (preserve as decimal string, **not** a JS Number) |
| Window                         | `RIFT`, `TWNClientFramework`, HWND `658476`                            |
| Window dimensions              | 2576 × 1408                                                            |
| Module base                    | `0x7FF60DF30000`                                                       |
| On-disk EXE SHA-256            | `df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01`     |
| On-disk EXE size               | 60,574,536 bytes                                                       |
| Native offset qualification    | **False**                                                              |

The trusted Telemetry v0.5.0 source lists `1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8` as its supported native-read build. The actual current executable is `df954b...`, so the existing C# reader correctly refuses its native offsets.

The tested Telemetry CLI binary is `C:\work\Telemetry\src\Telemetry.Cli\bin\Release\net10.0\Telemetry.Cli.exe`, SHA-256 `30b640f9bb80302ff6de3683aace501524990fa152d6558a181d5f9e10331e6d`. It identifies itself as **Telemetry 0.5.0**.

**Observed native-only output:** `source=rift`, `state=unavailable`, `target=null`, `player=null`, native source `unavailable`; RR2/Lua/player API sources were correctly `disabled`. Its message names the exact unsupported `df954b...` executable hash. Unknown values were **not** converted into zero or assigned to the current player.

## Verified live capture packages

| Capture                           | Physical process window                    | Evidence                                                                                                     |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| First source-checkout witness     | `06:05:25.466Z → 06:05:26.946Z` (1,480 ms) | `.tools/wb-rift001-m6-live-witness-20261121-01` — captured and independently verified                        |
| Second **sealed-runtime** witness | `06:09:44.921Z → 06:09:46.288Z` (1,367 ms) | `.tools/wb-rift001-m6-live-witness-sealed-20261121-02` — captured by sealed CLI, then independently verified |

Both were read-only native-only observations. Before and after each sample the pinned game PID, process-start ticks, module identity, executable hash and window HWND agreed. Both report `unsupported_build_observed`; **neither qualifies current player/target numeric fields**. Their raw JSON is stored locally in Workbridge's Git-ignored `.tools` area, not the repository.

The package contains:

| Artifact                                                   | Contents                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `physical-before/physical-epoch.json` and `SHA256SUMS.txt` | Original independently verified pre-sample physical identity                            |
| `telemetry.source`                                         | Exact read-only Telemetry CLI JSON bytes                                                |
| `physical-after/physical-epoch.json` and `SHA256SUMS.txt`  | Independent post-sample physical identity                                               |
| `manifest.json`                                            | Selector, source hashes, capture timing, native status and explicit unbound limitations |
| `SHA256SUMS.txt`                                           | Six entry checksums and mandatory final completion marker                               |

`verify-witness` rechecks all six entries and the physical receipt verifiers, then rejects any inconsistent process/window/executable identity, source state, capture order, checksums, unsupported-build claim or attempted promotion of unbound fields.

## Source-only implementation and sealed release correction

New source: `integrations/rift/src/live-witness.mjs`, exposed as `witness` / `verify-witness` in `integrations/rift/src/cli.mjs`. It imports the existing physical identity and saved receipt code and executes the already-existing Telemetry CLI, rather than implementing any new native game reader.

During isolated packaging, the first staged CLI correctly **failed** with `ERR_MODULE_NOT_FOUND` for `dist/scripts/desktop-ui.mjs`: the existing physical identity module imported the source-tree relative path `../../../scripts/desktop-ui.mjs`. A checksum-only closure scan had not exercised that import.

**Root-cause fix:** `scripts/stage-research-runtime.mjs` now stages the authoritative `scripts/desktop-ui.mjs` bytes under the sealed `research-runtime/support/desktop-ui.mjs` path. `integrations/rift/src/workspace-path.mjs` resolves the correct source or packaged helper URL, and `physical-epoch.mjs` loads the **same reviewed helper** lazily when actual window enumeration is required. No duplicate WinApp implementation was written. The runtime closure now contains **25 verified files**.

Final isolated staging: `C:\work\workbridge-mcp\.tools\m6-live-witness-final\dist\research-runtime`, manifest SHA-256 `7cc1824d33d0bb276792e1e1e71d0b2b188bb2dd68fc4021ab1019fe093ad976`. From this sealed copy, both the original saved `verify-witness`, fresh read-only `physical`, and a second complete `witness` + independent `verify-witness` **passed**. This proves the packaged dynamic WinApp dependency actually resolves and works.

## Operator commands — PowerShell 7 on AMD-DESKTOP

**Warning:** PID, start ticks, window and SHA are **specific to the captured process lifetime**. Do not reuse the example selectors after that client exits or restarts. Re-run `physical` and use its new exact values.

```powershell
cd 'C:\work\workbridge-mcp\integrations\rift'

# Re-discover one selected physical client, without sending input.
node .\src\cli.mjs physical --expect-host AMD-DESKTOP --pid 34596 --expect-sha df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01

# Capture one sample only while the selected PID and exact process-start
# ticks are still valid. Choose a never-used output directory.
node .\src\cli.mjs witness --expect-host AMD-DESKTOP --pid 34596 --expect-start-ticks 639308249563595623 --expect-sha df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01 --telemetry-exe 'C:\work\Telemetry\src\Telemetry.Cli\bin\Release\net10.0\Telemetry.Cli.exe' --expect-telemetry-sha 30b640f9bb80302ff6de3683aace501524990fa152d6558a181d5f9e10331e6d --out 'C:\work\workbridge-mcp\.tools\WITNESS-NEW-UNIQUE-ID'

# Reverify saved evidence later; does NOT sample the running game again.
node .\src\cli.mjs verify-witness --bundle 'C:\work\workbridge-mcp\.tools\WITNESS-NEW-UNIQUE-ID'
```

The CLI does not call an unrestricted shell, write game memory, send keyboard/mouse input, or reload RIFT. The native-only Telemetry CLI may open a **read-only process handle** on supported builds; the current unsupported-build sample reported no qualified native statistics. The physical identity collector itself does not read process memory.

## Local acceptance and remaining M6b work

- **18/18 synthetic live-witness tests passed**, covering mismatched PID/start ticks/builds, process/window changes, unsupported source reporting, demo/bridge rejection, wrong host, timestamp windows, executable tampering, replayed output paths, checksum and semantic tampering.
- The full RIFT companion suite passed **89/89** after adding the new path-resolution regression; the research coordinator suite remained **63/63**.
- Sealed runtime stage/catalog regression passed **14/14**; a dedicated new test imported the **real packaged physical module** and its SHA-matching authoritative WinApp helper. The isolated runtime independently staged **25/25** files; source and sealed **actual live** captures and verifiers both passed.
- Final selected local regression: **89/89 RIFT**, **63/63 research-coordinator**, **26/26 Workbridge facade/CI/release tests**; **178 passed, 0 failed, 1 optional PowerShell-path test skipped**. TypeScript `--noEmit`, Prettier and Git whitespace checks passed.
- No changes to installed RIFT files, the Telemetry project, a running Workbridge owner, or the previously validated release `wb-rift001-m5-20261121-003`. The new code requires a **new WB-001 candidate** and a separate exclusive Apply gate before becoming part of the installed MCP service.

**M6b is still blocked on exact-build Telemetry requalification.** Next work should use RRE/RR2 patch-recovery evidence to validate supported native target/player locators against `df954b...`; update the .NET 10 Telemetry reader only after independent verification. The Telemetry CLI must expose exact process/PID/start-ticks provenance in samples, or Workbridge must retain `sourceEpochBound:false` even on source-reported "live" values. Do not infer compatibility from an unchanged RVA or a matching game title.

A future integration into the generic research coordinator requires a separate _live read-only acquisition_ execution mode; its current `offline_saved_data` manifest claims must not be reused to imply that a live process was never sampled. A saved witness may instead be imported offline, preserving explicit historical status.

[WB-RIFT-001 master roadmap](wb-rift-001-unified-research-coordinator-roadmap-20261120.md) · [M5 validated release gate](wb-rift-001-m5-sealed-release-gate-20261120.md)
