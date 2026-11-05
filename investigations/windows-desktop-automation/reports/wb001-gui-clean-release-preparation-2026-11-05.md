# WB-001 clean GUI release preparation — 2026-11-05

**Status: PASS — staged and verified; NOT DEPLOYED.** Physical RIFT, Windows, Workbridge service and the November 2 GUI-turn quarantine remained untouched.

## What was prepared

- Git clean-source snapshot commit: `07f65b699e3a528fd3acaf92fa43200f94e72763`; `git archive` SHA256 `40F80A0E225DC43796944B04EA27EFCB2E94DE4973CAC9006542C09585146E5B`.
- Snapshot: `C:\work\workbridge-mcp\.local\wb001-gui-src-20261105b`.
- Immutable release candidate: `C:\work\workbridge-mcp\.local\wb001-gui-src-20261105b\.local\releases\gui-quarantine-20261105-prep02`.
- WB-001 release ID: `gui-quarantine-20261105-prep02`; version `0.16.4-dev`.
- Independent verifier `Get-WBRelease` **accepted** sealed `validated.json` and `manifest.json`, 3,183 payload files, manifest SHA256 `188456483878124856B58A6857563FA472272404914BF6F145B725E65781D8AC`.
- All eleven receipt checks zero: install, desktop-prebuild, desktop-prestage, tests, startup, updater, format, generic, desktop-stage, acceptance, desktop-closure.
- Full tests: **1,054 total, 1,051 passed, zero failed, three skipped**; separate focused inspector tests 29/29 passed; repository-wide Prettier check passed; updater and Windows startup suites passed.
- Desktop runtime manifest sealed six exact files under both `scripts` and `dist`: `desktop-ui.mjs`, `desktop-capture.mjs`, `vmware-host-capture.mjs`, `desktop-probe-act.mjs`, `desktop-turn-admission.mjs`, `Check-DesktopWindowHandle.ps1`.
- The release's local stdio MCP acceptance passed. `hostedVerified:false` is expected because no Apply occurred.

## First failed attempt and repairs

The retained first attempt `gui-quarantine-20261105-prep01` failed cleanly, with **1,043 pass / eight fail / three skipped**. Four tests imported `dist/desktop-turn-admission.mjs` before the legacy release builder staged it. Four inspector test fixtures assumed the previous five-file desktop closure. No `validated.json` was issued for the failed candidate.

Repairs, committed separately:

- `116ef1fe8f9a9d5fd1a63e2010be779468009c50` — prebuild and pre-stage the desktop helper before unit tests while retaining final reseal; update the inspector fixture and script count.
- `07f65b699e3a528fd3acaf92fa43200f94e72763` — formatting only for five pre-existing desktop-monitor scripts, so repository-wide Prettier passes.
- Existing user-owned dirty `scripts/freebuff-conpty-probe.py` was neither staged, committed, formatted, nor included from the working tree; clean Git archives exclude its modification.

## Live identity and quarantine preservation

At final read-only check, Workbridge still reported `0.16.4-dev`, PID **15064**, instance `8eeaffd2-4e11-4228-8bac-daa06449b08c`, started `2026-11-05T15:27:35.161Z` (unchanged). No new runtime was applied, no service was stopped or restarted.

November 2 evidence remained present and SHA-identical to historical pins:

- `desktop-input-turn.lock`: 380 bytes, `635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0`.
- `desktop-turn-quarantine-8aed4916-1cf3-4100-bc1b-d56f2308585f.json`: 425 bytes, `f1b37ebbeca97b4351d719786beb8c93dc678b76170f7e1a32b04bdecf0750a0`.

Original screenshot outcome remains **UNKNOWN**; quarantine is **ACTIVE**. Source commits and a sealed candidate are not evidence of a deployed GUI gate.

## Next separately gated work

1. Joey approval for a coordinated Workbridge-only maintenance window and WB-001 `Update-Workbridge.ps1 -Action Apply`. The updater's rollback and quiescence paths passed disposable tests, but a live operation backup will be created only during Apply. Do not deploy without consent; the existing deployed owner may not obey new admission controls.
2. Independently verify all GUI producers after deployment, especially the C# DesktopProbe watchdog under `investigations/` (not copied by WB-001's `WBSourceNames`). A sealed Workbridge dist package alone does not update that external binary.
3. Request separate, lease-specific approval before archival of the November 2 guard and sidecar, with fresh identity/hash checks, exclusive maintenance admission, durable byte-exact backups and no automatic replay.
4. Request distinct authorization before any RIFT-specific input, `/reloadui`, game restart, or reboot.

