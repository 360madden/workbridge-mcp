# GUI quarantine: orphan-sidecar safety milestone (2026-11-05)

Status: **source-only hardening validated; live November 2 quarantine unchanged**.
Date: Thursday, November 5, 2026 (America/New_York).
Owner: Workbridge-MCP desktop-automation investigation.

## Background / handoff

RRE context and the deployment boundary were preserved first in
`C:\work\rre\docs\RRE-RC32-WORKBRIDGE-GUI-HANDOFF-2026-11-05.md`
(RRE commit `0ec285c785e7777fa6a1c3211431afe5257d0572`).
The physical game displayed **RRE v0.4.11 research**. No new game reload was authorized or performed in this milestone.

The November 2 Workbridge desktop-input turn still has an unreconciled lock and quarantine sidecar. Existing recovery reports in this directory document the owner/lease and the requirement for operator-reviewed evidence before release.

## Identified gap

Three GUI producers acquired `desktop-input-turn.lock` but did not independently veto
`desktop-turn-quarantine-*.json`. If the original lock were absent while an uncertain
sidecar survived, those paths could begin new GUI work despite outstanding quarantine.
A sidecar is an independent safety veto; its timestamp or parseability must not matter.

## Implemented (source, not deployed)

1. `src/desktop-registration.ts`: after atomic lock acquisition/owner stamp and **before** calling the capture callback, enumerate siblings; refuse any `desktop-turn-quarantine-*.json` with `UI_TURN_RECOVERY_REQUIRED`. Release only the new, ownership-verified lock; preserve sidecar.
2. `scripts/vmware-host-capture.mjs`: same sidecar veto before VMware inventory, WinApp runner, or capture.
3. `scripts/desktop-probe-act.mjs`: same veto before read-only preflight or WinApp input.
4. Added an isolated, synthetic orphan-sidecar regression for each producer. Each uses an unparseable sidecar, no original lock, and asserts zero GUI-callback/runner invocations, retention of the sidecar, and removal of the newly owned lock.

The source uses the existing lock as the mutex during sidecar checking; it does **not** remove or reinterpret the live lock.

## Verification receipts

- Isolated TypeScript compilation: `node node_modules/typescript/bin/tsc --outDir .tools/gui-orphan-veto-20261105/dist` — PASS.
- Scripts: `node --test test/vmware-host-capture.test.mjs test/desktop-probe-act.test.mjs` — **30/30 PASS**.
- MCP registration: import `test/desktop-registration.test.mjs` against isolated `.tools/gui-orphan-veto-20261105/dist/desktop-registration.js` — **8/8 PASS**.
- Formatter: Prettier on the six touched source/test files.
- Tests used synthetic temporary evidence roots only; no physical RIFT or VM input, no live screenshot, and no lock archival/release.
- Running Workbridge service was not restarted or upgraded. Editing the source does not mean the deployed service is protected by this change.

## Unresolved: shared maintenance admission

Independent architecture review found a time-of-check/time-of-use race in a simple
`freeze.json` approach. Before any real quarantine archive, build and test a **second
atomic admission lock**, acquired by *all* GUI producers before the original turn lock,
and held by maintenance until postchecks finish. Required coverage: MCP capture,
VMware host script, DesktopProbe action script, C# watchdog, and any legacy samples
that may still run. Existing deployed producer processes may not honor new admission
until a controlled WB-001 service update. A source-only gate is not sufficient evidence
that the running system is frozen.

## Next actions (strict order)

1. **Source-only**: build shared atomic admission lease with ownership-checked release
   and synthetic cross-producer race tests. Verify packaging from compiled `dist`.
2. **Read-only**: recapture exact current guard/sidecar hashes, active process/service
   producers and the November 2 intent/process evidence. Do not infer safety from age.
3. **Separate operator-approved maintenance**: coordinate WB-001 producer upgrade,
   prove all old producers quiescent, acquire admission freeze, archive sidecar first and
   original lock last with byte-exact recoverable receipts, then verify guard state.
   Only after this can a new, separately authorized GUI action be considered.

## Non-actions / boundaries

No `/reloadui`, RIFT exit/restart, Windows reboot, Workbridge service restart,
GUI automation, SendKeys bypass, or release/removal of a quarantined file occurred.
The pre-existing unrelated modification to `scripts/freebuff-conpty-probe.py` is
user-owned and untouched.
