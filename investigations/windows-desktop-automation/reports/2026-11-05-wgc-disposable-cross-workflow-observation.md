# Cross-workflow WGC disposable capture observation — 2026-11-05 Eastern

**Provenance:** READ-ONLY coordinator observation of a **separate concurrent Workbridge workflow's** Windows Graphics Capture prototype. This is not our WinApp/Sbroenne first UIA parity trial, not a physical RIFT/VM test, and not an authorization to retry or deploy the WGC path. Treat other-workflow metadata as reported claims unless independently checked.

## Exact captured evidence and honest status

- Separate-owner source commits `03af169bbddf77939cb5775a707d572de1ea481d` and `03f034cec9c2b73e9963fecee706021e9ddcf358`; scoped prototype `prototypes/wgc-no-focus-pilot/`. Do not edit, stage, delete or assume ownership.
- Workbridge retained job `wgc_pilot_one_disposable_gui_attempt_20261105_01`: WindowsPowerShell wrapper **status failed, OS exit1**, start 2026-11-06 01:10:12.957Z, finish 01:10:14.644Z; stdout 306 bytes, stderr 0, output not truncated. The child code printed **PASS** for a 406-by-253 WGC-only synthetic HWND `0xB50352`, PNG size 4,255 bytes and SHA-256 `9414885183cf32274a353ccefb75c5a5e2028b97e87053cf90cec38a08b628f5`.
- Wrapper reported `finished=True`, but child `ExitCode` was **blank/null**, so the wrapper classified it as **exit1**. This is not a clean end-to-end success, regardless of child PASS text. It also reported same foreground HWND `1903292` before/after; this is wrapper observation, not a separate native attestor.
- Three separate saved Workbridge **read-only** jobs `wgc_pilot_png_offline_reader_20261105_01`, `wgc_pilot_readonly_png_reconcile_20261105_01`, `wgc_pilot_readonly_pixel_colors_20261105_01` each report **passed, OS exit0**, with untruncated outputs. The other workflow's evidence says PNG decoded 406x253 and three synthetic colors were consistent.
- Observed artifact description appears in an **untracked** `prototypes/wgc-no-focus-pilot/evidence-disposable-2026-11-05.json`, read SHA-256 `961559708d27a0303b8b476ffb04d699309220835743bcd3ae647b7f473e33f8`; this JSON belongs to another workflow and is not staged or committed by us. It claims no physical game, VMware or input interaction; that claim was **not** independently established by our passive inspection.

## What can and cannot be concluded

🟢 An actual synthetic-frame WGC attempt occurred, produced a structurally valid PNG, and three independent read-only validation jobs passed. The reported foreground HWND remained unchanged.

🟡 Child success, complete process-lifetime settlement, external noninterference, original-window focus and first-to-last safety invariants are **not fully independently proven** because wrapper ended OS exit1 with null child code and there was no native independent GUI watcher in this evidence.

🔴 Do **not** promote it to verified provider reliability, generalized no-focus capture, minimized RIFT capture, production screenshot fallback or WinApp/Sbroenne UIA parity.

## Next safe step

Let the **owning workflow** fix its child exit-code receipt off-line and separately validate source plus native desktop ownership/quiet-window gate. Do not re-run, relaunch, change focus, take screenshots of the physical game or touch VM guests from this investigation. Preserve the partial result and Workbridge's incumbent backend.
