# Coding with Workbridge

In 0.5.0, `workspace_info.roots` lists all allowed directories. Relative paths keep using `C:\work`; use absolute paths for `C:\rift modding`. File/Git/snapshot tools and terminal cwd selection support both. See [multiple-root configuration and path rules](workspace-roots.md).

## Typical workflow

1. Discover a project or call `project_overview`.
2. Search and read the relevant source. Keep its returned SHA256.
3. Apply a targeted edit with a unique operation ID and that SHA256.
4. Review the returned diff; run a terminal command or configured test/build command.
5. Poll job status/output until terminal, then inspect its exit code.
6. Inspect Git diff and either undo the file operation or commit explicitly selected files.

All file/directory paths are workspace-relative (or absolute within the workspace); Git file paths are repository-relative. New parents must be created explicitly. All journal/configuration paths belong to Workbridge's protected runtime state.

## File operations

Create a file:

```json
{"operationId":"task-001-create","path":"Example/notes.md","content":"Hello\n","expectedHash":null}
```

Edit existing text using the `sha256` returned by `read_file` or `file_info(hash=true)`:

```json
{"operationId":"task-002-edit","path":"Example/src/main.ts","expectedHash":"<64-character SHA256>","edits":[{"oldText":"return a - b;","newText":"return a + b;","occurrences":1}]}
```

`occurrences` defaults to one. No fuzzy replacements are made. UTF-8/BOM UTF-16 and existing newline style are preserved. A changing file, ambiguous replacement, oversized result, existing create destination, link, reserved Windows name, or outside-root path is rejected.

Every mutation takes a unique caller-chosen operation ID containing letters/digits/underscores/hyphens. After an uncertain response, inspect `change_status` with that ID and the current file. Reusing the same ID/arguments returns the previous result, never reapplies the change. Reusing an ID for other arguments is rejected. Interrupted `prepared` records require inspection; the server will not guess whether to repeat a write.

`undo_change` takes the original operation ID. It restores exact backup bytes only if the resulting file is still the expected version. Backups have checksums. Undo of a created directory requires it to be empty. File moves refuse overwrite and support case-only Windows renames; directory moves and recursive deletion are deliberately unsupported. A failed filesystem move can require inspecting both paths before recovery.

The local journal stores compact JSON metadata plus separate before-image files. It persists across server restarts, is excluded from normal search, and has no automatic retention purge. Operator cleanup removes the corresponding undo history. File-tool state is not a substitute for Git or a backup of the whole workspace. Optimistic content checks do not create an OS sandbox against hostile concurrent filesystem changes.

## Commands

The operator edits `.local/commands.json` locally. The MCP tools cannot add or rewrite command definitions. Example:

```json
{
  "projects": {
    "Example": {
      "test": {
        "executable": "C:/Program Files/nodejs/node.exe",
        "args": ["--test", "test/*.test.mjs"],
        "timeoutSeconds": 120
      }
    }
  }
}
```

Use absolute executable paths and fixed argument arrays. On Windows prefer `.exe` entry points; for npm use `node.exe` with the absolute installed `npm-cli.js` path and fixed npm arguments, rather than spawning `npm.cmd` directly. The fixed-profile tools do not accept additional arguments; `terminal_run` supplies dynamic execution independently. Trust the project code, hooks, dependencies and executable before allowing a command; this is executable code, not read-only inspection.

`commands_list(project)` exposes configured IDs. `command_run(project,command,requestId)` starts one job. Reusing a request ID does not run it again. Two jobs may run concurrently. Timeouts are 1–600 seconds (120 default), combined captured output is capped at 1,048,576 characters, and each output response is at most 60,000 characters. `command_output` offsets are character offsets. Poll status even if no more output is currently available. `passed` requires exit code zero; `failed`, `timed_out`, `cancelled`, and `interrupted` are distinct.

Workbridge removes its tunnel credential and inherited `GIT_*`/`WORKBRIDGE_*` variables from validation subprocesses. Other inherited project environment variables remain available. Do not put secrets in command arguments. Cancellation kills the server-owned process tree on Windows. Hard server termination leaves unfinished records marked interrupted on reload; jobs are never silently resumed.

### General terminal commands (0.4.0)

Call `terminal_run` with an existing `cwd` under the workspace root, an `executable`, a literal `args` array, a unique `requestId`, and optional `timeoutSeconds` (1–600, default 120). Absolute executable paths, relative executable paths, and installed names on PATH are supported. Example tool arguments:

