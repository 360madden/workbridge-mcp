# LEGION runtime repair checkpoint — 2026-11-08

As of **22:41 EST**. Status: **source environment fixes verified; release/deployment blocked**.
This supplements `LEGION-TOOLS-SETUP-2026-11-08.md`; it does not replace its completed installation evidence.

## Authority and preservation

- Joey approved a fresh source-derived diagnostic build and a **Workbridge-only restart after every validation gate passes**.
- No Workbridge, RIFT, or Windows restart occurred. No Apply action or new validated release was produced.
- Verified machine: **LEGION**. Active owner remains PID **23232**, instance `dca381aa-a8f1-4eda-9777-e6d4732610f7`.
- Active server SHA-256 remains `18dc464cc84e07e21dcbe9a33c9fe1a4a3ddab2159ff2ca531e514e1dd143207`.
- Diagnostic snapshot came from exact commit `34195f2e876663a1b3678a8008447d80fdcfc216`; unrelated dirty files were excluded. The previously denied failed payload was not accessed through another route.

## Verified source changes

1. Release builder now supports explicit `-RefreshUserEnvironment`: refresh only process PATH/DOTNET_ROOT, check prerequisite versions before creating the payload, and restore original process values on every exit. Default custom/virtual-environment shells remain unchanged.
2. Tunnel-key process variable is cleared before prerequisite child processes; tests inspect structure without reading real credentials.
3. Dedicated background launcher reads raw registered PATH/DOTNET_ROOT, refreshes SDK root before expanding PATH, and leaves interactive `Start-Tunnel.ps1` unchanged. This takes effect at the next background startup, not in the currently running owner.
4. Startup test fixture now supplies its own machine identity and separately rejects missing, malformed, blank, and mismatched identity settings. Production identity checks are unchanged.

## Results (do not aggregate overlapping checks)

| Verification | Result |
|---|---|
| Fresh clean-source install/build and six desktop helpers | Passed; only diagnostic output changed |
| Original five failure-bearing files, serial | 63 passed, 0 failed, 1 existing privilege skip; 143.9 seconds |
| Complete baseline suite, two test files at a time | **1,128 passed, 11 failed, 3 existing skips; 381.0 seconds** |
| Four newly failing files, unchanged serial trace | 39/39 passed; 39.8 seconds; did not reproduce full-suite errors |
| Final current-source environment/manifest tests | 5/5 passed, including PowerShell 5.1 and 7 |
| Actual refreshed process tool discovery | Node 24.20.0, npm 11.19.0, Python 3.14.10, .NET 10.0.403, Git 2.56.0.windows.4, gh 2.103.3, Windows PowerShell 5.1.26100.9818, WinApp 0.7.1 |
| Isolated startup/restart fixtures | Passed; these printed fixture restart messages, not an actual service restart |

The full-suite job is `legion-fresh-full-suite-concurrency2-20261108-2223-01`.
Final source checks are `legion-environment-final-gates-20261108-01`; startup fixtures are `legion-startup-identity-gate-20261108-01`.

## Remaining blocker

- `job-result-cli.test.mjs:211` expected COMMAND_RESULT_EXISTS but received JOB_RECORD_SAVE_FAILED.
- Ten further outcomes were PATCH_BLOCKED/EPERM during fixture patch application: six shared workflow-catalog-cli setup failures, one workflow-catalog case, and three workflows cases.
- Exception-only tracing in the ordinary diagnostic directory covered 40 processes, 453 renames, 207 links, and 2,584 opens. No relevant exception, dropped record, or truncation was captured.
- Therefore the exact syscall/lock owner remains **unproven**. Do not label the failures fixed, weaken expected errors, add blanket retries, change ACLs, or treat the isolated pass as a full release pass.
- Package test scheduling, assertions, deadlines, and required release gates remain unchanged.

Evidence is retained in `C:\work\workbridge-diagnostics\legion-desktop-20261108-2213`:
`provenance.json`, `diagnostic-results.json`, `full-suite-concurrency2-results.json`,
`four-file-fs-trace-results.json`, and bounded per-process trace summaries.
Exact hashes and all job IDs are in the companion JSON.

## Next authority boundary

The existing bridge enforces a **600-second** command limit in its job/schema code.
A complete serial run is estimated at **11.5–12.5 minutes before build and other gates**; full-run case times totaled 735.17 seconds.
No longer task was created and the command limit was not altered.

Request approval for **one bounded 20-minute standalone validation task**, leaving all individual test deadlines intact. After approval, select an explicit test-file-concurrency-1 profile and run every official release gate from a fresh committed-source archive. Serial file scheduling does not disable the suite's internal multi-owner, Promise.all, capacity, or native-child concurrency tests. A serial pass would validate that profile, not explain the prior parallel failures.

Then, in priority order:

1. Seal a fully passing official release; retain the failed parallel evidence separately.
2. Establish a quiet window and use reviewed WB-001 Apply/Status with rollback readiness; restart Workbridge only.
3. Reverify actual LEGION hostname/new owner and hosted WinApp/desktop helper behavior before separate LuaPad/RIFT acceptance. Do not restart RIFT or Windows.

## Recovery and unrelated work

WB-001 runtime rollback restores runtime/package files, **not launcher edits**.
The original background launcher is available in parent commit `34195f2e876663a1b3678a8008447d80fdcfc216` with SHA-256
`870b5d3223d36ef02b151fb9c3a243f18af9e670a3e4b8998862521a45727328`.
Durable patch journals retain before/after files; inspect status and current hashes before any guarded restore.

Preserved unchanged: user-modified `scripts/freebuff-conpty-probe.py` and untracked `LEGION-COPY-MANIFEST.json`.
No push was performed. This handoff belongs to the source milestone commit; consult Git history for its final commit ID.
