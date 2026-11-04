# OneDrive synchronization inside the two RIFT VMware guests — read-only triage

**Investigation date:** 2026-11-04 (America/New_York)  
**Scope:** Windows 11 OneDrive Personal, RIFT-Lab-1 and RIFT-Lab-2, without touching the live game, VMware guest, OneDrive UI, credentials, power state, or synchronization settings.  
**Status:** Research and a future evidence-collection plan; **root cause not established**. This report is not a record of new guest probes.  
**Ownership:** Workbridge desktop automation investigation. Production Workbridge remains in day-to-day service.

## 1. Baseline: observations versus missing proof

| Evidence from previous handoff / RR2 documents | What it establishes | What it does not establish |
| --- | --- | --- |
| Joey previously saw OneDrive's **paused** status and **Resume syncing** in guest screenshots; Settings was greyed out. Resuming manually caused a large backlog to process. | At that observation time, OneDrive reported sync paused. | Why it paused, when it paused, whether it was manual/automatic, or whether both guests still have that state. Grey Settings alone is not a root-cause discriminator. |
| OneDrive.exe was previously running and startup enabled in both guests; user OneDrive root was C:\Users\mrkoo\OneDrive. | The client had been installed/started for that user. | That the account was signed in, connected, syncing, or active in the present interactive user session. |
| UserSettingMeteredNetworkEnabled=0 in prior registry checks; Ethernet0 was **Public** category. | One relevant preference was set to 0 and the guest network's *security category* was Public. | Actual Windows **connection cost** (unrestricted/fixed/variable), roaming/over-cap flags, or OneDrive's effective policy. Public/Private is **not** metered/unmetered. |
| Prior VM checks found no virtual battery, Balanced power plan, and no selected sleep/resume Event IDs 42/107. | These *particular* observations lower the likelihood of battery-related or sleep-triggered pauses. | A complete power, Energy Saver, task, snapshot, network-reconnect, or timing timeline. |
| VMnet8 NAT/VMware Tools, OneDrive updater/reporting/startup scheduled tasks, readable SyncDiagnostics.log with no counted errors in selected categories; ODL logs not decoded. | The environment and several initial negative checks. | Continuous connectivity, absence of all OneDrive errors, the nature of binary logs, or whether a third-party tool paused OneDrive. |
| The RR2 Lua addon previously had an **Offline** / reparse placeholder for a guest file, independently repaired by deploying a pinned local source. | Cloud-file hydration state can break a game addon despite a nominal installed path. | A causal explanation for the OneDrive **pause**, or a guarantee that the rest of the OneDrive tree is hydrated. |

**Do not collapse these into "VMware is pausing OneDrive."** VMware NAT, snapshot/time sync, and session boundaries are hypotheses to test, not established causes.

## 2. Passive diagnosis decision tree

The first evidence to obtain, **only after separate approval for guest read-only observation**, is a timestamped status from the *correct logged-in guest user session* on each lab. Compare labs individually; do not infer Lab 2 from Lab 1.

1. **Does the correct interactive account currently have a OneDrive process/tray presence?**
   - **No process/no tray** → distinguish not-started, quit, crashed, delayed startup, and different user session with bounded process/startup/Windows event evidence. A missing tray icon alone is insufficient because Windows can hide icons. Do not start/restart OneDrive in this phase.
   - **Process present** → correlate executable path, PID/start time, Windows session ID, process owner SID, and tray account to the expected user. No sensitive identity or auth material in reports.
2. **What exact state does the OneDrive UI report?** Read icon and text together, not an icon guess:
   - **Paused cloud icon / "Resume syncing"** → proceed to *pause-origin* branch.
   - **Grey/cloud strike-through / sign-in or setup required** → *account/authentication* branch, not a pause repair.
   - **Red X, warning or "account needs attention"** → extract error category/code and timestamp; look for quota, inaccessible path, invalid name, or credentials, without attempting fixes.
   - **Circular arrows / "Processing changes" / uploading/downloading** → *backlog* branch; this is active or pending work and is not proof of pause.
   - **Up to date** → test a small, bounded known artifact's local metadata and timestamp across each device later, without creating test files now. Up-to-date is account-wide client reporting, not proof a specific online-only addon is local.
