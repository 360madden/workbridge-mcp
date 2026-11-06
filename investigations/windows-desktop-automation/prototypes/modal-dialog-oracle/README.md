# Passive owned-modal native oracle — source only (2026-11-05 ET)

**🟢 Offline .NET10 build-only PASS; 🟡 never launched, never linked to Workbridge.** This separately owned .NET10 WinForms WinExe has **no visible Form, input, UI Automation, focus manipulation, screenshot or VM/game access**. It attaches to **one already-running, exact** disposable modal-dialog-probe owner and passively records whether an actually new, native owned dialog appears while the owner becomes disabled, is destroyed, and the owner becomes enabled again.

The ORIGINAL target fixture at ../modal-dialog-probe/ remains unchanged (Program.cs SHA171f465a37d4a90b01e55b188e48830d7bcc49a36337a72d62f910953ef1eea7). Its owner appears first, auto-starts ShowDialog(this) after 5s, closes the modal after 30s and closes the owner ~6s later. An external oracle must attach before its 5s auto-open or honestly report a missed baseline.

**Verified compile-only receipt:** Source Program.cs SHA d0967a0643cd48612f207aa3382874d0da24e146dd9549c17195c6ef3acd7fa6 and csproj SHA a1e8669d3bf6652e3fc9f180bf4be06325404815a3c2c0d5c2fc4f7370840a77 were independently source-reviewed. Node read-only Temp provenance job wda_modal_oracle_source_build_temp_preflight_20261105a passed exit0 (ordinary C: OS/Workbridge research Temp, no reparse). ONE isolated .NET10 build job wda_modal_native_oracle_offline_build_20261105a ran 2026-11-06T00:43:47.183Z–00:43:51.066Z, passed **exit0, zero warnings and errors**. The ignored artifact is temp/modal-dialog-oracle-bin/ModalDialogOracle.exe, **162304 bytes, SHA256 076d0ac8587bba4fcd114593ca53e4204c2bfad621cdddc01aab2e5fd6f734a4**. The executable and WinEvents were **never run**. No native lifecycle or vendor UIA success may be inferred from compilation.

## Contract and exact target

Build target: ModalDialogOracle.csproj, net10.0-windows WinExe, UseWindowsForms=true, no additional NuGet packages. It must be launched **only after a distinct Joey-approved, quiet-desktop, Job-supervised trial**. Merely building is non-GUI, but even the passive app has a Windows message pump, two process-filtered OUTOFCONTEXT WinEvent hooks and a 50ms native EnumWindows observer.

Arguments are exact flag-value pairs:

    --pid <fixture-PID>
    --start-utc-ticks <fixture-process-start-UTC-ticks>
    --session-id <interactive-Windows-session>
    --owner-hwnd <fresh-decimal-HWND>
    --run-id <8..48-ASCII-safe-unique-ID>
    --evidence-dir C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\modal-oracle-<run-id>

The dedicated evidence directory must **already exist** and have ordinary, non-reparse ancestry. The path must match the exact ignored Workbridge investigation temp subtree and run ID; no caller-selected arbitrary write target. It uses FileMode.CreateNew (no overwriting), writes at most 160 bounded JSONL rows with flush/write-through, retains evidence and never cleans source fixtures.

Before first observation and on every 50ms poll, reject changed/reused PID, process start ticks, Windows session, root owner HWND, owner PID or minimized owner. The oracle requires the **same interactive session** as the target. The outer Workbridge supervisor must additionally prove the same user SID and WinSta0/Default desktop before launch; this helper deliberately does **not** read target process tokens/SIDs.

### Independent native proof

The required transitions in **one oracle monotonic clock domain**:

| Stage | Exact independent native acceptance |
| --- | --- |
| baseline_clean | Owner PID/start/session/HWND/root match; IsWindowEnabled(owner)=true; no visible owned top-level windows. Remember ALL existing owned HWNDs, including hidden ones. |
| owner_disabled | Owner IsWindowEnabled changes true→false; this alone is not a modal. |
| owned_modal_appeared | Exactly ONE newly created visible top-level HWND, GA_ROOT=self, GetWindow(GW_OWNER)=original owner, GetWindowThreadProcessId matches pinned PID, and owner disabled. Ignore already-owned hidden HWND revealed later. |
| owned_modal_destroyed | The EXACT previously identified modal HWND is no longer an IsWindow object, not merely hidden. Owner process still pinned/alive. If HWND is reused/re-owned, **unknown**, never reassociate by title. |
| owner_reenabled | Original owner HWND remains fresh/alive and IsWindowEnabled=true; no other visible owned candidate. |
| complete | Only all five ordered conditions in one complete clean-baseline interval; exit0. |

Exit statuses: **0** verified native lifecycle; **2** rejected invocation; **3** incomplete or missed/deadline lifecycle; **4** target identity/reuse/multiple-dialog conflict; **5** observer failure. Native WinEvent event IDs and native eventTickMs are **supplemental**. Microsoft documents EVENT_SYSTEM_DIALOGSTART/END inconsistently for custom dialogs; neither their presence alone nor absence proves actual modality. The primary truth is 50ms native polling of exact owner-enabled/owned-HWND/destroyed/reenabled evidence.

