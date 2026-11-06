# Admission-only desktop-turn orphan: source-only recovery decision — 2026-11-06 UTC

**Status: RED / HOLD for any real archival, release, GUI action, or Workbridge deployment.** This is an investigation design and no-op-only test plan. No current desktop locks, Windows tasks, host processes, RIFT/VM windows, services, or production src/dist files were modified or exercised.

## Exact state and why the paired-orphan helper is insufficient

An **admission-only orphan** means the canonical desktop-turn-admission.lock exists, desktop-input-turn.lock is definitively absent, and no matching desktop-turn-quarantine-*.json sidecar exists. The pair-only inspector committed in f542678 requires BOTH names and correctly rejects this state.

The admission name is the first cross-producer veto. The older GUI guard is a second veto acquired only later. For paired orphans, the old GUI guard can remain continuously present while the orphan admission is moved and maintenance races CREATE_NEW. **For admission-only orphans the old guard does not exist.** Moving/deleting the admission before replacing it produces a gap in which a competing, otherwise compliant GUI producer can immediately acquire admission, create a GUI turn and act. A clean task/process census immediately before the move is a snapshot, not a lock on future launches.

**Immediate rule:** No force unlock, stale-timeout release, PID-absence-based cleanup, invented sidecar, replacement dummy GUI guard, broad script archive, or implicit “safe because producer not running.” Do not invoke the paired-orphan recovery tool with the GUI-guard requirement relaxed.

## Source-proven distinct ways to reach admission-only

| Cause / crash interval | Source evidence | What it does *not* prove |
| --- | --- | --- |
| A1 — .NET watchdog creates admission, then dies **before** GUI CREATE_NEW/stamp | DesktopTurnLease.cs 63–103: admission acquired before sidecar veto and GUI CreateFile. A normal pre-GUI exception tries admission.Release(), but abrupt death or uncertain write may leave its name. | No game/UI action was dispatched by this invocation, **if** exact source/child ancestry can be proven; the file by itself does not establish that. |
| A2 — .NET watchdog settles child, deletes GUI guard, then dies **before** admission Release | DesktopTurnLease.cs Complete(true) 156–198: handle disposition, guard close/absence check, then admission release. Program.cs 290–324 records final after Complete. | An absent final journal can coexist with an already-dispatched action, and does not certify child/Job settlement. Native disposition BOOLEAN ABI still needs review. |
| A3 — Node producer acquires admission, crashes **before** old GUI guard creation | scripts/desktop-turn-admission.mjs 53–96 creates wx admission and closes creation handle; src/desktop-registration.ts 36–79, vmware-host-capture.mjs, desktop-probe-act.mjs, physical-RIFT, ChatInput, FlaUI dummy and RIFT retry wrappers acquire admission first. | Mode producer and a PID-only stamp do not identify exact process start/session or prove nothing else launched. |
| A4 — Node producer releases old GUI guard, crashes **before** admission finally-release | scripts/desktop-turn-admission.mjs 150–159 wraps action in finally-release; src/desktop-registration.ts 152–176 and other guarded writers release GUI guard by identity-check then pathname unlink. | Old action may have completed, failed, or become unknown. Node pathname-release also has a separate name-swap TOCTOU concern. |
| A5 — operator/maintenance gate created, then operator dies before completion | scripts/Archive-DesktopQuarantine.ps1 303–351 and Archive-StaleDesktopLock.ps1 123–131 acquire maintenance admission; shared helper supports mode maintenance at 99–104. | A maintenance-mode stamp is **not** a watchdog producer orphan; use a separate maintenance incident protocol. |
| A6 — guard was removed independently after an uncertain GUI operation | Not a normal supported two-lock cleanup sequence; classify as tampering/foreign reconciliation or a changed-pathname race until proven otherwise. | No license to fabricate the missing sidecar or clear admission. |

The admission schema v1 stores mode, producer, requestId, admissionId, owner.pid and acquiredUtc. **It omits owner start-ticks, session, SID, child PIDs, GUI target and native original FILE_ID.** Cross-reference exact durable journal/protocol evidence and independent OS lifecycle records; neither PID nor timestamp alone prevents PID-reuse ambiguity. A missing journal/child receipt is unknown outcome, not a no-input certificate.

## Inventory of known permitted GUI paths (source snapshot, not universal runtime proof)