3. **Pause-origin branch (only if pause is actually shown):**
   - Was a timed 2-, 8-, or 24-hour manual pause selected, and what is the last pause transition time? Use UI text and existing task/history evidence where available; do **not** click "Resume" to discover the reason.
   - Read actual current Windows connection cost via Windows.Networking.Connectivity (NetworkInformation.GetInternetConnectionProfile / GetConnectionCost): NetworkCostType, Roaming, OverDataLimit, BackgroundDataUsageRestricted. Query separately from the Public/Private security category; the earlier registry setting does not replace a live cost observation.
   - Read actual Energy Saver / Battery Saver effective state (if exposed), current power-source presence, and power transition history. A no-battery VM makes automatic battery-triggered pause less likely, not logically impossible through policy/virtualization edge cases.
   - Inspect *metadata only* for Task Scheduler actions and current process ancestry that could invoke OneDrive pause/quit; distinguish Microsoft's ordinary updater/reporting tasks from any custom automation. Never execute a discovered task.
   - Record OneDrive version, whether there was a client update/restart, and sign-in/token errors as *categories only*. Avoid dumping token-bearing logs.
   - **If evidence cannot disambiguate automatic vs manual pause, label the cause "unknown"**; preserve before-state for a future separately approved supervised experiment.
4. **Signed-out/error branch:** Determine if the client asks to log in, account attention, capacity/quota full, storage inaccessible, filename conflict, or unexpected sync root. Do not enter credentials, unlink/relink, reset client, unlink directories, or delete data.
5. **Backlog branch (OneDrive running but behind):** Record UI-reported remaining *count, size, status, oldest-change time* if shown. Separate initial catch-up from continuous churn among PC + both guests. Consider large/file-count queues, files held open by RIFT, uploads/downloads to three machines, simultaneous edits/rename collisions, hidden/temp files, insufficient cloud capacity, path/name restrictions, or throttling. These are candidate mechanisms, not yet findings.
6. **File unavailable in RIFT despite nominal sync:** Inspect the specific addon path's metadata first (Offline, ReparsePoint, Pinned/Unpinned, cloud state) **without opening or hashing an Offline file**. An online-only Files On-Demand placeholder cannot be assumed usable offline; opening or hashing may trigger hydration and network changes. Handle this as **artifact availability**, independently of paused sync.
7. **Network/time/session branch:** From passive, previously approved sources only, compare host versus each guest's clock/UTC offset, recent time-change/resume/snapshot events, DNS/gateway/VMnet8 NAT adapter presence, Windows cost/connectivity assessment, and OneDrive error timestamps. An apparent NAT IP or successful guest ping does not prove cloud authentication or OneDrive upload path. VMware Tools may adjust guest time at power/resume/snapshot; verify before alleging a timing cause.

### Compact routing map

| Observed state | Primary next question | Safe *evidence* | Do not do now |
| --- | --- | --- | --- |
| 🟡 Paused | Timed/manual vs metered vs saver vs automation? | Tray status text + last transitions + current network cost/power state | Click Resume, change pause/power/network settings |
| 🔴 Signed out/attention | Authentication vs quota vs error? | Account status class, error code, current process/session | Sign in, reset, unlink/relink, display auth tokens |
| 🔵 Processing/backlog | Catch-up or ongoing churn/conflicts? | UI counts/bytes, bounded timestamp summaries, sync diagnostic categories | Delete files, wipe cache, force mass resync |
| 🟠 Online-only addon | Which individual files are Offline vs Pinned? | Lightweight file-attribute enumeration before reads/hashes | Open/download/hash Offline placeholders in bulk |
| ⚪ No process/tray | Quit/startup/crash/other session? | Process owner/session, startup entry and relevant event timestamps | Start a new client or launch a scheduled task |
| 🟢 Up to date | Are the *required local* source files hydrated? | Bounded per-file attributes and target SHA only when already local | Assume all files are safely local |

## 3. Evidence capture design: no focus stealing, no accidental hydration

A later **read-only collector** should support one guest at a time and produce a machine-readable receipt with:

- **Provenance:** UTC collection timestamp; lab VMX identity; target Windows user SID in *redacted/hashed form*; interactive session ID; OneDrive PID/start time/version; tool and collector versions; result status (observed/unknown/denied).
- **Client evidence:** tray icon classification and any already-visible status string; UIA automation element identity only if exposed within the correct session; account type **Personal**. Host UIA sees VMware window, not OneDrive controls inside the guest. UIA must run inside the guest's own active desktop session.
- **No-UI evidence:** process status/startup metadata; user-visible OneDrive status from authorized read-only logs or narrow event categories; current Windows connection cost, NetworkCostType, roaming/over-limit/background usage; effective saver/power state; time offsets and timing events. UIA menu opening, clicking, foreground switching or screenshot capture are **interactive** and need separate explicit permission.
- **Cloud files:** metadata-only enumeration of an explicitly bounded list of known addon paths; Offline/Pin/Reparse attributes first. Never recursively scan the whole OneDrive tree, blindly hash, or read online-only content; such reads can hydrate/download.
- **Log hygiene:** only bounded status codes, timestamps, client version, numeric queue sizes if available; no raw account names, email addresses, file-path inventories, filenames from personal folders, browser cookies, OAuth/MSAL artifacts, credential files, or raw OneDrive binary ODL. Prior readable SyncDiagnostics.log's absence of selected counted errors is not proof of no sync failures.
- **Before/after receipts:** baseline ID, operation ID (if a later intervention is authorized), monotonic request/acknowledgment and visible-state timestamps, expected state, observed state, screenshot/element evidence ID if separately approved, independent outcome verification, timeout/unknown category, cleanup receipt. Do not infer success merely because a click returned.
- **UI/latency:** treat host → VMware Tools → guest service → correct interactive desktop → OneDrive provider as distinct hops; measure per-hop health, tool acknowledgment and UI state separately. On timeout, re-observe state rather than blindly re-clicking. Reject stale or wrong-session targets. Do not automate over RIFT's foreground window.

**Session rule:** The existing RR2 host/guest transport has an interactive guest-agent pattern (see riftreader2/scripts/vmware_guest_session.py, lab_codex.py, Ensure-GuestAgentTask.ps1). A future OneDrive worker must prove which user session it entered, then expose a **new, UIA-specific, isolated lease/queue and safe cleanup**. Do **not** put OneDrive UI commands into the RIFT input queue or reuse its RIFT-specific key-release cleanup assumptions. Lab 1 already has a blocked RIFT queue item; keep that quarantine independent. No live queue, guest receiver, focus, OneDrive, or RIFT actions were taken to create this report.

## 4. Root-cause hypothesis ranking (provisional, NOT measured probabilities)

| Priority | Hypothesis / discriminator | Assessment from existing evidence |
| --- | --- | --- |
| P1 | Automatic pause from Windows *actual metered connection cost*, background restriction, or policy | **Unresolved**; Public-category NIC and UserSettingMeteredNetworkEnabled=0 do not answer the required cost/effective-policy question. |
| P1 | Manual 2/8/24-hour pause, or automation selecting pause/quit | **Unresolved**; historical Resume UI and startup tasks do not identify actor or transition. |
| P2 | Sign-in/quota/client attention, or one client in a different Windows session | **Unresolved**; must classify present icon/status, process owner/session, account error before acting. |
| P2 | Three-device edits / large addon, SavedVariables, or file-count backlog | **Plausible source of backlog after resume**, not independently a cause of pause. |
| P2 | Files On-Demand offline placeholders | **Previously evidenced as separate addon-loading hazard**; not a proven sync-pause cause. |
| P3 | VMware NAT/DNS, connection changes, host connectivity, guest time jump or snapshot | **Possible environmental triggers**; nothing in current evidence demonstrates causality. |
| P3 | Saver/power event | **Lower priority** because no battery, Balanced scheme and selected sleep events were previously negative; still requires direct effective-state confirmation. |

The fact both guests exhibit a similar user-visible problem may point to shared configuration, deployment, or external sync behavior, but that is an **inference**. Compare precise evidence between labs before concluding shared causation.

## 5. Independent addon deployment path is not a OneDrive repair

The existing RR2 workflow at riftreader2/docs/workflows/addon-sync.md, scripts/addon_sync.py, and scripts/addon_sync_guest.ps1 already knows how to propagate authoritative repository addon files to PC/Lab1/Lab2 and check SHA256 and Offline/Pinned attributes. The guest installs live under C:\Users\mrkoo\OneDrive\Documents\RIFT\Interface\AddOns\RiftReader2. A previously Offline guidance.lua was backed up and replaced from repository/pinned source.

- **check / verify:** are non-writing with respect to installed addon files, **but not zero-side-effect overall**: they create artifacts/reports, and guest checking stages a script and writes a guest-local report. Thus **do not run them under this no-guest-command research authorization**.
- **sync:** intentionally backs up/writes installed addon files, verifies SHA256, and requests pinned/local availability; requires its own explicit deployment authorization and does not explain or fix an independently paused OneDrive.
- The guest script checks Offline attributes before hashing and refuses to hash an Offline placeholder. Preserve that safeguard. Avoid using mass sync as a diagnostic to force OneDrive backlog.
- Game reload and VMware power/focus are outside this investigation; never equate "addon present" with "OneDrive healthy."

## 6. Follow-on procedure — explicit authorization gates

**Tier 0 (this report): ✅ complete, research-only.** No guest commands/UI/actions. Preserve the existing baseline and existing blocked Lab1 queue.

