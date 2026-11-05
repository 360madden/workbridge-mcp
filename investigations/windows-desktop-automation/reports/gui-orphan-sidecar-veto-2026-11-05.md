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

## Fresh read-only host classification (after code commit)

At 2026-11-05T18:18:48Z, invoked the existing
`prototypes/gui-turn-reconcile-readonly.ps1` with **exact** historical lock SHA,
lease ID and request ID. Result: `state: unknown`,
`reasonCode: OWNER_PID_NOT_PRESENT`, `releaseEligible: false`.
The pinned lock checksum and sidecar linkage checks succeeded; no file was moved,
changed or released. Owner PID `43508` was absent in the current process snapshot,
but the old child process-tree settlement and screenshot outcome remain **unknown**.

Read-only Workbridge diagnostics immediately afterward reported version
`0.16.4-dev`, current owner PID `15064`, instance
`8eeaffd2-4e11-4228-8bac-daa06449b08c`, started
`2026-11-05T15:27:35.161Z`; tunnel healthy, 36/36 command slots available.
This supports a service-owner change since November 4, **not** a claim of
historical screenshot completion or safe automatic unlock. Inventory was incomplete
at its 20,000-entry limit; no global absence of other jobs is inferred.

## Original maintenance admission design (implemented later in source; update below)

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

## Later source-only continuation (13:49 EST, 2026-11-05)

The earlier numbered steps above were the **pre-implementation roadmap**. Their source-code
requirements have now been addressed; production deployment and live archive have **not**.

| Workbridge commit | Narrow milestone | Validation |
| --- | --- | --- |
| `accee90fe2fb4d129d6894d6cb21ebfbbed8a388` | Atomic maintenance/producer admission and ownership-verified release; three GUI producers | 36/36 focused JavaScript tests, isolated compiled MCP 8/8, TypeScript and formatting pass |
| `74d50de8bc1c43aa4084652cc922171ffe4b42d7` | Sealed staged desktop helper; upgrade-path closure checks | 55 pass / 1 skip staging, 37/37 updater, compiled MCP 8/8 |
| `b6dac1ee0b196a72fa034619729cff4e9238e859` | C# DesktopProbe watchdog atomic admission before GUI-turn lease | .NET 10 publish, normal/uncertain/foreign-lock synthetic PASS |
| `d3e98516becf24c2c3ad78afbf1c7c0f356ffd16` | Guard independent desktop-capture CLI via exact parent lease check while retaining MCP parent's unsettled-child quarantine | 56 pass / 1 skip; staged CLI negative and positive fake-backend child tests PASS |

Read-only producer audit found five GUI-affecting entrypoints: the MCP window screenshot,
VMware host capture, DesktopProbe action script, C# watchdog and standalone screenshot CLI.
The four original guarded writers now use admission in source. The standalone CLI requires
an exact current parent-owned admission+GUI lock (owner PID, producer, request/target identity,
bounded regular files and no quarantine); it refuses unowned direct shell use. Existing
snapshot-only samplers are not independent GUI writers.

**Deployment boundary:** Production Workbridge 0.16.4-dev has **not** been upgraded through
WB-001. No evidence yet proves every deployed/legacy producer uses the new gate.
Source proof is not live quiescence, and the Nov 2 screenshot still has unknown outcome.
Do not archive sidecar/guard until a reviewed WB-001 activation, verified live producer
inventory, independently approved maintenance freeze and exact byte-preserving protocol.
No Windows/game/service restart, GUI capture, lock change, or backfill success receipt
was performed in these milestones.

## Non-actions / boundaries

No `/reloadui`, RIFT exit/restart, Windows reboot, Workbridge service restart,
GUI automation, SendKeys bypass, or release/removal of a quarantined file occurred.
The pre-existing unrelated modification to `scripts/freebuff-conpty-probe.py` is
user-owned and untouched.
