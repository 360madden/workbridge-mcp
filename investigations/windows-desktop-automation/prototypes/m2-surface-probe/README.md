# M2 read-only DesktopProbe surface snapshot

Status: **SOURCE-ONLY / BUILD-AND-SELF-TEST GATE. No live observer or RIFT input executed.**

This standalone .NET 10 Windows console program reuses the geometry, per-monitor DPI,
target birth/session pinning and owned-HWND enumeration patterns already proven useful
in the repo's offline `rift-retry-sender` and `modal-dialog-oracle` investigations.
It introduces **no** mouse/keyboard/UIA action, foreground change, screenshot,
WinEvent hook, process launch, service deployment or filesystem output.

## Supported modes

- `--self-test`: purely synthetic argument/geometry checks; **zero Win32 calls**.
- `--snapshot --pid <pid> --hwnd <decimal-hwnd> --session-id <id> --start-utc-ticks <ticks>`:
  one bounded, read-only sample of the **existing** disposable GUI-004 WinForms
  `DesktopProbe` process and the exact `Workbridge GUI-004 Native Input Probe` title.
  The process birth UTC ticks and Windows interactive session must match exactly.
  Unknown flags and every other target (including RIFT) are rejected.

No such `--snapshot` invocation is authorized by this checkpoint. A future
disposable-fixture trial must first verify the exact fixture job/lease, owner,
session and foreground constraints, using the normal Workbridge approval gate.
Never launch the fixture merely to gather a snapshot without the separate pilot.

## Bounded output semantics

A successful one-shot read emits `OBSERVED_NOT_VERIFIED`, **not** `VERIFIED`.
The JSON includes the pinned target identity, UTC timestamp, observer-specific
Stopwatch tick/frequency, physical outer/client rectangles, window/monitor DPI,
minimized/visible/cloaked/enabled flags, foreground HWND, center-point hit-test root,
and the count of visible *owned* top-level windows. The adjacent
`native-surface-snapshot.mjs` validates this exact JSON shape and classifies
confirmed bad states without ever returning VERIFIED; its offline adversarial
fixtures live in `native-surface-snapshot.test.mjs`. It omits arbitrary window
titles, keystrokes, clipboard text and desktop pixels.

- Visible owned windows may be dialogs; the count is **not** an authoritative modal count.
- An unobscured center point does **not** prove an entire window is unobscured.
- A one-shot sample does **not** prove an absence of transient modal, foreground,
  geometry or occlusion changes between samples.
- Therefore `modalCoverage: "unknown"` and `occlusion: "unknown"` are
  deliberately fixed by the producer. Never promote them to `complete` or `clear`
  from this source.
- `observerTick` is an observer-local clock representation, **not** automatically
  compatible with Workbridge's M2 monotonic deadline clock. Cross-process timestamp
  alignment needs an independently calibrated clock pair.
- The existing `src/desktop-action-surface-proof.ts` verifier must continue to
  fail closed on this incomplete evidence. This helper cannot authorize/retry an action.

## Offline build/test

From `C:\work\workbridge-mcp`:

```powershell
dotnet build investigations/windows-desktop-automation/prototypes/m2-surface-probe/M2SurfaceProbe.csproj -c Release
dotnet run --project investigations/windows-desktop-automation/prototypes/m2-surface-probe/M2SurfaceProbe.csproj -c Release --no-build -- --self-test
```

The offline JavaScript consumer test runs with:

```powershell
node --test investigations/windows-desktop-automation/prototypes/m2-surface-probe/native-surface-snapshot.test.mjs
```

These checks do not start `DesktopProbe`, RIFT, VMware or the native observer.
The next milestone is a target-specific, read-only disposable-fixture snapshot
with independent observer/process/clock attestation, followed by an interval
modal/occlusion witness before a VERIFIED M2 receipt can be emitted.