| Admission participant / entrypoint | Source closure and role | Coverage decision |
| --- | --- | --- |
| MCP desktop_capture_window | src/desktop-registration.ts withDesktopAdmission before owned GUI turn; child desktop-capture.mjs authenticates parent | Source GREEN, deployed six-file desktop closure previously hash-audited |
| MCP desktop_capture_vmware_host | scripts/vmware-host-capture.mjs and src/desktop-vmware-tool.ts; may restore VMware **host** window | Source GREEN; guest controls are separate |
| Disposable DesktopProbe invoke | scripts/desktop-probe-act.mjs withDesktopAdmission before GUI guard/input | Source GREEN; action not a production-general input permission |
| DesktopProbeWatchdog .NET | native DesktopAdmissionLease.Acquire before DesktopTurnLease GUI creation | Source GREEN; published binary/source parity needs fresh check |
| Physical RIFT reload/focus and candidate stage | scripts/physical-rift-reloadui.mjs, physical-rift-candidates.mjs | Source GREEN, direct scripts require fresh SHA and explicit one-shot authority |
| ChatInputProbe disposable | scripts/chat-input-disposable-pilot.mjs | Source GREEN, may itself retain an uncertain old GUI guard |
| FlaUI disposable dummy click prototype | investigations/.../flaui-dummy-click/run-dummy-once.mjs | Source GREEN, **outside** sealed six-file production closure |
| RIFT retry offline contract/journal | investigations/.../rift-retry-sender/run-retry-once.mjs | Source GREEN, currently direct/prototype; production/guest input **not** inferred |
| Archive-DesktopQuarantine / Archive-StaleDesktopLock | scripts PowerShell: maintenance admission | Correct maintenance role only, not a GUI producer |
| Read-only WinApp/Sbroenne inspectors and parent-linked screenshot child | Inspectors need no input turn; screenshot child authenticates existing parent | Not an independent GUI input producer in audited read-only mode |
| Direct WinApp CLI / FlaUI / Sbroenne tools, low-level captureWindow or runWinapp imports, Workbridge terminal_run, ad-hoc PowerShell or Task Scheduler helper | May bypass both locks if not routed through a controlled adapter | **RED: not universally constrained or inventoried.** A process-name grep or one zero-candidate census cannot close this gap |

The November 5 producer audit was a **single** bounded snapshot of 409 processes and 238 tasks, not all future/process-history proof. Task Scheduler helper management can launch arbitrary configured executable actions; outside web/CLI clients may act without Workbridge leases. Free-running non-GUI Workbridge tasks may continue, but admission-only release requires an explicit **GUI-producer-wide maintenance offline guarantee** that the present codebase does not provide.

## Strict read-only forensic classification (no released/eligible result)

Operator-supplied, immutable per-incident requirements:

1. Canonical exact Workbridge evidence parent; do not auto-discover or mutate a lock path. Require local same-volume NTFS, ordinary non-reparse complete ancestor chain, bounded single-link non-delete-pending files; reject missing or ambiguous paths and access denied. Reject any desktop-input-turn.lock, sidecar, extra admission alias, or unknown producer shape. Native GetFileAttributes missing-name proof must distinguish ERROR_FILE_NOT_FOUND from access error; recheck after identity census.
2. Native held admission handle must establish volume serial+128-bit FILE_ID, exact bytes/SHA256/size (<=4KiB), schemaVersion1, mode producer vs maintenance, admissionId UUID, owner.pid, requestId and producer. Pin all original evidence; if FileId/hash changes or opens conflict, return UNKNOWN.
3. Require independent incident provenance: exact source/build and deployed runtime hashes, one durable request/intent journal **created before admission** with externally corroborated PID/start/session/SID, known child/Job membership and settlement receipts, no unknown input dispatch, no PID reuse. Without this, mark priorActionOutcome=unknown_outcome and historicalTreeSettled=unverified; no “never ran” inference.
4. Twice-sample bounded Windows processes/parents/start times, current native Job/task state, enabled Task Scheduler actions, Workbridge active controllers/jobs and all known provider backends. Empty current inventory is **not** proof of complete external producer freeze or historical descendants.
5. Output must remain: classifiedShape=admission_only; readyForManualReview=true **only if exact evidence is internally consistent**; releaseEligible=false; executeEnabled=false; archiveCreated=false; newActionPerformed=false; producerFreezeProven=false; priorActionOutcome=unknown_outcome. On any missing/foreign/partial identity, return blocked or unknown_outcome, not ready.

No age expiration, operator-supplied PID alone, “read-only WinApp sees no windows,” or task count alone can grant recovery.

## Recovery architecture alternatives — designs only

