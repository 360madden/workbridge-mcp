# DesktopProbe offline identity/evidence oracle — Nov 5, 2026

**Scope: investigation prototype only.** Source: `../prototypes/desktopprobe-offline-evidence.mjs` plus `../prototypes/desktopprobe-offline-evidence.test.mjs`. No process enumeration, CLI, window capture, desktop focus/input, guest access, task launch, filesystem operations or Workbridge service changes.

## Reuse and boundary

This pure classifier **reuses** the existing `winapp-desktopprobe-sample.mjs` exported `validateManifest`, `validateLease`, `validateObserver` and `sameOracle`, rather than duplicating their typed checks for fresh PID/HWND/process-start ticks, session/SID-equivalent boolean, class, root/unowned window, WinSta0/Default, nonzero stable foreground, journal counters, rect and watchdog budget.

Call `classifyDesktopProbeEvidence({ manifest, lease, before, after, nativeJournal })` with already collected, **synthetic or explicitly authorized** evidence (objects or <=8KiB JSON for the first four; <=64KiB raw UTF-8 buffer/string for the journal). It never reads the actual paths. The journal must contain exactly `starting` and `shown` in order, counter0, exact PID/session/HWND and known disposable title, and its raw-byte SHA256 must agree with **both** independent before/after observer receipts. The parser preserves CRLF/LF byte identity when hashing; no private window text or owner SID is emitted.

| Status | What it means | Illustrative code |
| --- | --- | --- |
| 🟢 `PASS` | **Submitted evidence is internally consistent** with one bounded, read-only DesktopProbe observation. This is **not live proof** that UIA was invoked or a Job exited. | `COMPLETE_READ_ONLY_IDENTITY` |
| 🔴 `FAIL` | A supplied complete identity assertion is contradicted, malformed, stale/expired, counter changed, extra event seen, journal SHA wrong or watchdog lease mismatched. | `INDEPENDENT_IDENTITY_FAILED`, `PROBE_OUTSIDE_WATCHDOG_BUDGET`, `JOURNAL_COUNTER_CHANGED` |
| 🟡 `UNKNOWN` | A required artifact is absent or the foreground HWND is unobservable/`0`/`unknown`; no success inferred. | `MISSING_NATIVE_JOURNAL`, `MISSING_AFTER`, `FOREGROUND_UNKNOWN` |

The result only includes `schemaVersion/status/reasonCode/readOnly` and boolean evidence-completeness flags; no raw journal, screenshot, clipboard, application title, path, PID, HWND or private owner SID. `PASS` requires no explicit input-event entry; **an unchanged counter/journal is necessary but not sufficient to prove the OS experienced no unrelated input**.

## Safety and semantic limitations

- This is a **pure offline consistency parser**; it cannot independently discover a running PID/HWND, prove current interactive token/foreground/session, verify actual file hashes, prove no UI input by other processes, or establish the watchdog's private Windows Job settlement. Those require the fresh native PowerShell observer, producer journals, admitted lease and separate watchdog proof.
- It accepts the *same* freshness and deadline rules as the current WinApp sample; old correctly archived runs are expected to be **FAIL stale**, even if they once succeeded. Never use it to relabel historical unknown outcomes as successful.
- A missing nested `before.journal`/ `after.journal` presently fails the imported observer contract as `INDEPENDENT_IDENTITY_FAILED`; a missing **raw** `nativeJournal` returns `UNKNOWN`. This intentionally distinguishes malformed submitted observer proof from evidence not supplied at all.
- A `PASS` is never sufficient to advance to Sbroenne, remove a Task Scheduler task, clear a quarantine/admission lock, or perform RIFT/VM input. The coordinator must review native source and the separate actual provider/job receipts.

## Executed synthetic-only tests

- Workbridge job `wb_wda_offline_oracle_test_20261105a`: `node.exe --test investigations/windows-desktop-automation/prototypes/desktopprobe-offline-evidence.test.mjs`, **exit 0, 9/9 tests passed, 0 failed**, ~92 ms Node test duration. No host GUI call.
- Covers exact fresh identity, JSON/CRLF normalization, bad PID/HWND/start/session, stale watchdog budget/lease, changed counter, 3-event input journal, corrupt HWND/SHA/foreground, unknown/zero foreground, absent raw journal/lease/observer, bounded malformed evidence and requestId mismatch.

**Live DesktopProbe pilot remains HOLD** for the watchdog uncertain-sidecar `requestId` recovery mismatch, orphan-admission policy and separately approved quiet desktop/peer gate. The new classification layer does not reduce those obligations.
