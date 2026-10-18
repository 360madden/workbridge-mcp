# Pending Workbridge Upgrade Ideas

This document collects **proposed** upgrades for future consideration. Entries are ideas, not approval to implement or deploy them. Add further proposals as numbered entries.

_Last updated: 2026-10-18_

## Joint implementation plan — WB-001, WB-002, WB-003

**Scope:** WB-001 and WB-002 were authorized, implemented, and activated with fresh hosted acceptance. WB-002 was activated at 0.4.0; current 0.5.0 adds both workspace roots with the same 33 tools. WB-003 remains proposed. This document alone does not authorize new scope.

**Recommended sequence (with explicit go/no-go checkpoints):**

1. **Baseline / prerequisites:** Verify current Workbridge 0.3.0 health and configured tests; inventory running version, startup task, and protected runtime configuration. Preserve the current source/worktree and establish a reviewed, known-good recovery baseline. The original baseline had no initial Git commit and contained staged, unstaged, and untracked files; do not assume an automated full-stage commit is safe.
2. **WB-001 — Resilient update path:** Establish backups, independent installer/restart supervision, health checks, and automatic rollback first. Exercise intentionally failed updates on an isolated test installation before using the production tunnel.
3. **WB-002 — Terminal execution:** Extend Workbridge's existing bounded jobs to accept useful developer commands and parameters while preserving C:\work boundaries, observable exit codes, cancellation, and safe operation IDs. Test on a disposable repository first.
4. **WB-003 — Git / GitHub CLI:** Confirm local Git and `gh` availability, check authentication state, then integrate CLI commands through WB-002 (or temporary fixed profiles). Use disposable local/remote test repositories for write operations; do not publish or modify real remotes without the user's specific approval.
5. **Final acceptance:** Run the existing test suites, demonstrate rollback, exercise the new command and Git workflows, restart through the independent updater, and verify a fresh browser-ChatGPT call to the live Workbridge server.

**Cross-cutting rules:** Preserve RiftReader and unrelated projects; don't alter user Git staging without explicit review; don't expose tunnel/GitHub credentials; distinguish a local CLI success from successful hosted access; update documentation and tests alongside functionality. No timeline or detailed architecture is committed at this stage.

## WB-001 — Reliable backup, self-update, and failed-update recovery

**Status:** Implemented and activated; fresh hosted tool verification passed\
**Priority:** High\
**Implementation:** Staged release validation, independent Task Scheduler controller, runtime/source/configuration backups, checksummed runtime installation, automatic rollback, operation journals, and local recovery. See [update workflow](updates.md). The original activation preserved file-level Git state without changing staging; the user subsequently authorized the first source commit.

**Activation evidence:** Operation `wb001-first` completed using `.local/releases/wb001-ready`. All 2,113 installed runtime files match the sealed manifest; a fresh connected `workspace_info` call returned root `C:\work` and version `0.3.0`. Local automation deliberately leaves its journal's `hostedVerified` false; the external caller's evidence is stored separately at `.local/update-operations/wb001-first/hosted-acceptance.json`.

### Problem

Workbridge can already read and edit its own source, build, run tests, and inspect changes. However, an update that stops or breaks the running Workbridge/tunnel process can interrupt the same ChatGPT connection performing the work. A passing build alone does not prove that the replacement service will start, reconnect, and answer tool calls. The Workbridge repository also has no initial Git commit as of this entry, so a current, known-good source baseline needs to be established.

### Desired result

A repeatable update process that preserves a verified working version, installs a validated new version, and **automatically restores the previous working version if installation or startup fails**. Deployment and rollback must be controlled by a process that does not depend on the Workbridge server being updated.

### Proposed requirements

1. **Establish a known-good baseline.** Record the current version and relevant source/build state, then establish a Git checkpoint without losing or silently changing staged, unstaged, or untracked work. Do not assume a Git commit alone backs up the running installation.
2. **Back up before deployment.** Save the last-known-good compiled runtime, relevant source or release package, and the installation/startup configuration needed for recovery. Include a manifest with versions, timestamps, and checksums. Preserve the existing tunnel association and Windows-protected credential; never print or expose the decrypted key.
3. **Stage and validate the update.** Build the candidate separately from the active runtime. Run applicable tests, formatting checks, startup checks, and acceptance checks. If any required check fails, do not deploy.
4. **Use independent deployment control.** A local helper or supervisor outside the Workbridge server performs the stop, installation, restart, verification, and rollback steps. It must survive the Workbridge/tunnel connection dropping. Reuse the existing Windows Scheduled Task and restart protections where appropriate.
5. **Verify the replacement.** Confirm the intended version is running, the local server starts, and the tunnel becomes ready. Make an actual ChatGPT-to-Workbridge tool call after reconnection before declaring end-to-end hosted verification complete; local readiness alone is not enough.
6. **Rollback on failure.** If the updated service fails startup or required local health checks, restore the last-known-good runtime and restart it. Provide a clear manual recovery path if automated rollback also fails.
7. **Make outcomes auditable and repeatable.** Record each phase and its result, prevent overlapping updates, avoid applying the same update twice, and retain enough backup history for recovery. Define backup-retention and cleanup behavior without silently deleting project data.

