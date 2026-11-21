# WB-RIFT-001 · M6b Telemetry locator drift audit

**Observed:** November 21, 2026 · AMD-DESKTOP · offline, read-only archived PE comparison.

## Goal and exact sources

The existing .NET 10 Telemetry native reader in `C:\work\Telemetry\src\Telemetry.Cli\Sources\LiveTargetSource.cs` supports only the historical executable SHA-256 `1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8`. M6a verified that the current physical RIFT image uses `df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01` and that Telemetry 0.5.0 correctly reports the build unsupported.

The new helper `integrations/rift/tools/telemetry-locator-drift.py` reads two explicitly SHA-pinned **archived** executables, the SHA-pinned Telemetry C# reader, and the exact existing `C:\work\rre\tools\rift_update_analyzer.py` source (SHA `6b77d964ec493221b8bb6240da6fcac7f489cdc540bad0c67d20f902991f84ae`).

It **reuses** RRE's established `inspect_pe` and `bytes_at_rva` functions, rather than implementing a new PE parser, and creates a structured file-byte-only report. It never interacts with the running process, Ghidra, target selection, game memory or the network. The original Telemetry and RRE repositories remain unchanged.

## PE section-base changes

| Section | Old base RVA | New base RVA |
| ------- | -----------: | -----------: |
| .text   |     `0x1000` |     `0x1000` |
| .rdata  |  `0x25EF000` |  `0x25FD000` |
| .data   |  `0x2F56000` |  `0x2F67000` |
| .pdata  |  `0x35EC000` |  `0x35FE000` |
| _RDATA  |  `0x3965000` |  `0x3978000` |
| .rsrc   |  `0x3979000` |  `0x398C000` |
| .reloc  |  `0x3A2A000` |  `0x3A3D000` |

**.data shifted +0x11000.** This is a static section-location observation, not a claim that every former variable moved with that section or that a relocated pointer has been verified.

## All nine inherited RVA constants

The section-relative candidate is the old offset within its old section, added to the new base of the **same named** section. **These are hypotheses only; do not copy them into the live Telemetry reader.**

| Telemetry constant       | Old RVA     | Section-relative candidate | File-backed 16-byte comparison                           |
| ------------------------ | ----------- | -------------------------- | -------------------------------------------------------- |
| ManagerRva               | `0x33624A8` | `0x33734A8`                | Not comparable (old raw 16 bytes unavailable)            |
| PlayerSystemRva          | `0x33623E0` | `0x33733E0`                | Not comparable (old raw 16 bytes unavailable)            |
| HealthSelectorRva        | `0x2F57850` | `0x2F68850`                | Different at old RVA; same at section-relative candidate |
| NameSelectorRva          | `0x2F582E0` | `0x2F692E0`                | Different at old RVA; same at section-relative candidate |
| LocalizedNameSelectorRva | `0x2F579F0` | `0x2F689F0`                | Different at old RVA; same at section-relative candidate |
| AlternateSelectorRva     | `0x2F58270` | `0x2F69270`                | Different at old RVA; same at section-relative candidate |
| SelectionSelectorRva     | `0x2F57260` | `0x2F68260`                | Different at old RVA; same at section-relative candidate |
| PositionSelectorRva      | `0x2F588A0` | `0x2F698A0`                | Different at old RVA; same at section-relative candidate |
| ClockRootRva             | `0x33DC2B0` | `0x33ED2B0`                | Not comparable (old raw 16 bytes unavailable)            |

| Classification                                   | Count |
| ------------------------------------------------ | ----: |
| Source constants checked                         | **9** |
| Old RVAs now map from .data into .rdata          | **6** |
| Same file bytes at old RVA                       | **0** |
| Matching 16 bytes at section-relative hypothesis | **6** |
| Not file-backed/comparable at historical RVA     | **3** |
| **Qualified new native locators**                | **0** |

Matching 16 bytes may be padding, repeated data or relocated constants. It does not establish object identity, calling code, initialized pointer state, owner relationship, API behavior or safe runtime dereference. The three non-file-backed roots require separate code-reference and initialization analysis.

## Running the repeatable helper

From PowerShell 7 on **AMD-DESKTOP**, in `C:\work\workbridge-mcp`:

```powershell
C:\Python314\python.exe -B .\integrations\rift\tools\telemetry-locator-drift.py `
  --expect-host AMD-DESKTOP `
  --workspace-root 'C:\work' `
  --before 'C:\work\RIFT-Build-Baselines\1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8\rift_x64.exe' `
  --after 'C:\work\RIFT-Build-Baselines\df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01\rift_x64.exe' `
  --reader 'C:\work\Telemetry\src\Telemetry.Cli\Sources\LiveTargetSource.cs' `
  --expected-before-sha 1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8 `
  --expected-after-sha df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01 `
  --expected-reader-sha 197f4af53be8fe597e17424066139e1735b6c063cb17589840de3c7418d3a1aa `
  --expected-rre-parser-sha 6b77d964ec493221b8bb6240da6fcac7f489cdc540bad0c67d20f902991f84ae `
  --output 'C:\work\workbridge-mcp\.tools\NEW_UNIQUE_LOCATOR_AUDIT.json'
```

The output flag is optional; without it the tool prints JSON to stdout. An existing output is never overwritten. The actual verified audit is retained in ignored local storage at `C:\work\workbridge-mcp\.tools\wb-rift001-m6b-locator-audit-20261121.json`.

## Verification and remaining work

The focused Node integration tests `integrations/rift/test/telemetry-locator-drift.test.mjs` ran **6/6 PASS** against the actual archived PE pair. Tests cover correct nine-row summary, old/new build SHA mismatch, reader/RRE script hash mismatch, wrong host, altered C# locator declarations and no-clobber behavior. Python compilation passed. **Final combined local regression:** RIFT **95/95**, research coordinator **63/63**, selected Workbridge facade/CI/release **26/26** with one optional PowerShell-path skip — **184 passing, 0 failed, 1 skipped**. TypeScript no-emit, Prettier and Git whitespace checks all passed.

M6b still needs native-reader requalification:

1. Trace the six hypotheses to independently verified new-code references and semantic object owners using existing RRE/Ghidra evidence, not just matching file bytes.
2. Recover the three non-file-backed roots from independently qualified initialization/caller paths.
3. Perform separate targeted read-only runtime ownership and field validation against an exact current RIFT PID, start ticks, window and executable hash; only then update the .NET 10 Telemetry reader.
4. Add producer PID/start-ticks and generation to the actual Telemetry output before linking it to a Workbridge live witness. Until then retain `sourceEpochBound:false`.

**No current live HP/XYZ/target statistics were qualified by this audit.** It cannot establish server acceptance or custom teleport behavior.

[WB-RIFT-001 master roadmap](wb-rift-001-unified-research-coordinator-roadmap-20261120.md) · [M6a live witness](wb-rift-001-m6-live-witness-20261121.md)
