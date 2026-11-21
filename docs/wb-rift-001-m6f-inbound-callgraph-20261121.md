# WB-RIFT-001 M6f — Inbound Direct-Call Census and Qualified Caller Pairing

**Date:** Saturday, November 21, 2026 (EST)  
**Host:** AMD-DESKTOP, independently verified with native hostname.exe exit 0  
**Scope:** Offline only, two SHA-pinned RIFT x64 executable images; no live game process or memory operation  
**Result:** 5,007 inbound direct calls per build; 2,451 uniquely paired caller functions; **zero live native locators qualified**

## Objective

M6c identified nine static native-locator hypotheses. M6d independently compared 26 preserved instruction witnesses, and M6e matched seven complete function bodies around the three root candidates (ManagerRva, PlayerSystemRva and ClockRootRva), observing one mapped Clock-to-PlayerSystem direct call.

M6f expands outward from **all seven function starts** selected by M6e. The key question is whether actual _caller functions_ can be matched across the two archived builds, not just whether their target call counts are equal.

New source: integrations/rift/tools/telemetry-inbound-callgraph.py

## Evidence method

1. Verify AMD-DESKTOP hostname, the immutable M6e JSON hash, its supported source/binary hashes and the exact M6e/M6c/M6d/RRE analysis modules and Telemetry C# reader. Do not start another Workbridge owner.
2. Decode both archived images inside the bounded PE .pdata function ranges, using the preinstalled RRE Capstone 5.0.7. Count only direct CALL instructions to one of the seven exact M6e function starts.
3. Independently verify **every counted** call as a five-byte x86-64 E8 rel32 encoding: actual four-byte signed relative operand, calculated target RVA, one Capstone typed immediate target, and the enclosing .pdata function.
4. For each distinct inbound caller, attempt a **complete** bounded-function disassembly using the pinned M6e normalizer. Reject an entire body as unpaired if it is too large, fails complete decoding, or contains an unverified raw RIP/branch encoding. Keep its independently verified inbound CALLs in the census; explicitly count and sample exclusions.
5. Pair callers only when the normalized entire function body hash, byte size, instruction count, mapped root-callee set and exact callsite offsets match **uniquely** within each build's selected caller population. Duplicate signatures are ambiguous, not verified pairings. Other relative call targets normalized by the underlying M6e code are not claimed to match.
6. Revalidate all source pins, then publish bounded examples and a non-overwriting, SHA-verifiable JSON report. No evidence of live pointer ownership is asserted.

## Full offline census

| Measurement                                    | Older archived build | Newer archived build |
| ---------------------------------------------- | -------------------: | -------------------: |
| .pdata function ranges decoded                 |              303,143 |              303,450 |
| Instructions decoded within ranges             |            7,633,563 |            7,634,005 |
| Direct CALL instructions to seven M6e starts   |            **5,007** |            **5,007** |
| Distinct caller functions                      |            **3,145** |            **3,145** |
| Disassembled fraction of .pdata function bytes |              99.899% |              99.902% |

The scan is deliberately limited to PE .pdata ranges, not every executable byte. Indirect calls and functions without unwind entries are not included. The 5,007 counts are instructions, not distinct callers, player instances or gameplay events.

### Call counts by mapped target

| Old function target             | New function target | Old / new callsites | Call instructions within uniquely paired caller bodies |
| ------------------------------- | ------------------- | ------------------: | -----------------------------------------------------: |
| 0x495030                        | 0x495690            |               0 / 0 |                                                      0 |
| 0x49A020 (PlayerSystem-related) | 0x49A690            |   **3,845 / 3,845** |                                                  2,677 |
| 0x49CC10                        | 0x49D280            |               0 / 0 |                                                      0 |
| 0x4A4750 (Manager-related)      | 0x4A4DC0            |   **1,160 / 1,160** |                                                    953 |
| 0x4E3520                        | 0x4E3B50            |               0 / 0 |                                                      0 |
| 0x4E66EF                        | 0x4E6D1F            |               0 / 0 |                                                      0 |
| 0x4E7710 (Clock-related)        | 0x4E7D40            |           **2 / 2** |                                                      2 |
| **Total**                       |                     |   **5,007 / 5,007** |                                              **3,632** |

## Qualified static pairings and exclusions

| Outcome                                                | Old build | New build |
| ------------------------------------------------------ | --------: | --------: |
| Distinct inbound caller functions                      |     3,145 |     3,145 |
| **Unique matched caller-function pairs**               | **2,451** | **2,451** |
| Functions excluded from complete-body pairing          |        83 |        83 |
| Incomplete complete-body disassembly                   |        48 |        51 |
| Unverified whole-body RIP target                       |         4 |         1 |
| Caller body exceeds 8 KiB limit                        |        31 |        31 |
| Unpaired caller-catalog entries (includes ambiguities) |       611 |       611 |

