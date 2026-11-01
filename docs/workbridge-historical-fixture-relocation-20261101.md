# Workbridge historical fixture relocation — 2026-11-01

## Purpose and safety boundary

Joey requested consolidation of the old Workbridge experiment and validation directories under `C:\work\workbridge-mcp\temp`, without moving or interrupting `C:\work\workbridge-mcp` or `C:\work\Workbridge Health`.

**State: VERIFIED COMPLETE — 2026-11-01 (UTC).** All 34 selected folders were relocated; the two protected folders stayed in place. Workbridge and its health helper remained online.

## Location mapping

For each of the **34** top-level historical Workbridge-named directories in the pre-move inventory, excluding the two protected folders:

- Original: `C:\work\<historical-name>\<relative-file>`
- Current after relocation: `C:\work\workbridge-mcp\temp\<historical-name>\<relative-file>`

Preserve the exact original folder spelling and every nested file. Historical reports, raw receipts, failed test output and sealed manifests intentionally retain their *original* absolute paths as contemporaneous evidence. To open them now, apply the mapping above; do not interpret old paths in historical notes as active dependencies.

## Pre-move dependency findings

- Live 0.16.4-dev Workbridge: 36 command-job slots and 36 coordination assignments; its `Workbridge MCP` task runs from `C:\work\workbridge-mcp`. This owner must not be restarted for this filesystem cleanup.
- `Workbridge Health` remains in active use by `Workbridge Helper pc-health` and `PcHealth.exe`. Never relocate it.
- No scheduled task or running process directly referenced the 34 selected historical directories in the read-only inspection; this does not prove no offline or external consumer exists.
- `.local\commands.json` registers one historical validation project's `test` command under `workbridge-validation-WJtzao`. Its profile must be propagated to `workbridge-mcp/temp/workbridge-validation-WJtzao` before moving, then the old key retired after validation.
- `.local\browser-validation.json` records the older validation folder; preserve its original bytes in the migration backup and update the current pointer after the move.
- Current documentation references old evidence locations. Keep raw historical claims intact and use this relocation index to resolve current locations.
- The historical `workbridge-agent-proof-20261018-2154` contains six **absolute** Git worktree `.git` pointers and six matching repository-side `gitdir` backlinks, using forward-slash Windows paths. These 12 references were discovered in final verification, backed up, and repointed after relocation. All six archived worktrees now pass `git rev-parse --show-toplevel` and appear in their parent repositories' `git worktree list`.
- A shared fixture generator (`scripts/prepare-browser-validation.mjs`) previously created new `workbridge-validation-*` folders at the workspace root. It is updated to use this ignored `temp` directory to reduce future clutter.

## Verified completion and receipts

- Exactly **34 whole historical directories** now reside directly below `C:\work\workbridge-mcp\temp\`; none remains at its former `C:\work` location. The only top-level Workbridge-named directories left are the protected `workbridge-mcp` and `Workbridge Health`.
- Pre-move and initial post-move inventories matched: **105,101 files and 2,283,815,811 logical bytes** across the 34 folders. After the 12 deliberate Git metadata pointer rewrites (20 extra bytes each), an independent filesystem inventory again counted **105,101 files and 2,283,816,051 logical bytes**: exactly **+240 bytes**, with no lost folder or payload files. Folder enumeration excludes traversal through the four junction targets.
- The one live historical project command profile was pre-registered at `workbridge-mcp/temp/workbridge-validation-WJtzao`, directly tested through Workbridge, and then its old root-level project key was removed. The current `.local\browser-validation.json` project/directory fields and `.local\snapshot-validation-path.txt` were updated to the nested path; original versions and the command-profile edit were backed up.
- Four historical NTFS junctions were repointed safely to relocated in-fixture targets **before** moving their parent folders, and all four resolve. All five standalone historical Git repositories remain readable. Twelve archive-only Git pointer files were repaired with backups afterward; all six nested worktrees resolve in Git.
- Workbridge 0.16.4-dev remained healthy with **36-slot capacity**, tunnel ready and control plane `ok`; `Workbridge MCP` and `Workbridge Helper pc-health` scheduled tasks were observed running. No service restart was needed.
- Preflight, initial postflight, move, junction and Git-pointer receipts: `C:\work\workbridge-mcp\temp\_relocation\`. Recoverable current-pointer backups and the 12 archived Git-pointer backups: `C:\work\workbridge-mcp\.local\relocations\wb-temp-20261101\`.
- The earlier original absolute paths inside historical reports and sealed/raw evidence remain intentionally unmodified; use the location mapping above when reading them. Moving directories on the same `C:` volume organizes the workspace; it **does not reclaim disk space**.

## Procedure and recovery

1. Add `temp/` to `.gitignore`; confirm Git remains scoped to normal sources.
2. Create `temp` and retain a preflight inventory of original directory names, counts, sizes and references.
3. Back up the two current configuration/pointer files before their guarded edits. Pre-register the new command-profile path while the original still exists.
4. Check exact source and destination existence, reparse points, active processes and task references; move only the 34 selected *whole directories*, each to the identically named child of `temp`. Never merge or overwrite a destination.
5. Verify every source is absent, every destination exists, representative Git/evidence files survive, and pre/post directory file counts and logical bytes agree.
6. Retire the old command profile only after the relocated profile is confirmed. Check hosted Workbridge diagnostics, scheduled tasks, Git status and the untouched health helper.
7. If a move is interrupted, inspect source and destination before retrying. Restore by moving the same directory back only when the original path is empty; do not delete either tree or replay a conflicting move.

The earlier Git release baseline and `.local\releases` remain unchanged. This relocation does not validate or delete historical proof data.