See `C:\work\rre\docs\RRE-WORKBRIDGE-QUARANTINE-CLEARANCE-HANDOFF-2026-11-05.md` for the earlier controlled-clearance handoff.

## Follow-up: historical catalog preflight and prep03 (2026-11-05)

**Status: PASS — fix committed, new release sealed and independently verified; NOT DEPLOYED.**

- Newly discovered predeployment blocker: running `diagnostics.jobs.inventory` scans only 20,000 historical entries, returning `complete=false` with `limitReached=true` and `timeLimitReached=false`, although live capacity was idle (0 occupied, 0 running, 0 retained).
- New `Get-WBHistoricalJobCensus` read-only PowerShell fallback completed against **21,986 historical entries** (11,069 job records, 10,917 result receipts, 0 unknown). It bounds time and entry count and rejects link/directory/unrecognized entries without pruning history. `Assert-WBIdleDiagnostics` accepts only the exact limit-only case with valid counters and zero live capacity, and controller rechecks owner identity, capacity and census counts before any service stop.
- Fix commit: `b0b8d6a643ed9d0a8deb8c25d6b9da145ca9f515`, scoped to `scripts/Workbridge-Update.ps1`, `scripts/Invoke-WorkbridgeUpdate.ps1`, `test/updater.test.ps1`, `docs/updates.md`. The unrelated user edit in `scripts/freebuff-conpty-probe.py` remains untouched.
- Focused updater tests: **42/42 passed**. `git diff --check` passed. Independent safety audit found no concrete fail-open bug, while noting that tests do not yet exercise the full controller's two live CLI observations as an end-to-end synthetic.
- Clean source archive from the exact fix commit: `C:\work\workbridge-mcp\.local\wb001-gui-src-20261105c` (no dirty working tree content).
- Sealed candidate: `C:\work\workbridge-mcp\.local\wb001-gui-src-20261105c\.local\releases\gui-quarantine-20261105-prep03`.
- Independent `Get-WBRelease` verifier **PASS**. Manifest SHA256: `01D7C888B9297708B15D2133484C202019E138206D30C20FE295DA6B91225519`; **3,183** files; all **11** validation checks zero, including desktop closure. Full tests: **1,054 total / 1,051 pass / 0 fail / 3 skip**. Version `0.16.4-dev`, `hostedVerified=false` as expected.
- Live Workbridge still PID **15064**, instance `8eeaffd2-4e11-4228-8bac-daa06449b08c`, 0/36 occupied. Original quarantine lock and sidecar remain byte-identical. RIFT, Workbridge service, and Windows have not been reloaded or restarted.

**Deployment remains separately gated:** The currently running older Workbridge owner does *not* honor the new updater admission lock. Therefore no Apply is permitted without Joey's explicit approval for a coordinated Workbridge-only maintenance window that suspends new jobs from other chats/automations. The standalone C# watchdog is not part of WB-001 payload and must be independently checked before any quarantine archival or GUI input pilot. Keep prep02 and prep03 sealed, and preserve original Nov2 evidence.

## Authorized deployment and hosted verification (2026-11-05)

**Status: PASS — WB-001 deployed; desktop-input quarantine remains ACTIVE.** Joey explicitly approved a coordinated Workbridge-only maintenance window. The hourly RRE automation `6ae97e1f47848191a839458995713b1b` was disabled after its previous iteration completed, then re-enabled after hosted verification. No game/Windows reload or restart occurred.

- Operation ID: `wb001_gui_prep03_apply_20261105a`. Dispatcher completed successfully, and the independent scheduled controller task finished in `Ready` state.
- Controller journal: `phase=completed`, `error=null`, `recoveryError=null`, at **2026-11-05T20:17:50.5294819Z**. Ordered events `preparing → prepared → stopping → installing → starting → verifying → completed`; recoverable backup/checksum and prior release identity retained under `C:\work\workbridge-mcp\.local\update-operations\wb001_gui_prep03_apply_20261105a`.
- Independent post-update `Test-WBManifest` verification **PASS** for the retained pre-update runtime (**2,865 files**) and the complete preserved backup tree (**3,631 files**). Both matched `backup-manifest.json`; previous version `0.16.4-dev`. No backup files were changed.
- Installed release digest: `01D7C888B9297708B15D2133484C202019E138206D30C20FE295DA6B91225519`; version remains `0.16.4-dev`, previous release digest `F04B372A9F47466997456105D6027FBF67B07FEE8B5C083B181380552E4E38FB`.
- Hosted Workbridge `workspace_info` and `diagnostics` PASS: new PID **58580**, new instance `be5f373a-8c98-4877-b5dd-dbea9e5728d5`, listener/tunnel ready, command capacity **36**, occupied **0**. Post-install hash comparison passed for all six installed `dist` desktop files and their runtime manifest (**7/7 byte-exact** against sealed payload).
- Nov2 `desktop-input-turn.lock` and its quarantine sidecar remained SHA-identical to their pinned hashes. Separate `DesktopProbeWatchdog` processes: **0**, and it was not included in WB-001 payload. No synthetic desktop pilot, physical RIFT keyboard input, or `/reloadui` was attempted.
- The runtime `diagnostics.jobs.inventory` remains bounded at 20,000 and reports incomplete for the >21,000 historical files; this is **expected**. The deployed updater's separate full-census fallback handles the specific limit-only preflight safely. The journal's `hostedVerified=false` remains its local-only field; actual hosted verification is documented above.

