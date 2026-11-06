# D1 — provider-neutral desktop outcome reducer (offline research)

Status: **private deterministic Node unit test PASS (22/22); production/live GUI HOLD**.

Scope: three isolated investigation files in this folder. This code does not load
Workbridge production modules, start a child process, read a file, open a socket,
call MCP, touch a Windows window, access VMware, or send game input.

## Contract

`reduceDesktopOutcome(intent, events, nowNs)` consumes a versioned request-bound,
strictly validated record of **trusted external event attestations**. Its source
labels are part of an offline test fixture, **not cryptographic proof** that a
Windows process emitted them. An eventual live adapter must independently
authenticate durable request/provider hashes, native target identity, exact GUI
turn/Job owner, monotonic timestamps, source receipts, and evidence retention.

- `verified_success`: independently observed effect-once and Workbridge
  durable before/intention/effect receipt; exact native target + provider call
  identity; Job settlement to zero; native held-lease + released-lease attested;
  no unresolved owned modal, contradictory owner, target drift, or clock issue.
- `verified_failure`: independently authoritative terminal no-effect/no-queued
  attestation with the same identity, Job, lease and receipt settlement.
- `pending`: only if native held lease + independently current matching
  supervised worker PID/create-time/session/Job, monotonic freshness <=2s,
  immutable request/provider identity, and a future deadline are verified.
- `blocked`: pre-dispatch explicit refusal with no evidence of provider input
  or effect, no registered worker, and no structural contradictions.
- `unknown_outcome`: uncertain dispatch, timeout/hang, missing independent
  effect, stale owner, mismatched modal HWND, post-dispatch target drift, or
  unsettled descendants/leases. Never safely replay from this state.

All five output states have `retryAllowed:false` and `authorizesInput:false`.
`semanticProof` and `cleanup` are orthogonal, so an independently observed
effect with a hung/unsettled worker retains `unknown_outcome`.

Timings L0–L8 are **nine potentially overlapping spans**, never additive and
never comparable between host and guest clocks. They use decimal monotonic
nanosecond string timestamps in one declared clock domain. L3 preserves the
provider timeout span even when no ACK is emitted. Contradictory or mixed
clock origins suppress all computed spans.

Provider ACK and eugman-style 300 ms late-modal pending identification are
signals to reconcile, *not* app results, retry grants, or final settlement.
The current Workbridge WinApp CLI integration does not invoke the WinApp
`wait-for` command; any live wait would require independently owned native
observer evidence, not an assumption about a provider's behavior.

## Source-only deterministic matrix

`model.test.mjs` contains O01–O18 from the committed D0 design plus four
fail-closed checks O19–O22. Tests use fixed synthetic HWND/PID/timestamps,
and import only Node's built-in test/assert modules and this pure model.
They cannot establish NTFS/COM/Windows Job/desktop safety or actual app behavior.

If and only if independently peer-reviewed and explicitly authorized, the
bounded offline test command is:

```powershell
# Run from C:\work\workbridge-mcp, normal Workbridge approval gate:
& 'C:\Program Files\nodejs\node.exe' --test investigations/windows-desktop-automation/prototypes/outcome-reconciler/model.test.mjs
```

No production migration or live GUI trial is authorized by passing this
synthetic matrix. Next gate after this prototype is a separately reviewed
provider adapter, explicit native evidence provenance and controlled test.

## Single authorized offline execution receipt — 2026-11-06

- Workbridge job ID: `wda_outcome_reconciler_private_22cases_20261106_e01`
- Exact executable: `C:\Program Files\nodejs\node.exe`
- Exact arguments: `--test investigations/windows-desktop-automation/prototypes/outcome-reconciler/model.test.mjs`
- Working directory: `C:\work\workbridge-mcp`; deadline 60 seconds.
- Start: `2026-11-06T01:00:31.586Z`; end: `2026-11-06T01:00:31.935Z`.
- Workbridge job status `passed`, **OS exit code 0**; Node reporter
  **tests 22 / pass 22 / fail 0 / cancelled 0 / skipped 0**;
  reporter `duration_ms 87.7438` (not a desktop latency benchmark).
- `stderrLength=0`, `stdoutLength=1951`, `outputTruncated=false`.
- This proves only the 22 synthetic input/output mappings, not independent
  Windows event provenance, Job membership, service safety or UI outcomes.
- All prospective production and user-desktop operations remain **HOLD**.

