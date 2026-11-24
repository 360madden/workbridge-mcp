# Workbridge-MCP — LEGION transition handoff, November 23, 2026

**Host:** LEGION, independently verified on November 23, 2026 at 23:40 EST (November 24, 04:40 UTC).  
**Repository:** C:\work\workbridge-mcp  
**Canonical upstream:** https://github.com/360madden/workbridge-mcp  
**Starting HEAD:** 93588309d38d97c4acb790b153f0d0e006ba2aeb (main)  
**Purpose:** Transfer the established AMD-DESKTOP research context to LEGION, distinguish source synchronization from installed service state, and preserve the next executable development gates.

## 1. Verified transition status

| Item                                     | Result                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Native hostname preflight                | LEGION; hostname.exe exit 0                                                              |
| Repository HEAD before this handoff      | 9358830                                                                                  |
| Actual GitHub main before this handoff   | 9358830; git ls-remote exit 0                                                            |
| Tracked working tree before this handoff | Clean                                                                                    |
| Source package version                   | 0.16.5-dev                                                                               |
| Running Workbridge owner                 | 0.16.4-dev                                                                               |
| Secure MCP tunnel                        | Available, ready, control plane OK                                                       |
| Command capacity                         | 36 slots; one unrelated RCM job active at inspection                                     |
| Workbridge command launch                | Recovered for the commands observed in this session; prior failure root cause unverified |
| GitHub CLI                               | Installed; gh run list exit 4 because authentication was unavailable                     |
| Current hosted CI conclusion             | Not independently retrieved in this session                                              |
| Live Workbridge upgrade                  | Not performed                                                                            |
| Live RIFT qualification                  | Not performed                                                                            |

The command host previously failed to start hostname.exe with COMMAND_LAUNCH_FAILED. On this session's preflight, request wb-legion-handoff-preflight-20261123 completed with exit 0 and exact stdout LEGION. Git inspection and remote access subsequently succeeded. This establishes recovery of the observed operations, not proof that the historical fault was permanently fixed. If it recurs, collect the exact command-host launch error, current owner/child identity, executable availability and bounded diagnostic output before selecting a recovery action.

The active runtime is one development version behind the source. Synchronizing source through Git does not replace a running Workbridge service. In particular, do not start a second owner or overwrite an in-use native command host executable.

## 2. Git synchronization history and owner decisions

On November 22 the owner executed hostname.exe locally, confirmed LEGION, and attempted a fast-forward pull. Git downloaded the remote objects, but rejected the pull because LEGION's main and GitHub's main had diverged. The owner explicitly directed that GitHub's current copy take priority and LEGION's old local-only commits be discarded from the active branch.

The owner subsequently executed git fetch origin main and git reset --hard origin/main, after backing up the modified FreeBuff script. The supplied terminal transcript confirms the active branch moved to 9358830. This session independently confirmed that same HEAD and remote SHA. No new reset, rebase, merge, force-push, reflog purge or garbage collection was performed.

