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
| 1 Release cutover | `/root/release_cutover` | `scripts/Update-Workbridge.ps1`, `scripts/Workbridge-Update.ps1`, `test/updater.test.ps1` | Address safe baseline/candidate identity path without weakening validation; synthetic tests only | Assigned |
| 2 Runtime closure | `/root/runtime_bundle` | `scripts/New-WorkbridgeRelease.ps1`, `scripts/stage-desktop-runtime.mjs`, `test/stage-desktop-runtime.test.mjs` | Seal and verify desktop-script dependencies in immutable candidate; no activation | Assigned |
| 3 Desktop action | `/root/desktop_action` | `src/desktop-probe-action-tool.ts`, `test/desktop-probe-action-tool.test.mjs` | Exact disposable target, fresh identity/lease, fail-closed action tests | Assigned |
| 4 VMware recovery | `/root/vmware_recovery` | `scripts/vmware-host-recovery.mjs`, `test/vmware-host-recovery.test.mjs` | Interrupted host-frame intent/receipt reconciliation; no VM input | Assigned |
| 5 Guest receiver | `/root/guest_receiver` | `scripts/Inspect-RiftGuestReceiver.ps1`, `test/inspect-rift-guest-receiver.test.mjs` | Read-only host-versus-guest receiver evidence and bounded explicit unknowns | Assigned |
| 6 Independent review | `/root/independent_review` | None — read-only | Concrete release, desktop/VM security/race/regression review; follow-up code review | Assigned |
| Coordinator | `/root` | This ledger and designated integration paths only | Integration, test receipts, scoped commits, queue assignment, release gating | Active |

Workers read `AGENTS.md`, `docs/autonomous-investigation-policy.md` and `docs/interactive-desktop-vm-roadmap.md`; file modifications require fresh hash checks and unique durable IDs. Root alone performs cross-lane edits/commits after verifying ownership and tests. Jobs use distinct request IDs. Five implementation workers may use Workbridge command slots; coordinator reserves capacity for integration and does not blindly overlap full test gates.

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

## Approval visibility

If ChatGPT presents `Allow ChatGPT to use Workbridge?`, surface it in the main conversation; the owner may need to expand `Previous activity`. Do not bypass or auto-click host approval. These prompts are distinct from Windows UAC.
