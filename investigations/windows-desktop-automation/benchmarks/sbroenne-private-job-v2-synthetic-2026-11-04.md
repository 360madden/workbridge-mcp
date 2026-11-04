# M3-P5 Sbroenne v2 private-Job supervisor — synthetic containment verdict

Date: 2026-11-04 (America/New_York). **Status: 🟢 synthetic clean + forced-negative containment PASS; 🟡 real MCP/UIA/desktop remains HOLD.** This is not a performance benchmark or a production Workbridge change.

## Why an isolated v2 exists

The committed v1 native host assigned **itself** to a kill-on-close private Job. Two unexpected `conhost.exe` members made its exact-three-member assumption invalid; the host printed `HOST:UNKNOWN` while Workbridge sometimes showed wrapper exit0. v1 source and the prior RED report remain unchanged.

V2 creates a **private child-only Job** while the C# host stays outside. It invokes exact SHA-pinned `C:\Program Files\nodejs\node.exe` with `CreateProcessW(CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT)`, `STARTUPINFOEX` restricted inherited handle list containing only synthetic child stdin-read/stdout-write (stderr shares bounded stdout). It verifies the private Job initially has **zero** members; assigns the still-suspended Node handle to the non-inherited KILL_ON_JOB_CLOSE Job; verifies exact singleton membership; then resumes the Node thread. No `ShellExecute`, WMI process launch, daemon, GUI, UIA, screenshot, keyboard, mouse or VM control.

After the synthetic child announces `READY:<PID>`, v2 verifies both **distinct** Node/child PIDs appear in a complete PID list and belong to the private Job, with matching session/process start and bounded classification of any additional Windows `conhost.exe` members. It requires a coherent `JobObjectBasicAccountingInformation` count and complete `JobObjectBasicProcessIdList` with returned-bytes bounds. It publishes `HOST:SETTLED:0` **only after** the Node exits 0 and three stable checks observe private Job active count0 and empty PID list while the host is still alive. On failure it terminates owned Node/Job, waits for empty settlement, reports sanitized `HOST:BLOCKED` and returns OS exit3/4.

### Pinned isolated artifacts (paths relative to investigations/windows-desktop-automation)

| Artifact | SHA256 |
|---|---|
| `prototypes/Sbroenne-PrivateJob-V2.cs` | `55a3571647fcb525c605d7f922e63885809ec01dffd9f3a88f00f882ff6f9b30` |
| `prototypes/Sbroenne-Provider-Host-V2.cs` | `e13c9693ac093b2bc35f65d2ef21fe1af0207aae0886129717a75a234e81246e` |
| `prototypes/sbroenne-job-v2-synthetic.mjs` | `2926455f353d65f9cff54112e71cebfb9c696676a371c56f4cbdae200c79194e` |
| Ignored `temp/Sbroenne-Provider-Host-V2.exe` | `5e4bd51f0fee8347638e4749ac8ecb3a9e3150d5f5525c85d5e4a9010348f4f8` |

The v2 fixture is **new**, rather than mutating the existing SHA-pinned v1 synthetic script. It clears/unrefs its ACK timer and pauses/destroys stdin after GO, enabling deterministic Node shutdown. Node executable SHA remains `119d6fa70e6ae1b15b90688ab6bcc8e3a2819acea021af196895cab1843645af`. Independent FLAUI and watchdog reviewers examined Win32 ABI/handle ownership/source safety before child process testing. Only Windows built-in C# compiler and a pinned Node script were used; no SDK installation or system configuration changes.

## Execution receipts

| Gate | Workbridge Job ID | Observed result |
|---|---|---|
| Initial v2 compile-only | `wda_sbroenne_v2_synthetic_compile_only_20261104_m3p5` | **PASS**, exit0, no warnings |
| First clean synthetic | `wda_sbroenne_v2_suspended_clean_synthetic_20261104_m3p5` | **BLOCKED, exit3**, `ATTRIBUTE_SIZE_INVALID`, Job empty; arbitrary attribute-list lower bound rejected valid smaller Win32 size, before child creation |
| API-derived attribute-list fix compile | `wda_sbroenne_v2_attribute_list_fix_compile_20261104_m3p5` | **PASS**, exit0, no warnings |
| Second clean synthetic (v1 fixture) | `wda_sbroenne_v2_suspended_clean_retry_20261104_m3p5` | **BLOCKED, exit3**, suspended Node assignment + READY members3 proven, but v1 fixture had dangling stdin/10s timeout; host reported `NODE_EXIT_INVALID:JOB_EMPTY:1` |
| New dedicated v2 fixture syntax | `wda_sbroenne_v2_synthetic_fixture_syntax_20261104_m3p5` | **PASS**, exit0 |
| Final v2 fixture compile | `wda_sbroenne_v2_lifecycle_fixture_recompile_20261104_m3p5` | **PASS**, exit0 |
| **Final CLEAN synthetic** | `wda_sbroenne_v2_fixture_final_clean_20261104_m3p5` | **PASS, OS exit0**, complete terminal success and Job empty |
| **Final FORCED-NEGATIVE synthetic** | `wda_sbroenne_v2_fixture_forced_negative_20261104_m3p5` | **EXPECTED failure, OS exit3**, blocked code + owned Job empty |

Exact final success receipt (synthetic only):

```text
HOST:ASSIGNED_SUSPENDED:49072:ACTIVE:1
HOST:READY_MEMBERS:3:NODE:49072:CHILD:47420
RESULT:success:SYNTHETIC_ONLY:none
HOST:SETTLED:0:NODE:49072:DURATION_MS:265
```

Exact final negative receipt:

```text
HOST:ASSIGNED_SUSPENDED:47048:ACTIVE:1
HOST:READY_MEMBERS:3:NODE:47048:CHILD:57084
HOST:BLOCKED:FORCED_NEGATIVE_TEST:JOB_EMPTY:1
```

The forced-negative Workbridge result was `failed/exitCode:3`, matching native host semantics (unlike ambiguous v1 exit0). The 265 ms synthetic duration is **not** a desktop/UIA or Workbridge automation latency measurement.

## Residual gates — no GUI authorization inferred

- Private Job membership proves the exact synthetic Node and child are controlled and the Job reached zero; it **does not prove** every OS console auxiliary created before suspended assignment was inside the private Job. For a future GUI/MCP trial, separately inventory outside-Job process descendants, inherited service/console processes and potential escapes. The source explicitly permits only known system-path `conhost.exe` as an additional *inside*-Job member.
- The clean and controlled-negative tests do **not** simulate abrupt supervisor crash or long-lasting hung children. A future bounded kill-on-close failure injection and independent descendant process inspection are required before claiming full production readiness.
- The actual Sbroenne MCP stdio server, UIA snapshot, native DesktopProbe, VMware, RIFT and other real desktop applications were **never launched or interacted with** by v2 tests.
- A foreign/quarantined RIFT desktop-input-turn lock remains a separate hard gate; never remove or steal it. The day-to-day Workbridge backend stays unchanged.

**Decision:** v2 successfully resolves the *synthetic* self-owned Job / misleading exit-code failure. Preserve this as a research provider-supervision foundation. Keep real desktop snapshot pilot HOLD until coordinator explicitly approves the next isolated safety gate. All files are limited to this investigation; ignored binaries retained for audit, no production changes.
