# Synthetic Windows Job Object hang/effect-then-hang prototype

Status: isolated investigation fixture only; NOT a production Workbridge command host, input adapter, or UI Automation implementation.

## Scope

- Uses the existing `C:\work\workbridge-mcp\scripts\Desktop-JobLifetime.cs` without modifying it.
- Compiles `HangSmoke.cs` with the Windows .NET Framework `csc.exe` already required by Workbridge.
- Launches only its own synthetic host and child; it never opens a window, runs UI Automation/COM, sends mouse/keyboard input, inspects VMware, touches RIFT, or contacts a network service.
- Uses a fresh `wb-desktop-hang-*` directory immediately beneath `os.tmpdir()`; only that identified directory is removed in `finally`.
- The test kills only its own `spawn()` child process handle. The non-inherited Job Object handle closes on host termination and Windows terminates descendants.
- No Workbridge service restart, `src/`, `dist/`, `.local/`, existing tests or installed runtime changes.

## Running the focused test (only with coordinator approval)

From `C:\work\workbridge-mcp`, execute through Workbridge's bounded terminal job:

```text
node --test investigations/windows-desktop-automation/prototypes/desktop-job-lifetime/desktop-job-lifetime-hang.test.mjs
```

Use `timeoutSeconds <= 90` and a unique request ID. This invokes no GUI or guest input. The test itself has a 45-second timeout, and the nested native host/worker each have a 30-second maximum sleep.

## Independent evidence and outcome meaning

Two modes use a durably flushed `journal.jsonl`:

| Mode | Journal | Independent side effect | Expected result after worker tree settlement |
| --- | --- | --- | --- |
| `hang-before-effect` | `dispatch_entered` | No `effect.marker` | `verified_failure` *only for this deterministic fixture* |
| `effect-then-hang` | `dispatch_entered`, `effect_committed` | One exclusive `effect.marker` with `1\n` | `verified_success` despite lost provider return |
| Unsettled or missing/contradictory evidence | Incomplete/unknown | Indeterminate | `unknown_outcome`; never auto-retry |

The observer reads files independently of the blocked child and confirms the child PID is no longer alive before classifying. An event log alone is not sufficient: the marker is a separate durable side effect. Neither a successful subprocess exit nor a provider acknowledgment constitutes action success.

**Important boundary:** Absence of a marker proves nonexecution only because this synthetic fixture completely defines its sole possible effect and the worker is known terminated. An arbitrary Windows application may have delayed, asynchronous, or unjournaled effects; absence of a local marker there must be classified `unknown_outcome`, never `verified_failure`.

## Promotion gate

Before considering any reusable host or production adapter, test actual UIA calls and provider descendants separately in a disposable GUI fixture with Workbridge leases, fresh PID/start/HWND/session identity, independent postconditions, bounded process-tree settlement, and WB-001 release/rollback. This prototype intentionally proves none of those GUI-specific claims.

## Verified isolated run — November 4, 2026

- Workbridge test job: `reliability_synthetic_hang_20261104_001`, exit code `0`, status `passed`, 1/1 tests passed, 0 failures or skips.
- `hang-before-effect`: marker absent, native worker tree settled, synthetic-only `verified_failure`.
- `effect-then-hang`: durable marker and native journal each confirm one effect, worker tree settled, `verified_success` despite hung worker.
- Malformed/missing evidence and unsettled tree paths are classified `unknown_outcome` by offline assertions.
- Test body: 583 ms; full TAP duration: 5.69 s (a remaining five-second test-race timeout keeps the Node process alive after success).
- Temporary build and evidence were confined to the unique OS temp directory and cleaned by test; no GUI, COM, VM, RIFT, installations or Workbridge service changes.
- This remains a **synthetic process-containment result**, not an actual UIA/provider-hang validation.

## P1/P2 containment hardening — November 4, 2026

- Native host now requires Job Object ActiveProcesses()==2 (host and exactly one synthetic worker) and announces host/child identity plus mode; Node verifies the announcement against its owned process handle.
- The independent observer proves the blocked child is alive immediately before terminating the owned host, awaits host exit and child disappearance, and requires settlement before deleting evidence. If settlement cannot be verified, it retains the uniquely owned temp directory for explicit review.
- Outcome classification binds the exact worker PID, mode, event schema, ordered event sequence and durable marker; missing, extra or contradictory evidence returns unknown_outcome.
- The five-second Promise.race timer is now cleared after settlement.
- Focused rerun: Workbridge job reliability_synthetic_hang_p1_20261104_001, passed, exit 0, 1/1 tests; synthetic verified_failure and verified_success both confirmed with job_members=2 and settled child; body 434 ms, full TAP 521 ms, no stderr.
- Residual gaps: this is still not an actual COM/UIA hang; no independent Windows process start-time check beyond the owned fresh spawn; the temp-quarantine failure branch is source-reviewed but not fault-injection-tested. Future GUI experiments require their own authorization.
