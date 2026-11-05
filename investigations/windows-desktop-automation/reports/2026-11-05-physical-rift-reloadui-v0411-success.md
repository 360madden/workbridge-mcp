# Physical RIFT /reloadui — successful guarded one-shot and RRECollector v0.4.11 verification

Date: 2026-11-05 (America/New_York, EST UTC-05:00)
Outcome: **PASS**. One authorized UI-only reload submitted; independently verified. No game or Windows restart.
Scope: **physical** running RIFT only; VMware labs excluded.

## Authorized target and action

- User authorized precisely one `/reloadui`, the RIFT **game UI** refresh, without restarting RIFT or Windows.
- Windows target at time of action: `rift_x64`, PID `32156`, HWND `462734`, window class `TWNClientFramework`, Windows session 1, start UTC `2026-11-05T15:31:50.6416621Z`.
- Adapter: `scripts/physical-rift-reloadui.mjs`, current safety-fix commit `3062baf87df5f6217de4ca1ac2dddc78b1c28cbf`; independently tested **23/23** synthetic cases.
- Fixed input sequence, targeting the identified RIFT HWND in a single guarded turn: focus root/window, Enter, literal `/reloadui`, Enter. No blind retry.
- One-shot user action ID: `physical_rift_reloadui_20261105_once02`.
- Workbridge terminal job: `physical_rift_reloadui_one_approved_20261105b`, passed exit 0.
- Submission receipt: `2026-11-05T22:21:00.132Z` (**5:21:00 PM EST**), `submitted:true`, `verified:false` (correct: game postcondition requires independent evidence), `integratedFocusVerified:true`.
- Console: `{"ok":true,"replayed":false,"submitted":true,"verified":false,"status":"SUBMITTED_PENDING_EXTERNAL_GAME_EVIDENCE"}`.
- Durable evidence: `.tools/desktop-evidence/physical-rift-reloadui-physical_rift_reloadui_20261105_once02.receipt.json` and `.tools/desktop-evidence/physical-rift-reloadui-singleton.intent.json`.
- An *earlier* dry-live command attempt `physical_rift_reloadui_one_approved_20261105a` was denied at the screenshot age gate **before any key** (`CHAT_STATE_UNVERIFIED`, `inputSubmitted:false`). Subsequent fresh screenshot and distinct one-shot ID resulted in the single actual input.

## Independent game-side postconditions

- Fresh pre-input screenshot at `2026-11-05T22:20:34.473Z`, request `physical_rift_reload_visual_20261105c`, SHA256 `c8c4060020f97d829cde6e56846b04f14238da25cec201cc9db2a27c0754aff5`. Chat was visibly closed/empty; `RRE v0.4.11 research` window present.
- Post-input screenshot at `2026-11-05T22:21:20.214Z`, request `physical_rift_reloadui_postcheck_20261105a`, SHA256 `ca6bc136f6fda5198d6d392340632953e9d6684ad380f50c4010c46e2a1dda41`.
- The latter screenshot shows fresh chat initialization including `[RRECollector] v0.4.11`, additional loaded addons, and addon windows newly open (LuaPad and RiftReader readiness). This is independent evidence of RIFT UI reinitialization.
- Concurrent Windows desktop enumeration independently confirmed **one** RIFT window alive, same PID `32156`/HWND `462734`, foreground true. No game process replacement.

## Persistence integrity audit (independent read-only reviewer)

- Original pre-input `RRECollector.lua` backup stored at `.tools/desktop-evidence/rift-reloadui-baselines/physical-rift-20261105-pre-reload01/RRECollector.lua`, 74,216 bytes, SHA256 `8321e9e3fa850c2b1500287cf72da4c0f4f29b47c1ad581b016a1de2a184c4ed`.
- Live account SavedVariables file at `OneDrive/Documents/RIFT/Interface/Saved/<account>/Deepwood/Atank/SavedVariables/RRECollector.lua`, post-update mtime `2026-11-05T22:21:00.331Z`, 74,216 bytes, SHA256 `04aa55ec18db2dc6ff892b207d6c62cc5f04c1dd8046e4193ce7ab7f064c27b7`.
- Independent read-only diff job: `independent_rift_reload_savedvar_diff_20261105`, exit 0; 2,544 lines compared, **2,542 identical**. Only persisted window coordinates differ: line 2525 `x 1312 → 1178`, line 2526 `y 438 → 426`.
- Version **0.4.11**, **69** known abilities, **96** static candidates, **8** toolbar pins remained unchanged. The different hash is explained entirely by the two window coordinates; research data persisted.

## Workbridge quarantine and safety after execution

- The historical November 2 desktop-input quarantine was previously archived under the verified recovery protocol with hashes/journaling, not blindly deleted.
- After submission, independent directory queries found **zero** `desktop-input-turn.lock`, `desktop-turn-quarantine-*.json`, or `desktop-turn-admission.lock`.
- Singleton intent and submission receipt are **retained by design** to prevent replay. Do not erase them to repeat the command.
- The Workbridge adapter deliberately reports `verified:false` at the transport layer; the game-side screenshot and SavedVariables write establish final end-to-end verification.

## What was not tested

- No Windows restart, RIFT game restart, VM interaction or additional `/reloadui`.
- No blanket proof that every loaded addon feature works; only successful initialization, v0.4.11 presence, and recorded SavedVariables persistence were verified.

## Next milestones (priority)

1. **P1:** Keep the receipt and singleton evidence immutable; ensure future diagnostic tooling reads these artifacts and reports completed one-shot operations without replay.
2. **P2:** Make the independent game-side verification into a read-only Workbridge status command: expected PID/start, postimage metadata, RRECollector init line or persistent save event, and lock hygiene.
3. **P3:** Resume RRECollector v0.4.11 functional/UI checks (toolbar hover, individual buttons and research workflow) in a separate explicitly scoped test, with no automatic extra `/reloadui`.
