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

The controller first verifies the sealed release and takes an installation-wide exclusive lock. It copies the candidate's runtime into the operation directory, then backs up the current runtime, source, Git metadata, command/profile configuration, and service task XML. SHA256 manifests identify runtime and preserved files. The existing DPAPI credential stays at its original path and is neither decrypted nor copied by the updater. Startup task, tunnel association, profile, workspace root, and state journals remain in place.

The preflight health check must pass before the controller stops the service. It records the compiled runtime's actual MCP version; an edited source `package.json` may already describe the next version. The backup retains those original package bytes, and recovery checks the previous compiled version. Candidate preparation still requires its compiled version to match its package. The controller waits for Task Scheduler to stop, then installs only `dist`, `node_modules`, `package.json`, and `package-lock.json`. Existing targets move into retained `displaced` folders. It checks installed bytes, starts the existing task, checks a fresh loopback health URL, and runs a direct stdio probe against the installed runtime. If tunnel initialization has reported a server version, that version must also match. Tunnel readiness without initialized MCP is reported only as local readiness.

An update failure after stopping begins automatically restores the checksummed previous runtime and verifies its readiness. Preflight failure never stops the working service. Reusing the same operation ID and release returns the recorded terminal result; it does not reinstall. A different release requires a new operation ID. An unresolved earlier journal blocks a new update. A completed operation cannot roll back over a later installed release.

After `completed`, make a fresh ChatGPT-to-Workbridge tool call and check the intended version/content. `hostedVerified` remains false in the local journal because the updater cannot certify an external caller's acceptance. Record hosted evidence separately.

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
