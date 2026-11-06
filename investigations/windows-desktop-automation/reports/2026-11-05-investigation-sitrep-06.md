# Windows Desktop Automation Investigation — SITREP 06

**Thursday evening, 2026-11-05 (America/New_York); Windows job receipts 2026-11-06 UTC.** Coordinator checkpoint; scope is scoped source/research and pure synthetic tests. Workbridge 0.16.4-dev remains the operational 36-slot coordinator, **no backend replacement**.

## 🟢 What passed in actual retained Workbridge jobs

| Evidence | Exact saved result | Verified scope |
| --- | --- | --- |
| **D1 action-outcome reconciler** | 22 of 22 named O01–O22; OS exit0, 1,951-byte complete stdout, zero stderr; saved job `wda_outcome_reconciler_private_22cases_20261106_e01` (01:00:31.586–31.935Z). Source model SHA256 `ed9407d56abe8830a4ad6a2d81934eaff789d6e3f7fb854c777f802320dd963e`, test SHA256 `faac268a520b1a57c6470aaf7fddc80c5dcc83045eab9b2d94b912a6db7319f2`. Commit `159dd1f206845c1a12539bd5f32d2050cb7421f7`. | Pure deterministic reducer; all three source peer reviewers gave GO, FLAUI and WinApp rechecked saved receipt. No provider called, no screenshot or input. |
| **M3-P12 WinApp/Sbroenne snapshot comparison** | 18 of 18 named P01–P18; OS exit0, 1,757-byte complete stdout, zero stderr; job `wda_m3p12_parity_pure_offline_unit_20261105_a01` (01:00:17.750–18.134Z), syntax 2/2. Module SHA256 `69d8c05ea9a691a27eb4c14ec1605572a3a1460dcf89c0be0c64e087697933df`, test SHA256 `f110e4bd7bbfb75b539c1f65f3b8910cac147b5f821ef493577e714699a42131`. Commit `9a1c2a5ff1c08577ad5ec74d59581184cc5b0f5d`. | Pure privacy-filtering, typed-ID, exact session/run/lease/Job witness policy only; no WinApp or Sbroenne UIA calls. FLAUI independently verified retained job. |
| **Owned modal model** | 8/8 pure modal synthetic tests OS exit0, earlier saved job `wda_modal_oracle_pure_model_offline_tests_20261105a`, commit `1c6a9616ab01f277f164a6426cd2d8583402ad22`. | Built WinExe source **not executed**; proves no actual modal/foreground behavior. |

## 🟡 Important implementation boundaries

1. The outcome reducer requires the correct target process/start/HWND, an independent app-result witness, native held lease and settled Job/receipt before it can claim `verified_success`. An ACK alone is not success; ambiguous outcomes remain `unknown_outcome`, never auto-retry.
2. M3-P12 pure comparator is intentionally stricter than existing compact source receipts. An authentic, provider-time **typed-control witness** bound to exact sample/target/run/lease and independently validated watchdog/Job0 is **not yet emitted by the live WinApp/Sbroenne samplers**. Comparisons must therefore remain UNKNOWN; 18/18 is **not real-provider parity proof**.
3. Actual guest OneDrive controls cannot be reached by merely inspecting VMware host windows. RIFT, both VMware labs, and physical desktop remained untouched.
4. Workbridge's deployed `edit_file` direct `replaceAll` string-replacement issue remains a proven P1 bug with a scoped WB-001 remedy plan; **no live patch, deployment or server restart**. A distinct source audit ruled out claiming a proven direct `write_file` bug.
5. Native orphan lock/admission release and the first desktop/UIA fixture trial remain on HOLD; the older Nov 2 archived screenshot remains `unknown_outcome`. Synthetic private NTFS/Job tests do not authorize live lock release.
6. The separate WGC no-focus pilot received **read-only triage**; its optional `--capture-disposable` branch creates a visible 420-by-260 WinForms fixture despite no-activate flags. While this report was being written, a concurrent workflow committed the WGC prototype (`03af169`) and continued changing `Program.cs`. The latest reviewed README/Program source fixes output to its own `pilot.png` directory and excludes generic RIFT targeting and input, but there is still no evidence of an authorized runtime GUI trial. **Another workflow owns its evolving implementation; this investigation did not launch, stage, edit or test WGC**. Keep desktop-lease/watchdog/user quiet-window checks before any separately authorized GUI run.

## 🟢 Operational freshness

At coordinator read-only diagnostics, Workbridge was `0.16.4-dev`, PID `58580`, instance `be5f373a-8c98-4877-b5dd-dbea9e5728d5`, tunnel ready/control plane OK, **36 of 36 command slots available**. Retained job inventory scanned up to 20,000 entries and was incomplete; do not infer exhaustive history. An unrelated dirty `scripts/freebuff-conpty-probe.py` was left untouched. During this report, a separate workflow committed and continued modifying WGC source; these research milestones did not stage, delete or edit it.

## Next practical decisions

- Finish M5 evidence-rated **keep/wrap/replace/defer per function** analysis, including dialogs, drag, screenshots and VMware host/guest OneDrive.
- Recheck candidate source provenance and producer-time witness attestation with **source-only** investigation. Keep the current backend working.
- Obtain a **quiet user-coordinated Windows desktop window** before proposing a new, short, precisely target-bound disposable WinApp versus Sbroenne read-only pilot. Watchdog native ownership/session, Job and before/after independent receipts must be freshly checked. No physical RIFT game/VM input and no restarts.
- Apply any production fix or provider swap only via separately authorized WB-001 controlled validation/rollback.

**Evidence home:** `C:\work\workbridge-mcp\investigations\windows-desktop-automation\`, with full source, hashes and limited claims in `prototypes/outcome-reconciler/README.md` and `benchmarks/desktopprobe-snapshot-parity-normalizer-2026-11-05.md`.
