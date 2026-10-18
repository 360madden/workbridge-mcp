# Work in multiple project roots

Workbridge 0.5.0 supports explicit project roots. The primary root remains `C:\work`. This installation also permits the existing `C:\rift modding` directory (with a space); no alias or junction is created and the whole C: drive is not added.

Call `workspace_info` to see `root` (the default) and `roots` (all allowed directories). Relative paths retain their original meaning under the primary root. Use an absolute path for the additional root. Example tool arguments:

```text
discover_projects(directory="C:/rift modding")
list_directory(directory="C:/rift modding/RiftReader")
read_file(path="C:/rift modding/RiftReader/README.md")
git_status(project="C:/rift modding/RiftReader")
terminal_run(cwd="C:/rift modding/RiftReader", executable="git",
             args=["status", "--short"], requestId="rift-status-001")
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
