# M3-P12 provider-neutral DesktopProbe read-only snapshot parity — pure offline receipt

Date: 2026-11-05 America/New_York (Workbridge test receipts UTC Nov 6).
Owner: Sbroenne candidate research lane, independent peer reviews by WinApp and FlaUI.
Scope: **two new-only investigation prototypes**; no changes to live Workbridge, WinApp 0.7.1, Sbroenne V5, desktop services, RIFT or VMware.

## Result: GREEN offline model; RED real provider parity remains unproven

- Pure module `prototypes/desktopprobe-snapshot-parity.mjs`, SHA256 **`69d8c05ea9a691a27eb4c14ec1605572a3a1460dcf89c0be0c64e087697933df`**, only runtime dependency `node:crypto`.
- Pure synthetic tests `prototypes/desktopprobe-snapshot-parity.test.mjs`, SHA256 **`f110e4bd7bbfb75b539c1f65f3b8910cac147b5f821ef493577e714699a42131`**, Node built-ins and a self-source read in P14; no CLI, MCP, GUI, Win32, OS process or network operations.
- Workbridge bounded `node --check` jobs `wda_m3p12_parity_module_syntax_20261105_a01` and `wda_m3p12_parity_tests_syntax_20261105_a01`: each **OS exit 0**, zero output.
- **Exactly one bounded offline unit run** `wda_m3p12_parity_pure_offline_unit_20261105_a01`: true **OS exit 0**, untruncated stdout 1,757 bytes, **18 passed / 0 failed**, suite duration 105.2529 ms. The coordinator's later proposed request ID `wda_m3p12_private_18cases_20261106_e01` was **not executed**; no duplicate run.
- Independent WinApp and FlaUI reviewers approved the frozen source+tests for **offline unit testing only**; neither approved live UIA, provider adapter integration, GUI launch, input, screenshot, Focus, VM or production toggle.

## Input contract and behavior

Exports: `normalizeReadOnlySnapshot(sample)`, `compareReadOnlySnapshots(winappSample,sbroenneSample)`, `typedIdWitnessDigest(provider,ephemeralTree)`, `SOURCE_PINS`.

