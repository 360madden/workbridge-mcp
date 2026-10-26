# PC and VMware automation — coordinated agent queue (2026-10-26)

Coordinator: ChatGPT /root. Six workers active at launch; root owns integration, independent review, exact-path Git commits, release decisions, and queue replenishment. This ledger records assignments, not proof that work is complete.

## Grounded baseline

- Repository: `C:\work\workbridge-mcp`; branch `main`; assignment HEAD `f16c79a9414ff84ae1429d2f07ea6192ad9d8999`.
- Deployed Workbridge: `0.16.3-dev`, 52 tools, six bounded command slots (runtime is healthy).
- GUI-006 candidate: `0.16.4-dev`, 56 tools, private MCP screenshot proven, seven sealed-release gates passed, **not deployed**.
- Previous activation `gui006-activate-20261026-01` stopped safely at preflight: disk/source runtime version 0.16.4 versus loaded 0.16.3. Never bypass this check or retry uncertain activation with a fresh ID.
- Shared Git tree has extensive unrelated modified and untracked user work; no broad staging, stash, reset, delete or overwrite. Versioned source is not the deployed runtime.

## Exclusive ownership and current queue

| Lane | Agent | Exclusive write ownership | Acceptance focus | Initial state |
| --- | --- | --- | --- | --- |
| 1 Release cutover | `/root/release_cutover` | `scripts/Update-Workbridge.ps1`, `scripts/Invoke-WorkbridgeUpdate.ps1`, `test/updater.test.ps1` | Controller disk/live version mismatch guard and synthetic safe recovery; defer `Workbridge-Update.ps1` to another active worker | In progress |
| 2 Runtime closure | `/root/runtime_bundle` | `scripts/New-WorkbridgeRelease.ps1` | Invoke existing isolated runtime-script staging as sealed release gate; defer staging helper/test edits to another active worker | In progress |
| 3 Desktop action | `/root/desktop_action` | `src/desktop-probe-action-tool.ts`, `test/desktop-probe-action-tool.test.mjs` | Exact disposable target, fresh identity/lease, fail-closed action tests | Assigned |
| 4 VMware recovery | `/root/vmware_recovery` | `scripts/vmware-host-recovery.mjs`, `test/vmware-host-recovery.test.mjs`, `scripts/vmware-host-capture.mjs`, `test/vmware-host-capture.test.mjs` | Fail-closed aggregate replay without unleased recapture; verify foreign lock preservation | In progress |
| 5 Desktop process cleanup | `/root/guest_receiver` | `src/desktop-cli-runner.ts`, `test/desktop-cli-runner.test.mjs` | On uncertain grandchild termination emit typed DESKTOP_TREE_UNSETTLED; synthetic timeout/race tests; no actual input | Reassigned, in progress |
| 6 Independent review | `/root/independent_review` | None — read-only | Concrete release, desktop/VM security/race/regression review; follow-up code review | Assigned |
| Coordinator | `/root` | This ledger, `src/desktop-registration.ts`, `test/desktop-registration.test.mjs` | Quarantine GUI lease on unsettled tree, integrate/test/review worker changes, scoped commits and release gating | Active |

Workers read `AGENTS.md`, `docs/autonomous-investigation-policy.md` and `docs/interactive-desktop-vm-roadmap.md`; file modifications require fresh hash checks and unique durable IDs. Root alone performs cross-lane edits/commits after verifying ownership and tests. Jobs use distinct request IDs. The live Workbridge six-slot capacity is shared with separately running Codex CLI jobs; check live command status before starting isolated tests. Do not run `npm run build` in the active checkout: it changes on-disk `dist` while service 0.16.3 remains loaded. Build only into isolated disposable paths.

## Cross-workstream discoveries and collision resolution

- Other active Codex CLI jobs `wb26-followup-codex-11-20261026-01` and `wb26-followup-codex-12-20261026-01` were independently found targeting desktop staging and release baseline logic. The matching two worker lanes above relinquished overlapping files; preserve their ongoing work. Job `wb26-followup-codex-13-20261026-01` is also active on separate Git/recovery work. These jobs are outside this coordinator's direct agent roster.
- Guest receiver lane reused RiftReader2 `control_client.py status` and `verify_guest_recovery.py` with read-only SQLite/identity checks. No duplicate inspector created; guest receiver startup and current live control still need independent evidence.
- Independent review found a desktop runner timeout/grandchild race plus VMware replay-before-lease and foreign-lock unlink gaps. Root added a guarded `DESKTOP_TREE_UNSETTLED` lease quarantine and regression test; runner and VMware workers are closing source-level causes. Code is not deployed; isolated build/test evidence is still required.

## Verified integration checkpoint — October 26, 14:06 UTC

