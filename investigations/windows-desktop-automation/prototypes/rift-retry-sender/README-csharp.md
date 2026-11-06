# Physical RIFT Retry Sender — P2 C# offline-only

Status: **Built and 25/25 pure synthetic tests passed on 2026-11-05**. No game input performed. P3 live activation **not approved**.

## Exact responsibility and boundaries

- The .NET 10 console executable accepts only `--self-test` or `--dry-run <absolute-witness-envelope.json>`. All other CLI requests, including `--execute-once` / `--live`, hard-reject with `LIVE_DISABLED_PENDING_P3` (exit 2) before touching Windows.
- `--self-test` performs no Win32 or FlaUI calls and uses synthetic PNG-header bytes, **not** a complete PNG image.
- `--dry-run` is **read-only**: verifies envelope metadata, independently hashes supplied PNG bytes, reads PNG IHDR dimensions, and rechecks native RIFT HWND / PID / process start UTC / Windows session / class / title / owner / foreground / visibility / WindowFromPoint root / DPI / outer bounds / DWM extended bounds / client rect and origin / physical virtual-screen containment. It **never moves or clicks the mouse, never focuses, launches, or reloads the game**.
- C# checks requested `imageBytesVerified` etc. **as caller assertions**. It does not directly call Workbridge's screenshot/capture receipt service. Only the Node wrapper's independent receipt validator can provide that provenance, and only an actual human viewing the exact SHA-bound screenshot can attest that the selected ROI represents the Retry button. A forged JSON envelope can misrepresent visual/receipt history; this prototype must not be represented as independently proving those facts.
- The private `UnreachableFlaUiTransport.FutureSingleClick` is source for future review. It contains an internal permanently-false gate and has **no caller or public CLI path**. The adapted transport uses existing local FlaUI.Core `Mouse.Position` then `Mouse.LeftClick` after immediate native hit-test. P2 never invokes it.

## Why DWM frame is required

A read-only live Windows geometry probe of the physical RIFT process reported:

| Witness | Physical virtual-screen rect |
| --- | --- |
| HWND GetWindowRect | `(-1928,-2) 1936×1048` |
| DWM extended frame | `(-1920,6) 1920×1032` |
| WinApp PNG IHDR | `1920×1032` |
| ClientToScreen origin and size | `(-1920,29) 1920×1009` |
| GetDpiForWindow | `96`; thread awareness PMv2 |

Therefore only `virtual click = DWM extended-frame top-left + midpoint of visually attested PNG ROI` is a valid candidate. The older `rift-retry-click-plan.mjs` uses the **outer window** origin and requires PNG dimensions equal the outer bounds; it is **not suitable for this WinApp capture**. Do not use SavedVariables coordinates as pixel proof: toolbar saved coordinates may be stale and need scale and offset calibration.

Old HWND/PID and ROI examples in this document are diagnostic examples only and **must never be replayed**. Runtime preflight requires a fresh `<=30s` capture and exact current PID/HWND/start/session.

## Expected envelope (owned and journaled by Node wrapper)

Use absolute `screenshotPngPath` (WinApp capture PNG bytes), with additional JSON fields:

- `target`, `processBefore`, `processAfter`, `windowBefore`, `windowAfter`, `uiaRootAfter`, `capture`, `visual`, `desktop`, `dpiAwareness`, `nowUtc`: same identity and receipt meanings as the existing pure planner (but capture dimensions must match DWM **not** outer).
- `coordinateMapping`: `{mode:"dwm-extended-frame-physical",source:"win32-DwmGetWindowAttribute-DWMWA_EXTENDED_FRAME_BOUNDS",observedUtc:"<fresh UTC ISO>",outerWindow:{x,y,width,height},dwmFrame:{x,y,width,height},clientOrigin:{x,y},clientSize:{width,height},dpi:96,dpiAwareness:"per-monitor-v2"}`. DWM observation must be at or after the screenshot (1-second tolerance).
- `plan`: `{kind:"physical-rift-retry-DWM-OFFLINE-PLAN",executable:false,liveAuthorized:false,target,captureRequestId,captureSha256,sourceDwmRect:{x,y,width,height},virtualScreenPoint:{x,y},proposedTransport:"FlaUI.Core.Input.Mouse.Click(Point)",requiredNextGate:"P3 independent review and target-specific Joey approval"}`. The C# sender derives and checks the point itself; it never accepts an arbitrary coordinate CLI argument.

The Node wrapper owns admission, Workbridge verified capture receipts, human visual attestation, exact screenshot SHA, one-shot write-ahead journal, lease, cooldown/quarantine, and future authorization boundary. **The C# process does not own these distributed coordination guarantees.** They must be reviewed and tested together before any live route can be proposed.

## Offline verification performed

1. `dotnet build investigations\windows-desktop-automation\prototypes\rift-retry-sender\RiftRetrySender.csproj -c Release --nologo -p:GeneratePackageOnBuild=false --artifacts-path C:\work\workbridge-mcp\.tools\rift-retry-sender-artifacts`: exit 0. 0 errors; 42 warnings all in pre-existing FlaUI.Core source.
2. `dotnet <artifact>\RiftRetrySender.dll --self-test`: exit 0, `SELF_TEST_PASS`, 25/25; includes negative virtual X, DWM vs outer confusion, forged point, class/session/start changes, SHA drift, stale receipt, ROI size and Win32 foreign hit root.
3. `dotnet <artifact>\RiftRetrySender.dll --execute-once`: exit 2, `LIVE_DISABLED_PENDING_P3`, `inputInjected:false`.
4. **No `--dry-run` against the real RIFT process has been run in P2;** without fresh PNG + exact operator attestation that would be inappropriate.
5. No live click, focus, reload, game client restart, screenshot action or deployment performed by this project.

## P3 stop conditions

Do not turn on input, change the false gate, create a new live CLI flag, or deploy a sender until independent code review and **separate target-specific Joey approval**. Require fresh post-capture native DWM evidence, physical PMv2, actual Workbridge screenshot-receipt provenance, exact human-attested Retry ROI, durable one-shot journal with fail-closed recovery, and a serialized exclusive desktop/input lease. Reject any changed/new process, HWND, session, start, title/class, outer/client/DWM rect, DPI, foreground, occlusion, capture hash, or stale attestation. No retries after uncertain dispatch.
