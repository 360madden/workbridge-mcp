# WB-RIFT-001 M6e — Pinned RIFT Function-Body and Direct-Call Audit

**Date:** Saturday, November 21, 2026 (EST)
**Host:** AMD-DESKTOP, confirmed by native Workbridge hostname.exe exit 0
**Scope:** Two archived SHA-pinned RIFT executables and existing M6d evidence; no live process, game input or memory action
**State:** Offline tool and regression verification PASS; native runtime locator qualification remains zero

## Goal and method

M6c established nine static RIP-relative locator hypotheses; M6d independently paired 26 preserved instruction shapes. M6e expands the three root hypotheses (ManagerRva, PlayerSystemRva, ClockRootRva) into complete .pdata-bounded function bodies and identifies only those direct callsite relationships whose old and new target function starts can be explicitly paired.

New helper: integrations/rift/tools/telemetry-function-relations.py. It independently verifies the SHA-pinned M6d JSON, M6d/M6c/M6b source, RRE PE parser, original Telemetry C# reader and archived executable images. It rechecks hashes before publication. Both executable bodies are disassembled completely within capped .pdata ranges. The normalization masks only verified RIP disp32 and directly encoded relative branch/call immediates; it keeps other bytes, instruction offsets, lengths, mnemonics, SHA fingerprints and bounded differences. Source is not deployed into the live Workbridge service.

## Verified function-body continuity

| Root hypothesis | Old function RVA | New function RVA | Bytes in each | Instructions per image | Direct calls per image | Normalized equal |
| --------------- | ---------------- | ---------------- | ------------: | ---------------------: | ---------------------: | ---------------- |
| Manager         | 0x4A4750         | 0x4A4DC0         |            20 |                      4 |                      0 | Yes              |
| Manager         | 0x49CC10         | 0x49D280         |            72 |                     18 |                      2 | Yes              |
| PlayerSystem    | 0x49A020         | 0x49A690         |            20 |                      4 |                      0 | Yes              |
| PlayerSystem    | 0x495030         | 0x495690         |            88 |                     21 |                      4 | Yes              |
| Clock           | 0x4E7710         | 0x4E7D40         |            92 |                     25 |                      1 | Yes              |
| Clock           | 0x4E3520         | 0x4E3B50         |         1,114 |                    243 |                      5 | Yes              |
| Clock           | 0x4E66EF         | 0x4E6D1F         |         1,652 |                    401 |                     27 | Yes              |

**Totals:** 7/7 normalized body matches; 716 instructions and 3,058 function bytes per image; zero remaining normalized instruction differences.

The initial manual comparison found one apparent mismatch in the 401-instruction Clock function. The difference came from a prefixed RIP-relative movdqa: Capstone 5.0.7 reports disp_size=2 even though the actual encoded displacement occupies four bytes. M6e accepts the four-byte normalization only after independently verifying ModRM, signed raw bytes, typed RIP operand, instruction length and computed target. The anomaly is preserved as one explicit decoder-metadata warning per image, not silently discarded.

## Verified static direct-call mapping

At relative callsite offset +70, the old Clock-related function 0x4E3520 calls the old PlayerSystem-related function 0x49A020. In the newer build, the paired Clock function 0x4E3B50 calls its paired PlayerSystem function 0x49A690 at the same offset. The tool records this as one matching mapped call edge.

This supports static source-code continuity. It does **not** establish that a running RIFT client initializes or owns these pointers, nor that the Telemetry .NET reader is compatible with the newer build.

## Evidence and hashes

- Final ignored report: C:\work\workbridge-mcp\.tools\wb-m6e-function-relations-final-20261121.json
- Report size: 8,143 bytes
- Report SHA-256: e9537078d1944da7a763b622343477129f90c4df3ab491ef390a0bc264e181b4
- M6e tool SHA-256: 4d6e20ee60966de7710c819914935d54145370fb03cf1c0fc67d6acb949ed0fe
- M6d input report SHA-256: e90b0e4f3d05cbf640cf6f302c60d3c25b1af6fed39067a67ffcc587503200d8
- M6d tool SHA-256: 9908f7b07decb027bc55b4b88486a19583632bf420ed1fbf09327af43fd62533
- Old RIFT x64 SHA-256: 1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8
- Newer RIFT x64 SHA-256: df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01

### Reproduction on AMD-DESKTOP (PowerShell 7)

From C:\work\workbridge-mcp, choose a never-used JSON output filename:

```powershell
& 'C:\work\rre\.venv\Scripts\python.exe' -B .\integrations\rift\tools\telemetry-function-relations.py --expect-host AMD-DESKTOP --workspace-root 'C:\work' --report '.tools\wb-m6d-context-20261121-final.json' --expected-report-sha e90b0e4f3d05cbf640cf6f302c60d3c25b1af6fed39067a67ffcc587503200d8 --expected-m6d-tool-sha 9908f7b07decb027bc55b4b88486a19583632bf420ed1fbf09327af43fd62533 --before 'C:\work\RIFT-Build-Baselines\1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8\rift_x64.exe' --after 'C:\work\RIFT-Build-Baselines\df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01\rift_x64.exe' --reader 'C:\work\Telemetry\src\Telemetry.Cli\Sources\LiveTargetSource.cs' --output '.tools\NEW-UNIQUE-M6e-report.json'
```

## Validation and next research gate

- Focused M6e tests: **9 passed, zero failed**.
- Complete RIFT companion regression: **120 passed, zero failed, zero skipped**.
- New JavaScript tests pass Prettier.
- Adversarial tests cover wrong host, report/tool/source SHA mismatches, rehashed fabricated native qualification, ambiguous and contradictory function mappings, pre-existing output, and the independently encoded RIP anomaly.
- No game, live memory, debugger, addon, service restart or deployment action.

**Limits:** The function sample is selected from M6d root witnesses, not all RIFT functions. M6c .pdata scanning was not a whole-code image analysis. Masked relative call displacements can hide changes in call _targets_; only the explicitly mapped call above was checked against both selected function starts. Native runtime locators remain unqualified.

**Next:** Extend verified offline initializer/caller relationship research, then separately qualify current-process pointer ownership and exact producer PID/start ticks before updating the Telemetry .NET 10 native reader.

Earlier checkpoint: docs/wb-rift-001-m6d-instruction-context-20261121.md
Master roadmap: docs/wb-rift-001-unified-research-coordinator-roadmap-20261120.md
