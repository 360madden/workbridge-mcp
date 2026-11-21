# Workbridge-MCP — Saturday RIFT Research Handoff (2026-11-21)

**Created:** Saturday, November 21, 2026 (America/New_York)  
**Owner / repository:** 360madden / `C:\work\workbridge-mcp` / GitHub `360madden/workbridge-mcp`  
**Host verified for this handoff:** **AMD-DESKTOP**, native Workbridge `hostname.exe` completed exit **0**, stdout `AMD-DESKTOP`  
**Starting local Git HEAD:** `49d7f3a69f32e031ff3fe3ac5e2bd24a0be900d7` (`main`, 3 commits ahead of locally recorded `origin/main` before the handoff commit/push)  
**Current installed Workbridge:** `0.16.5-dev` with **36** command-job slots and **36** coordinated worker assignments (not 36 ChatGPT reasoning agents); connected secure tunnel, authenticated loopback CLI.  
**MCP research facade:** implemented in source but **not deployed** to the installed owner. The prior M5 release `wb-rift001-m5-20261121-003` was validated and remained unapplied; it predates later M6d–M6f changes.

> This document reports evidence observed **before the handoff commit and requested push**. Confirm the final remote SHA and CI workflow status independently after publishing; an offline test result is not a remote GitHub CI pass.

## 1. Status at handoff

| Area                                           | Verified state / important qualification                                                                                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workbridge host                                | AMD-DESKTOP, `0.16.5-dev`, tunnel operational; no service replacement                                                                                                                                                 |
| Git branch                                     | `main`; recent M6d–M6f source committed locally                                                                                                                                                                       |
| Working tree before this handoff               | Only unrelated **untracked** `scripts/ci-core-test-partition.mjs`; preserve it; do not stage, delete, stash or overwrite                                                                                              |
| M6d                                            | Complete: pinned instruction witness context; **26/26** normalized samples match                                                                                                                                      |
| M6e                                            | Complete: **7/7** selected root-related function-body pairs normalize identically, **716** instructions per build; one explicitly mapped cross-root direct-call edge                                                  |
| M6f                                            | Complete: **5,007** typed-verified inbound CALL instructions per build, **3,145** distinct caller functions per build, **2,451** uniquely paired caller-function pairs, **3,632** corresponding mapped-root callsites |
| Live native telemetry                          | **Not qualified**: `nativeRuntimeLocatorsQualified=0`; `livePlayerTelemetryVerified=false`                                                                                                                            |
| Installed RIFT, Telemetry, RRE, RR2            | No live process memory reads/writes, game input, addon deployment, debugger attachment, or project edits in M6d–M6f                                                                                                   |
| Latest confirmed hosted CI before this handoff | GitHub Build and Test run `44928404278` at `3377114` passed both Windows/Node 24 matrix shards; newer local commits need fresh hosted verification after push                                                         |

### Research-chain baseline

- **Older archived RIFT executable SHA-256:** `1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8`.
- **Newer archived RIFT executable SHA-256:** `df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01`.
- Archived executables are stored under `C:\work\RIFT-Build-Baselines\<sha>\rift_x64.exe`, **not** in Git.
- Existing Telemetry `.NET 10` reader supports the old build. M6a physical witness identified the newer executable and correctly reported unavailable native player/target fields; source PID/start-epoch binding and runtime pointer ownership are not established.
- M6b/M6c found **nine static locator hypotheses**: six selectors with apparent `+0x11000` RVA shift, and three roots with `+0x117C0` shift. This is **not** a current-memory offset qualification. See [M6c report](wb-rift-001-m6c-pdata-xrefs-20261121.md).

## 2. Exactly what was built and verified

### M6d — instruction witness shape continuity

**Local commit:** `99efd550986630d0499cd0a78add7edff5b781ef`  
**Analyzer:** `integrations/rift/tools/telemetry-locator-context.py`  
**Tests:** `integrations/rift/test/telemetry-locator-context.test.mjs`  
**Details:** [M6d report](wb-rift-001-m6d-instruction-context-20261121.md)

The new analyzer reads the pinned M6c report and old/new PE files; verifies original instruction bytes and .pdata membership; confirms typed Capstone RIP-relative targets; and compares the 26 historical against 26 newer sampled instruction shapes after masking only the **independently validated** four-byte RIP displacement. **26/26** match and **0/9** native runtime locators qualify. Focused **9/9** PASS; full RIFT suite **111/111** PASS.

**Ignored evidence:** `.tools/wb-m6d-context-20261121-final.json`  
**Evidence SHA-256:** `e90b0e4f3d05cbf640cf6f302c60d3c25b1af6fed39067a67ffcc587503200d8`  
**M6d source SHA-256:** `9908f7b07decb027bc55b4b88486a19583632bf420ed1fbf09327af43fd62533`.

### M6e — complete selected function bodies and a mapped direct call