- Root's desktop turn quarantine edit has current source SHA-256 `c35b8be87574ac07011ca8260f53d7859f4181abe77d98aafc85f38051186b2c`; test SHA-256 `1c34789b9441f45b738d2c52544146aa158be05378c31ae7f1ace15e26e48af9`. These existing untracked GUI source/test files are **not** individually committed, because their imports still depend on other uncommitted GUI files. No live runtime changes.
- Isolated TypeScript build: Workbridge job `pcvm-registration-isolated-tsc-20261026-01`, `node node_modules/typescript/bin/tsc --project tsconfig.json --outDir .tools/pcvm-registration-20261026-01/dist`, exit 0. No active `dist/` rewrite.
- Focused copied test: `pcvm-registration-focused-test-20261026-01`, 6/6 pass, exit 0; includes `DESKTOP_TREE_UNSETTLED` quarantine and second-caller refusal. Focused Prettier check `pcvm-registration-format-20261026-01` exited 0. Independent reviewer gave conditional PASS pending actual runner emission.
- External `wb26-followup-codex-11-20261026-01` timed out after 600 seconds, not a completed milestone. Its staging helper/test require read-only artifact audit and focused fresh checks before promotion.

## Coordinator checkpoint — October 26, 15:19 UTC

- GUI source integration: desktop CLI runner classifies uncertain nested/outer child termination as `DESKTOP_TREE_UNSETTLED`; registration quarantines the shared desktop lease. Windows native Job Object subtree settlement remains **required before live input**. Isolated TypeScript build and 14/14 runner, 6/6 registration tests previously passed.
- VMware host capture: aggregate replay now verifies saved intent, inner receipt, PNG signature/dimensions, SHA-256, target identity, and time/state chronology entirely offline. Falsey/malformed journals and orphan images fail closed. Shared lock is preserved after uncertain intent; recovery inspector can hash saved evidence without VM backend calls. Quarantine owner metadata/release reconciliation remain missing and must not be automated by lock age. A source-only replay snapshot-stability guard was added after independent review.
- Combined desktop/VM tests `pcvm-vm-immutable-replay-tests-20261026-01`: 71/71 pass, exit 0. Focused Prettier check `pcvm-vm-immutable-format-check-20261026-01`: exit 0. No live VM actions.
- Five-file staging `scripts/stage-desktop-runtime.mjs` was reused from existing worker; focused suite `pcvm-stage-runtime-root-regression-20261026-01`: 19 pass, 1 skip for Windows symlink privilege, exit 0. Release builder now stages after generic build and before acceptance, verifies source vs dist hashes and rejects unresolved stage artifacts before sealing. PowerShell 5.1 syntax parser `pcvm-release-stage-syntax-20261026-01`: exit 0; full sealed release test still pending.
- WB-001 regression `disk-ahead-of-live-refuses-before-stop` was committed as `400b6cefcf3a2f60eec3a6d401752f11c2307787`; updater suite `pcvm-wb001-disk-ahead-test-20261026-01`: 22/22 pass, exit 0. Additional error-reason and package-hash assertions are being retested. Current live 0.16.3 vs disk 0.16.4 mismatch remains protected; no service update or restart attempted.
- Independent review identified a downstream release-gate validation gap in `Get-WBRelease`: it checks six legacy gate receipts but not `generic`, `desktop-stage`, `desktop-closure` for 0.16.4. This is queued as a version-scoped guard with legacy release compatibility; do not claim complete WB-001 acceptance yet.
- RiftReader2 receiver reused existing tools and discovered V14 config path with matching SHA-256 without reading credentials; current PID/start identity and guest readiness are not yet confirmed. No game input is authorized by that historic receipt alone.

## Promotion gates

1. Independently inspect each owned diff, targeted tests, hashes and all errors/negative cases.
2. Re-read Git HEAD and staging immediately before staging **only exact reviewed paths**. No remote push.
3. Integrate production desktop actions only after reproducible disposable-target locking/focus/identity tests.
4. Resolve 0.16.3 installed-baseline/0.16.4 candidate packaging and WB-001 rollback proof before any live installation. Test current runtime through fresh hosted Workbridge calls after an eventual update.
5. Independently verify guest receiver before any live Rift game input. VMware host pixels are not proof of guest control.
6. Refill completed worker lanes with highest-priority independent tasks, preserving one writer per path.

## Follow-on queue (not started)

- Verify desktop runtime closure from a truly separate installation directory after bundle/cutover fixes.
- Independent staged-update/recovery rehearsal against disposable service instance and old-version rollback seal.
- Synthetic desktop race tests across two simultaneous clients and interrupted intent recovery.
- Fresh VMware host image plus guest receiver telemetry correlation, read-only first.
- Coherent GUI-006 source integration and fresh full release build only after all active workers settle.

## Coordinator checkpoint — October 26, 15:40 UTC

