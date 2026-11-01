# WB-013 — 0.12.2-dev deployment and hosted acceptance

Date: October 20, 2026 EDT (October 21 UTC).  
Status: **Deployment and tool acceptance passed.**

## What changed

Two reproduced multi-file recovery defects were corrected: known-ID operations
could follow a recovery-directory junction rejected by discovery, and inconsistent
terminal metadata could report undo success without restoring files. Shared bounded
validation now rejects both before project/journal mutation. Valid interruption,
restart, partial recovery, snapshot verification, and guarded undo remain supported.
See [verification and limitations](wb013-validation.md).

## Release and installation

- Version **0.12.2-dev**, **51 tools**.
- All seven release gates passed, including **279 tests**, startup, **21 updater cases**, formatting, generic acceptance, and the actual MCP catalog probe.
- Production-only offline installation passed **25/25 recovery tests** without source or development dependencies. Those tests are included in the 279-test suite, not additional unique cases.
- Activation **wb013-activate-20261020-01** completed **22:20:48 EDT**; no error or recovery error. The independent controller restarted Workbridge once and retained the 0.12.1-dev rollback package.
- Sealed manifest: **DBBAF9A2B38114C82FFCED6A05514FB9106D7FB36F9EAFF8398FDCD2359A9A6C**.
- Fresh hosted calls and installed CLI identified the same owner: **81cc4340-490c-4124-a2b8-58d23fc86145**.
- Fresh installed full suite: **279/279 passed**, job `wb013-installed-full-tests-20261020-01`, exit 0; no skips or cancellations. No live build was run.

The updater retains `hostedVerified: false` by design; external tool acceptance
is recorded here, not fabricated in the local updater journal.

## Hosted recovery proof

A disposable Unicode/spaces-path Git repository had two CRLF files staged and an
unrelated dirty file. Browser `patch_apply` changed both files. CLI status and
identical-ID replay found the same operation and returned `replayed: true`.
A later CLI edit to one file caused browser and CLI undo to return the same
`PATCH_BLOCKED` / `PATCH_CONFLICT` error, preserving both files. CLI exited 1
and skipped its sentinel write. After explicitly undoing the later edit, browser
patch undo restored both originals; CLI repeated undo without repeating writes.
Fresh browser reads confirmed both original hashes, and fixture Git staging and
unrelated dirty bytes matched their baseline.

Patch ID: `wb013-hosted-patch-20261020-01`. Later edit:
`wb013-hosted-later-20261020-01`. Corruption tests used disposable private state;
no live recovery record was deliberately corrupted.

## Preservation and evidence

Before this documentation checkpoint, hash checks verified:
**2805 installed runtime files**, **2963 sealed files**,
**2805 rollback runtime files**, **3361 retained backup files**,
**160 expected source files**, **six configuration files**, and the unchanged
main Git index. Source promotion was an explicit 11-file patch; two package files
were installed by the independent updater. Existing dirty work was preserved.

Evidence root: `C:\work\workbridge-wb013-20261020-01\evidence`.
Key files: `baseline.json`, `reproduction.json`, `initial-job-evidence.json`,
`live-patch-compatibility.json`, `sealed-release.json`, `promotion-plan.json`,
`source-promotion.json`, `deployed-integrity-before.json`, raw hosted CLI results,
`browser-observations.json`, and `hosted-final-result.json`.
The documentation patch is `wb013-deployment-checkpoint-20261020-01`;
`checkpoint-expected.json` declares its intended hashes before application.
Final integrity is in `deployed-integrity-after.json`; read its actual result.

No credentials, permissions, model settings, real Rift/RRE files, or existing Git
staging were changed. No commit or push was made. Sealed evidence is retained.
Windows directory junction tests passed; a real file-symlink probe was unavailable
under the existing user permissions. No privilege changes were made. Structural
checks do not authenticate forged internally consistent journals or eliminate
external filesystem races. Final-response rendering remains separately unverified.

## Resume

Start with [the current handoff](handoff-20261020.md). WB-013 has no remaining
release or hosted tool gate. The next investigation targets workflow-discovery
bounds and partial-error handling; it is not yet a delivered capability.

Model: GPT-6 Astra Pro.  
Reasoning level:
