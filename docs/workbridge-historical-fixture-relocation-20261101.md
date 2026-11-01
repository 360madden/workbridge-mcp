# Workbridge historical fixture relocation — 2026-11-01

## Purpose and safety boundary

Joey requested consolidation of the old Workbridge experiment and validation directories under `C:\work\workbridge-mcp\temp`, without moving or interrupting `C:\work\workbridge-mcp` or `C:\work\Workbridge Health`.

**State: PREPARED — relocation not yet complete.** Keep this heading accurate until independent post-move checks succeed.

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
- The historical `workbridge-agent-proof-20261018-2154` contains six relative Git worktree links; moving their common parent should preserve their relative relationship. Verify that they remain readable afterward.
- A shared fixture generator (`scripts/prepare-browser-validation.mjs`) previously created new `workbridge-validation-*` folders at the workspace root. It is updated to use this ignored `temp` directory to reduce future clutter.

## Procedure and recovery

1. Add `temp/` to `.gitignore`; confirm Git remains scoped to normal sources.
2. Create `temp` and retain a preflight inventory of original directory names, counts, sizes and references.
3. Back up the two current configuration/pointer files before their guarded edits. Pre-register the new command-profile path while the original still exists.
4. Check exact source and destination existence, reparse points, active processes and task references; move only the 34 selected *whole directories*, each to the identically named child of `temp`. Never merge or overwrite a destination.
5. Verify every source is absent, every destination exists, representative Git/evidence files survive, and pre/post directory file counts and logical bytes agree.
6. Retire the old command profile only after the relocated profile is confirmed. Check hosted Workbridge diagnostics, scheduled tasks, Git status and the untouched health helper.
7. If a move is interrupted, inspect source and destination before retrying. Restore by moving the same directory back only when the original path is empty; do not delete either tree or replay a conflicting move.

The earlier Git release baseline and `.local\releases` remain unchanged. This relocation does not validate or delete historical proof data.
