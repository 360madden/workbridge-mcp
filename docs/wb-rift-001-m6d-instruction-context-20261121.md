# WB-RIFT-001 M6d — RIFT RIP Instruction-Shape Context Audit

**Date:** Saturday, November 21, 2026 (EST)  
**Host:** AMD-DESKTOP, confirmed by completed native Workbridge hostname preflight (exit 0)  
**Scope:** Offline analysis of two SHA-pinned archived RIFT executables, without opening the live game  
**Status:** Local implementation and validation PASS; native runtime locator qualification remains 0

## Goal and method

M6c identified six selector-location hypotheses shifted by +0x11000 and three root-location hypotheses shifted by +0x117C0. Equal static RIP-reference counts are useful evidence, but insufficient to prove equivalent caller semantics or runtime object ownership.

New M6d helper: integrations/rift/tools/telemetry-locator-context.py.

It independently opens the **exact** M6c report and source-pinned archived RIFT executables. It rechecks original instruction bytes, function-range membership in the PE exception directory (.pdata), and Capstone 5.0.7 typed RIP-relative operands. It masks **only four validated displacement bytes**, then pairs samples by an exact multiset of remaining instruction bytes, mnemonic, instruction size and offset within the containing function. The pairing does not rely on sample order or nearest RVA.

Before and after inspection it also checks the M6c tool, M6b helper, RRE parser, Telemetry C# reader, archived game binaries and M6c report SHA-256 pins. An output filename must be new.

## Verified final results

| Metric                                            |    Observed |
| ------------------------------------------------- | ----------: |
| Locator hypotheses examined                       |       9 / 9 |
| Historical M6c instruction samples                |          26 |
| New-build M6c instruction samples                 |          26 |
| Exact normalized sample-shape matches             | **26 / 26** |
| Unmatched old / new shapes                        |       0 / 0 |
| Unique pairs within each saved locator sample set |          26 |
| Qualified native runtime locators                 |       **0** |
| Validated live player/target source epoch         |          No |

| Locator                  | Matching preserved samples |
| ------------------------ | -------------------------: |
| ManagerRva               |                          3 |
| PlayerSystemRva          |                          3 |
| HealthSelectorRva        |                          3 |
| NameSelectorRva          |                          3 |
| LocalizedNameSelectorRva |                          2 |
| AlternateSelectorRva     |                          3 |
| SelectionSelectorRva     |                          3 |
| PositionSelectorRva      |                          3 |
| ClockRootRva             |                          3 |

A unique match **within the three sampled records** does not imply global uniqueness, exact code ownership, or a current in-memory object. This is targeted static instruction-shape corroboration, not a new working Telemetry offset map.

### Source and final evidence identifiers

- M6d source SHA-256: 9908f7b07decb027bc55b4b88486a19583632bf420ed1fbf09327af43fd62533
- Consumed M6c report SHA-256: 2c0b5cdf287b321377e1abd2a7bc373ab949932d22489c1fccc5e735292fd977
- Consumed M6c tool SHA-256: c212bbd8892cd39b0468db27a65ede731fa9b187b7e8499d414de6777419e22a
- Older archived RIFT build: 1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8
- Newer archived RIFT build: df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01
- Final report: C:\work\workbridge-mcp\.tools\wb-m6d-context-20261121-final.json
- Final report size: 12,905 bytes
- Final report SHA-256: e90b0e4f3d05cbf640cf6f302c60d3c25b1af6fed39067a67ffcc587503200d8

### Reproduce on AMD-DESKTOP (PowerShell 7)

Run from C:\work\workbridge-mcp. Use a _new_ output filename:

```powershell
& 'C:\work\rre\.venv\Scripts\python.exe' -B .\integrations\rift\tools\telemetry-locator-context.py --expect-host AMD-DESKTOP --workspace-root 'C:\work' --report '.tools\wb-rift001-m6c-xref-audit-20261121-final.json' --expected-report-sha 2c0b5cdf287b321377e1abd2a7bc373ab949932d22489c1fccc5e735292fd977 --expected-xref-tool-sha c212bbd8892cd39b0468db27a65ede731fa9b187b7e8499d414de6777419e22a --before 'C:\work\RIFT-Build-Baselines\1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8\rift_x64.exe' --after 'C:\work\RIFT-Build-Baselines\df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01\rift_x64.exe' --reader 'C:\work\Telemetry\src\Telemetry.Cli\Sources\LiveTargetSource.cs' --output '.tools\NEW-UNIQUE-M6d-report.json'
```

### Test evidence

- Focused M6d regression: **9 passed, 0 failed**.
- Complete RIFT companion regression: **111 passed, 0 failed, 0 skipped**.
- Prettier check for new JS test: **PASS**.
- Final SHA-pinned real offline run: **exit 0**; JSON saved and independently SHA-checked.
- An initial test-only typo used a wrong JSON property name; corrected and rerun before reporting these final results.
- Tests include altered report hashes, rehashed altered witness target/bytes, false qualification claims, wrong .pdata function, wrong machine, existing output, and duplicate signature ambiguity.

No Workbridge service update, installed game/addon change, native game memory access, debugger attachment, GitHub push, or current-client interaction was performed.

## Limits and next useful milestone

M6c scanned .pdata function ranges, not all raw code; those ranges cover about 78% of .text. M6d checks at most three sampled instructions per locator. Matching normalized instructions is **not** a proof of the containing functions' behavior or initialized object ownership.

Next: inspect independently validated instruction/function _surroundings_ and root initializer/caller relationships, keeping source pins and ambiguous outcomes explicit. Then, separately, qualify read-only pointer ownership and the exact producer PID/start ticks before proposing modifications to the Telemetry .NET 10 native reader.

Earlier evidence: docs/wb-rift-001-m6c-pdata-xrefs-20261121.md  
Master roadmap: docs/wb-rift-001-unified-research-coordinator-roadmap-20261120.md
