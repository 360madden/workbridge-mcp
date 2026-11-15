# Workbridge storage cleanup trial packet

Status on November 15, 2026 (America/New_York): **READ-ONLY PREPARATION PASSED; MANUAL
QUARANTINE/RESTORE CYCLE NOT RUN OR AUTHORIZED**.

This defines one reversible trial on verified `AMD-DESKTOP`; it authorizes no purge or global
cleanable-byte claim. The implementation passed the 1,353-test release validation, so no new release
or full suite is needed.

## Target and evidence

- Updater operation: `agent12-activate-20261031-02`; resource kind: `candidate`.
- Source: `.local\update-operations\agent12-activate-20261031-02\candidate`.
- Retained sealed copy: `.local\releases\agent12-20261031-05\payload`, restricted to `dist`,
  `node_modules`, `package.json` and `package-lock.json`.
- Duplicate proof: 2,865 runtime files, 74,027,483 logical bytes; operation age 14 full days.
- Source identity: volume `bc4aff304afee654`, file ID
  `e77c2600000022000000000000000000`; unchanged during preparation.
- Proposed GC operation ID: `gc-agent12-candidate-trial-20261115a`. Its quarantine namespace was
  absent during preparation.

Fresh artifacts under
`.tools\retention-evidence\cleanup-ready-20261115-055508473\`:

| Artifact                        | Qualification                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidate-plan.json`           | Canonical plan SHA-256 `38e5c0e4645127ad602fdfa72978c054f84dcdfd127a83123d3e8c0b9bfca783`; file SHA-256 `9b53c741664eee9ffe6aae799904cb75f0ae0c266aabdf15e66ea560a665e3b9` |
| `references-preview.json`       | Complete 34-operation graph, zero blockers; current final `0.16.5-dev` operation and previous bridge protected                                                             |
| `review-packet-v2.json`         | SHA `D886E8E20B657FBC01349B3500F8AE8415293888327A45C532506361B278A937`; prepared only; all authorization/maintenance/mutation flags false                                  |
| `runtime-manifest-summary.json` | SHA `A20C66C3432AE7BCFC0C3812110F49196072F732172BEC45E3BEB755408D8547`; manifest-derived counts                                                                            |
| `operator-exclusion.json`       | SHA `9A0060B9D603721F5453383C3640209E69A45F8EADD45217E8D49846AF9EC6C1`; separate offline-recovery exclusion                                                                |

`review-packet-v2.json` supersedes the preserved original
`review-packet.json`, SHA-256
`7F84297B59081DE0370ADF0896A5E2E9B0963F38DFF1E8F300B74DB4C47FA502`. The canonical plan and
plan-file hashes are unchanged.

The final operation, previous bridge and every `backup/runtime` are protected by modeled updater
references. The native reference graph and its `protectedPaths` do **not** model
`.local\recovery-operations`. That namespace is instead an explicit operator exclusion, separately
bound by `operator-exclusion.json`, and is outside the planner's allowed candidate/displaced source
selection. The source plan binds its identity, source tree, retained tree, manifest, metadata and
current reference graph.

The summary derives 2,865 files/74,027,483 logical bytes from the sealed A392 manifest's four
runtime roots; it is not a second hash scan. Production plan creation verified current source
and retained bytes against that manifest.

## Authorization and execution baseline

Before moving anything, obtain owner authorization for this exact source, destination, operation ID
and cycle. Coordinate quiet clients, builders and manual writers; 36 idle slots and the updater lock
do not attest that maintenance interval.

Immediately before quarantine:

1. Reverify `hostname.exe` is `AMD-DESKTOP`, the proposed GC namespace is absent, and no competing
   retention/update operation is active.
2. Refresh the plan/reference/identity proof. If its canonical plan hash changes, stop and review a
   new packet; never substitute a new hash silently.
3. Refresh free-space, Git index/worktree and configuration baselines. Preserve the original hashes
   of `.local/settings.json`, `autostart.json`, `workspace-roots.json` and `commands.json`.
4. Preserve user-owned `scripts/freebuff-conpty-probe.py`, preparation SHA-256
   `c29fbfd898c5fe54e86e34403a79ef4d1107761f4828deed153be4be3de3c07f`.

Preparation free space was 175,355,756,544 bytes, not an execution baseline or global reclaimable
total.

## Manual cycle commands

Run from `C:\work\workbridge-mcp` only after the exact-target authorization and quiet-maintenance
attestation. Use the same GC operation ID and canonical plan hash throughout.

```powershell
node scripts/storage-retention.mjs quarantine --plan C:\work\workbridge-mcp\.tools\retention-evidence\cleanup-ready-20261115-055508473\candidate-plan.json --expect-plan-sha256 38e5c0e4645127ad602fdfa72978c054f84dcdfd127a83123d3e8c0b9bfca783 --operation-id gc-agent12-candidate-trial-20261115a --maintenance-confirmed

node scripts/storage-retention.mjs status --install-root C:\work\workbridge-mcp --operation-id gc-agent12-candidate-trial-20261115a

node scripts/storage-retention.mjs restore --install-root C:\work\workbridge-mcp --operation-id gc-agent12-candidate-trial-20261115a --expect-plan-sha256 38e5c0e4645127ad602fdfa72978c054f84dcdfd127a83123d3e8c0b9bfca783 --maintenance-confirmed

node scripts/storage-retention.mjs status --install-root C:\work\workbridge-mcp --operation-id gc-agent12-candidate-trial-20261115a
```

After timeout, interruption or ambiguity, inspect `status` with the same ID; never use a new ID. A
replacement at either path is a collision: do not overwrite, merge, rename around or delete it.

## Acceptance and stop conditions

Pass requires the reviewed plan/identity, settled `quarantined`, identical resource restoration to
the exact source, and final `restored` with no pending commit. Recheck configuration, dirty-file,
Git, installed-marker, recovery-protection and free-space baselines. Separate logical bytes moved
from measured volume free space.

Stop on changed plan/reference/tree/identity evidence, incomplete status, namespace collision,
unexpected link/reparse/hardlink/stream state, configuration or Git drift, lost maintenance
coordination, or any mismatch between source and retained proof. Preserve the operation journal and
inspect it; do not improvise filesystem repair.

This trial intentionally restores the payload and therefore frees **zero bytes**. It contains no
purge command or purge authorization. Any future real reclamation requires a **new quarantine**,
its real version-2 receipt aging for seven complete days, fresh `purge-prepare` reference and
surviving-copy proof, review of the exact purge digest, and separate authorization for the explicit
permanent-delete command. The preparation packet and this manual trial cannot authorize that step.
