# DesktopProbe independent watchdog — isolated prototype

Status: **synthetic-only PASS** through November 6, including actual watchdog-stamp abrupt-exit recovery in OS-temp fixtures. **HOLD** for a real watchdog-driven GUI pilot pending historical Job-tree settlement, live recovery authorization and interactive-session gates. Physical RIFT was untouched.

## Purpose and ownership

`DesktopProbeWatchdog.exe` is a **Windows GUI-subsystem** (.NET 10 WinExe) owner process, intended to run as a single interactive-user Task Scheduler helper in a future approved pilot. It launches only hash-pinned `DesktopProbe.exe` and `DesktopProbe.dll`, as its exact child, under an existing private Windows Job Object (source-linked from `scripts/Desktop-JobLifetime.cs`). The watchdog enters its private Job **before** launching the child, requires active member count 1->2, and verifies exact child Process handle and session. Job has KILL_ON_JOB_CLOSE, so even watchdog crash closes the handle and terminates descendants, subject to later real scheduling validation.

Source and publish are confined to this prototype; `src/`, `dist/`, `.local/`, registered tasks, services, and host/guest desktop were not changed.

## Strict real-mode launch preflight (NOT YET AUTHORIZED)

The only accepted invocation is `--desktopprobe <runId> <exeSha256> <dllSha256>`. RunId is 8–40 lowercase ASCII letters/digits/hyphens, with alphanumeric first and last characters. Build must reside exactly in `investigations/windows-desktop-automation/temp/desktopprobe-watchdog-publish`. The private target must exist at `temp/desktopprobe-<runId>/publish/DesktopProbe.exe` and managed DLL alongside it, with both caller-provided SHA256 digests matching. Evidence is `temp/desktopprobe-<runId>/evidence`, unique per run. Interactive nonzero Windows session is required.

The shared owner lease is `.tools/desktop-evidence/desktop-input-turn.lock`. A foreign/stale/quarantined lock or any orphaned `desktop-turn-quarantine-*.json` sidecar in the shared lock directory causes hard refusal. Recovery must address both lock and sidecar; this prototype never removes them. The watchdog *atomically* creates the exact shared lock using Windows `CreateFileW(CREATE_NEW, FILE_SHARE_READ)` with no overwrite, writes durable immutable JSON stamp, and holds that file handle while the child exists. It never takes focus itself or sends input. Other desktop operators remain blocked on the GUI turn. Benchmark observers are read-only participants: they validate matching leaseId/runId/requestId/watchdog PID/start ticks against the manifest, without acquiring another lock.

The private watchdog job must return to one active member and its exact child must have exited before a successful lease release. `DesktopTurnLease.Complete(true)` verifies the exact stamp bytes using the held handle, marks only that opened file object for deletion via `SetFileInformationByHandle(FileDispositionInfo)`, and confirms disappearance. Crashes, unknown settlements, mismatches, or delete failures leave the lock quarantined for explicit manual reconciliation; no PID/age-only cleanup or automatic retry.

Stamp shape:
```json
{"schemaVersion":1,"kind":"workbridge.gui-turn","producer":"desktopprobe-watchdog",
"runId":"<runId>","requestId":"<runId>","leaseId":"GUID",
"owner":{"pid":123,"processStartUtcTicks":"string","sessionId":1},
"target":{"kind":"window","pid":null,"hwnd":null,"process":"DesktopProbe"},
"acquiredUtc":"ISO-UTC","synthetic":false}
```

After the child logs its *native* `shown` HWND, watchdog independently checks that specific HWND through Win32 (not title-wide discovery): PID/session/known title/counter0, class, visible/nonminimized root unowned window. If validated, it creates `temp/desktopprobe-<runId>/evidence/target-manifest.json` with `schemaVersion,runId,requestId,leaseId,ownerSid,watchdogPid,watchdogStartedAtUtcTicks,pid,startedAtUtcTicks,sessionId,hwnd,className,title,exePath,exeSha256,foregroundHwnd,evidenceDir,observedAtUtc,deadlineUtc,jobActiveAfterSpawn`. The WinApp and Sbroenne observers then independently read/revalidate exact PID/HWND/start/SID and shared lease. No foreground change is forced; source requires only a nonzero foreground HWND and the samplers independently confirm it remains unchanged before/after. Target HWND ownership is checked separately from foreground state. First manifest snapshot is **not refreshed**, so any <=5-second freshness gate currently requires immediate sampling or a future refresh design.

Hard watchdog child kill starts at <=110 seconds from process entry, not a WinForms timer. Child/Job settlement and GUI target proof are distinct: if native shown/HWND manifest is missing, real mode returns exit4 with `result=no_gui_manifest` and `operationOutcome=unknown_outcome` even when the child was safely terminated and the GUI-turn lease safely released on independently verified process-tree settlement. Unknown descendant settlement retains/quarantines the lease. The TaskScheduler interactive-token boundary and real GUI launch remain untested and gated separately.

## Completed synthetic no-GUI verification

Publisher (executed; exit0):
```powershell
& "C:\Program Files\dotnet\dotnet.exe" publish investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/DesktopProbeWatchdog.csproj -c Release -o investigations/windows-desktop-automation/temp/desktopprobe-watchdog-publish --artifacts-path investigations/windows-desktop-automation/temp/desktopprobe-watchdog-artifacts --nologo
```
Workbridge build jobs `wda_watchdog_build_20261104_005`, `_006`, `_007` and `_008` all passed exit0; `_008` is the final source build including orphan-quarantine gate.

