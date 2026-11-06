# Workbridge-first automation roadmap for LuaPadModern
Date: 2026-11-06 (America/New_York)  
Owner: Joey / Workbridge team  
Status: APPROVED PLAN; implementation and live acceptance are separate gates.

## Decision and scope

Prioritize reliable Windows desktop automation in Workbridge before expanding manual LuaPadModern acceptance. Workbridge remains the single orchestration and MCP layer; existing WinApp CLI, Win32, desktop guards, screenshot tools and guest controllers supply specialized actions. The physical RIFT window and each VMware guest are **different desktop sessions** and require their own verified identity and exclusive input turn. The RIFT addon executes in its own restricted Lua sandbox; Windows desktop control neither enlarges nor bypasses that sandbox.

Goal: allow an authorized operator to ask the assistant to focus LuaPad's editor, enter a harmless Lua snippet, press **Run**, and independently verify the Output in the **physical** RIFT game, without asking Joey to perform routine clicks.

## Evidence baseline (do not confuse with production capability)

- Running Workbridge owner: **0.16.4-dev** on the physical Windows host; exact PID/instance must be refreshed before deployment. Do **not** start a second owner against `.local`.
- Production MCP surface presently offers Windows list/inspect and screenshot capture including VMware **host-window** capture. It does **not** yet publish general-purpose typed mouse and keyboard input tools.
- GUI-004a and GUI-004b demonstrated bounded InvokePattern, keyboard and mouse actions against a disposable .NET fixture, with fresh target identity and native effect evidence; these are **pilot results**, not RIFT acceptance.
- GUI-004c unfinished: locked-desktop rejection, lease/race/cancellation handling and independently verified after-action outcome. GUI-006 needs typed MCP registration and **WB-001** deployment/rollback.
- Earlier Nov. 2 input quarantine was reconciled; a Nov. 5 authorized one-shot `/reloadui` and guarded `/lp` already ran successfully. Their durable journals are consumed; never reset or replay them.
- Physical LuaPadModern **v2.0.0-preview21** has visual proof of click-to-focus, typing including Enter/Tab, and click-away blur. The **Run button and Lua Output execution remain unverified live**.
- Lab 1 and Lab 2 have recent inventories of WinApp CLI 0.7.1, .NET 10, Python 3.14, PowerShell 7, Node, Git and Sysinternals. Installed software alone does **not** prove guest-side GUI control, receiver health or test success.

## Execution order and acceptance

### M1 — Finish the guarded input core (FIRST)

1. Inspect `scripts/desktop-probe-act.mjs`, `scripts/desktop-turn-admission.mjs`, `src/desktop-registration.ts` and existing GUI-004 tests. Reuse their durable request IDs, target PID/HWND/process-start/session checks, exclusive admission and quarantine veto.
2. Implement a **narrow typed action descriptor and preflight**, with exact target, allowed action type, focus/foreground/geometry checks, bounded timeout, uncertain-outcome journal and deterministic denial reasons. No free-form global key injection.
3. Exercise synthetic negative cases: stale HWND/PID reuse, lock screen/noninteractive session, competing owner/lease, quarantine, changed geometry, child HWND ancestry, timeout/cancel and missing proof. Release modifiers/buttons on a controlled failure and preserve unknown outcomes without automatic replay.
4. Prove exactly one action on the disposable native GUI fixture; independently read its changed counter/state. **Pass:** no wrong-target interaction, no lock bypass, no duplicate action, all focused tests green.

### M2 — After-action verification and operator-grade evidence

1. Verify target identity immediately before/after action and pair a fresh target-only capture with native fixture journal/state; distinguish screenshot hash from semantic content.
2. Detect unexpected owned modal, foreground loss, resolution/DPI changes, hidden/occluded/minimized window and stale coordinate mapping. Classify as VERIFIED / REJECTED / UNKNOWN; unknown must not be automatically retried.
3. Keep bounded metadata and hashes; do not log arbitrary clipboard text, keystrokes, personal UI content or unrestricted desktop images. **Pass:** every action has an attributable target, a durable result and a defensible postcondition.

### M3 — Physical RIFT LuaPad P1 end-to-end

1. Re-enumerate physical `rift_x64` PID/process birth/session/HWND, current RIFT foreground, LuaPad version/position, current GUI owner, quarantine and locks.
2. Use a narrowly reviewed RIFT-specific adapter for GPU-drawn controls where UIA cannot identify a button. Do **not** transfer fixture coordinates directly to RIFT; derive fresh geometry/scale/occlusion, reject ambiguity and first prove harmless focus behavior. No game or Windows restart unless explicitly needed.
3. Enter a benign Lua snippet (e.g. `print("P1_RUN_OK", 6 * 7)`), invoke **Run** once, then independently confirm the expected Output **P1_RUN_OK 42**; test syntax-error feedback separately with a non-destructive snippet.
4. Verify the editor preserves focus/blur and Enter/Tab behavior; no direct OS/network/file access assumption from in-game Lua. **Pass:** live Run + actual output proof with screenshots/receipts; otherwise leave P1 pending.

### M4 — Lab 1 and Lab 2

1. Inventory fresh VMX, guest boot/session, receiver, RIFT process and GUI tools **independently** for each lab. Host VMware chrome is not the guest desktop.
2. Validate read-only guest screenshot and control-plane health, then bounded synthetic guest UI input with one owner **per guest**. Only then promote a narrowly scoped guest RIFT test.
3. **Pass:** reproducible guest-by-guest target/effect evidence; failures isolated to their owning lab and no surprise restart, snapshot or security changes.

### M5 — Stable reusable MCP interface

1. Publish typed narrow `desktop_action`-class capability/variants only after M1/M2 tests and review. Integrate with the Workbridge scheduler while serializing input on each desktop.
2. Stage under **WB-001**: isolated build/test, source and binary identity, rollback exercise, service owner validation, explicit staged activation, post-deploy read-only smoke, then approved disposable action.
3. Document operator usage and failure recovery for LuaPadModern, RRE, AutoFight and RiftReader2. **Pass:** assistant can request a specific scoped action and receive independently verified outcome without manual routine clicks.

## Standing invariants

- One exclusive input owner **per desktop session**; 36 Workbridge command slots are not 36 GUI input permissions.
- Fresh host/guest process identity, session, foreground, DPI and geometry before input; no unguarded mouse/keyboard, secure-desktop or permissions bypass.
- Unknown/abandoned locks, quarantine and uncertain actions are stop/reconciliation states, not retry opportunities.
- No resetting consumed `/reloadui` or `/lp` one-shot journals.
- User-owned dirty files (notably `scripts/freebuff-conpty-probe.py`) remain untouched. Commit only verified owned files with exact hashes and current HEAD.
- Source commits do **not** deploy the running Workbridge owner. Existing authorization covers normal code/test/small commits; live RIFT changes and WB-001 service replacement require their separate target-specific checks.
- Keep this plan short and update the active `docs/interactive-desktop-vm-roadmap.md` with completed, verified acceptance results only.

## Immediate next action after this document's isolated commit

Read the GUI-004 core/registration tests, implement the smallest typed preflight/cancellation or race guard on the **disposable target only**, run focused tests, inspect exact diffs, and commit that verified code slice separately. Do not perform physical RIFT input as a first code test.