- Workbridge history HEAD after the scoped release closure commit is `796787eb1f84ee53d39c285ca9aeebe6b4707030` (`feat(workbridge): stage and verify desktop runtime in sealed GUI releases`). That commit records five named release/stage/update files; this is **source Git only**, not a service deployment.
- Newly tested source: VMware desktop/capture/recovery replay `71/71` passed, stage helper `19 passed / 1 skipped (Windows symlink privilege)`, updater `30/30` passed, baseline planner fixture `36/36` passed, and PowerShell 5.1 syntax was accepted for the three release/update test scripts. No VM input.
- Isolated GUI-006 release attempt `pcvm-gui006-20261026-02` (job `pcvm-new-sealed-release-builder-20261026-02`) **failed at the tests gate** after dependency installation; exit 1. No validated release receipt, deployment, service stop, or active dist overwrite. Independent test-log triage assigned; once fixed, create a fresh isolated release ID rather than editing a failed sealed candidate.
- Fresh six-worker queue: desktop native Windows Job supervisor and synthetic process-tree proof; VMware immutable lease and quarantine ownership; release test-log diagnosis; read-only WB-022 baseline/rollback qualification; release metadata strict-type regression; guest receiver identity-only probe. Coordinator owns cross-client capture integration, scoped commits, safety gates and queue refill.
- Active owner remains Workbridge `0.16.3-dev` / 52 tools. Disk sources remain ahead at `0.16.4-dev`; WB-001 correctly refuses the mismatch. Do not retry deployment until installed-baseline provenance, supervisor settlement, staged release and rollback are independently proven.

## Validation checkpoint — October 26, sealed candidate and pilot quarantine

- The fresh isolated `pcvm-gui006-20261026-03` release (job `pcvm-third-isolated-gui-release-20261026-01`) passed all reported gates: install, tests, startup, updater, format, generic, desktop-stage and acceptance. The command printed a validated-release path and confirmed no service stop/deployment. It is an isolated sealed source snapshot, **not current deployed code** and not automatic authority for WB-001 activation.
- The sole earlier full-suite failure was `AGENT_COORDINATION_BUSY` in a synthetic parallel assignment test. The test now permits only explicit idempotent replay after that exact busy refusal; production lock ownership rules are unchanged. Focused `test/agent-coordination.test.mjs`: 26/26 passed and Prettier clean. This currently untracked test belongs with future cohesive agent-coordination source integration.
- Coordinator improved the MCP `withDesktopCaptureTurn` capture-window owner stamp, immutable lease and quarantine guard. Isolated TypeScript compilation passed, 7/7 focused registration tests passed, and both files are Prettier clean. The two files remain uncommitted until related GUI-006 imports can be committed together.
- Separate DesktopProbe pilot fix: it previously unconditionally unlinked the shared GUI lock after uncertain post-intent input. It now writes/fsyncs an owner stamp and action intent, retains a modified/uncertain lease, writes linked quarantine metadata and blocks other request IDs. Synthetic `test/desktop-probe-act.test.mjs` passed 16/16, Prettier clean; no live desktop input occurred.
- A new sealed release is required after all currently active worker changes settle. The current installed Workbridge remains `0.16.3-dev` and only a proven rollback baseline plus guarded WB-001 cutover can change it.

## Coordinator checkpoint — October 26, 17:07 UTC

- Source Git HEAD advanced through `36cbba2ba19cbf12b113c68ea9c8aa44b07100a7` (VMware host-turn v1 stamp/quarantine) and `671da1911bc539da0c7f1ffbc9d5005214d9fc9a` (strict GUI metadata validation in both release builder/updater). Scoped updater PowerShell 5.1 suite: **34/34 passed**, including string/Boolean schema and decimal-size rejection; `git diff --check` passed.
- Isolated GUI-006 release `pcvm-gui006-20261026-04` failed its full-tests gate with one timeout-fixture assertion: under whole-suite load, a one-second child timeout produced no saved stdout. Its focused 21/21 retry-save tests passed. The source-only test fixture now allows five seconds for child startup/output; production timeout behavior was not changed.
- Fresh isolated release `pcvm-gui006-20261026-05` passed install, full tests, startup, updater, format, generic acceptance, desktop staging, release acceptance **and desktop closure**. Independent receipt check found all **nine typed exit codes zero**, manifest SHA-256 `3AB2FECF71C37CCC0F6BEB16995641A8E510AF20EDCE314F2EC320A84CF06A07` matches the sealed manifest, 3,147 payload entries, desktop manifest v1/five helpers, private probe 0.16.4-dev/56 tools. `hostedVerified=false`. No deployment/service/VM action.
- WB-022 read-only diagnosis: healthy live 0.16.3-dev equals installed marker but disk build is 0.16.4-dev. Marker/request/journal all agree on `wb022-activate-20261021-01` and release digest `04B5CAAFB9F2E91552FCE1D2A91C02456B7E43073E8C60DC3E217DDE6A7C9A26`; journal completed with no recorded errors. Independently verified the original sealed 0.16.3 release and **all 2,808 retained candidate runtime file hashes**. Isolated rollback startup/52-tool test and actual loaded-byte identity remain unproven; WB-001 Apply stays blocked.
- RiftReader2 historical V14 configuration SHA-256 still matches, but read-only process-identity probe found its prior PID 36776 **absent**. Treat V14 receipt as stale; search for a current receiver and inspect queue only read-only before any restart/status/VM input.
- Six specialist lanes reviewed host Job Object process-tree settlement, missing receiver recovery, lock/quarantine races, rollback provenance, native-runtime staging, and test flakiness. Coordinator owns next implementation: native process-tree supervisor and cross-client synthetic lock tests. Never release GUI lease based only on direct-child exit or lock age; protect the running service.