```json
{
  "cwd": "my-project",
  "executable": "npm",
  "args": ["test", "--", "--runInBand"],
  "requestId": "my-project-tests-001",
  "timeoutSeconds": 120
}
```

Poll `command_status(jobId)` and read `command_output(jobId,stream="stdout"|"stderr"|"combined",offset,limit)`. Combined remains the default; legacy jobs may only have combined output. Streams share the 1,048,576-character capture budget. Output pages contain at most 60,000 characters. Terminal and fixed-profile jobs share the two-job limit and the same cancellation/status API. Reuse the same request ID after a lost response; changing executable, arguments, cwd, or timeout with that ID returns `ID_REUSE`. A completed or interrupted ID never silently reruns. Arguments are not retained in job records; command output can still contain anything the child prints.

Execution is noninteractive: stdin is closed and there is no terminal UI. Native arguments preserve empty strings, Unicode, spaces, quotes, and shell metacharacters without implicit shell parsing. Windows npm/npx launchers use their adjacent official Node CLI entrypoints. For scripts or command sequences, explicitly invoke `powershell.exe` with `-NoLogo -NoProfile -NonInteractive -File <script>` or a deliberate `-Command` argument. PowerShell scripts must check native `$LASTEXITCODE` and exit with it when a failed native command should fail the job. Other `.cmd`/`.bat` scripts require an explicit interpreter; missing tools and invalid executables return failed jobs with diagnostics and a null exit code.

The cwd check rejects paths outside the workspace, protected state, and junctions. **Commands run with the Windows user's filesystem/network rights; cwd validation is not an OS sandbox.** A command can access other paths and installed tools. Review the intended script, dependency installs, hooks, and effects; obtain specific user authorization for destructive changes or publishing. Do not place secrets in arguments or printed output. The tunnel credential and inherited `GIT_*`/`WORKBRIDGE_*` variables are removed, while other project environment variables remain available.

Windows process-tree ownership uses the existing Job Object helper in a small compiled host. Timeouts, cancellation, root-command exit, and abrupt MCP-server death terminate descendants, including descendants that keep output pipes open. A restart leaves unfinished jobs interrupted. Use the independent [WB-001 updater](updates.md) to deploy or restart Workbridge itself.

Use `node scripts/configure-self-commands.mjs` to configure Workbridge's build, test, format check, startup test, and read-only RiftReader acceptance commands without replacing existing profiles.

## Git

`git_read_file`, `git_compare`, and `git_blame` inspect historical source with the same fixed Git executable/limits as existing Git tools. Capture is capped at 1 MiB and response output at 60,000 characters; historical reads are intended for ordinary UTF-8 source files.

`git_commit` requires a message, unique operation ID, exact expected HEAD (null if unborn), and individual selected paths with their current SHA256 (null for deleted files). It stages/commits only selected worktree paths, leaving unrelated staged entries staged. It supports an initial commit. It refuses detached HEAD and missing author/committer identity, does not invent authors, and does not push. Configure the intended Git identity locally when needed.

Normal repository hooks and signing remain active. A failure can leave selected files staged. An uncertain attempt must be inspected through Git status/history before choosing another operation ID; blindly repeating commits is not safe. File undo does not undo a commit or reset the index.

## Recovery and rollouts

- A `CONFLICT` means reread before editing/undoing; never substitute a guessed hash.
- `OPERATION_UNCERTAIN` means inspect the recorded ID and affected paths/history.
- `EDIT_LIMIT` concerns recoverable changes/full hashing, not large streamed reads.
- A search limited by time/output is incomplete; narrow its scope. Regex is Rust syntax, without PCRE lookaround/backreferences.
- A missing command profile does not prevent source work. Use an authorized `terminal_run` command, or have the operator configure a reusable profile.
- Let current jobs finish or cancel them before restarting the scheduled task. Read cursors expire on restart. Allow about 30 seconds for hosted reconnection.
- Double-click `Workbridge Status.cmd` if the server is unavailable. Existing startup credentials and tunnel associations are reused.

ChatGPT write/command permissions are a client setting. Tool annotations describe behavior; they are not authorization enforcement. Workbridge's file-tool path/state checks and fixed-profile selection apply independently. Terminal commands have the broader effects described above.