- `wda_watchdog_lease_smoke_20261104_001`: `--synthetic wdsmoked`, **exit0 PASS**, 1.91s. Private mock lock acquired atomically; simultaneous competing acquisition rejected (`collisionBlocked=true`). Synthetic child PID54660, watchdog PID72404, job members 1->2->1, independent child marker, timeout kill, exact child exit, lock released and directory listing confirms mock lock absent.
- `wda_watchdog_final_smoke_20261104_001`: `--synthetic wdsmokeg`, **exit0 PASS**, final SHA source regression: watchdog PID70860, child PID6728, 1->2->1, collision blocked, lease released, elapsed1618ms.
- `wda_watchdog_manifest_regression_20261104_001`: `--synthetic wdsmokef`, **exit0 PASS**, validates added missing-manifest truth condition does not regress synthetic containment, Job 1->2->1, collision blocked, owned lock released.
- `wda_watchdog_uncertain_smoke_20261104_001`: `--synthetic-uncertain wdsmokee`, **exit0 PASS of simulation**, 1.93s. Private mock lock collision rejected, child PID30608, watchdog PID68800, 1->2->1, but deliberately passed `Complete(false)`, leading to `operationOutcome=unknown_outcome`, `leaseReleased=false`, `leaseRetained=true`. Directory listing independently confirms `desktop-input-turn.mock.lock` and `desktop-turn-quarantine-<leaseId>.json` left for recovery. This is **intentional synthetic uncertainty**, not an actual hung GUI failure.

Synthetic tests do **not** prove TaskScheduler ownership, real WinForms UI startup/shown, COM/UIA hung-provider containment, or GUI focus safety. They prove native private-Job containment/timeout and atomic lock collision/settlement on this exact compiled WinExe test process only. No production service or active game was touched.

### November 5 atomic maintenance-admission integration (synthetic verified)

- Before a GUI turn, `DesktopTurnLease.Acquire` now creates `desktop-turn-admission.lock` with Win32 `CREATE_NEW`, using the durable `workbridge.gui-admission` schema from `scripts/desktop-turn-admission.mjs`. The independent orphan-sidecar veto is checked again under admission.
- Verified settlement removes the exact owned GUI guard first and admission second. On uncertain settlement, admission is released only after exact original GUI guard bytes and its matching quarantine sidecar are verified retained; otherwise it stays blocking. Abnormal `Dispose` retains both.
- Synthetic mode uses per-run `desktop-turn-admission.mock.lock`, never the live `.tools/desktop-evidence` lock.
- `wd_admission_csharp_publish_20261105_a01`: Windows .NET 10 publish PASS (exit 0).
- `wd_admission_csharp_synthetic_ok_20261105_a01`: `--synthetic admgateok20261105a` PASS (exit 0); exact Job 1→2→1, child settled, both mock lock files absent.
- `wd_admission_csharp_synthetic_uncertain_20261105_a01`: `--synthetic-uncertain admgateunc20261105a` PASS (exit 0); original mock GUI guard + linked quarantine retained, admission released after exact guard verification.
- `wd_admission_csharp_synthetic_busy_20261105_a01`: preexisting foreign mock admission yielded expected exit 3 `UI_TURN_BUSY` in 89 ms; no child marker or GUI-turn file was created.
- `wd_sidecar_compat_publish_20261105_e01`: refreshed .NET 10 publish after adding matching sidecar `requestId=runId` and explicit `intentSha256=null`; **exit 0**.
- `wd_sidecar_archive_readonly_contract_20261105_e01`: **1/1 PASS, exit 0, 5.51s**. Synthetic uncertain Job 1→2→1, private mock guard+sidecar cloned into unique OS temp fixture, then the pinned actual `Archive-DesktopQuarantine.ps1` accepted them in **read-only mode without `-Execute`**, returning `readyForManualReview:true` and no archive or byte changes. This proves exact parser compatibility, **not manual recovery execution**. See `WatchdogQuarantineContract.test.mjs` and `../../reports/2026-11-05-desktop-turn-admission-independent-audit.md`.

## Pending gates

1. Independent final review of native lease P/Invoke, real manifest and identity checks.
2. **PARTIAL / STILL BLOCKED:** `Archive-WatchdogOrphanFixture.ps1` plus `WatchdogOrphanFixture.test.mjs` have **7/7 PASS**. New watchdog fault injection proved Job membership 1→2, abrupt owner exit and independent child disappearance within four seconds before synthetic copied-lock archival. Dual/admission-only archiving and hostile-input checks remain green. This proves one synthetic child-kill case, not historical descendant settlement for a real GUI. The archiver cannot touch live shared locks; reviewed production recovery remains missing.
3. Operator approval for first GUI pilot, published disposable DesktopProbe hashes, TaskScheduler interactive token, watchdog process-tree ownership, separate sampler lock validation, and target foreground/freshness preflight.
4. If >5-second sampling is needed, add a safe atomic fresh-manifest publisher or a new independently revalidated fresh-snapshot contract; do not treat an aged manifest as current.