### Implementation plan

- **Discovery:** Audit the current Scheduled Task, launcher, runtime paths, existing `Restart-Workbridge.ps1`, and recovery artifacts. Decide what constitutes the active release and which configuration must survive upgrades.
- **Baseline & staging:** Capture a restorable last-known-good package with checksums; use a separate candidate build and run existing build, test, format, startup, and acceptance checks.
- **Independent deployment:** Build a local updater/supervisor whose lifetime does not depend on Workbridge's server or the tunnel. It records each phase, stops/restarts the existing task in order, and independently verifies the new service.
- **Failure recovery:** On failed startup/readiness or interrupted installation, automatically restore the previous runtime and test recovery. Retain a locally executable manual repair route.
- **End-to-end check:** After successful local deployment, reconnect from ChatGPT and verify the intended version with a real tool invocation. Hosted verification is distinct from the updater's automatic local readiness gate.

### Acceptance criteria

- A normal update succeeds and reports the new version with successful post-restart tool access.
- A failed build/test never replaces the running version.
- A deliberately broken startup or failed readiness check triggers rollback to the verified prior version.
- An interrupted or repeated deployment can be diagnosed and safely resumed or rolled back.
- Existing tunnel credentials, startup settings, unrelated Git changes, and project files remain intact.
- If the server is unreachable from ChatGPT, recovery is still possible locally via an independent helper and the Workbridge Status shortcut.

### Design notes / boundaries

- Prefer incremental changes to the existing TypeScript server, Windows Scheduled Task, restart script, and validation commands rather than redesigning Workbridge.
- Keep ordinary file edits separate from **deployment**: changing source should not automatically restart or replace a working service.
- Do not add unrestricted remote shell access as a requirement for self-updates.
- Choose the exact update-supervisor, release-storage, and rollback implementation when this idea is approved for engineering.

---

## WB-002 — Practical terminal execution from ChatGPT

**Status:** Implemented and activated; fresh hosted terminal acceptance passed\
**Priority:** Very high\
**Implementation:** Version 0.4.0 adds `terminal_run`, dynamic executable/arguments/cwd, bounded jobs, separate stdout/stderr, literal Windows argument handling, npm/npx CLI resolution, and descendant cleanup after cancellation, timeout, root exit, or server death. Fixed profiles remain supported. No new package dependencies. See [coding workflow](coding-workflow.md).\
**Dependency:** WB-001 completed; activation used its independent controller and retained 0.3.0 recovery baseline

**Activation evidence:** Operation `wb002-first` installed sealed release `.local/releases/wb002-ready`, manifest SHA256 `2FDEE7B5E8094C436C41CA8A07BC58AABE44541BD7F7420F2F6985AEB6F57675`. ChatGPT refreshed to 33 tools and ran npm failure/fix/pass acceptance with separate streams and completed-job replay. External evidence: `.local/update-operations/wb002-first/hosted-acceptance.json`. See [validation evidence](validation.md).

### Problem and goal

Before WB-002, Workbridge ran only operator-configured command IDs with fixed arguments. ChatGPT could not directly choose a typical PowerShell, Git, Python, Node/npm, or .NET development command and its parameters during a coding session. WB-002 adds practical general-purpose command execution using the existing job controls.

### Proposed requirements

1. **Invoke developer tools dynamically.** Support commands with explicit executable, argument list, and working directory, primarily under `C:\work`. Typical targets include PowerShell, Python, Node.js/npm, Git, `dotnet`, and `gh` when installed. Correctly handle Windows paths and quoting.
2. **Keep execution observable.** Reuse or extend existing job IDs, bounded runtime and output, stdout/stderr reporting, exit codes, job polling, cancellation, and process-tree cleanup. A command that starts is not a command that passed.
3. **Support coding workflows.** Permit command sequences required for installing dependencies, building, testing, diagnostics, source generation, and CLI-based GitHub operations; distinguish noninteractive commands from those requiring interactive prompts.
4. **Protect current work and the service.** Validate working directories inside `C:\work`; explain that command execution uses the Windows user rights and is not a filesystem sandbox, avoid exposing secrets, identify working directories explicitly, and never silently delete files/reset repositories. Require a deliberate decision for destructive/system-changing operations. Avoid letting server-owned commands serve as the only way to restart their own server; use WB-001 for deployment.
5. **Stay minimal.** Build on the existing command/job infrastructure where possible. Keep current predefined command profiles working; avoid a heavyweight terminal UI or unnecessary new dependencies.

