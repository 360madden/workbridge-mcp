# Passive modal oracle — pure in-memory state model proof (2026-11-05 ET)

**🟢 OFFLINE 8/8 PASS; no Windows UI code executed.** This is a narrow deterministic state-model contract for the existing separately compiled native oracle. It does not exercise the C# observer, process hooks, WinApp, Sbroenne, desktop GUI, input, VMware, RIFT, OneDrive or Workbridge service.

## Exactly frozen sources and one job

- Pure oracle-model.mjs SHA256 **9f6c5eae6aadf60ef361b743872d0fba0388ccfc7ab34f4d0595ae28bf18b700**, size6008.
- Pure oracle-model.test.mjs SHA256 **cbd656871ee79a96ad090d3ef10eef9da93110d1a2e454c74a30dbe638aed934**, size4502.
- Read-only independent WinApp peer source review **GO** before any test: no fs, child_process, network, Win32, UIA, GUI or Windows API imports; bounded maximum1200 snapshots, 32 owned candidates each, target ID and monotonically increasing per-oracle tick validation.
- One bounded Workbridge terminal job **wda_modal_oracle_pure_model_offline_tests_20261105a**: executable node.exe, args --test investigations/windows-desktop-automation/prototypes/modal-dialog-oracle/oracle-model.test.mjs; started **2026-11-06T00:53:04.405Z**, ended **00:53:04.749Z**, status **passed OS exit0**, stdout **821 bytes nontruncated**, stderr0, Node test duration **82.4753ms**, 8 pass, 0 fail, 0 cancelled, 0 skipped.

| Case | Synthetic expected/observed |
| --- | --- |
| N01 late first baseline (owner disabled + visible existing modal) | 🟢 PASS — unknown LATE_ATTACH_OR_DISABLED_BASELINE, no claimed complete |
| N02 simultaneous two new owned visible HWNDs | 🟢 PASS — unknown AMBIGUOUS_NEW_OWNED_HWND |
| N03 originally tracked modal HWND reused by different PID | 🟢 PASS — unknown MODAL_HWND_REUSED_OR_OWNER_CHANGED |
| N04 owner exits before modal destruction | 🟢 PASS — unknown OWNER_IDENTITY_CHANGED_OR_EXITED |
| N05 all WinEvents absent, native poll samples complete | 🟢 PASS — **verified_native_cycle** without trusting callbacks |
| N06 50s deadline expires without visible owned modal | 🟢 PASS — unknown INCOMPLETE_OR_LATE_DEADLINE |
| N07 contradictory single sample says modal visible AND IsWindow=false | 🟢 PASS — unknown CONTRADICTORY_VISIBLE_BUT_DESTROYED_SAME_SAMPLE |
| P01 positive control with supplemental WinEvents | 🟢 PASS — verified_native_cycle with exact transition ordering |

The pure reducer requires exact PID, start ticks, session, root owner HWND, owner enabled→disabled, one previously absent same-owner/new visible top-level HWND, independently observed original modal IsWindow=false, same owner enabled and no visible owned children, under its monotonic deadline. It does not mutate the input. A native WinEvent notification alone never grants success.

## Deliberate limitations — do not overclaim

- This test validates **the pure modeled contract, NOT C# P/Invoke behavior** and not actual UIA provider snapshots. The previously compiled native observer Program.cs SHA d0967a0643cd48612f207aa3382874d0da24e146dd9549c17195c6ef3acd7fa6 is not loaded or executed.
- Same-PID, same-owner HWND destruction and reuse entirely **between two 50ms polling samples** cannot be excluded without independent native hook/creation evidence. Treat this as an unresolved identity risk in a future live pilot.
- Model stops on first complete cycle; it does **not** run a post-destroy/late-modal watch (~300ms vendor heuristic) or prove no delayed new owned window.
- The model currently rejects iconic=true but accepts an omitted iconic field; its own test constructors include iconic:false. Stronger schema completeness is a separate code review gate before generalization.
- The supervisor's SID, WinSta0/Default desktop, pinned fixture executable, foreground/lease and <=60s child-owning Job duties remain unproven for a live run. The model does not inspect user tokens or target process handles.
- No p50/p95 on real UIA or native polling was measured from these deterministic in-memory tests. The Node internal 82.4753ms is **unit-test duration**, not Windows dialog latency.

## Next safe decision

**Stop** at the reviewed pure state model. A first real native/WinApp/Sbroenne modal pilot needs a separate Joey-approved quiet desktop, exact fresh process/session/SID/owner HWND, full admission/GUI-turn fence, pinned source/build, hard private Job/teardown, and strictly read-only provider calls one per fresh disposable fixture. Do not launch or interact with the existing Windows app/RIFT/VM/OneDrive or infer that Workbridge production now has modal handling.
