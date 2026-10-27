# Workbridge-MCP handoff — RIFT update pivot (2026-10-27)

## Owner decisions (highest priority)

1. **Stop and defer all attempts to increase worker/agent counts.** This includes the 25-agent swarm proposal and October 26 four-chat capacity pilot. Neither 25 concurrent agents nor increased hosted concurrency was demonstrated or deployed. Do not restart these experiments or invest in their architecture without a new explicit instruction.
2. **Focus on the RIFT MMO's newly updated game client.** The update's exact installed build, changed files and compatibility effects have not yet been verified in this conversation. Workbridge is the transport for local diagnostics; do not conflate RIFT live/native installation, RiftReader2 VMware laboratories, and the separate RIFT API project.
3. **Queue a deferred Workbridge maintenance review (MNT-001), not a service upgrade.** The active Workbridge service works at the last observed baseline. Preserve it while RIFT investigation proceeds.

The older live-PC/VM roadmap remains reference material, not authorization to activate unfinished GUI tooling or to resume the paused scaling program.

## Verified current/last-known state

| Item | Evidence and interpretation |
| --- | --- |
| Workbridge active service | Connected `workspace_info` on October 27 reported `0.16.3-dev`, instance `1b571711-76ef-43fa-89c0-f2a7440a21ae`, PID `3576`, local CLI enabled. The deployed catalog is 52 tools. This direct call succeeded; it is not a full service audit. |
| Git | `C:\work\workbridge-mcp`, branch `main`, last pre-handoff HEAD `f9955c3a966b998d97de01f2abaea39402a2f878`. Many modified and untracked files predate this handoff; they belong to other workstreams. Never blanket-stage, stash, reset, or delete. |
| Running command jobs | An October 27 bounded `command_list` query for running `workbridge-mcp` jobs found none in its first 300 scanned entries; `complete=false`. This does **not** prove no older or other-project jobs exist. |
| Disk/active mismatch | Prior diagnostic: built/source runtime `0.16.4-dev` versus active/installed `0.16.3-dev`. WB-001 release-update preflight properly refused activation before stopping the service. Do not bypass/restart/force-overwrite. |
| Rollback | Original WB-022 `0.16.3` runtime retained. Prior check verified all 2,808 candidate file hashes; independent disposable private runtime started, returned `0.16.3-dev` and 52 tools, exit 0. This is stronger recovery evidence, but does not certify the exact in-memory active bytes or a completed WB-001 controller rollback rehearsal. |
| VMware guest receiver | October 26 passive V23 receipt identified PID `26412`, supervisor running/healthy, no in-flight request; `responseVerified=false`, guest disarmed. Stale until freshly reconfirmed. Do not launch a duplicate receiver or send guest input based on old evidence. |

## What the #07 test build actually is

`C:\work\workbridge-mcp\.local\releases\pcvm-gui006-20261026-07` is a **sealed GUI-006 desktop/VMware candidate**, not an increased-agent-capacity build.

- Candidate version: **`0.16.4-dev`**, versus deployed `0.16.3-dev`.
- Proposed additional MCP tools (52 → 56): `desktop_windows`, `desktop_inspect`, `desktop_capture_window`, `desktop_capture_vmware_host`.
- Isolated acceptance: **1,023 passed, 0 failed, 3 skipped**; nine release gate checks recorded zero exit.
- Sealed manifest SHA-256: `DD44607FEE488963BC3276764CCD550D6F4F776A734D7F9929169E08898C0240`, 3,150 payload entries.
- Private stdio MCP inspection reported 56 tools; `hostedVerified=false`. **Not deployed.**
- Historical use of five Codex coding workers and agent-coordination regression tests verifies engineering/test workflows; it is **not proof of 25 concurrent model-backed agents or a raised worker capacity**.
- Native Windows JobObject lifetime proof was committed in `e378da9` and `5eec212` but **has not yet been integrated into the production desktop command launcher**. Release promotion remains separate and gated.

For source evidence, read `docs/gui006-desktop-vmware-2026-10-26.md`, `docs/interactive-desktop-vm-roadmap.md` and `docs/pc-vm-automation-agent-queue-20261026.md`.

## Maintenance queue (deferred, in recommended order)

- **MNT-001 / read-only baseline refresh:** Confirm service identity/version, actual ready state, tool catalog, active jobs with a *complete* catalog scan, update journal, installed marker, retained rollback, and loaded-versus-disk version. Inspect logs only as needed; never print credentials.
- **MNT-002 / non-disruptive diagnostics:** Determine if a concrete Workbridge fault affects RIFT local read/file/command operations. If none, keep `0.16.3-dev` in place.
- **MNT-003 / future release engineering:** Isolated WB-001 cutover/rollback-controller fault tests, native supervised command host integration and a new versioned sealed runtime; fresh hosted acceptance is required for any deployment. No production activation is approved by this handoff.
- **MNT-004 / test and worktree hygiene:** Revisit heavy-load child-readiness fixture races and preserve/checkpoint only coherent, reviewed changes without touching unrelated dirty files.
- **Capacity scaling:** Explicitly **on hold**, not part of MNT-001–004 or GUI-006.

No emergency maintenance, production restart, new service deployment, cleanup, or VM input is established as necessary by the checks conducted for this handoff.

## Next RIFT-focused work

1. Identify which client is being examined: recent RIFT API conversations explicitly target the **native local PC installation**, not RIFT-Lab VMware; do not silently switch it to VMware.
2. Read `AGENTS.md` and current project documentation in the chosen RIFT repository, and inspect the current installed client executable/version, patch dates, game/addon directory and available logs using read-only tools.
3. Compare before/after binaries or API behavior only when real reference evidence exists; flag hypotheses separately. Prioritize addon API capability and stability, especially spellbook, range/cast metadata, GCD, and positional data when relevant.
4. Keep live game operations opt-in and target-verified. For any post-update regression, record exact version, error, repro, affected add-on/API and rollback information.
5. Commit narrow, tested RIFT project milestones with durable handoffs. Avoid cross-repository changes unless explicitly required.

## Resume checklist

- Start from `C:\work\workbridge-mcp\AGENTS.md` and `docs/autonomous-investigation-policy.md`; if doing desktop/VM work also read `docs/interactive-desktop-vm-roadmap.md`.
- Recheck live `workspace_info` and Git HEAD/status; do not assume that the October 27 process PIDs remain valid.
- Read this handoff plus `docs/pc-vm-automation-agent-queue-20261026.md`.
- Honor Joey's explicit deferment of agent scaling.
- Answer the user's current RIFT question using its own repository/client evidence. Only resume Workbridge maintenance if the user requests it or a proven transport blocker makes it necessary.

### Copy/paste resumption instruction

> Resume the RIFT MMO update investigation using Workbridge. Read the October 27 Workbridge RIFT-pivot handoff and current RIFT repository instructions first. Agent scaling is paused. Leave the healthy deployed Workbridge 0.16.3-dev service and GUI-006 candidate #07 unchanged. Identify the native RIFT client update and its impact with read-only evidence, then implement and commit small, verified fixes in the appropriate RIFT project only. Keep the deferred Workbridge maintenance queue intact.
