# Prepare, install, and recover a Workbridge runtime

WB-001 adds local Windows update tooling around the existing scheduled task. WB-001 itself added no MCP tools. WB-002 is active at version 0.4.0 with 33 tools; operation `wb002-first` passed fresh hosted acceptance. A release's manifest digest and operation ID identify its exact files, including updates with the same server version.

## Prepare a release

From a trusted Workbridge source directory in PowerShell:

```powershell
.\scripts\New-WorkbridgeRelease.ps1 -ReleaseId 'next-release' -WorkspaceRoot 'C:\work'
```

This copies the source into a new `.local\releases\next-release\payload`, runs `npm ci` from the pinned lockfile, builds and runs the integration tests, runs Windows startup and updater tests, checks formatting, runs self-contained disposable acceptance, and checks actual stdio MCP initialization, version, its expected tool catalog (33 tools at 0.4.0; 32 at 0.3.0 for rollback), and `workspace_info`. Building 0.4.0 also compiles the Windows command host using the built-in .NET Framework compiler. Commands write separate logs outside the payload. The tunnel API key is removed from the validation environment. No running service is stopped.

Only a successful run creates `validated.json`, bound to the SHA256 manifest of every payload file. A failed check leaves its logs and produces no valid receipt. Use a new release ID to retry; existing release folders are never overwritten. Dependencies and validation scripts are trusted project code and can use the network and filesystem.

Keep the validated release unchanged. Source edits do not automatically rebuild or deploy it. The release probe is local stdio acceptance; it does not claim that ChatGPT can reach the replacement through the tunnel. The broader source/snapshot workflows remain covered by their existing acceptance scripts and integration tests.

## Apply a reviewed release

```powershell
.\scripts\Update-Workbridge.ps1 -Action Apply -OperationId 'next-update' `
  -ReleasePath 'C:\work\workbridge-mcp\.local\releases\next-release'