**Tier 1 (separate approval):** Read-only host/process/session inventory, narrow existing status/log summaries, current network cost/power/time and metadata-only bounded addon paths in **one guest at a time** using a verified guest interactive session and new UIA-specific control boundary if needed. Reject a guest target that cannot be tied to the correct session, or a blocked lease. Collect one receipt per lab. No screen capture unless separately approved.

**Tier 2 (separate approval):** If passive evidence insufficient, request Joey's timestamped screenshot of the expanded OneDrive status panel, or supervised in-guest UIA **inspection** of a tray flyout with RIFT unfocused only by informed permission; menu opening itself changes UI state. Never steal focus while game is in play. Compare Labs before action.

**Tier 3 (distinct explicit change approval):** A scoped, supervised pause/resume experiment for **one non-critical guest**, after preserving queue and file baselines, to measure backlog growth and recurrence. Do not click Resume automatically as part of Tier 1/2. Trigger no sign-in, process kill/reset, unlink/relink, cache deletion, cloud cleanup, task enable/disable, Windows settings changes, VM snapshot/power changes, or guest reboot. Lab 1's blocked RIFT queue stays quarantined pending independent diagnosis; Lab 2 is a candidate only after readiness/lease safety checks, otherwise use a synthetic guest.

**Handoff if a gate fails:** Log lab ID, time, denied or unavailable capability, last reliable read-only observation, risk to running RIFT, and exact human action requested. Do not work around permission/security/session restrictions.

## 7. Official primary-source references (checked 2026-11-04)

1. Microsoft Support, [Pause and resume OneDrive sync](https://support.microsoft.com/en-us/onedrive/how-to-pause-and-resume-onedrive-sync) — manual 2/8/24h pause and automatic battery saver/metered-network pauses.
2. Microsoft Support, [What do the OneDrive icons mean?](https://support.microsoft.com/en-us/onedrive/what-do-the-onedrive-icons-mean) — paused, signed-out, attention, sync-in-progress icons.
3. Microsoft Support, [Fix OneDrive sync problems](https://support.microsoft.com/en-us/onedrive/fix-onedrive-sync-problems) — status-based troubleshooting, error categories.
4. Microsoft Support, [Save disk space with OneDrive Files On-Demand](https://support.microsoft.com/en-us/onedrive/save-disk-space-with-onedrive-files-on-demand-for-windows) — online-only vs locally available vs always-keep-local.
5. Microsoft Learn, [Files On-Demand on Windows](https://learn.microsoft.com/en-us/sharepoint/files-on-demand-windows) — file attributes and pinning behavior.
6. Microsoft Learn, [NetworkInformation class](https://learn.microsoft.com/en-us/uwp/api/windows.networking.connectivity.networkinformation?view=winrt-28000) — ConnectionProfile / ConnectionCost fields; cost is distinct from network security category.
7. Microsoft Support, [Processing changes](https://support.microsoft.com/en-us/onedrive/troubleshoot-onedrive-sync-issues-stuck-on-processing-changes) and [Sync pending](https://support.microsoft.com/en-us/onedrive/onedrive-is-stuck-on-sync-pending) — backlogs can arise from active files, many files and sync conflicts.
8. Microsoft Support, [OneDrive limitations](https://support.microsoft.com/en-us/onedrive/restrictions-and-limitations-in-onedrive-and-sharepoint) and [Microsoft storage quotas](https://support.microsoft.com/en-us/onedrive/microsoft-storage-quotas) — file-count, name, quota and conflict considerations.
9. Microsoft Learn, [Build a cloud-file sync engine](https://learn.microsoft.com/en-us/windows/win32/cfapi/build-a-cloud-file-sync-engine) — cloud-file hydration behavior.
10. Broadcom KB, [Time synchronization in VMware virtual machines](https://knowledge.broadcom.com/external/article?legacyId=1189) and [guest time drift](https://knowledge.broadcom.com/external/article/310305/time-in-virtual-machine-drifts-due-to-ha.html) — guest clock changes as an investigable hypothesis.
11. Broadcom KB, [Troubleshooting guest network connection failures](https://knowledge.broadcom.com/external/article/307964/troubleshooting-network-connection-failu.html) and [VMware NAT networking](https://knowledge.broadcom.com/external/article/310849/connecting-to-vmware-virtual-machines-us.html) — host/guest/NAT separation.

**Bottom line:** The historical screenshot supports **paused** at that moment. The exact cause remains unknown. The highest-value next safe discriminator is a *current*, correctly session-attributed OneDrive status and Windows connection-cost/power observation, with Files On-Demand metadata handled as an independent artifact-risk check.