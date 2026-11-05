# Physical RIFT RRECollector Retry — offline mouse prototype (Nov 5, 2026)

**Status:** SOURCE-ONLY, NON-EXECUTABLE. No physical game input and no live service deployment. Source+synthetic tests: rift-retry-click-plan.mjs and .test.mjs (10/10 PASS with Node 2026-11-05 23:20:40Z). This is **not** an operational click adapter.

## Why this path

- RRECollector/ui.lua:756-757 calls execute("candidates") for its Retry button.
- RRECollector/main.lua:287-288,259-260 routes that button through the same onSlash handler as /rre candidates (runCandidateLookup("manual")); same bounded read-only ability lookup.
- Microsoft WinApp CLI 0.7.1 ui click takes accessibility selectors, not physical coordinates. RIFT's custom-drawn controls are absent UI Automation. WinApp send-keys can be HWND-bound but cannot prove the internal game-chat focus; a capture can change focus between staging text and Enter.
- Local C:\work\FlaUI\src\FlaUI.Core\Input\Mouse.cs:74-95,173-182 supplies FlaUI.Core.Input.Mouse.Click(Point); internally SetCursorPos, verified GetCursorPos with retry on mixed-monitor positioning, then Mouse.Down/Up. It is global and not HWND-bound by itself.

## What the prototype actually validates

A pure function constructs only a non-executable physical-virtual-screen coordinate plan. It requires:

1. Independently pinned process PID/HWND/startUtc/session before and after screenshot; exact rift_x64, RIFT, TWNClientFramework, owner HWND zero.
2. Window bounds stable before/after capture, visible and foreground afterward; matching independent UIA root geometry.
3. Hash-verified, time-bounded (30 seconds) screenshot receipt from the same target; visual attestation bound to requestId and SHA256.
4. Explicit human rectangle around visible Retry (not a scaled screen preview), small enough for a single toolbar button and inside the image.
5. Per-monitor-V2 DPI awareness, proven window-frame-to-PNG physical pixel mapping, known virtual-screen physical pixel coordinate space, and independently verified pointer coordinates. Negative X for the secondary monitor is expected. The returned virtualScreenPoint is not a client-relative offset.

The output explicitly says executable:false, liveAuthorized:false. It has no import of FlaUI, WinApp input, Workbridge input, or keyboard/mouse primitive.

## Next implementation gates — NOT DONE

1. **Disposable GUI harness, independent review:** Build isolated .NET 10 helper using FlaUI Core rather than re-implementing mouse injection. Test a dummy button on each physical monitor and at mixed-DPI; verify GetCursorPos, native button-click count, and no action on wrong HWND.
2. **Workbridge one-shot wrapper:** Reuse desktop-turn-admission.mjs, exact desktop-input-turn.lock, and quarantine sidecars. Hash-pin a fresh RIFT screenshot, revalidate PID/HWND/start/session and GetWindowRect immediately before the click, foreground target within one exclusive turn, and fsync intent before any click. On uncertainty, preserve intent/turn and quarantine, never automatic retry. A mouse sender receipt is not game acceptance.
3. **UI acceptance and permission:** Recheck button appearance/position before action, calibrate preview-to-physical scaling (prior screenshot rendered narrower than native 1936-wide window), no arbitrary coordinate input publicly configurable, and request explicit confirmation for Retry button rather than the prior slash method.
4. **Game outcome:** Post-click screenshot for in-game feedback; inspect candidateAttempt and candidateLookup only after normal persistence. Never force /reloadui just to flush. Distinguish successful no-detail negative API observations from positive Detail records.

**Do not run against physical RIFT now.** The pin/ROI evidence in tests is synthetic; old PID/HWND/rectangle is not valid future authority.
