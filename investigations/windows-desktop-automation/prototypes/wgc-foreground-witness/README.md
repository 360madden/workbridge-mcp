# P3.3 passive foreground-event witness (SOURCE-ONLY candidate)

Status: **OFFLINE PROTOTYPE. No native hook has been installed or exercised.**
Owner lane: `wgc_passive_event_witness`. All tests use synthetic in-memory calls.

Purpose: detect possible transient foreground transitions that endpoint-only
`GetForegroundWindow` snapshots can miss. This is a candidate component for a
future Windows Graphics Capture (WGC) read-only receipt v2, **not an input tool**.

## Safe executable surface

`dotnet run --project ForegroundWitness.csproj -- --self-test` runs only
`ForegroundAudit` fake transitions. Any other argument exits 2. The executable
does not invoke `PassiveForegroundHook.Install`, start a GUI, capture pixels,
focus a window, inspect RIFT, or launch any process.

## Native candidate (not runtime-verified)

`PassiveForegroundHook.Install` wraps user32
`SetWinEventHook(EVENT_SYSTEM_FOREGROUND, WINEVENT_OUTOFCONTEXT)` and provides
same-owner-thread `UnhookWinEvent`, a GCHandle-rooted callback and no fallback.
It has **not been invoked**. Future separately authorized integration must:

1. Pin exact executable and dependency hashes, current PID/HWND/session and source identity.
2. Install the hook on a dedicated pumped message-loop thread (or a verified owner STA)
   **before** opening the capture interval. Do not pump on an unbounded timer.
3. Count **every** foreground event, including same-HWND or switch-and-return.
   Never store unrelated window titles or screenshot content.
4. Revalidate baseline/endpoint HWND, bound lifetime, drain queued events,
   unhook on the registering thread, and independently attest event-loop coverage.
5. Treat callback errors, message-pump stalls, install/unhook failures, lost
   intervals and late events as **UNKNOWN/BLOCK**, never as proof of no focus.
6. Preserve `LIVE_DISABLED_PENDING_P3` on all physical-RIFT Retry/click paths.

`ForegroundReceipt.Verdict=CandidateUnchanged` means only that the **synthetic
state machine** saw a fully marked sequence and zero delivered events. It always
sets `ProvesNoTransientFocus=false`. Async WINEVENT_OUTOFCONTEXT event delivery
may lag, so neither two equal HWND snapshots nor a zero callback count proves
complete foreground continuity.

## Gates and next tests

- Offline: `dotnet build ... -c Release` and `dotnet run ... --self-test`.
- Negative fixtures: absent hook, missing pump, missing drain, wrong endpoint,
  same-HWND event, switch-and-return, late callback, double begin/end/unhook,
  fault state. No GUI or hook installation.
- Future separately authorized disposable-window pilot: independent observer
  verifies message-pump callback coverage and teardown, with real event timeline
  and no foreground operations. **Not authorized in this milestone.**
- Physical RIFT screenshot, click, keyboard, reload or restart remain prohibited
  without new, narrow approval. This module is not wired to Workbridge tools.

Primary Microsoft references:

- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nc-winuser-wineventproc
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-unhookwinevent
