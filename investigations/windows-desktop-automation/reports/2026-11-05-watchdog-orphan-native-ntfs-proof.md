# DesktopProbeWatchdog orphan admission: Windows native NTFS synthetic proof — 2026-11-05

**Result: 🟢 6/6 PASS, native synthetic only. 🟡 Real-world manual recovery and GUI pilot remain HOLD.**

The research helper at investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/Native-OrphanHandoff-Synthetic.ps1 has **no arguments and no live-target mode**. It creates unique GUID-named OS temporary NTFS fixture roots, hash-pins scripts/Archive-DesktopQuarantine.ps1 SHA256 **5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0**, extracts only its Win32 C# Add-Type here-string (without invoking the archiver), then exercises file-ID-preserving native rename, CreateFileW CREATE_NEW admission, sharing and handle-bound delete. It refuses non-NTFS or any reparse ancestor, records old outcome unknown, and deletes **only** its six exact newly created temporary fixture roots after all tests pass. On failure, fixtures remain for review.

## Exact Windows receipt

- Job: **wd_native_orphan_handoff_20261105_e04**
- Command executable: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
- Literal args: -NoProfile -NonInteractive -File investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/Native-OrphanHandoff-Synthetic.ps1
- Workbridge terminal status: **passed**, OS **exit 0**
- Runtime: 2026-11-05T23:29:11.260Z through 23:29:12.490Z (~1.23 s)
- Exact JSON: schemaVersion=1, synthetic=true, nativeFileIdHandoff=true, **passed=6, failed=0, fixtureCount=6, cleanedFixtureCount=6**, old outcome=unknown_outcome, liveDesktopTouched=false, guiLaunched=false, stderr length=0
- Reviewed source SHA256: **8ad6939027c990425c8e75bbf8b2baa461102714a12255cfb052c53a1f0e6f21**
- Independent pre-run reviewers: coordinator and WinApp red-team. Approval was strictly one bounded no-GUI synthetic run; no production archiver changes.

## Native test coverage

| Native case | Native Windows claim actually exercised | Verdict |
|---|---|---|
| N01 | Exact held Win32 file handles preserve FileIdInfo volume + 16-byte ID while admission is renamed first, replacement maintenance admission acquired, GUI guard renamed LAST; reopened archived IDs match originals. Maintenance deleted by its own handle only after completion receipt. | 🟢 PASS |
| N02 | Deterministic competing CREATE_NEW admission succeeds in the handoff gap; maintenance CREATE_NEW gets only expected Win32 busy 80/183; old GUI guard remains the **same FILE_ID**, racer cannot CREATE_NEW GUI guard, foreign admission left untouched. | 🟢 PASS |
| N03 | Live held owner FILE_SHARE_READ refuses archiver DELETE-access OpenPinned with exact Win32 sharing violation32; original pair remains unchanged. | 🟢 PASS |
| N04 | Existing relocation destination causes exact native FileRenameInfo no-replace collision 80/183; original admission and GUI guard file objects and destination bytes intact. | 🟢 PASS |
| N05 | Stop immediately after old admission relocation and before new maintenance acquisition leaves original GUI guard canonical with same FileId; no inferred action success. | 🟢 PASS |
| N06 | **Single-process staged interleaving model**: after old SHA/FileId validation, a foreign stamp with distinct owner PID, SHA and FileId replaces pathname, and a simulated vulnerable *path-based* delete removes the foreign gate. Separately, native owner handle with FILE_SHARE_READ prevents rename (IOException low Win32 code32) and own-handle deletion succeeds. | 🟢 PASS |

**Important distinction:** N06 illustrates a possible lstat/read/lstat→pathname unlink time-of-check/time-of-use sequence in Node admission release. It is NOT a measured two-process exploit, proof of occurrence, or observed production failure. Normal compliant actors still cannot get wx while the original pathname exists. The outcome supports future handle-bound release hardening.

## Failed trial history (preserved, never called PASS)

| Job | OS exit | Actual harness issue |
|---|---|---|
| wd_native_orphan_handoff_20261105_e01 | 1 | N02 attempted ReadAllText on still-live synthetic contender handle; Windows correctly denied incompatible sharing. |
| wd_native_orphan_handoff_20261105_e02 | 1 | N06 observed correct Windows sharing rejection, but harness tested outer PowerShell MethodInvocationException HRESULT rather than nested IOException HRESULT32. |
| wd_native_orphan_handoff_20261105_e03 | 1 | All case blocks reached the final JSON emission, but PowerShell misparsed bare nativeFileIdHandoff=true (missing $); no trustworthy final case count. |
| wd_native_orphan_handoff_20261105_e04 | **0** | Exact 6/6 pass + six-temp-root cleanup receipt. |

After each failure, the investigator stopped and reviewed source, required specific exception-code proof, obtained independent peer review and explicit coordinator permission for the **next distinct** synthetic run. No blind retry, relaxed catch, or live action occurred.

## Scope and outstanding production gates

This proves **native Windows NTFS handling mechanics in isolated fixtures**, not that every installed GUI producer respects both admission and old GUI guard. The fixture's process/TaskScheduler quiescence is synthetic; no real owner/child/Job census was performed here. The standalone DesktopProbeWatchdog still self-assigns its private Job and has no real TaskScheduler GUI proof. Admission-only orphan is deliberately excluded: with no old GUI guard, the handoff gap cannot be protected by this protocol. Any incomplete archive, collision, or live recovered owner needs separate operator review with pinned original evidence and never action replay.

**Next milestones (without live execution):**

1. Build an independently reviewed read-only Windows admission/guard census spanning all deployed/legacy producers, TaskScheduler launchers, exact owner PID/start/session and Job descendants; missing evidence means NO-GO.
2. Add native fault injection for after-maintenance, after-guard-move, journal/fsync failure and second-operator idempotence; retain hard fail-close and explicit file-ID pinning.
3. Design separate admission-only recovery with provably offline producers or an independently validated sentinel, never widen pair protocol silently.
4. Harden production Node admission pathname unlink by exact-handle deletion in a separately reviewed WB-001 rollout and synthetic cross-process race test; no production change from this research lane.

**Decision remains: HOLD real GUI pilot and any live archive/unlock; GO for further source-only/read-only and private fixture investigations.**
