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