| Option | Operational argument | Current verdict |
| --- | --- | --- |
| R0 — retain admission, read-only classify and document | Preserves current global veto and daily non-GUI Workbridge operations; no risk of admitting a new GUI producer during cleanup. | **GREEN for source-only/no-op testing; only current deliverable.** |
| R1 — full GUI-producer maintenance offline window, then exact native archive | Under **separately authorized and independently enforced** shutdown/freeze of all GUI producers, tasks, external CLI/agent sessions and direct input entrypoints, pin original FileId/bytes; stage durable byte-exact backups, transfer admission with no-replace native handle and owned maintenance CREATE_NEW, verify new gate before resuming any producer. Any competing process/unknown task stops operation. | **RED for current deployment.** No globally complete freeze primitive or durable cross-provider owner settlement proof today. |
| R2 — future atomic old-admission→new-maintenance handoff | Research whether a Windows NTFS held-handle file rename/replace strategy can preserve **continuous admission pathname exclusion**, including file sharing, destination replacement, old handle identity, crash and contenders; must not assume FILE_RENAME_REPLACE_IF_EXISTS yields suitable lock transfer. | **RESEARCH ONLY; no claimed Windows proof.** Requires private NTFS two-process interleaving benchmark, native FileId and negative failures before considering code. |
| R3 — additional maintenance-fence protocol used by all writers | Deploy an admission-adjacent v2 pre-action fence respected by every GUI path before any old lock may be moved; prove source+installed parity across direct clients, and deny uncooperative executables. | **Future architectural change**, not an immediate orphan repair; requires WB-001 and external-launch control. |

**No accepted R1/R2/R3 implementation exists.** Under a real admission-only orphan, safest default is keep the admission and continue non-GUI work until a future operator-authorized maintenance method is proved. An ordinary GUI census is insufficient authorization.

## No-op-only proposed synthetic regression matrix

Every case uses one unique disposable OS-temp NTFS directory, exact fixture-owned FileId and SHA, no GUI, no Task Scheduler/start/stop, and no live .tools path. All tests assert byte-for-byte unchanged original admission and no GUI guard/sidecar/backup/move. A source-only classifier's hypothetical Execute switch is **always disabled before path inspection**.

| Case | Synthetic evidence variation | Required result |
| --- | --- | --- |
| A01 | Exact native one-file producer admission, no guard/sidecar, complete mocked journal/census | Review-only, releaseEligible=false, actionOutcome unknown |
| A02 | Admission exists but unexpected GUI guard | Reject admission-only path; route paired shape separately |
| A03 | Sidecar present or unmatched quarantine | Reject / sidecar-specific investigation |
| A04 | Admission missing | Not an orphan: no-op, no fabricated file |
| A05 | Mode maintenance, foreign producer, blank/changed requestId or admissionId | Reject wrong incident class |
| A06 | Partial JSON, empty stamp, oversize, reparse/hardlink/delete-pending, not NTFS | Reject before any release option |
| A07 | Expected SHA/FILE_ID drift, same-content replacement at pathname | Reject foreign file; no overwrite |
| A08 | Original owner alive, PID reused, child/Job descendant uncertain | Reject; no historical settlement inferred |
| A09 | Enabled GUI launcher Task, external CLI/agent not proven constrained, incomplete census | Reject even when snapshot lacks named GUI PID |
| A10 | Journal missing, different run, ambiguous pre/post-guard phase, unverified input outcome | UNKNOWN, remain blocked |
| A11 | Two operators/classifiers or same operationId replay | Stable no-op result; no release/backup |
| A12 | Attempted -Execute/force/TTL cleanup | Immediate hard refusal, fixture unchanged |
| A13 | Racing compliant contender while original admission name exists | CREATE_NEW contender fails busy; original FileId/bytes unchanged; **no old admission move** |
| A14 | Proposal removes admission before maintenance replacement | Model race exposes gap; acceptance must fail, never treat gap as protected |
| A15 | Hypothetical atomic native handoff early failure or unknown OS return | UNKNOWN/STOP; never remove or replace a foreign gate, no automatic retry |

For A13/A14, source-model tests alone cannot prove the Windows kernel's native behavior; a separate, independently reviewed NTFS experiment may be designed later, but **no real admission/GUI action is permitted by this report**.

## WB-001 next decision and rollback

Preserve running Workbridge 0.16.4-dev; no production src/dist, Windows tasks, real .tools lock, VMware guest, physical RIFT or external providers changed. Next useful milestone is an **investigation-only no-op admission-only classifier** with exact native identity and injected synthetic census, followed by independent source audit. Only after full producer-freeze and native handoff proofs could a new **separately approved** maintenance/archive utility be considered. An abandoned source-only design needs no live rollback; keep forensic incident guards untouched.
