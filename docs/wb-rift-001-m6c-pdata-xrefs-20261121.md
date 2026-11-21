# WB-RIFT-001 M6c — PDATA-Constrained RIFT RIP-Relative Cross-Reference Audit

**Captured:** November 21, 2026 (EST)  
**Host:** AMD-DESKTOP, independently verified with native hostname.exe exit 0  
**Status:** Offline static investigation; **no new live native Telemetry offset is qualified**.

## What improved beyond M6b

M6b found that six Telemetry selectors share the same 16 bytes at the equivalent section-relative position within the newer RIFT build. It could not identify the three non-file-backed roots and explicitly qualified zero memory locators.

M6c reuses the previously SHA-pinned RRE PE parser and static locator helper, then decodes actual **x86-64 RIP-relative memory references** with RRE's existing **Capstone 5.0.7** installation under `C:\work\rre\.venv`. Instead of decoding arbitrary bytes from the entire image, it constrains scanning to PE exception-directory (`.pdata`) function ranges, and separately validates bounded reference samples using **typed** Capstone memory operands and exact source instruction bytes.

The resulting evidence supports a different displacement for the three roots, while retaining the original caution: static code references do not establish live pointer ownership or correct native reader behavior.

## Original and newer executable evidence

| Input                                            | Exact SHA-256                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| Older RIFT x64 image                             | `1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8` |
| Newer RIFT x64 image, current live witness build | `df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01` |
| Telemetry `LiveTargetSource.cs`                  | `197f4af53be8fe597e17424066139e1735b6c063cb17589840de3c7418d3a1aa` |
| RRE `rift_update_analyzer.py`                    | `6b77d964ec493221b8bb6240da6fcac7f489cdc540bad0c67d20f902991f84ae` |
| M6b static audit helper                          | `737873e0ba3802874f466999f8ee01703ad804346e00666e6584efd57c38ce9c` |
| M6c XREF audit helper                            | `c212bbd8892cd39b0468db27a65ede731fa9b187b7e8499d414de6777419e22a` |

The analysis tool verifies all declared pins, including its own bytes; any mismatch refuses the run. It creates one JSON report with original instruction bytes, bounded typed operand witnesses, tool versions and source hashes, not a new native reader.

## All nine static native RVA candidates

Two **different shifts** are supported by independent xref-count evidence:

| Original Telemetry constant | Historical RVA | New static candidate RVA | Shift      | Old RIP refs | New RIP refs |
| --------------------------- | -------------- | ------------------------ | ---------- | -----------: | -----------: |
| `ManagerRva`                | `0x33624A8`    | `0x3373C68`              | `+0x117C0` |          595 |          595 |
| `PlayerSystemRva`           | `0x33623E0`    | `0x3373BA0`              | `+0x117C0` |          605 |          605 |
| `HealthSelectorRva`         | `0x2F57850`    | `0x2F68850`              | `+0x11000` |          575 |          575 |
| `NameSelectorRva`           | `0x2F582E0`    | `0x2F692E0`              | `+0x11000` |          385 |          385 |
| `LocalizedNameSelectorRva`  | `0x2F579F0`    | `0x2F689F0`              | `+0x11000` |            2 |            2 |
| `AlternateSelectorRva`      | `0x2F58270`    | `0x2F69270`              | `+0x11000` |           93 |           93 |
| `SelectionSelectorRva`      | `0x2F57260`    | `0x2F68260`              | `+0x11000` |          239 |          239 |
| `PositionSelectorRva`       | `0x2F588A0`    | `0x2F698A0`              | `+0x11000` |          306 |          306 |
| `ClockRootRva`              | `0x33DC2B0`    | `0x33EDA70`              | `+0x117C0` |          583 |          583 |

The six selectors correspond to relocated file-backed content in `.data` with identical sampled 16-byte windows and matching xref counts. The three roots are not file-backed at their **old** RVAs. For each root, the scanner searched a bounded ±`0x2000` RVA neighborhood around the simple section-relative prediction and found exactly **one** new `.data` target with the original full-sweep xref count. The three root candidates all share an extra **`+0x7C0`** relative displacement, so their total RVA shift is **`+0x117C0`**.

The original `+0x11000` displacement is **not** correct for the three roots. Zero native locators have been independently qualified for runtime use; these nine addresses are **static hypotheses**.

### Representative typed instruction references

All these instruction bytes are saved in the report and were re-decoded by Capstone with typed RIP-relative memory operands:

| Purpose      | Old function / reference RVA | New function / reference RVA | Candidate target |
| ------------ | ---------------------------- | ---------------------------- | ---------------- |
| Manager root | `0x49CC10 / 0x49CC26`        | `0x49D280 / 0x49D296`        | `0x3373C68`      |
| Player root  | `0x495030 / 0x49504A`        | `0x495690 / 0x4956AA`        | `0x3373BA0`      |
| Clock root   | `0x4E3520 / 0x4E3553`        | `0x4E3B50 / 0x4E3B83`        | `0x33EDA70`      |