**Local commit:** `6d7176f0e49abf084c4fa417ecfb7b7a59a459a6`  
**Analyzer:** `integrations/rift/tools/telemetry-function-relations.py`  
**Tests:** `integrations/rift/test/telemetry-function-relations.test.mjs`  
**Details:** [M6e report](wb-rift-001-m6e-function-relations-20261121.md)

Compared **seven full selected .pdata function pairs** around Manager, PlayerSystem and Clock roots. **716 instructions and 3,058 bytes per image**, **7/7** normalized body matches. Established one static direct-call mapping:

- Old Clock-function start `0x4E3520` → old PlayerSystem-related target `0x49A020` at relative call offset `+70`.
- New corresponding Clock function `0x4E3B50` → new corresponding target `0x49A690`, also at `+70`.

One initial mismatch in a prefixed RIP-relative `movdqa` was traced to Capstone 5.0.7 reporting `disp_size=2` when **four actual displacement bytes** were present. The decoder exception is individually verified and recorded, **not silently ignored**. Focused **9/9** PASS; full RIFT suite **120/120** PASS.

**Ignored evidence:** `.tools/wb-m6e-function-relations-final-20261121.json`  
**Evidence SHA-256:** `e9537078d1944da7a763b622343477129f90c4df3ab491ef390a0bc264e181b4`  
**M6e source SHA-256:** `4d6e20ee60966de7710c819914935d54145370fb03cf1c0fc67d6acb949ed0fe`.

### M6f — inbound callsite census and paired callers

**Local commit:** `49d7f3a69f32e031ff3fe3ac5e2bd24a0be900d7`  
**Analyzer:** `integrations/rift/tools/telemetry-inbound-callgraph.py`  
**Tests:** `integrations/rift/test/telemetry-inbound-callgraph.test.mjs`  
**Details:** [M6f report](wb-rift-001-m6f-inbound-callgraph-20261121.md)

The complete offline scan of the two pinned PE images found:

| Measurement                                                                                   |     Older build |     Newer build |
| --------------------------------------------------------------------------------------------- | --------------: | --------------: |
| Valid decoded .pdata function ranges                                                          |         303,143 |         303,450 |
| Instructions decoded within those ranges                                                      |       7,633,563 |       7,634,005 |
| Independently verified `E8 rel32` direct CALL instructions into the seven M6e function starts |       **5,007** |       **5,007** |
| Distinct inbound caller functions                                                             |       **3,145** |       **3,145** |
| Uniquely paired caller-function bodies across builds                                          | **2,451 pairs** | **2,451 pairs** |
| Corresponding paired mapped-root CALL instructions                                            |       **3,632** |       **3,632** |

Per-target inbound CALL totals are **3,845** to the selected PlayerSystem helper, **1,160** to the selected Manager helper, and **2** to the selected Clock helper, identically in both archives. The other four selected function entries have zero direct E8 callers in the scanned .pdata ranges.

Callsite pairing requires a uniquely matching **whole normalized function-body fingerprint**, instruction count and exact mapped-root call offsets. **135 ambiguous caller matches** were left unqualified; **611 caller catalog entries per build** were unpaired. Additionally **83 caller bodies per build** were excluded from full-body verification because they were too large, disassembled incompletely or had unverifiable RIP target encodings. A safely decoded individual direct E8 call may still be counted in the census for an excluded body; the **whole body is not falsely counted as paired**.

M6f focused **9/9** PASS. Final full RIFT companion regression **129/129** PASS, zero failures/skips. Python AST syntax, Prettier and Git whitespace checks passed.

**Ignored evidence:** `.tools/wb-m6f-inbound-second-20261121.json`  
**Evidence size:** 49,482 bytes  
**Evidence SHA-256:** `c820abf89abe903532b33a4ab57e7689f61f10d2a30433ae80f85d44e7683c0f`  
**M6f source SHA-256:** `127c414577e242319e6892ac869868a06f1b68a5f32dcf8a59890b2a58679d75`.

**Caveat:** M6f's .pdata-only linear code sweep covers approximately 78% of raw .text from earlier scans. It does not cover leaf functions absent from unwind metadata, indirect calls or all semantically possible control flow. Normalized relative branch/call bytes alone do not prove unrelated call targets are semantically equivalent. Never infer actual runtime object ownership from matching counts.

## 3. Current operational constraints

- **Mandatory host preflight each new chat/agent session:** execute `hostname.exe` on the selected Workbridge connector and check actual completed stdout/exit code. This handoff proves **AMD-DESKTOP only**. Do not silently switch to LEGION or VMware.
- **Protect user state:** only `scripts/ci-core-test-partition.mjs` was untracked at the start of this handoff. It is unrelated and must remain untouched, uncommitted and unstashed unless separately reviewed.
- **No accidental service update:** `npm run build` in the active working checkout can try replacing an **in-use** native `dist/command-host.exe`. Prefer isolated release/validation checkouts for full builds. Source edits, passing RIFT tests and a GitHub push do **not** deploy the installed Workbridge owner.
- **MCP research tools remain source-only** until a new WB-001 sealed candidate passes its complete release gates, exact manifest verification and separate maintenance/rollback handoff. The older validated M5 candidate does **not** incorporate recent M6d–M6f work.
- **No model-agent exaggeration:** the 36 host job/assignment slots are not 36 ChatGPT reasoning workers.
- **Evidence is local:** `.tools` reports, game executables, Telemetry binaries and saved process witnesses are deliberately Git-ignored. They are **not** included by pushing source and docs to GitHub.
- **Live process epoch remains unqualified:** old PID, HWND and start-tick values are historical evidence only. Fresh RIFT process selection is required for any later live read-only experiment.