| Provenance part | Normalizer requirement | If missing / mismatched |
| --- | --- | --- |
| Exact disposable target | Frozen watchdog manifest runId=requestId, leaseId, watchdog PID/start, owner token SID, DesktopProbe PID/**start UTC ticks as string**/session/HWND/class/fixed title/foreground, observed and deadline UTC | `unknown_outcome` |
| Exclusive GUI turn | Immutable `workbridge.gui-turn` stamp for exact watchdog/run/request/lease/session, not a foreign/RIFT capture owner | `unknown_outcome` |
| Source pins | A `winapp-desktopprobe-sample.mjs` SHA `ed02a9b7...`, native observer `52d88949...`, version 0.7.1; B V5 `2208e476...`, observer `50ed06c9...`, exact vendor EXE `ce18a73e...`; independently approved executable hash and raw/canonical manifest/lease artifact SHA | `unknown_outcome` |
| Independent native state | A native before/after plus separate **pre-dispatch (<=2s)** pinned V5 dual target+watchdog witness (A legacy observer lacks watchdogOwnerVerified); B native before/preDispatch/after with current watchdog identity. Stable PID/start/HWND/session/class/SID, root/owner HWND, WinSta0/Default, rect, foreground and original native journal hash/counter0 | `unknown_outcome` |
| Same attempt and time | Typed read-only explicit PID/HWND/depth1 operation, provider dispatch inside exact watchdog window; A >=15s remaining, B >=40s at dispatch and >=80s at **initial admission**, age<=65s. UTC used for ordered evidence only; never subtract unrelated guest/host clocks | `unknown_outcome` |
| Three strict UIA controls | **Ephemeral raw provider tree** is recounted for `IncrementButton:Button`, `ResetButton:Button`, `CounterDisplay:Text` (A `Label` allowed). Reject duplicate selector/automationId **even if one is wrong-type**, omitted, diff, truncated, suppressed or incomplete; check pinned provider-specific shape hash against compact provider receipt | `unknown_outcome` |
| Typed-ID producer witness | PII-free digest of node depth/type/child count/**allowlisted known ID only**, created by trusted adapter **when raw result is observed**, bound to provider binary, immutable sample/run/lease, target PID/start/HWND/session, producer child PID/start, manifest/lease hashes, private receipt SHA and bounded capture time | `unknown_outcome` |
| Independent settlement | Supervisor receipt must bind the same immutable run/request/lease/sample, target, watchdog and specific owner/child PID/start/session, exactly zero verified private Job members, own OS exit0, and **same** private provider+witness receipts | `unknown_outcome` |

The public normalized response contains only `verified_readonly_snapshot` or `unknown_outcome`, fixed reason codes, exact known control type labels, count/depth, one **provider-specific** structural SHA, state/journal SHA, hashed target identity and phase latency. It never echoes arbitrary UIA element Name, Text, Value, automation IDs other than the three fixture allowlisted labels, private images, screenshot or raw tree. Unknown results intentionally omit raw data and per-step inferred zero latencies.

A valid A/B pair on the **same exact HWND, process start/session and watchdog lease** with stable matching native state yields `verified_control_parity`. Mismatching node count/depth is reported **`structuralCounts:'different'`** rather than falsely claiming equivalent tree shapes. The provider-specific structural SHA256 values are different encodings and are **never compared directly**. A uses two legacy native observers plus a separate watchdog witness; B uses three dual-target observers. Provider-only inspect/snapshot times are reported separately from full end-to-end, with explicit observer overhead and cold/startup caveats. This is a read-only snapshot result, **not** proof of any application input effect or transaction `verified_success`.

## Critical trust and integration boundary (LIVE HOLD)

**There are currently NO actual live A/B snapshots satisfying this normalizer's strict contract.** The existing A/B samplers project and discard raw private UIA trees; their compact success receipts only say `fixtureControlsVerified:true`, without all typed occurrences. WinApp A's projector ignores a second known selector if that duplicate has the wrong type. The pinned old WinApp native observer also has no watchdog owner verification. The new provider-time typed-ID witness and independently bound settlement receipts are therefore **not yet emitted** by existing adapters. The pure synthetic tests supply illustrative simulated already-trusted attestations; they **do not authenticate** a live provider binary, file, OS process, native timestamp, witness or private Job.

A synthetically altered raw B tree plus a self-altered witness digest can still pass if an external producer falsely self-attests with the *same old witness receipt hash*. Source review identified this explicitly: a trusted immutable production adapter must create and atomically persist the typed-ID witness at the actual provider-result boundary, hash/sign/independently verify its exact bytes, and match that digest to raw ephemeral projection, provider raw-record SHA, private provider receipt and exact supervisor Job receipt before calling the pure normalizer. A hash string or JSON boolean is **not** an independent credential; its trusted producer is an external prerequisite. Until integrated, previously saved sanitized receipts correctly return `unknown_outcome`, not PARITY PASS.

Do not change existing provider behavior under this task. Future, separately gated stage: add a narrow in-process projection hook on both providers before raw tree disposal, separate WinApp dual watchdog witness, bounded source-hashed native Job evidence and coordinator attestation; first source review, then offline simulated/real artifact verification, then only after a new quiet-window approval a fresh 110s disposable DesktopProbe **read-only** UIA pilot. No new service or default provider switch.

## Synthetic 18-case coverage (all PASS)

- P01–P02: both provider projections typed and private Name/Value/Text excluded from public output.
- P03–P05: wrong-type WinApp duplicate, repeated Sbroenne ID, suppressed/truncated/missing tree all UNKNOWN.
- P06–P08: missing A watchdog witness, foreign/unsettled Job, wrong manifest/lease canonical SHA UNKNOWN.
- P09–P10: stale, mismatched HWND, inconsistent timestamps, native foreground drift or target changes UNKNOWN.
- P11–P12: semantic three controls can agree with different provider tree node counts; compact receipts alone UNKNOWN.
- P13–P14: unexpected source pin/ACK/journal change UNKNOWN; pure module imports no GUI/process SDK.
- P15–P18: same-shape substituted tree, post-dispatch watchdog witness, foreign provider/witness receipt and stale witness PID/lease/sample all UNKNOWN.

## Isolation

Committed source/test only; no production files touched, no WinApp or Sbroenne executable launched, no task scheduler, UIA COM, screen capture, focus, mouse/keyboard, RIFT or VMware operations. Preserve unrelated dirty `scripts/freebuff-conpty-probe.py` and other agents' research lanes. Test receipts remain queryable through Workbridge command_output by exact job ID.