These are **code-reference witnesses**, not evidence that the pointers reference the same initialized structures or selected player in a live process.

## Decode coverage and limitations

| Measurement                              | Older image | Newer image |
| ---------------------------------------- | ----------: | ----------: |
| Valid `.pdata` function ranges           |     303,143 |     303,450 |
| Instructions decoded                     |   7,633,563 |   7,634,005 |
| Function-range bytes                     |  31,109,004 |  31,105,104 |
| Bytes decoded within those ranges        |  31,077,595 |  31,074,622 |
| Decoded fraction within range            | **99.899%** | **99.902%** |
| Portion of raw `.text` covered by ranges | **78.218%** | **78.101%** |
| RIP operands not understood by scan      |           0 |           0 |
| Distinct RIP targets within `.data`      |     158,968 |     158,610 |

The function-range coverage is **not 100% of the executable**. PE unwind ranges can miss leaf functions; linear sweeps can accidentally decode embedded data, indirect jumps may hide call relationships, and no decompiler or debugger proof of object ownership was performed. The 16-byte windows and xref counts are useful filters, not stand-alone identification guarantees.

The scanner validates each preserved sample's raw instruction bytes and Capstone typed RIP operand. It does **not** typed-verify every decoded instruction in the millions-long count, so counts remain **bounded static decoding evidence**. It neither accesses active RIFT process memory nor transmits game input.

## Saved report and exact operator command

The accepted reproducible report is retained under ignored local storage:

`C:\work\workbridge-mcp\.tools\wb-rift001-m6c-xref-audit-20261121-final.json`

SHA-256 of the saved JSON report: `2c0b5cdf287b321377e1abd2a7bc373ab949932d22489c1fccc5e735292fd977` (21,863 bytes).

In **PowerShell 7 on AMD-DESKTOP**, from `C:\work\workbridge-mcp`:

```powershell
& 'C:\work\rre\.venv\Scripts\python.exe' -B .\integrations\rift\tools\telemetry-locator-xrefs.py `
  --expect-host AMD-DESKTOP `
  --workspace-root 'C:\work' `
  --before 'C:\work\RIFT-Build-Baselines\1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8\rift_x64.exe' `
  --after 'C:\work\RIFT-Build-Baselines\df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01\rift_x64.exe' `
  --reader 'C:\work\Telemetry\src\Telemetry.Cli\Sources\LiveTargetSource.cs' `
  --expected-before-sha 1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8 `
  --expected-after-sha df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01 `
  --expected-reader-sha 197f4af53be8fe597e17424066139e1735b6c063cb17589840de3c7418d3a1aa `
  --expected-rre-parser-sha 6b77d964ec493221b8bb6240da6fcac7f489cdc540bad0c67d20f902991f84ae `
  --expected-static-helper-sha 737873e0ba3802874f466999f8ee01703ad804346e00666e6584efd57c38ce9c `
  --output 'C:\work\workbridge-mcp\.tools\NEW_UNIQUE_XREF_REPORT.json'
```

The command uses RRE's **existing** virtual environment, not an installed new Python package. The output directory and file must already be permissible under Workbridge's normal ignored evidence storage; the helper refuses to overwrite an existing report. Source or tool version changes require new explicit hashes.

## Test and next milestone

The focused `integrations/rift/test/telemetry-locator-xrefs.test.mjs` suite passed **6/6**: it executes the **real pinned** two-build scan and checks all nine exact candidate/count results, rejects wrong host and source hashes, verifies the helper's embedded source SHA and tests ambiguous/duplicate or missing count matches. Any root with multiple possible count matches stays unselected; no "nearest address" guess is allowed.

**Final local regression:** RIFT integration suite **101/101**, shared research coordinator **63/63**, selected Workbridge facade/CI/release suite **26/26** with one optional PowerShell-path skip — **190 passing, 0 failing, 1 skipped**. Python syntax compilation, strict TypeScript check, Prettier and Git whitespace validation passed. Remote GitHub Actions and a new WB-001 production release were not performed.

**Next:** independently verify selected code-reference contexts, initialization paths and class/object ownership for each root, followed by a separate guarded **read-only** current-process experiment. Only then consider a new exact-build route in Telemetry's .NET 10 reader and bind its actual producer PID and process-start ticks to a fresh witness. Do not patch Telemetry's old build constant or guess that all roots shifted equally.

The Telemetry and RRE repositories were not modified by this milestone, and the running Workbridge owner was not deployed or restarted.

[Earlier M6b byte audit](wb-rift-001-m6b-telemetry-locator-drift-20261121.md) · [M6a physical witness](wb-rift-001-m6-live-witness-20261121.md) · [WB-RIFT-001 master roadmap](wb-rift-001-unified-research-coordinator-roadmap-20261120.md)
