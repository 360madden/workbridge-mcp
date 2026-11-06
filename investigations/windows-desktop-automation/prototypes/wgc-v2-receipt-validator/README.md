# P3.3 — WGC v2 offline receipt consistency gate

Status: **OFFLINE ONLY / NOT INTEGRATED / NO LIVE CAPTURE**.

This isolated prototype consumes an in-memory proposed v2 WGC capture receipt, a caller-supplied target/source pin, an expected unique request ID and PNG bytes. It returns only a bounded structural/cryptographic consistency result. It does **not** read a game, open or focus any window, invoke WGC, launch a process, write a PNG, issue a click, modify RIFT, or authorize Retry.

Run from C:\work\workbridge-mcp using the existing Node installation:

    node --test investigations/windows-desktop-automation/prototypes/wgc-v2-receipt-validator/receipt-validator.test.mjs

The test builds a two-color **synthetic PNG entirely in memory** and exercises positive and negative receipt paths. Production source/integration is **not** enabled by a passing test.

## Checks covered

- v2 kind/version, exact fresh expected request ID, no replay/partial receipt or legacy receipt substitution
- precise PID/HWND/process start/session/title/class/owner equality to an independently supplied target
- pinned Microsoft WinApp 0.7.1/WGC-only assembly/dependency hashes and source commit; no fallback
- UTC/monotonic first-frame ordering, bounded wait, post-capture age no greater than 30 seconds, positive frame version
- instrumented foreground event-hook coverage and zero events, unchanged endpoint HWNDs
- PNG magic, noninterlaced RGBA8 IHDR, chunk lengths, CRC32, compressed IDAT integrity, exact scanline length/filter bytes, IEND, size and SHA-256
- strictly no focus/input/reload/restore/Retry authorization, success only for known child and wrapper zero exits
- exclusive namespaced output-path claims and immutable receipt claims

## Boundaries (not yet verified)

All test receipts, source hashes, HWND/PID, event hooks, process exits and image evidence are **synthetic**. Passing means only that the data **would satisfy a consistency contract if independent witnesses were trustworthy**. The module cannot establish that WinEventHook was installed, that Windows process identity is genuine, that a capture actually occurred, that the PNG pixels match the claimed colors, or that exact screenshot-to-client coordinates are calibrated. PNG validity is bounded RGBA8 noninterlaced chunk/CRC/zlib/exact-scanline/filter-byte checking, not full decoded-pixel reconstruction or color validation. The returned result explicitly says STRUCTURAL_CRC_INFLATE_ONLY and independentPixelDecodeVerified=false. UTC timestamps allow 0–7 fractional digits (including .NET round-trip format); JavaScript Date comparisons are millisecond precision, with monotonic tick ordering separately required. The caller must implement those separately and must not trust a self-attested receipt alone.

The blueprint contract's frameVersionMinimum=1 is a requirement; a real receipt must report its observed timing.frameVersion positive integer. The blueprint's placeholder foregroundMayChange string is not a runtime truth value: any future accepted receipt must carry the observed boolean false after independent event monitoring. Captures whose target process creation occurs after captureBeginUtc are rejected.

The existing RIFT Retry sender remains **LIVE_DISABLED_PENDING_P3**. The one authorized physical screenshot has already been used and cannot be repeated without a new specific approval. No additional live GUI or physical-RIFT operation is part of this milestone.
