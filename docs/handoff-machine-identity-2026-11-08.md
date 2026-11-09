# Workbridge MCP handoff — 2026-11-08, machine identity + VMware labs

## Goal and current state
Prevent ChatGPT/Workbridge from confusing LEGION, AMD-DESKTOP, RIFT-Lab-1, and RIFT-Lab-2. Favor lightweight, fail-closed checks, reuse RR2 controllers, preserve dirty worktrees, and avoid service interruptions. **Code committed, live Workbridge service activation NOT confirmed.**

## Verified
- Physical Windows hosts: LEGION and AMD-DESKTOP, independently verified via hostname.exe.
- Both physical production tunnel launchers require .local/settings.json expectedHostname and reject a mismatch. Both negative tests passed.
- Both servers have a configured-hostname mismatch guard. AMD server also exposes computerName in workspace_info source (not yet confirmed in deployed service).
- AMD VMware vmrun at C:\Program Files\VMware\VMware Workstation\vmrun.exe lists two running guests.
- Lab 1: C:\rift modding\VMs\RIFT-Lab-1\RIFT-Lab.vmx; BIOS UUID 56 4d c7 a3 99 ee e3 57-3d 9d 93 5b 4b f5 d8 56; VMware PID 31864, VNC 5905.
- Lab 2: C:\rift modding\VMs\RIFT-Lab-2\RIFT-Lab.vmx; BIOS UUID 56 4d 48 19 3d e6 d1 b9-b4 e8 4a 94 7e 47 0c c2; VMware PID 32496, VNC 5962.
- AMD scripts/Verify-RiftLabIdentity.ps1 passed both host+VM checks, intentionally reports guestOperationsAllowed=false.
- RR2 managed controllers restored/reused on AMD. Lab 1 required existing Manage-RR2HelperTask.ps1 Register then Start; Lab 2 reused. Both controller status endpoints reported connected/ready, guest armed=false, recoveryRequired=false, guest-reported names RIFT-LAB-1 and RIFT-LAB-2. Both reported responseVerified=false; this is **not** independent guest identity certification.
- AMD RR2 control_host.py authenticates guest hello machineName against configured expectedMachineName and supports an identity operation. Inspect current contracts before attempting to use it.

## Commits
AMD-DESKTOP workbridge-mcp main: 664de94 launcher; a58b6e5 server hostname guard and workspace_info computerName; c725e95 VM inventory; 24cc15a VM preflight; e6980d8 controller observations.
LEGION workbridge-mcp main: dd9cc1c AGENTS preflight; 07d864c server guard; 237d3a2 regression test; a7b0146 format; b2d274f launcher. AMD also had earlier AGENTS commit c831577.
Branches/checkouts are machine-local; do not assume synchronized or pushed.

## Outstanding / next actions
1. Recheck actual hostname on the selected connector at the beginning of the next session.
2. Poll LEGION release job identity-legion-stage-release-1108 and inspect .local/releases/identity-legion-20261108/validated.json; it was still running npm test at last check. Do not claim validated or deploy until confirmed. Earlier full test job identity-legion-full-tests-1108 timed out.
3. Finish focused tests and staged WB-001 updater deployment for both physical hosts, respecting idle jobs, rollback and active connections. AMD command-host.exe was locked by live process, preventing npm run build; do not kill it casually.
4. Extend Verify-RiftLabIdentity.ps1 to obtain an independently authenticated fresh guest identity response from RR2's existing receiver/controller; ensure binding to exact VM instance, expected machineName, and freshness. Do not infer proof from status machineName or responseVerified=false.
5. Integrate this preflight into guest-specific Workbridge/RR2 workflows only after verified. Keep guest actions blocked on missing proof; no RIFT input or VM reset needed for preflight.
6. Consider propagating AMD workspace_info computerName to LEGION once reconciled with current source; keep checks lightweight.
7. Commit only owned files. AMD dirty unrelated: scripts/freebuff-conpty-probe.py, src/schemas.ts, test/bridge.test.mjs. LEGION dirty unrelated: scripts/freebuff-conpty-probe.py and untracked LEGION-COPY-MANIFEST.json.

## Test evidence / caveats
- AMD bridge tests: 9/9 pass.
- Both production launchers rejected deliberately incorrect COMPUTERNAME in isolated negative tests.
- Both lab VMX and BIOS UUID checks passed. VMware guest IP query returned 'password required'; avoid treating that as guest absence.
- RR2 guest identity remains not independently response-verified. Both controllers were disarmed; no game input was sent.
- Do not expose tokens from RR2 artifacts/control-fleet-live/*/host.json in summaries.

## Recommended resume
Read docs/machine-identity.md, scripts/Verify-RiftLabIdentity.ps1, AGENTS.md, and RR2 scripts/control_host.py / control_client.py / ensure_controller.py. Verify host, inspect jobs, complete guest identity proof and deployment. Keep concise progress SITREPs.