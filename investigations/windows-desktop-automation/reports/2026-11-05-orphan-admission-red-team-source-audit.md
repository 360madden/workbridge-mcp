# Independent red-team audit — orphan admission handoff and WinApp pilot gate

**Date:** November 5, 2026 (America/New_York). **Lane:** read-only source/synthetic-design review; no live GUI, VM, RIFT, Workbridge service, lock or Task Scheduler mutation by this reviewer. **Verdict:** 🟢 **Private NTFS synthetic completed 6/6** with exit0; 🔴 HOLD real archival, DesktopProbe GUI launch and WinApp/Sbroenne UIA benchmark.

## Verified sources and precise scope

| Source | SHA-256 / fact |
| --- | --- |
| `scripts/desktop-turn-admission.mjs` | `2d07155795c6766ea2adbff96907e523b0550f9ab3df7fc7020dfa2b3f941f21` |
| Deployed `dist/desktop-turn-admission.mjs` | **Byte-identical SHA** `2d071557…` to source above, not merely a proposed fix. `src/desktop-registration.ts:41–55` dynamically loads the deployed helper. |
| `prototypes/desktopprobe-watchdog/DesktopTurnLease.cs` | Current two-lock source has handle-bound Win32 admission/GUI releases, matching `requestId` on uncertainty sidecars. Distinct from the Node helper. |
| `OrphanAdmissionHandoffSynthetic.test.mjs` | SHA `701c150478fc1df0795a463f78f46655b5d742a886cf004d3f43a12df8a0e813`; peer reported job `wd_orphan_handoff_model_20261105_e01`, **10/10 PASSED**. It uses injected quiescence/producer coverage and Node rename/ino stand-ins. |
| `Native-OrphanHandoff-Synthetic.ps1` | Final source SHA `8ad6939027c990425c8e75bbf8b2baa461102714a12255cfb052c53a1f0e6f21` (final e04). Command job `wd_native_orphan_handoff_20261105_e04`: OS exit 0, **6/6 PASS**, failed 0, stderr 0, **6/6 unique OS-temp fixtures cleaned** in 1.23s. This is private NTFS synthetic proof only, not live recovery. |
| `scripts/Archive-DesktopQuarantine.ps1` | SHA `5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0`; hash-pinned C# here-string is **extracted/compiled** by native test, not executed as a live archive operation. |

### Risk #1 — source-proven Node admission release TOCTOU (P2 likelihood / high consequence)

`scripts/desktop-turn-admission.mjs:61–95` creates admission via `open(...,'wx')`, writes/fsyncs it, then **closes** the original creation handle. `releaseDesktopAdmission:117–138` checks current pathname `lstat/readFile/lstat`, dev/ino/bytes/SHA, and later `:143` performs **`unlink(lease.filename)` by pathname**. These are non-atomic relative to a same-user concurrent rename/replacement.

A possible, **not observed**, interleaving is:

1. Owner A verifies old file identity/hash.
2. Another same-user process B renames the old canonical name and creates a new foreign admission at that name.
3. A's already-pending pathname unlink deletes B's **new** gate, violating the intended invariant that a foreign admission is untouched.

This requires a racing actor able to alter that pathname during a small timing window. It is not evidence of malicious activity or a reproduced exploit in Joey's current session. Routine cooperative likelihood is **low (P2 operational priority)**, but if an archival procedure promises *never* to delete a foreign admission, this is a **P1 correctness gate**. An additional stat or sleep cannot make check+pathname unlink atomic.

**N06 native fixture meaning:** the final PowerShell source takes original Windows FILE_ID/SHA, models the exact checked→swapped→pathname-deleted sequence with a distinct replacement file ID/SHA and labelled synthetic owner PIDs, then contrasts a live **native held handle** whose share mode refuses the swap. That is a **single-process ordered interleaving model**. It does **not** execute `releaseDesktopAdmission` or prove a real two-process scheduler race, exploitation rate or an actual production lock deletion.

**Smallest reliable future fix:** move Node admission creation/ownership/release behind a narrow Windows helper holding the **original** CreateNew FILE_SHARE_READ handle through the operation, then hash-check and delete by that exact native handle using `SetFileInformationByHandle(FileDispositionInfo)`. Reuse proven archive/ watchdog native patterns. If that cannot be implemented, retaining the gate for explicit manual recovery on ambiguous ownership is safer than speculative pathname unlink, but has operational cost. Do not patch the deployed helper as part of this review.

### Risk #2 — the guard-covered handoff depends on a cooperative **all-producer** invariant

The design's key step is original orphan admission relocation **first**, new maintenance admission acquisition **second**, original GUI guard relocation **last**. The old GUI guard blocks **compliant** producers during the brief admission-name gap. S09 model and N02 native test check the old guard's CREATE_NEW collision, but the `allProducersHonorLegacyGuard=true` quiescence fact is **injected**, not OS-enforced.

