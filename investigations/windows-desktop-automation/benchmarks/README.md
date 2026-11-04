# Benchmark evidence

Do not record an unrun experiment as passed.

Compare WinApp CLI, sbroenne wincli, eugman FlaUI where available using the *same disposable application* and operations. Record tool/revision, host OS/session/monitor/DPI, cold/warm start, sample count, median/p95 time, errors/timeouts, resource use, response size, target-ID validation and independently checked state change.

Failure scenarios: a stale HWND/ref, minimized target, duplicated label, modal dialog, hung provider, focus theft, concurrent callers, cancellation, and interrupted/unknown mutation. Include before/after states and request/receipt IDs. Avoid live RIFT/guest input.

Keep raw captures and secret-bearing observations out of Git; commit only bounded, redacted summaries.