.\scripts\Update-Workbridge.ps1 -Action Status -OperationId 'next-update'
```

Apply creates a separate ordinary-user scheduled task named `Workbridge Update next-update`. Task Scheduler starts the controller outside the Workbridge launcher's Windows Job Object, so it survives the tunnel/server stopping. The controller is copied into the operation directory before dispatch; it does not execute from the runtime being replaced. A Task Scheduler smoke test verifies survival after terminating its dispatching Job Object owner.

**Shared-service idle race (observed 2026-10-31):** Checking for zero running jobs before Apply is a snapshot, not an admission lock. During a prior updater backup another project's RiftReader2 job started, and the deployed controller later stopped the owner, leaving that job interrupted even though the release completed. Never automatically retry an interrupted job without checking for partial external effects. The exact incident and job ID are preserved in `docs/workbridge-12-agent-roadmap-20261031.md`.

**Quiescence fix staged but not yet deployed (2026-10-31):** The new command owner holds `.local/updater.lock` from immediately before its first job-record publication until the job is visible in occupied capacity. The updater holds the same lock exclusively from preflight through stop, requires a live `CheckIdle` callback, and queries local CLI `diagnostics` immediately before stopping. Busy, retained, closing, incomplete, unavailable or malformed capacity refuses Apply without stopping. The disposable updater suite passed 37/37 cases; two Windows cross-process lock tests passed. Sealed candidate `updater-quiescence-20261031-03` passed all nine release checks with 1,030 compiled-runtime tests passed, zero failed and three skipped. Its manifest SHA-256 is `B5E61D7204E8294376C55EC719AF8A891EC48193A401F9E4810B0CF78F9B23A8`. **The first deployment still needs an exclusive maintenance window:** the current running binary does not yet observe the new lock. An idle snapshot alone is insufficient. Do not stop Workbridge until all command clients agree that no new jobs will be submitted.


**Historical-catalog preflight correction (2026-11-05, source-only):** The live 0.16.4-dev owner has more than 20,000 historical `.local\jobs` entries, so bounded `diagnostics.jobs.inventory` reports `complete=false`, `limitReached=true`, and `scannedEntries=20000` despite a genuinely idle live capacity map. A strict read-only census fallback is now permitted only for this exact size-limit case; it rejects malformed/unexpected entries, links, directories, errors, timeouts, changed counts, nonzero occupied/retained/running jobs, malformed owner identity, or a changed live owner during recheck. It preserves every historical file and refuses the update before any stop when uncertain. This fallback does **not** eliminate the old binary's admission race; a separate exclusive quiet window and Joey's explicit approval for a **Workbridge-only** runtime restart are still required. RIFT and Windows remain untouched. The initial controller fix passed 42 synthetic updater cases; clean release validation and a live deployment remain separate gates.

**Deployment verified (2026-11-05):** Joey approved the exclusive Workbridge-only window. Apply operation `wb001_gui_prep03_apply_20261105a` completed with rollback-capable backup and no controller error; retained journal records the full prepare/stop/install/start/verify sequence. Release `gui-quarantine-20261105-prep03` has digest `01D7C888B9297708B15D2133484C202019E138206D30C20FE295DA6B91225519`, 3,183 files and eleven passed validation gates. Hosted `workspace_info`/`diagnostics` reached the fresh owner (PID 58580, instance `be5f373a-8c98-4877-b5dd-dbea9e5728d5`), 36/36 capacity available, and seven desktop runtime/manifest hashes matched the sealed payload. The RRE hourly automation was paused for the window and then resumed. The old desktop-input quarantine files remain byte-identical and **active**; separate C# DesktopProbe watchdog and GUI producer checks still precede any explicit quarantine-clearance or game-input decision. The runtime historical catalog continues to report the 20,000-entry scan limit as expected; the updater fallback is separate from runtime diagnostics. See `investigations/windows-desktop-automation/reports/wb001-gui-clean-release-preparation-2026-11-05.md` for exact evidence.

The controller first verifies the sealed release and takes an installation-wide exclusive lock. It copies the candidate's runtime into the operation directory, then backs up the current runtime, source, Git metadata, command/profile configuration, and service task XML. SHA256 manifests identify runtime and preserved files. The existing DPAPI credential stays at its original path and is neither decrypted nor copied by the updater. Startup task, tunnel association, profile, workspace root, and state journals remain in place.

The preflight health check must pass before the controller stops the service. It records the compiled runtime's actual MCP version; an edited source `package.json` may already describe the next version. The backup retains those original package bytes, and recovery checks the previous compiled version. Candidate preparation still requires its compiled version to match its package. The controller waits for Task Scheduler to stop, then installs only `dist`, `node_modules`, `package.json`, and `package-lock.json`. Existing targets move into retained `displaced` folders. It checks installed bytes, starts the existing task, checks a fresh loopback health URL, and runs a direct stdio probe against the installed runtime. If tunnel initialization has reported a server version, that version must also match. Tunnel readiness without initialized MCP is reported only as local readiness.

An update failure after stopping begins automatically restores the checksummed previous runtime and verifies its readiness. Preflight failure never stops the working service. Reusing the same operation ID and release returns the recorded terminal result; it does not reinstall. A different release requires a new operation ID. An unresolved earlier journal blocks a new update. A completed operation cannot roll back over a later installed release.

After `completed`, make a fresh ChatGPT-to-Workbridge tool call and check the intended version/content. `hostedVerified` remains false in the local journal because the updater cannot certify an external caller's acceptance. Record hosted evidence separately.

When a release changes tool definitions, check the actual ChatGPT catalog as well as `workspace_info.version`. For WB-005, ChatGPT initially retained the old catalog despite reporting the new server version. In Workbridge's plugin settings, **Refresh tools** loaded the 34-tool catalog, including `command_list` and `command_output.tailChars`; a new Chat turn then passed both checks. This existing platform setup step does not require changing tool permissions. The local batch CLI discovers its owned server directly and does not use that cached hosted catalog. On 2026-10-31 Joey refreshed the `0.16.4-dev` Workbridge plugin in ChatGPT; a fresh turn exposed all 64 tools including eight coordination `agent_*` calls, with direct `agent_list` and `agent_status` checks passing.

The default service task is `Workbridge MCP` and the readiness window is 45 seconds. `-ServiceTaskName` can select another installation's task, but its action must launch the specified installation's background script and use that directory as its working directory. `-ReadinessTimeoutSeconds` accepts 3–120 seconds. The original task and timeout are retained in the operation request for recovery.

## Recover or roll back locally

After a killed controller, interrupted copy, or `recovery_required`, use the same operation ID:

```powershell
.\scripts\Update-Workbridge.ps1 -Action Recover -OperationId 'next-update'
```

Recover restores the original runtime rather than continuing a partial installation. It works when the active package metadata is missing. Repeating recovery after a successful restoration is harmless. If the controller failed before the prepared phase, recovery closes the preflight journal without stopping the service. To undo the latest completed update:

```powershell
.\scripts\Update-Workbridge.ps1 -Action Rollback -OperationId 'next-update'
```

If the normal dispatcher scripts are unavailable, the operation retains its controller:

```powershell
# Run in a separate LOCAL terminal, independently of the Workbridge connection.
# First set request.json's action to Recover; keep its other fields unchanged.
& 'C:\work\workbridge-mcp\.local\update-operations\next-update\controller\Invoke-WorkbridgeUpdate.ps1' `
  -InstallRoot 'C:\work\workbridge-mcp' -OperationId 'next-update'
```

The controller checks the runtime backup before stopping the active service. A missing/corrupt backup or a failed restart records `recovery_required`; the retained backup, displaced files, baseline audit, and Workbridge Status shortcut support local diagnosis. Resolve the recorded error before retrying. The credential's Windows user/computer and the existing startup launcher must still be available. This is runtime recovery, not whole-machine disaster recovery.

## Evidence and retention

Each `.local\update-operations\<id>` retains its request, copied controller, journal with phase timestamps and errors, runtime/source/configuration backup, candidate, displaced files, and probe evidence. Status also reports an early controller error if it failed before creating a deployment journal. No backup, operation, displaced tree, or update task is deleted automatically. This intentionally trades disk space for recovery; review and remove obsolete operations/tasks manually after hosted acceptance and after deciding which previous releases to retain. Never remove an operation needed to recover an unresolved journal.

The repository originally had no author identity or initial commit. Deployment checkpoints preserved that original Git state without staging or committing files. The user subsequently authorized the first source commit; consult Git history for the checkpoint. Commit identity is supplied per invocation without changing Git settings.

WB-004 (0.6.0) adds compiler/source/executable hash verification to the native build. Unchanged builds reuse the verified executable, allowing full package self-validation while its command host is active. Changed native sources require staging a release outside the active runtime; do not rebuild a running executable in place. Generic acceptance evidence is written outside the sealed payload, and existing release receipts remain valid for rollback.
