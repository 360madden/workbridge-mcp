# Work in multiple project roots

Workbridge 0.6.0 adds a local operator command for explicit project roots. Installation code, private state, and project directories are separate; a new installation can select any existing primary directory through the startup scripts’ `-Root` parameter. On this PC, the primary root remains `C:\work`. This installation also permits the existing `C:\rift modding` directory (with a space); no alias or junction is created and the whole C: drive is not added.

Call `workspace_info` to see `root` (the default) and `roots` (all allowed directories). Relative paths retain their original meaning under the primary root. Use an absolute path for an additional root. For example, after explicitly adding `D:\Projects`:

```text
discover_projects(directory="D:/Projects", recursive=true, maxDepth=4)
list_directory(directory="D:/Projects/example")
read_file(path="D:/Projects/example/README.md")
git_status(project="D:/Projects/example")
terminal_run(cwd="D:/Projects/example", executable="git",
             args=["status", "--short"], requestId="project-status-001")
```

Git file filters remain relative to the selected repository. Discovery scans the requested directory; the default still scans `C:\work`. Paths returned for the primary root remain relative. Paths returned for additional roots are absolute and can be passed back into file, Git, job, and saved-snapshot tools. File edits and undo work in either root. Terminal commands retain existing time/output limits and Windows user permissions; cwd validation is not an OS sandbox.

## Local configuration

The operator-owned `.local/workspace-roots.json` contains only additional roots:

```json
{
  "additionalRoots": ["C:\\rift modding"]
}
```

The launcher continues to supply `WORKBRIDGE_ROOT=C:\work`. Keep this file in the active state directory (normally the checkout's `.local`) and restart using the independent update/recovery workflow. It is protected from project file tools and included in updater configuration backups. Snapshot capacity remains in separate `settings.json`; existing settings are preserved.

All roots must be absolute existing directories; at most 16 additional entries are accepted. Invalid JSON/schema, missing directories, and relative roots fail startup instead of silently widening or dropping access. Duplicate canonical roots are collapsed. Without this file, only the primary root is available. Earlier runtimes ignore the new file, allowing rollback to 0.4.0 with its original single-root behavior.

File tools still reject paths outside the allowed roots, directory junctions/symlinks (including links between allowed roots), `.git` internals, and protected runtime state. Root directories themselves cannot be deleted/replaced through file mutations. Listing and search keep generated-directory exclusions. Adding a root does not combine, copy, or modify its projects.


## Manage roots without rebuilding

Run locally from the Workbridge installation:

```powershell
.\scripts\Manage-WorkspaceRoots.ps1 -Action Show
.\scripts\Manage-WorkspaceRoots.ps1 -Action Validate
.\scripts\Manage-WorkspaceRoots.ps1 -Action Add -Path 'D:\Projects'
.\scripts\Restart-Workbridge.ps1
# After finishing work in that root:
.\scripts\Manage-WorkspaceRoots.ps1 -Action Remove -Path 'D:\Projects'
.\scripts\Restart-Workbridge.ps1
```

Use `-StateDirectory` and `-PrimaryRoot` explicitly for a separate installation without autostart settings. The helper reads the installed primary from `autostart.json` when present. It never changes the primary, creates a project, or modifies project settings. It rejects whole-drive additions, protected state, relative paths and junctions/symlinks. Unicode and spaces are supported. Duplicate additions are no-ops. Remove can repair an unavailable additional root; malformed JSON must be repaired locally before this helper can operate.

Each change saves the previous configuration text under `root-config-backups` before an atomic replacement. Keep a known-good copy for local recovery. A changed configuration returns `restartRequired=true`; a no-op returns null because runtime restart state was not checked. New project accesses stop with `WORKSPACE_RESTART_REQUIRED` after configuration changes until the existing service is restarted. Removing a root neither deletes its files/journals nor redirects old undo records; re-adding the same canonical root restores that identity. A folder still covered by another allowed parent remains accessible.

The restart command verifies fresh tunnel readiness and retries a zero-result Task Scheduler start once if the previous instance is still completing. Actual startup failures remain visible through status/log diagnostics.

On Windows, command hosts hold shared native configuration leases for their lifetime. Add/Remove takes an exclusive lease and refuses to run while jobs are active. Wait for jobs or cancel them, then run this helper locally, outside Workbridge’s own terminal tool. A command that was validated before a configuration change rechecks it after acquiring its lease and stops before execution if it changed. Process exit releases leases automatically. In-flight file operations are not transactional with configuration changes; wait for edits to finish before reconfiguration. Commands retain normal Windows account rights.

## Discover grouped repositories and project context

`discover_projects` keeps its immediate-child default. Opt into `recursive=true`, choose `maxDepth` from 1 to 12 (default 4), and follow `nextOffset`. File entries count toward the scan/pagination budget even though only directories appear as projects. Results include the selected folder’s identity and repository-root/linked-worktree evidence for Git markers. Broken/unavailable Git markers report a diagnostic without preventing ordinary folder inspection. Plain folders and unborn/dirty repositories are valid inputs; no commit history or prescribed source layout is required.

`project_overview` lists applicable ancestor and selected-folder `AGENTS.md` paths within allowed roots, scoped nested instruction paths, selected-folder README files, manifests, and candidate commands. These are bounded evidence for the caller to read, not permission grants or automatically executed scripts. Additional-root paths remain absolute; duplicate repository basenames are unambiguous.