## Coordinator checkpoint — October 26, 17:35 UTC

- Native Windows process-lifetime prototype committed as `e378da926628d51dd87934974e4a7835ce190f3b`; deterministic synthetic follow-up committed as `5eec2120fbe61c37792b84c9bfca6de02ada8afc`. Isolated C#4 compiler smoke and Node test proved an owned Job sees a grandchild after its direct parent exits, waits for `ActiveProcesses==1`, and terminates its descendant on last-handle closure. Focused test and Prettier checks passed. This helper is **not yet integrated** with the runtime desktop-command launcher.
- Isolated release `pcvm-gui006-20261026-06` failed the full-tests gate with two startup-readiness fixture races during heavy Windows parallel load (CLI child PID marker absent; timeout-tree stdout absent). No seal or deployment. New files' focused native test passed; those failures did not prove a production code defect. Follow-up queue owns explicit readiness-handshake fixtures.
- Fresh isolated `pcvm-gui006-20261026-07` passed install, full tests, startup, updater, format, generic, desktop-stage and acceptance; independent receipt inspection confirmed nine strictly zero checks including desktop-closure. Tests: **1,023 passed, 0 failed, 3 skipped**. Manifest SHA-256 `DD44607FEE488963BC3276764CCD550D6F4F776A734D7F9929169E08898C0240`, 3,150 payload entries, desktop manifest v1/five helpers, private probe 0.16.4-dev/56 tools, `hostedVerified=false`. No production service/desktop/VM actions.
- Native guest-control recovery: V14 PID 36776 is stale, but current **V23** receiver PID 26412 precisely matches its process receipt (image path/startTicks `134374473072221318`), config digest and `vm:rift-lab-1` resource; both configured host ports belong to 26412. Authenticated `control_client.py status` READ-ONLY GET succeeded. Host connected, coordination `ready`, console reservation held with no in-flight operation; guest disarmed, not busy, no recovery requested, but `responseVerified=false`. V23 receipt reports `inJob=false`. VMware PID 38044 and startTicks match saved identity, but Win32 executable path is unavailable, so full VM image verification and fresh guest acknowledgement are **not established**. Do not launch a second receiver or send input.
- Next coordinator-owned tasks: a versioned native desktop command host/TS integration (no unsupervised fallback), schema-v2 release packaging and isolated rollback tests; deterministic child-readiness test fixtures; private WB-022 0.16.3/52-tool rollback startup check; cross-client GUI quarantine stress tests; V23 supervisor/SQLite queue read-only inspection. Keep live Workbridge 0.16.3-dev untouched until independent cutover and hosted acceptance.

## Coordinator checkpoint — October 26, 17:39 UTC

- WB-022 0.16.3 rollback package now passes **independent private startup validation**. Using the exact historically sealed 0.16.3 release and retained WB-022 candidate, root copied and hash-verified all 2,808 runtime files into `C:\work\workbridge-mcp\.tools\wb022-private-20261026-01\payload`, then ran the original `scripts/release-acceptance.mjs --expected-version 0.16.3-dev` in isolated local stdio with separate workspace/state and no production control-plane key. Result: exit 0, package/runtime version 0.16.3-dev, **52 tools**, `hostedVerified=false`; original release manifest SHA-256 remained unchanged. The private copy is retained for review.
- Immediately afterward the read-only live diagnosis still found healthy installed/loaded Workbridge 0.16.3-dev, completed WB-022 journal and disk 0.16.4-dev. The intentional disk/live mismatch remains protected. Do **not** treat an independently working rollback runtime as proof of in-memory byte identity or permission to skip isolated controller failure/cutover tests.

## Approval visibility

If ChatGPT presents `Allow ChatGPT to use Workbridge?`, surface it in the main conversation; the owner may need to expand `Previous activity`. Do not bypass or auto-click host approval. These prompts are distinct from Windows UAC.
