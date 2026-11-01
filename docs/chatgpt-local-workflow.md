# Using local PC tools from an ordinary ChatGPT chat

Select **Chat**, select **Workbridge** in the composer plugins menu, and give
ChatGPT a concrete task. The PC must be online with its tunnel running.

Starter request:

> Use Workbridge. Read C:/work/workbridge-mcp/docs/chatgpt-local-workflow.md.
> Then complete this local Windows task: [describe the intended result].
> Use installed tools first; create a small PowerShell or C#/.NET 10 helper
> when useful. Save its source and results under a named C:/work folder.
> Run it, inspect the actual output, and report the saved paths and exit code.

This document is guidance when explicitly read. Saving it does not automatically
add instructions to every future ChatGPT chat or expand plugin permissions.

## Working sequence

1. Call `workspace_info` and inspect the relevant project's instructions and
   existing files. Establish the intended paths and current software/tool versions.
2. Use an installed CLI or PowerShell command where it already provides the
   needed behavior. For new helpers, retain readable source and a short usage
   note, plus any required project/package manifest.
3. Use recoverable file tools for source/config edits inside allowed roots.
   Use current hashes, exact edit matches, and unique operation IDs. File-tool
   undo covers those edits; it does not cover arbitrary process writes.
4. Run explicit executable/argument/cwd jobs through `terminal_run`. PowerShell
   scripts should use `-NoLogo -NoProfile -NonInteractive -File` and check every
   native command's `$LASTEXITCODE`. Poll the same job until terminal status and
   inspect stdout/stderr; reuse the same requestId after an uncertain response.
5. For installations, inspect exact package ID, publisher, source, version,
   installer, and scope. Prefer the vendor's supported package-manager route;
   use user scope when suitable, inspect installed inventory before retrying,
   and verify both version and a real operation afterward. Retain uninstall
   instructions. Avoid unrelated software upgrades or installation bundles.
6. For configuration, locate the effective config and its owner/application.
   Back up the original bytes, make a targeted change, validate syntax and
   actual behavior, and identify any reload/restart needed. Restore if the
   experiment requires restoration; report any setting intentionally retained.
7. Report results and remaining limitations accurately. A started job, generated
   source file, or available installer alone is not proof of successful execution.

## Windows compatibility and lifecycle

The Windows App Execution Alias for `winget.exe` is available to PowerShell but
the current Workbridge native executable resolver rejects it (`stat` returns
EACCES). Invoke WinGet through PowerShell. This supported route passed package
inspection without modifying PATH, Windows alias settings, or bridge code.

An already-running scheduled bridge can retain an older PATH after installing a
tool. Use its verified absolute executable path immediately. A PATH refresh is
not a reason to redeploy a working service.

Command execution uses the bridge account/token, with filesystem and network
rights beyond cwd. Jobs have closed stdin, six concurrent slots, at most 600
seconds, bounded capture, and process-tree cleanup. Interactive installer/UAC
prompts need operator interaction. Check token/elevation and the exact need;
do not assume administrator access. Persistent applications need an appropriate
supported lifecycle, such as an explicitly configured Windows service or
Scheduled Task, when a real task requires it. Do not add a supervisor by default.

**ChatGPT Chat-mode tool approval is separate from Windows prompts.** When a
Workbridge action may trigger the platform card **“Allow ChatGPT to use
Workbridge?”** (for example, **Terminal Run**), warn the user prominently in the
**main conversation before issuing that call**. If the card is hidden, tell
them to expand **Previous activity** and review **See details**, then choose
**Allow once**, **Always allow** (when appropriate), or **Deny**. Do not
claim that a command started while approval is pending, click on the user's
behalf, or silently retry through an alternate route. One concise notice per
approval-prone phase is enough; avoid repeated approval spam. The platform
controls card placement and may require review even when Workbridge's own app
permission is Allow all. See the [ChatGPT approval visibility protocol](chatgpt-approval-visibility.md).

Use the independent Workbridge updater for service updates rather than
restarting its own command host from inside a job.

## Verified demonstrations

For a helper that must outlive a command job, use the native task manager in
[administrator/UAC and persistent helpers](admin-and-persistent-helpers.md).
Register a Limited user task, explicitly choose any sign-in trigger, inspect
application health, and stop/remove the task when finished. Elevation is a
separate per-operation Windows consent workflow; the current fixed diagnostic
does not grant a general administrator shell.

See [the local PC roadmap](local-pc-roadmap.md) for actual browser-chat evidence,
saved artifacts, remaining scope, and the repeatable demonstration scripts.