## 4. M6g — recommended immediate next work

**P0: classify candidate initializer, getter and teardown paths among M6f's 2,451 uniquely paired caller functions, using pinned archived sources and no live game.**

1. Reconfirm machine, HEAD, Git status and all evidence hashes. Read this handoff, [master roadmap](wb-rift-001-unified-research-coordinator-roadmap-20261120.md) and [M6f report](wb-rift-001-m6f-inbound-callgraph-20261121.md).
2. Extend the existing M6f evidence reader rather than duplicate the PE parser, Capstone decoding, SHA checks or worker scheduler. Use **bounded, high-signal candidates first**: uniquely matched callers with both Manager and PlayerSystem helper calls, repeated near offsets, or direct sites whose surrounding instructions may load/store the corresponding root. Do not assume a frequently called helper is a constructor.
3. Distinguish concrete function patterns: reads of root RIP-relative storage, assignments/zeroing, constructors, destructors, registration and returning accessors. Save exact old/new function RVA, instruction witness bytes, call targets and context with hashes; mark hypotheses versus independently verified static facts. When image control flow makes linear-decoded bytes dubious, **record an exclusion**.
4. Preserve M6f's 135 ambiguous and 83 excluded-per-build records. Any extended matching must remain uniquely keyed and must not weaken M6e's byte/operand proof.
5. Add focused negative tests (changed hashes, misleading callees, duplicate equivalence, omitted .pdata function, invalid RIP target, report tampering). Run the bounded full RIFT suite. Commit a narrow source/test/doc milestone only after results support it.

**P1: prepare a distinct, read-only current-client qualification plan.** The selected live process must be identified at time of acquisition by current PID + exact 64-bit process-start ticks + module/exe SHA + HWND. The Telemetry producer must report the **same epoch** rather than relying solely on Workbridge's external before/after bracket. Only independently reproducible pointer-chain ownership and player/target state evidence would permit proposing a new exact-build native-reader route. Unknown values stay unavailable, never guessed zero.

**P1/P2: independent Workbridge release gate.** A new clean, committed WB-001 candidate must be built from the actual post-push HEAD, pass the full release suite, seal its 25-file research runtime closure or its current exact source-defined closure, and receive independent hosted checks before any **separate** production Apply. Do not deploy or restart the active owner as a side effect of this handoff.

## 5. Useful commands and resumption checklist

Use these in **PowerShell 7 on AMD-DESKTOP** after checking the machine:

```powershell
cd 'C:\work\workbridge-mcp'
hostname.exe
git status --short --branch
git log -5 --oneline
node --test --test-concurrency=4 integrations/rift/test/*.test.mjs
```

Expected latest verified RIFT suite _as of this handoff_ is **129/129 passing**. A new test run establishes its own current result.

For the exact M6f reproduction, follow the pinned command in [M6f report](wb-rift-001-m6f-inbound-callgraph-20261121.md). It needs the original local archived builds, RRE virtual environment and the ignored M6e JSON evidence; choose a **new** output path. The 49,482-byte original M6f JSON and exact SHA above should be independently checked if reused.

## 6. Git publication checklist

Requested by the owner on November 21, 2026: **create this handoff and push the repository**.

- Before push: verify exact tracked files in this handoff commit; preserve `scripts/ci-core-test-partition.mjs`; confirm `main` and remote `360madden/workbridge-mcp`.
- Push `main` normally, without force. If rejected due to remote divergence, inspect/fetch/reconcile; **do not force-push or erase work**.
- After push: independently verify `origin/main` and GitHub remote HEAD match local HEAD, and report the new commit SHA.
- GitHub Actions may be pending; report `pending` or `failed` honestly rather than claiming green unless a completed corresponding workflow shows success.
- This document must remain useful even if the model session ends. Resume M6g without re-asking for already documented source paths or prior goals.

**Related primary evidence:** [M6d](wb-rift-001-m6d-instruction-context-20261121.md) · [M6e](wb-rift-001-m6e-function-relations-20261121.md) · [M6f](wb-rift-001-m6f-inbound-callgraph-20261121.md) · [master roadmap](wb-rift-001-unified-research-coordinator-roadmap-20261120.md) · [WB-001 release gate](wb-rift-001-m5-sealed-release-gate-20261120.md)
