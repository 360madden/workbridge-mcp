# Windows Desktop Automation Investigation — SITREP 05

**Thursday evening, 2026-11-05 (America/New_York)**. Some Windows job IDs/receipts have crossed into 2026-11-06 UTC. Coordinator checkpoint; investigation only. Existing Workbridge desktop integrations and daily use remain deployed and unchanged by this investigation.

## Operational state

- Latest read-only diagnostic: Workbridge 0.16.4-dev, instance `be5f373a-8c98-4877-b5dd-dbea9e5728d5`, PID 58580, tunnel ready and control plane OK, 36/36 command slots available at the checked instant. Stored-job inventory is bounded and incomplete; this is not a global historical claim.
- The old November 2 desktop input quarantine was archived under a **separate, specifically authorized** RIFT maintenance workflow; the old screenshot outcome remains unknown and was not replayed. No game, VM, Windows desktop input, production server restart or production lock mutation was performed in this research checkpoint.
- Five parallel specialist investigation lanes were coordinated with exclusive source ownership and source/Job/process peer review. Shared research folder and roadmap remain under `investigations/windows-desktop-automation/`.

## New verified milestones

| Lane | Evidence | Result | What it does **not** establish |
| --- | --- | --- | --- |
| **M3-P8 restricted environment synthetic** | Windows custom seven-key Unicode environment, 20-key presence mask `11111100000000000000`, native Job0, 860 ms, OS exit0. Commits `5dc47ad` and `8e8d78e`. | 🟢 One private synthetic MCP oracle passed. | No real Sbroenne process, UIA, GUI or automatic extraction control proof. |
| **M3-P9 actual Sbroenne v1.3.28 MCP** | Exactly pinned single-file executable SHA-256 `ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128`; one isolated actual-vendor `tools/list`, OS exit0, 1.328 s, 253-byte fixed stdout, stderr0, Job0, one `ui_snapshot` advertised, zero `tools/call`. Native private scratch/extraction dirs had zero observed items. Commits `604c305` and independent `01abcd1`. | 🟢 Protocol compatibility and owned process settlement established for this one run. | No UIA invocation, before/after app observation, provider speed comparison, exhaustive out-of-Job-child proof, or confirmed extraction destination. |
| **R0 native FileId lease** | Compiled .NET 10 helper with one-byte Windows FileDisposition BOOLEAN; read-only independent actual NTFS user-Temp preflight. Four private synthetic cases: create/release/replay, same-byte replacement refusal, owner abort lock retained, two-owner CREATE_NEW contention. Commit `378b2ea`. | 🟢 4/4 synthetic, OS exit0, no production file touched. | Not yet a production admission/lock fix. Held-handle rename races, hardlinks, reparse, share denial and lifecycle remain R1. |
| **WinApp incumbent 0.7.1** | Earlier November 4 taskbar read-only 10 cycles had median listing+inspect 3,677 ms. November 5 offline target-evidence oracle passed 9/9. A later proposed paired direct-inspect vs duplicate-discovery A/B was aborted early with **zero completed pairs**; two isolated preflight calls took 5,357 and 20,367 ms. Commit `78da117`. | 🟡 Narrow existing baseline valid; new A/B inconclusive. | No relative Sbroenne-vs-WinApp UIA latency or general dialog reliability proof. |
| **Watchdog orphan inspector** | Corrected synthetic-only source passed PowerShell parser and real OS Temp preflight, with two independent source-review GO decisions. One subsequent 11-case private synthetic attempt `wd_orphan_inspector_private_matrix_20261106_e01` stopped at **I01**, OS exit1, `EXPECTED_NATIVE_FILE_ID_INVALID`. | 🔴 Test failure honestly retained; no automatic replay. | Failed first case means no 11-case pass. Pinned native helper outputs a continuous 32-digit hex FileId while the inspector expected dashed byte groups; source contract fix and fresh review required. |

## Critical independent source finding — file-edit literal fidelity

Workbridge's **deployed** `dist/changes.js` and source `src/changes.ts` implement `edit_file` by passing replacement text directly as the second argument of JavaScript `replaceAll`. Certain dollar-prefixed sequences in replacement text are interpreted by JavaScript as replacement instructions rather than literal bytes. The orphan-inspector author observed twice that a PowerShell regex ending in one such sequence unexpectedly appended roughly 8 KB of prior file text; source audit independently identified the mechanism.

**Impact:** potential content corruption in affected `edit_file` operations; this is a source-confirmed data-integrity bug, not evidence of corruption to unrelated files. The source review **did not** establish the same bug in direct `write_file` and expressly limits that claim. The minimal proposed repair is a function callback returning literal replacement text plus regression cases. No production source, deployment or running Workbridge service was changed. A separate scoped source-audit report and WB-001-governed fix plan are in progress.

## Next gates in priority order

1. Correct inspector FileId canonical representation and pin exact inspector/harness hashes; parse/preflight and obtain new independent source approvals before requesting **a distinct** private 11-case synthetic test. Never auto-retry the failed I01 operation. Live orphan archival remains on hold.
2. Save independent `edit_file` source audit and isolated regression matrix; consider a narrowly reviewed production fix only via separate WB-001 validation and rollback. Avoid unsafe replacement text in interim research edits.
3. Extend R0 to R1 held-handle release-vs-rename, hardlink/reparse/share-denial and cold/warm performance under private fixtures; keep production locks untouched.
4. Prepare a one-shot same-target WinApp vs Sbroenne read-only UIA comparison. Real disposable GUI launch, foreground/UIA observation and native postcondition require an explicitly coordinated quiet desktop interval and a fresh desktop admission gate. **No GUI trial authorized in this checkpoint.**
5. Preserve Workbridge as the scheduler, existing four desktop tools, RIFT host integration and both VMware labs until a function-level incumbent-vs-candidate decision is actually measured. Production replacement belongs to M5/M6 plus WB-001.

### Key evidence links inside this repository

- `benchmarks/sbroenne-v4-restricted-singlefile-protocol-2026-11-05.md`
- `prototypes/fileid-lease-r0/R0-EVIDENCE-2026-11-05.md`
- `benchmarks/m1-taskbar-ab-interrupted-2026-11-05.md`
- `reports/2026-11-05-investigation-sitrep-04.md`

All these outcomes are deliberately limited to the exact executed evidence. This report does not convert an isolated protocol handshake into proof of real Windows GUI reliability.

## Post-checkpoint verified follow-up (after the initial report)

- The first private watchdog inspector e01 test remains a recorded **failure** at I01. The corrected, freshly peer-reviewed **new** e02 job passed 12/12 synthetic cases, OS exit0, 12/12 private fixtures cleaned, no live locks, GUI or VMware. Its readonly inspector is still not a production lock-release utility. Independent audit `d3322ad`; owned implementation and truthful e01/e02 evidence commit `f542678`.
- An isolated in-memory JavaScript regression proved 11/11 cases: replacement-string substitution corrupts literal special tokens, while callback replacement preserves exact content. Commit `2e42969`. Workbridge deployed edit_file is still **unpatched**; direct write_file is not proven affected.
- A separate exact-HWND WinApp/Sbroenne parity **source-only** pilot contract was committed `a3b3555`; the actual Windows UIA snapshot trial remains HOLD until user-coordinated quiet desktop admission.