Source coverage presently observed: `src/desktop-registration.ts` wraps the deployed desktop-capture parent with an admission followed by legacy guard; `scripts/desktop-capture.mjs` verifies both exact parent stamps; `scripts/{desktop-probe-act,vmware-host-capture,chat-input-disposable-pilot,physical-rift-reloadui,physical-rift-candidates}.mjs` call the shared `withDesktopAdmission` wrapper and use legacy guard logic; DesktopProbeWatchdog uses native admission+guard. **This is only coverage of reviewed code.** Direct `winapp.exe`, user-launched PowerShell, generic `terminal_run` commands or third-party GUI controllers are not OS-forced to participate. Fresh deployed process/task inventory and a quiet-desktop owner authorization remain mandatory; if a live uncontrolled caller can operate during the handoff gap, **NO-GO**.

### Risk #3 — crash recovery state space is only partially modelled

| Partial state | Model/native coverage | Safe next action |
| --- | --- | --- |
| Exactly old admission + old GUI guard, no sidecar | S01–S06, S08–S10, S14–S15; N01–N05 native mechanics | Eligible **only for operator review**, not automatic archive |
| Admission only; no old guard | S14 rejects; can arise before guard creation or after guard deletion | **Separate GUI-producer-offline protocol required**; guard-covered handoff unsafe |
| GUI guard only; old admission moved, maintenance not acquired | S08/N05 leave guard; S09 competitor race tests a branch | Do not retry automatically; original file IDs, archive stages, foreign claimant and current tasks must be reconciled |
| Foreign winner's admission + old guard | S09/N02 demonstrate old guard retained, **not competitor full lifecycle** | Leave foreign gate intact; require proof its owner stopped before any new operator action |
| New maintenance admission retained + old GUI guard | S10 tests a stop, no operator continuation implementation | No new GUI turn; exact journal/file ID recovery |
| New maintenance admission retained **after old guard moved** | S11 proposed but not yet covered by first ten logical tests or N01–N06 | No automatic release; archive proof plus future owner-specific recovery |
| New GUI turn after completed maintenance release | S13 proposed only | Treat new file IDs/request as independent, never overwrite or attribute to old action |

Missing negatives from the first ten logical tests include S07 (all backup/manifest crash points), S11 (after guard relocation), S12 (destination collision/disk or write failures beyond the tested first collision), S13 (new turn after release), S16 (replay/second operator after crash), and actual multi-process producer competition. N01–N06 add **native FILE_ID/share/no-replace mechanics** but do not close those lifecycle and producer-proof gaps.

### Native harness security signoff (source and private test receipt)

**Verified offline run** for exact final source SHA `8ad69390…`, launched with `powershell.exe -NoProfile -NonInteractive -File` under a bounded 90-second command job (actual duration 1.23s):

- No arguments or caller-supplied root; every fixture uses fresh GUID `wb-native-handoff-fixture-*` under Windows OS temp; initial NTFS/reparse check; never opens live `.tools/desktop-evidence`, executes WinApp, touches Task Scheduler or Workbridge owner.
- Hash-pin the existing archive PowerShell source, extract its native C# string and `Add-Type` only; does **not** invoke archival instructions. A fresh PowerShell process matters: the run refuses an already-preloaded `WorkbridgeArchiveWin32` type.
- Held-handle FILE_ID and no-replace N01/N04, contender/old guard N02, live native owner share denial N03, intermediate retained guard N05 and N06 pathname-replacement **model**; no arbitrary GUI target.
- After **all** six cases pass, cleanup uses only this invocation's recorded GUID temp roots. Any failure retains those private fixtures for forensics. The final source includes explicit NTFS/reparse ancestors and narrow expected Win32 error checks. The `e04` receipt reports `liveDesktopTouched:false`, `guiLaunched:false`, `priorActionOutcome:'unknown_outcome'`; no live-target operation occurred.

**Trial chronology:** `wd_native_orphan_handoff_20261105_e01` exited 1 at a test-owned N02 FILE_SHARE_READ contention; `e02` exited 1 because N06 PowerShell outer `MethodInvocationException` masked the underlying expected IOException/Win32 code; `e03` reached the footer but exited 1 on bare `nativeFileIdHandoff=true` instead of `$true`, so **no 6/6 claim** for earlier trials. The independently reviewed one-token correction in e04 produced the exact JSON receipt: `passed:6`, `failed:0`, six named cases N01–N06, `fixtureCount:6`, `cleanedFixtureCount:6`, source archive SHA `5b1860ed…`; `command_status` independently confirms exit0 and stderr0. The old failed trials do not constitute production bugs or actions on live locks.

**Still required before anything beyond private synthetic:** independent no-live-artifact postcheck, actual deployed GUI producer/TaskScheduler process census under a held maintenance gate, a documented admission-only crash branch, and a separately approved one-shot manual recovery protocol. E04 does **not** make live DesktopProbe or recovery safe automatically. A synthetic GO is **not** a live DesktopProbe WinApp UIA or recovery GO.