### Implementation plan

- **Survey:** Review `src/jobs.ts`, `src/schemas.ts`, `src/server.ts`, existing command configuration, and current tests; identify what can be reused.
- **Initial capability:** Add a bounded noninteractive command interface with executable/arguments/cwd, result tracking, and clear failure diagnostics. Determine needed controls before allowing arbitrary PowerShell scripts or multi-command sessions.
- **Validation:** Test PowerShell, Python, `dotnet`, Git, and Node commands that exist locally; handle missing executables gracefully. Test Unicode/space-containing paths, nonzero exits, long output, timeouts, cancellations, and interrupted connections.
- **Rollout:** Exercise the interface only in a disposable test project first. Run regression suites and release through WB-001's independently recoverable process.

### Acceptance criteria

- ChatGPT can run a practical local development command in a selected project without creating a new fixed command profile each time.
- Execution reports its true exit code, bounded output, and an unambiguous error on failure.
- Cancellation/timeouts clean up child processes; a server restart does not falsely claim an interrupted command succeeded.
- Existing configured jobs, repository restrictions, credentials, and unrelated files remain unaffected.

---

## WB-003 — Git and GitHub CLI integration (reuse existing tools)

**Status:** Proposed\
**Priority:** High\
**Implementation:** Not started\
**Dependency:** General command execution is available through WB-002 at 0.4.0; GitHub authentication remains a separate prerequisite

### Goal

Let ChatGPT manage local Git development and GitHub workflows through the existing **Git** executable and official **GitHub CLI** (`gh`). Reuse maintained tools rather than implementing a custom GitHub API client or duplicating Git functionality in Workbridge.

### Proposed requirements

1. **Detect the installed tools first.** Check Git and `gh` versions and availability before suggesting installation. Check GitHub CLI authentication status without exposing tokens. If authentication is needed, keep sign-in and authorization under the user's control.
2. **Invoke existing CLIs.** Use `terminal_run` (available through WB-002 at 0.4.0) to run `git` and `gh` with the intended repository as the working directory. Fixed profiles remain available for reusable commands.
3. **Support typical workflows.** Branching, fetch/pull/push, selected-file commits, repository creation, pull requests, issues, releases, and GitHub Actions status should use the relevant CLI—not a new in-house implementation.
4. **Preserve user work.** Inspect status and diffs, handle dirty worktrees and conflicts deliberately, avoid broad staging by default, and never silently reset, force-push, delete branches, or overwrite unrelated changes. Distinguish local commits from publishing to a remote.
5. **Handle errors clearly.** Surface command output, exit codes, missing installation, authentication failures, remote permissions, and merge conflicts in actionable terms; do not report success until the CLI confirms it.
6. **Keep the interface maintainable.** Favor thin execution/orchestration and existing Workbridge file/Git inspection tools over new GitHub-specific APIs or substantial custom Git logic.

### Implementation plan — verify, authenticate, integrate

1. **Verify installed tools:** Local checks on October 17 confirmed Git 2.55.0.windows.3 and GitHub CLI 2.96.0 on PATH. Neither needs reinstalling. These local checks do not establish Workbridge command integration.
2. **Check GitHub authentication:** The local `gh auth status` check reported no authenticated GitHub hosts. The user must complete `gh auth login` interactively; don't embed secrets in scripts or logs.
3. **Integrate with WB-002:** Use `terminal_run` to invoke Git and `gh` from an explicitly selected repository; retain fixed profiles for useful repeatable operations.
4. **Test read-only behavior first:** Run local `git status`, repository discovery, and read-only `gh` queries, confirming clear diagnostics for missing auth or permissions.
5. **Test write behavior on disposable repositories:** Create/switch a branch, make a selective commit, and—with specific authorization for remote changes—push and create a GitHub pull request. Verify remote results before reporting success.
6. **Document daily workflows:** Capture practical command examples, prerequisites, safe defaults, and troubleshooting. Retain Workbridge's existing Git tool API for its strengths.

### Acceptance criteria

- Workbridge accurately detects installed Git/`gh` tools and reports when sign-in is required.
- A test repository can be inspected and given a new branch without disturbing existing changes.
- GitHub repository and pull-request operations work through `gh` when the user is authenticated and authorizes the relevant actions.
- Failure cases return useful diagnostics without exposing credentials or corrupting local work.
- Existing Workbridge Git inspection and selective-commit features continue to function.

### Design notes

- **Do not build a custom GitHub management system.** Rely on official Git and GitHub CLI, which can evolve independently of Workbridge.
- This replaces the earlier proposed #3, "Complete Git repository management." It does **not** remove Workbridge's existing Git read/commit capabilities.
- WB-002 is documented above and is the preferred execution foundation for this integration.

---