**Remaining independent gates:** Verify the standalone watchdog and all desktop producer admissions in read-only/synthetic conditions; then request separate approval to archive the two original quarantine artifacts and run one explicitly authorized live game-input pilot. Do not delete/quarantine-bypass existing evidence automatically.

## Post-deployment desktop safety validation (2026-11-05)

**Status: PASS for source/runtime admission and disposable synthetic evidence; quarantine stays ACTIVE.**

- Node regression `wb001_gui_postdeploy_synthetic_regression_20261105a`: **37 total, 36 pass, 0 fail, 1 skip**. Covered atomic admission and maintenance exclusion, foreign/replaced stamps, abandoned admissions, fake capture backend, standalone parent-gated CLI and sealed six-file stage. The skipped *file symlink* test requires unavailable Windows symlink privileges; directory-junction rejection passed.
- Node regression `wb001_gui_postdeploy_producer_regression_20261105a`: **38/38 passed**. Covered MCP registration/schema, orphan sidecar veto, DesktopProbe native-focus and counter conditions using fake backends, and VMware capture preflight/ownership with mock controls. Across both Node runs: **74 passed, 0 failed, 1 skipped**.
- Independent C# DesktopProbe watchdog pinned EXE/DLL SHA unchanged. Synthetic `wd_safe_mock_smoke_20261105b1` returned `synthetic_watchdog_passed` with `verified_child_settled`, collision blocked, monitored Job process count 2→1, child terminated on deadline, temporary lease released. Postcheck `wd_safe_mock_postcheck_20261105b1`: no leftover mock lock or quarantine. **No live watchdog process** was started.
- Independent Nov2 forensic recheck `wda-gui-turn-readonly-postwb001-20261105a`: both original files ordinary, byte-exact (380-byte lock SHA `635a367e41b80f9ad76fa1097c2ca8ece090315dc05dbf65deb4ebbfb28636b0`; 425-byte sidecar SHA `f1b37ebbeca97b4351d719786beb8c93dc678b76170f7e1a32b04bdecf0750a0`). Old owner PID 43508 is absent, but classifier correctly says `OWNER_PID_NOT_PRESENT`, `priorActionOutcome=unknown`, `historicalTreeSettled=unverified`, `releaseEligible=false`, `automaticRetryAllowed=false`, `manualArchiveDecisionRequired=true`. Related synthetic classifier cases: **10/10 passed**.
- Independent producer-source audit confirmed **five known GUI-affecting entrypoints**: MCP `desktop_capture_window`, VMware-host capture script, DesktopProbe action script, C# watchdog, and standalone desktop-capture CLI. The first four acquire the shared atomic admission before GUI turn ownership (with orphan-sidecar veto), while the standalone child CLI requires exact parent-owned admission and turn stamps. No known production entrypoint omitted the admission gate.
- **Hardening opportunity (not yet implemented):** `scripts/desktop-capture.mjs` exports the low-level `captureWindow()` helper without independent admission validation. Its known production callers are guarded, and the standalone CLI is guarded; a future direct module importer might bypass the intended contract. Narrowing the helper export or explicitly requiring validated parent-lease context would close that future path, with new synthetic tests.

**Next separately approved step:** Establish an actual cross-producer desktop maintenance freeze, independently verify lock/sidecar identity and no active owners, make durable recoverable byte-exact backups, then consider **manual archival** of the original Nov2 quarantine while preserving the prior screenshot outcome as unknown. This requires Joey's separate approval. Any synthetic/live GUI input pilot, physical RIFT `/reloadui`, game restart or Windows reboot remains independently gated. No such action occurred in this phase.