Previously backed-up script: C:\work\legion-pre-sync-backup-20261122\freebuff-conpty-probe.py (location reported by the owner's command transcript; not re-inspected in this session).

The following existing untracked paths remain on LEGION and must not be accidentally staged or deleted:

- LEGION-COPY-MANIFEST.json
- investigations/windows-desktop-automation/prototypes/flaui-dummy-click/obj/

The AMD-DESKTOP untracked CI draft documented in the November 21 handoff is a different machine's working-tree state; do not assume it is present on LEGION.

## 3. Research milestones carried forward from AMD-DESKTOP

Read the [November 21 AMD-DESKTOP handoff](handoff-workbridge-rift-2026-11-21.md) and the [unified research roadmap](wb-rift-001-unified-research-coordinator-roadmap-20261120.md) for the exact evidence chain and individual source SHA-256 pins.

| Milestone           | Commit  | Historical result on AMD-DESKTOP                                                                                                                                           |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M6d                 | 99efd55 | 26/26 normalized sampled instruction shapes matched                                                                                                                        |
| M6e                 | 6d7176f | Seven selected function pairs matched; 716 decoded instructions per build; one mapped static direct-call relationship                                                      |
| M6f                 | 49d7f3a | 5,007 decoded inbound direct-call instructions per build; 3,145 distinct callers per build; 2,451 unique caller-function pairs; 3,632 corresponding root-call instructions |
| November 21 handoff | 9358830 | Source, tests, documentation and explicit remaining qualification gates published                                                                                          |

M6f retained 135 ambiguous matches, 611 unpaired caller-catalog entries per build and 83 excluded whole-function bodies per build. Matching static code does not establish runtime ownership or initialized game objects. Native runtime locators qualified: zero. Live player/target telemetry was not verified. No live client changes were made in those offline milestones.

The historical AMD-DESKTOP RIFT integration result was 129 passed, zero failed, zero skipped. This is not a fresh LEGION test result. No full build, native scan, game process operation or RIFT suite was performed during the current documentation-only handoff.

## 4. LEGION research portability and dependency gaps

The previous handoff documents exact saved reports and archived executable locations. Read-only file-info checks on LEGION returned ENOENT at all five paths below. That means the inputs are absent at those exact paths, not that no copy exists anywhere on the laptop.

| Documented input path relative to C:\work                                                          | Current LEGION observation                                  |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| workbridge-mcp/.tools/wb-m6d-context-20261121-final.json                                           | Absent at documented path                                   |
| workbridge-mcp/.tools/wb-m6e-function-relations-final-20261121.json                                | Absent at documented path                                   |
| workbridge-mcp/.tools/wb-m6f-inbound-second-20261121.json                                          | Absent at documented path                                   |
| RIFT-Build-Baselines/1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8/rift_x64.exe | Absent at documented path                                   |
| RIFT-Build-Baselines/df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01/rift_x64.exe | Absent at documented path                                   |
| rre/.venv/Scripts/python.exe                                                                       | Exists; Python version and Capstone dependency not verified |

Git deliberately excludes the generated research evidence and game archives. A source pull does not transfer them. The current M6d–M6f regression files also have exact host and artifact prerequisites. Do not call the legacy AMD-DESKTOP evidence tests on LEGION and report their expected machine mismatch as a software regression. Never replace the expected machine name merely to make a historical test pass.

Before reproducing the archived-build experiment, inventory accessible existing assets, verify the exact documented SHA-256 pins, confirm the Python environment and Capstone version, and adapt host-dependent configuration explicitly. Keep portable synthetic tests independent from real archived-image evidence tests. If inputs genuinely are not available on LEGION, maintain a documented reproduction gap rather than manufacturing substitute evidence.

## 5. Prioritized next work

### P0 — LEGION deployment and diagnostic readiness

- Repeat native hostname verification and inspect actual source HEAD, installed owner version, active jobs and tunnel health at the start of the next session.
- Treat the observed recovery of command launches as a successful preflight, not a proven root-cause fix. Use the existing diagnostic tools if command failures recur.
- Inventory the current LEGION prerequisites and isolate the machine-dependent research tests. Avoid duplicating existing RRE/Telemetry tooling.
- Inspect the source-defined WB-001 staged-update procedure and release closure. Prepare a fresh, independently validated release candidate based on current committed source. Keep the installed 0.16.4-dev owner available until a separate maintenance/apply gate is authorized and verified. Do not update an active owner while other repository sessions are using it.
- If necessary, record that GitHub CLI is not authenticated on LEGION. Git transport and GitHub CLI authentication are distinct; a successful git ls-remote is not proof that gh can access Actions. Do not expose or copy authentication tokens.

### P1 — Continue the existing research roadmap when its prerequisites are met

The November 21 handoff retains the M6g research queue. Resume from the established M6f evidence and its documented limitations only after machine-specific inputs and their source pins have been independently verified. Do not claim that historical AMD-DESKTOP findings were newly validated on LEGION. Any later live-runtime experiment requires a separately verified process identity and independent state evidence.

### P2 — Workbridge release and portable test coverage

The earlier validated M5 release predates M6d–M6f; see [the sealed release gate](wb-rift-001-m5-sealed-release-gate-20261120.md). Complete the current official WB-001 validation sequence, including the release manifest, real test results and rollback plan. Source version, candidate version and deployed owner version must remain separate status fields.

## 6. Resumption commands

From PowerShell on the intended Windows machine:

```powershell
Set-Location C:\work\workbridge-mcp
hostname.exe
git status --short --branch
git log -5 --oneline
git ls-remote origin refs/heads/main
```

Use the active Workbridge connector's diagnostic call to obtain the running owner version; package.json is authoritative only for the source version. Do not reuse a previous session's hostname output after changing machines or restarting the service.

## 7. Publication

This handoff records pre-publication observations. The owner requested creation of a handoff and a normal GitHub push. Commit only this documentation file with the expected HEAD and exact file hash. Preserve the unrelated untracked paths. Publish main without force, then independently verify the resulting remote SHA and the local branch state. Report the hosted CI outcome only if actually observed; the unauthenticated LEGION gh CLI currently prevents that verification.

**Related documents:** [AMD-DESKTOP November 21 handoff](handoff-workbridge-rift-2026-11-21.md) · [autonomous investigation policy](autonomous-investigation-policy.md) · [desktop and VM roadmap](interactive-desktop-vm-roadmap.md) · [M6f evidence](wb-rift-001-m6f-inbound-callgraph-20261121.md).