The pairing algorithm separately counts **135 ambiguous caller pairings**; those do not become verified pairs. Of the 5,007 inbound calls per build, **3,632** occur at matched mapped-root offsets inside the 2,451 uniquely paired caller functions. The other 1,375 are not promoted to a cross-build callsite match.

Example of a high-activity paired caller from the final evidence: old function 0x6F2D40 maps to new function 0x6F31D0, with 25 mapped-root CALL instructions at corresponding offsets. Another function 0x7A15AE maps to 0x7A1ACE with 15 such calls. Both are unique only within the scanned selected-caller fingerprint population; neither is a verified game initializer by itself.

### Root cause of the first refused whole-body match

An initial attempt stopped at old caller RVA 0x5E57D0. At instruction RVA 0x5E6EDB, bytes 00 2D 5D 5E 00 92 decode linearly as a RIP-relative access with a computed target outside the bounded image. The M6e full-body validator correctly refused to normalize it. M6f does **not** weaken this check or claim the entire caller is verified. It records such callers as excluded, alongside other incomplete or excessive-size functions. The rest of the direct-call census stays independently verified.

This distinguishes reliable individual E8 callsite observations from lower-confidence complete function-body interpretations.

## Immutable source and report evidence

- Accepted ignored report: C:\work\workbridge-mcp\.tools\wb-m6f-inbound-second-20261121.json
- Accepted report size: 49,482 bytes
- Accepted report SHA-256: c820abf89abe903532b33a4ab57e7689f61f10d2a30433ae80f85d44e7683c0f
- M6f source SHA-256: 127c414577e242319e6892ac869868a06f1b68a5f32dcf8a59890b2a58679d75
- M6e input report SHA-256: e9537078d1944da7a763b622343477129f90c4df3ab491ef390a0bc264e181b4
- M6e tool SHA-256: 4d6e20ee60966de7710c819914935d54145370fb03cf1c0fc67d6acb949ed0fe
- Old RIFT x64 SHA-256: 1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8
- New RIFT x64 SHA-256: df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01

## Reproduce on AMD-DESKTOP

From PowerShell 7 in C:\work\workbridge-mcp, use a fresh output filename (an existing file is never replaced):

```powershell
& 'C:\work\rre\.venv\Scripts\python.exe' -B .\integrations\rift\tools\telemetry-inbound-callgraph.py --expect-host AMD-DESKTOP --workspace-root 'C:\work' --report '.tools\wb-m6e-function-relations-final-20261121.json' --expected-report-sha e9537078d1944da7a763b622343477129f90c4df3ab491ef390a0bc264e181b4 --expected-m6e-tool-sha 4d6e20ee60966de7710c819914935d54145370fb03cf1c0fc67d6acb949ed0fe --before 'C:\work\RIFT-Build-Baselines\1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8\rift_x64.exe' --after 'C:\work\RIFT-Build-Baselines\df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01\rift_x64.exe' --reader 'C:\work\Telemetry\src\Telemetry.Cli\Sources\LiveTargetSource.cs' --output '.tools\NEW-UNIQUE-m6f-inbound.json'
```

## Validation and remaining research

- New focused regression suite: **9/9 passed, 0 failures**, including full real pinned two-build scan and cross-call fingerprints.
- Complete RIFT companion suite: **129/129 passed, zero failures, zero skips**, with bounded Node test concurrency of four.
- Adversarial checks: wrong machine, wrong source/image/report pin, existing output intact, rehashed false native status, forged E8 target, duplicate caller-body fingerprints, contradictory callsite offsets and unverified full-body RIP exclusion.
- Python syntax and JavaScript Prettier checks: PASS.
- No live process memory read/write, game action, addon deployment, Workbridge service update or debugger operation.

**Limits:** Matching normalized bodies and a mapped target CALL at a shared offset provides strong static cross-build correspondence, not a proof of constructor behavior, initialized pointer ownership, player/target statistics, or server-accepted gameplay changes. No outside-target callees are semantically verified merely because their relocatable branch bytes normalize alike. The 135 ambiguous entries and 83 excluded bodies per build remain unqualified.

**Next high-value research:** Classify the 2,451 paired callers by _actual_ setup/cleanup behavior and calling context, then independently validate candidate Manager/PlayerSystem roots against a precisely identified read-only physical RIFT process and Telemetry source epoch. No .NET reader offset update should be inferred from static call counts alone.

Earlier milestone: docs/wb-rift-001-m6e-function-relations-20261121.md
Master roadmap: docs/wb-rift-001-unified-research-coordinator-roadmap-20261120.md
