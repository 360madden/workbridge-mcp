# M3-P11 Sbroenne V5 read-only DesktopProbe snapshot — independent source gate

**2026-11-06 UTC.** This is a **source-only** review. No V5 code was built or launched by this reviewer; no GUI/UIA, window focus, screenshot, input or Workbridge production action was performed.

**Verdicts:**

- 🟢 **GO one offline compile-only + Node syntax check with ENABLE_SBROENNE_UI_SNAPSHOT deliberately UNDEFINED**, if separately authorized. The V5 host `#if !ENABLE_SBROENNE_UI_SNAPSHOT` returns fixed `HOST:BLOCKED:UI_SNAPSHOT_COMPILE_GATE_CLOSED` and OS64 before opening manifest/private roots, spawning a child or touching UI.
- 🔴 **HOLD any define-enabled V5 build, runtime UIA snapshot or desktop pilot** pending the explicit identity, path and durable pre-action requirements below. Existing V4 protocol-only evidence cannot be extrapolated into snapshot correctness.

## Exact new-only files inspected

| Component | Source SHA-256 |
| --- | --- |
| `prototypes/Sbroenne-RestrictedSnapshot-Host-V5.cs` | `c7e80d74f53204641c470a8e223cb02b474038a12bd1ca2203fad1017aa44282` |
| `prototypes/Sbroenne-SuspendedEnvNode-V5.cs` | `fad4db8ce88850b7b5ab9e86ffbfca0798ab3d07140f823383541bb76c7af121` |
| `prototypes/sbroenne-v5-restricted-desktopprobe-snapshot.mjs` | `db0eed168e5e5c8ef2cf4c31e3e895a5a3b7cb29d60b0afb9ede028cdc1cd764` |

Reuse: V2 private Job helper `55a35716...`, pinned single-file Sbroenne v1.3.28 EXE SHA `ce18a73e...` (size 59,893,792), current installed MCP SDK client `stdio.mjs` SHA `af887c89...`.

## Positive source properties — NOT runtime-proven

- Host uses dedicated V5 source/launcher so known working V4 remains unmodified. Enabled branch checks exact CLI mode and manifest path shape, pins Node/script and sole vendor EXE hash/size, creates owner-only extraction/scratch roots; launches Node suspended with sorted restricted seven-key UTF-16 env and explicit two pipe handles, assigns child-only kill-on-close Job before Resume; validates vendor server PID/path/session/member inventory; requires only fixed `RESULT:success:READONLY_SNAPSHOT_VERIFIED:<sha>`, runner exit0, Job empty, matching receipt hash, private files bounded and overall deadline.
- Node validates target manifest's run, PID, start ticks, session, WinForms class, title, HWND, foreground handle, journal status and expected three controls. Reads and checks watchdog GUI lease, calls native observer before/connect/immediately-before/after, enforces foreground/window rect/journal parity, rechecks deadlines, and makes **one** `ui_snapshot` call with explicit target HWND, depth1, full tree, diagnostics false. It rejects any extra catalog tool, and suppresses stderr/raw UIA tree.
- Snapshot projection retains only structural UIA **control types**, tree shape SHA, node count, three fixed fixture control matches, and bounded timings. No raw UI text, names or image data is written to its final JSONL; exact receipt digest is echoed to native host. If a snapshot was dispatched and anything fails, the result becomes `unknown`, not false success.

## Required enabled-path fixes / hard holds

1. **Watchdog owner PID reuse:** `assertLease` verifies that guard JSON start ticks/session equal manifest, but its only current process liveness check is `process.kill(watchdogPid,0)`. A dead original watchdog and reused PID would still pass the stale lock/manifest pair. Native observer verifies DesktopProbe child's PID/start/HWND/SID, **not current watchdog owner start ticks**. Require bounded no-focus **current watchdog PID + start ticks + session**, preferably SID/image, immediately pre-dispatch and after; a held process handle with exit-state monitoring would be stronger. Treat any uncertainty as blocked/unknown.
2. **Manifest executable provenance:** `validateManifest` checks `exeSha256` merely matches a 64-hex pattern; observer confirms the target binary matches the *same self-reported hash*. To prove the approved disposable DesktopProbe build, pin the manifest or known expected DesktopProbe EXE SHA using independent coordinator/watchdog receipt, rather than trusting only manifest content.
3. **Parent junction/reparse risk:** Host `TrustedManifest`, launcher `IsOwnedFixtureManifest` and Node `readBoundedJson` vet leaf existence and literal lexical shape but not complete `temp/desktopprobe-<run>/evidence` and `publish` ancestor chains. Require ordinary/non-reparse resolution to the exact project temp tree before accepting target, executable and receipt.
4. **No durable before-action receipt:** Node writes `stage:'entered'` then proceeds to vendor/dispatch, but performs `audit.sync()` only after the post-dispatch `finished` record. Crash/power loss could lose proof a snapshot had been attempted. `await audit.sync()` on the entered record **before dispatch** (and keep final sync) is required for restart-survivable unknown-outcome semantics.

## Unmeasured / operational holds

No enabled V5 process has run; source cannot establish whether vendor `ui_snapshot` affects focus, whether exact HWND is interpreted as intended, if UIA hangs, if PowerShell survives the seven-key environment, or snapshot latency. An eventual pilot requires separately approved DesktopProbe watchdog live fixture, verified owner/lease and nonreparse ancestry, manifest hash, watchdog deadline, native Job, a single read-only call, before/after foreground parity, secure projected receipt, and no existing quarantined GUI turn. This review authorizes **none** of those actions; no use against physical RIFT or VMware guest.