Each JSONL event includes version/run/sequence, UTC, independent Stopwatch tick+frequency/elapsedMs, target PID/process-start/session, owner/modal/observed-owner HWND, read-only state/count and optional event ID. It **never** saves window titles, arbitrary UI text, clipboard, keystrokes, pixels or process command lines. Timer deadline is 50 seconds, **not a hard kill**: the external *child-owning* Windows Job watchdog must enforce 60s-or-less settlement and preserve UNKNOWN if the observer or fixture hangs.

## WinApp vs Sbroenne modal acceptance pilot (NOT RUN)

Choose **one provider per fresh, identically configured disposable fixture run**. Provider binaries and source digests must be pinned; do not switch inside an uncertain call. The shared Workbridge desktop turn must remain uncontended. No Invoke, click, type, dismiss, input permission, live OneDrive settings, VMware guest, RIFT, or third-party modal is authorized by this plan.

| Phase | Native oracle | Microsoft WinApp CLI 0.7.1 | Sbroenne/mcp-windows v1.3.28 |
| --- | --- | --- | --- |
| Preflight | Baseline_clean with exact PID/start/HWND/session/SID externally pinned, hook status recorded | Provider version/binary SHA, fresh exact PID/HWND read-only inspect, owner enabled; no all-desktop broad enumeration | Exact pinned exe/server/Job identity, protocol ready, exact HWND/PID-targeted ui_snapshot, complete flag |
| During modal | Owner_disabled + exactly new owned HWND + owner chain, per-oracle ticks | One bounded read-only inspect of exact dialog HWND, recognizes ModalStatus and DismissModalButton, no focus | One bounded read-only ui_snapshot of same exact dialog HWND and typed controls, no focus; reject incomplete/auto-diff-only tree as negative proof |
| After auto-dismiss | Exact modal HWND destroyed, same owner alive/re-enabled and no visible owned children | If an after-inspect completes before owner self-close, dialog absent and owner status continues; otherwise mark **after-provider-missed** | Same native postcondition; fresh exact owner ui_snapshot only within 6s post-close window or **after-provider-missed** |
| Failure | Unknown for missing baseline, stale HWND/PID/session, ambiguous children, no destroy, observer timeout | Distinct transport error, UIA timeout/hang, stale tree/element, wrong HWND, no postcondition; never infer action failed | Distinct MCP/error/incomplete snapshot/timeout/wrong element; no retry; private Job must settle before next provider |

A provider may return success while the modal state is still pending; **provider ACK is not independently verified application state**. Even with complete native modal cycle, UIA control-name parity needs separate bounded provider receipts. The fixture self-opens and self-closes; it does **not** demonstrate blocked UIA InvokePattern or user-action correctness.

### Latency observations and comparability

Record source-specific timestamps and durations, not invented single-hop totals:

- Oracle monotonic T0 baseline, T1 owner-disabled, T2 modal-appeared, T3 modal-destroyed, T4 owner-reenabled; derive T2−T1, T3−T2 and T4−T3 **within the oracle clock only**.
- Workbridge parent monotonic provider worker spawn→ready, entered→response/timeout, native journal read→postcondition, Job0 settlement, overall request→durable receipt. Provider subprocess clocks are separate unless calibrated.
- UTC aligns events qualitatively; do **not subtract UTC timestamps across unsynchronized host/guest**. Here all tasks are host-only; unknown CLI/worker scheduling skew remains a reported bound.
- Record exact version/SHA, PID/start/HWND/session, run ID, prior incumbent GUI lease/foreground snapshot, sample n, cold/warm, payload bytes, success/incomplete, p50/p95 only when n is justified, and whether a provider snapshot completed *inside* the 30-second modal interval.
- First pilot is one passively observed native cycle and **one** read-only snapshot per provider on **separate** runs, not a latency winner announcement. Later repeated samples require a new explicit gate; no 40× automatic stress.

Practical timing caution: fixture owner auto-opens after **5s**, modal lasts ~30s, owner remains only ~6s afterward. Attaching too late or a WinApp inspect taking ~20s can miss a stage; classify incomplete, not no-dialog or provider failure. A longer-lived modified fixture is a *separate* reviewed milestone; this source does not change the original.

## Hard stops

No verified quiet desktop, unknown active shared GUI admission/desktop-turn lock, incomplete native process/session/SID provenance, owner HWND reused, owner already disabled at attach, multiple new owned windows, another agent's active UIA call, provider Job unsettled, secure desktop/UAC, or original fixture/observer timeout => **NO GO / UNKNOWN**. Never click, close, Escape, relaunch or retry in response. Always preserve journal and child Job ownership evidence.

References: pinned eugman/FlaUI-MCP-Core WindowBaseline/ModalAwareInvoker at commit f372899044d6b8ca9f466cb07b146bb6ff7be579; local reports/eugman-modal-tracker-feasibility-2026-11-05.md; Microsoft [SetWinEventHook message-loop contract](https://learn.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-setwineventhook), [WinEvent dialog constants](https://learn.microsoft.com/en-us/windows/win32/winauto/event-constants), [GetWindow owner](https://learn.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-getwindow), [modal dialog ownership](https://learn.microsoft.com/en-us/windows/win32/dlgbox/about-dialog-boxes).
