# Physical RIFT /lp reopen — guarded preflight checkpoint

Date: 2026-11-05 (America/New_York); source/test preparation crossed 2026-11-06 UTC.
Owner: Joey Delfierro. Target: **physical** RIFT only; VMware excluded.
Status: **SOURCE/SYNTHETIC READY; LIVE INPUT NOT ATTEMPTED**.

## Scope and reason

LuaPadModern Preview 20 centered startup has independent proof from the guarded 2026-11-05 17:21 EST /reloadui. The remaining acceptance is deliberate Close followed by /lp reopen and a separate editor-focus test. Joey authorized live tests, including UI reload/restart if needed. No reload or restart was needed here.

A new narrowly scoped helper, scripts/physical-rift-luapad-open.mjs, prepares **only** one explicit Enter, literal /lp, Enter action after visual evidence that native chat is closed/empty and the LuaPad window is **closed**. It does not click Close, type editor code, reload the UI or restart the game. The prior /reloadui singleton and receipt are preserved.

## Safety properties

- Strict process PID/HWND/process-start/session, class/title, WinApp 0.7.1 and exact UIA root, inspected immediately before input.
- Requires a fresh Workbridge PNG/capture receipt SHA-256 and explicit visual attestations chat-closed-empty AND luapad-closed; a screenshot receipt by itself cannot interpret pixels.
- Shared desktop-turn-admission.lock and desktop-input-turn.lock, quarantine veto, fsynced unique one-shot intent and receipt.
- Only the fixed /lp sequence; exact native response and foreground checks; no automatic retry or second request ID.
- After any uncertain phase following durable intent, retain desktop lock and create quarantine sidecar. Post-action screenshot is required to claim game acceptance.

## Offline verification and live preflight

- New test: test/physical-rift-luapad-open.test.mjs.
- Node syntax check: PASS.
- Synthetic runner: **4/4 tests PASS**, covering strict options, exact sequence/receipt/no replay, stale screenshot gate, and uncertain sender quarantine.
- Read-only script preflight at 2026-11-05 approximately 21:09 EST: PASS. Physical process rift_x64 PID 32156, HWND 462734, start 2026-11-05T15:31:50.6416621Z, session 1, root selector win-rift-5475, background at observation.
- Fresh screenshot request luapad_lp_prestate_20261106_001, captured 2026-11-06T02:09:16.683Z, 1920x1032, SHA256 70f0695c6ca9eaf9781a863d914e93205b891f41dd9bde450c8cf9588833cb70. **LuaPad is visible/open**, with its Help output. Chat appears closed; this does NOT satisfy the mandatory luapad-closed attestation. No input was attempted.

## Next live action

1. Joey deliberately clicks LuaPad's own Close button, leaving physical RIFT running and native chat closed. The agent currently lacks a production-approved coordinate-click adapter for custom-rendered RIFT controls; WinApp UIA click accepts selectors, not raw RIFT frame positions.
2. Obtain a **new** screenshot with a unique request ID. Visually confirm LuaPad absent, chat closed/empty, and no competing modal input.
3. Verify exact process identity and lock/quarantine health. Run one newly authorized guarded /lp action from a terminal_run job within the screenshot's 30-second freshness gate.
4. Capture a post-action screenshot and confirm centered Preview 20 title/front order. Preserve the one-shot receipt; never replay uncertain input.
5. Test editor key focus only after separate focus-specific tooling and visual input-target confirmation. Do not assume opening gives the RiftTextfield focus.

No changes were made to Workbridge's running owner/service, the physical game, LuaPad installed addon, game process, or Windows settings in this preparation.
