# Autonomous investigation, blocker recovery, and checkpoint policy

Effective: 2026-10-24. Owner instruction: Joey asked Workbridge agents to maximize independent problem-solving, deeply investigate blockers, continue useful work without waiting for routine guidance, and commit successful milestones regularly. This is a durable project operating policy, not proof that any particular machine operation has succeeded.

## Standing operating posture

1. **Own the investigation.** A failed command, missing tool, unresponsive receiver, unsupported API or unexpected password prompt starts diagnosis; it does not immediately become a request for Joey to intervene. Distinguish evidence from assumptions.
2. **Use the authority already granted.** Continue within the Workbridge/Rift project scope: read-only inspection, code changes, isolated tools, tests, validated helper lifecycle, recoverable local artifacts, narrow Git commits, and documented rollout gates. Do not repeatedly request authorization for routine project actions already delegated.
3. **Respect actual boundaries.** Do not invent, retrieve, expose, repurpose or brute-force credentials; do not bypass access controls or protected workflows. Stop a blocked path when it genuinely needs the owner's secret or a protected approval, but investigate other legitimately available integrations independently. User statements of broad approval do not turn unknown credentials into known credentials.
4. **Preserve operating state.** Do not interrupt a live Rift VM, guest game, shared input channel, Workbridge owner, live service, or concurrent workspace without target-specific checks. Use existing recovery/rollback arrangements. Keep uncertain actions journaled and never blindly resend them.
5. **Be candid.** Report verified results, unresolved hypotheses, and failed attempts separately. A running VM is not proof of a logged-in Windows session, working guest receiver, or screenshot. A tool reporting success is not proof of the target state.

## Mandatory blocker playbook

For every blocker, follow this sequence and record the results in the active roadmap:

1. **Define the failing layer.** Identify host OS/session, target process/window, VMware API/GUI/encryption, guest Windows logon, guest receiver, network, Workbridge MCP, or test harness. Reproduce with the same guarded request only when it is read-only or idempotently safe.
2. **Capture bounded evidence.** Exact command/tool, version, operation ID, exit code, error category, target identity, time, current state, and last independently validated milestone. Do not print tokens, decrypted settings, process command-line passwords, clipboard content or raw private windows.
3. **Form competing hypotheses.** Enumerate at least two plausible explanations, their differentiating tests, and what would falsify them. Consult existing C:\work tools, repository notes and maintained vendor documentation first; reuse a verified component before coding a substitute.
4. **Probe without side effects first.** Inspect running processes, UIA/VMX feature names (not secret values), available API verbs, socket reachability, known receivers, logs and health indicators. Use synthetic windows or isolated test VM artifacts for input experiments.
5. **Try independent legitimate paths.** Prefer bounded alternatives that use already-authorized access. Do not equate rejection by one adapter with rejection by every adapter; also do not use an alternate adapter to evade a genuine permission requirement.
6. **Prototype and verify.** Implement a narrow adapter with explicit target identity, leases, cancellation/timeouts, durable request IDs, bounded outputs, postcondition evidence and tests of failures. First use a disposable target. Treat anomalous metadata as an investigation lead, not an invitation to drop identity checks.
7. **Commit a successful slice.** Run relevant tests/formatting, inspect diffs, verify exact file hashes and current HEAD, commit only the owned files, and update the roadmap with evidence and next gate. Never blanket-stage a dirty tree or silently change another workstream.
8. **Escalate only the irreducible dependency.** Ask Joey one precise question only when the remaining next action truly requires a secret, physical presence, a material choice, or an approval that tools cannot obtain normally. Report useful parallel progress and the exact unblock procedure.

## Priority matrix for persistent blockages

| Failure category | Independent responses | Stop condition |
| --- | --- | --- |
| Tool unavailable/incompatible | Inspect installed versions, docs and existing tools; pin a known compatible backend; verify with synthetic tests | Only unusable backends remain |
| Transient transport/process failure | Check service identity, job status, journals and host session; bounded restart-safe retry with same operation ID | Repeated attempt is unsafe or would duplicate an uncertain action |
| GUI focus/window problem | Re-enumerate HWND/PID, foreground, desktop lock and button geometry; compare UIA, screenshot and Win32 ancestry | Correct target cannot be established |
| VM display unavailable | Compare Workstation GUI capture, VMware-supported APIs, validated guest-side capabilities and existing receiver; keep VM state unchanged until a capture path is proved | Every legitimate candidate is blocked or would disturb live guest |
| Authentication error | Distinguish guest OS sign-in from encrypted VM/VMware API authentication; inspect non-secret metadata and vendor flags | Only a credential-owner action can authorize access |
| Dirty/uncommitted repository | Scope changes, preserve unrelated files, maintain local recovery evidence, small verified commits | Safe snapshot/commit boundaries cannot be determined |

## VMware-specific correction (2026-10-24)

An earlier `vmrun -T ws captureScreen` failure said `A password is required for this operation`. It was incorrect to infer from this that the running Rift guest needed a Windows login. A read-only inspection of `C:\rift modding\VMs\RIFT-Lab\RIFT-Lab.vmx` confirmed the *presence of property names* `encryption.data`, `encryption.keySafe`, and `vtpm.present`, without reading their values. VMware documents the encrypted-VM password flag `-vp` separately from guest-OS credentials `-gu/-gp`. Guest autologin, VMware UI's unlocked state, and separate `vmrun` authorization must be investigated independently.

Do not put a VM password on a command line, in the repository or in diagnostics. Continue investigating authorized host-window capture and existing guest receiver/display capabilities; report concrete image evidence only after verifying a real guest frame. Do not alter VM encryption, virtual TPM, disks or snapshots to make a capture command work.

## Autonomy, test and commit rhythm

- Work from the current roadmap; if none exists, establish a short numbered one with measurable acceptance and rollback.
- Seek the next **verified milestone**, not an arbitrary duration of apparent activity. When one path stalls, switch to another useful independent lane and return with new evidence.
- One process owns live desktop/VM input at a time. Other work may proceed read-only or on isolated files; coordinate via explicit leases or task ownership.
- Record each result with version/build/session identity. Prefer independent observations (native event, image hash, exit code, process start identity) over the initiating tool's assertion.
- Commit after each narrow validated milestone. Check Git status and HEAD before staging; stage exact paths only. Record commit hash. Local commits are not remote backups.
- Existing unrelated modified/untracked files remain the owner's work. Preserve them; audit and checkpoint them as a separate planned milestone rather than bulk-staging or stashing blindly.
- If a tool call times out, check the saved operation ID, job status, resulting file hashes and journal first; do not issue a new operation ID for an uncertain write or input.
- Before stopping, publish a precise status: completed gates, tests, commits, deployment state, independent paths explored, blockers actually needing Joey, and the next executable step.

## Limits of standing approval

The user has granted broad initiative for this project, including routine development and debugging. This policy does **not** authorize irreversible deletion of unrelated data, surprise VM resets, credential extraction, changing security settings to bypass authentication, remote publication beyond the established project workflow, or unverified interaction with the live Rift world. Seek confirmation only for material decisions or genuinely new access. While waiting, advance other project-safe work.

Related source of truth: `docs/interactive-desktop-vm-roadmap.md`. As of November 5, 2026, the installed Workbridge owner is **0.16.4-dev**, verified by live diagnostics and physical-RIFT read-only doctor; the earlier 0.16.3-dev owner note is historical. Use WB-001 staged release and rollback for any future service deployment.
