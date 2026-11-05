# Source-only audit: Sbroenne v3 environment, native bundle extraction and process ancestry

Date: **Thursday, November 5, 2026 (America/New_York)**. Status: **🟡 v3 protocol-only OS0/Job0 remains valid; 🔴 environmental confinement and outside-Job process/file side effects are NOT proved. No new server, GUI or desktop runtime was executed for this audit.**

## Corrected conclusion

The v3 native host created an owner-only ignored extraction directory, and its Node source explicitly supplied `DOTNET_BUNDLE_EXTRACT_BASE_DIR` in the Sbroenne stdio server's launch parameters. The one approved protocol-only receipt reported `HOST:EXTRACT_ITEMS:0` and a fully settled private Job. Those facts **do not prove** that the server's environment had only four keys, that no native DLL was extracted elsewhere, or that no transient helper process was created outside the private Job.

### Exact source chain

| Layer | Pin and decisive source fact | Conclusion |
|---|---|---|
| Native host `prototypes/Sbroenne-Mcp-Provider-Host-V3.cs` | SHA256 `73d3f24297946f5c16ea701f58cab03314a6b5dc6b0b29e3d442db9e1a0ce068`; creates unique protected current-SID extraction base; checks root DACL and surveys contents after Job0 | 🟢 Explicit private root and bounded survey; no evidence of OS loader destination |
| Reused suspended Node launcher `prototypes/Sbroenne-SuspendedMcpNode-V2.cs` | SHA256 `96982e1b64dea6560827da3df309f40810cc2d90dc84352283b6029b7f3d5ce2`; `CreateProcessW` lines 152–155 passes `lpEnvironment=IntPtr.Zero` | 🟡 Node inherits native-host environment; no native sanitization |
| Node v3 protocol source | SHA256 `79204d1230827979eb63c7c779c413a4fbfda9e917567b5de874c4905ed1409e`; `StdioClientTransport.env` includes `SystemRoot`, `WINDIR`, `DOTNET_BUNDLE_EXTRACT_BASE_DIR`, `MCP_WINDOWS_TIMEOUT_MS` | 🟢 The four values are explicitly provided to SDK; ⚠️ they are overrides, not a complete child environment |
| Installed MCP SDK `node_modules/@modelcontextprotocol/client/dist/stdio.mjs` | SHA256 `af887c8972a37b8c3fcc78192d8f1d56c099bf8ca365f4843ec51ced6f5650da`; `getDefaultEnvironment` Windows allowlist lines 10–28; `start` lines 74–78 constructs `env:{...getDefaultEnvironment(),...this._serverParams.env}` and `shell:false` | 🔴 Can forward other present defaults to .NET child; prior four-key-only claim retracted by commits `86d97e0`, `5441489` |
| Self-contained single-file vendor EXE | v1.3.28 pinned source commit `655b9fc92d03ad52a270067c6844ea1231c90559`; exactly one published file 59,893,792 bytes, SHA256 `ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128` | 🟢 Publish provenance; runtime native extraction still possible |
| Private Job helper `prototypes/Sbroenne-PrivateJob-V2.cs` | SHA256 `55a3571647fcb525c605d7f922e63885809ec01dffd9f3a88f00f882ff6f9b30`; exact suspended Node membership, READY PID census, repeated final active0/empty list; no continuous Job event collector | 🟢 Private Job membership/settlement as sampled; 🔴 no claim about outside-Job or ephemeral process history |

The SDK default Windows inherited-key names are **APPDATA, COMSPEC, HOMEDRIVE, HOMEPATH, LOCALAPPDATA, PATH, PATHEXT, PROCESSOR_ARCHITECTURE, PROGRAMDATA, PROGRAMFILES, PROGRAMFILES(X86), PROGRAMW6432, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERNAME, USERPROFILE and WINDIR**, if present in Node's inherited environment. This inventory is *key names only*: no values, user profile paths, credentials or command lines were accessed or emitted. The Native v2 launcher is not a secret boundary.

The v3 Node source uses mixed-case `SystemRoot`, while SDK defaults refer to uppercase `SYSTEMROOT`. Windows environment comparisons are case-insensitive, but the JavaScript object spread is case-sensitive, potentially producing duplicate logical keys; later Windows process creation resolves them. Normalize the exact key casing in any future revision and test with a safe child-key-presence oracle.

## What the zero-extraction observation does and does not mean

On the single approved v3 one-shot protocol run, the host reported:
```text
HOST:PRIVATE_EXTRACT_ROOT:1
HOST:READY_MEMBERS:4:RUNNER:43884:SERVER:61944
RESULT:success:PROTOCOL_ONLY:none
HOST:EXTRACT_ITEMS:0:RETAINED_FOR_AUDIT:1
HOST:SETTLED:0:RUNNER:43884:SERVER:61944:DURATION_MS:1142
```

This proves the **specific owned extraction root surveyed at the end was empty**. It does not distinguish: (A) .NET did not need disk extraction for this bundle/runtime path, (B) .NET used and later removed files from that root, or (C) extraction went to another location. Microsoft's deployment documentation says bundled native libraries can be extracted to `DOTNET_BUNDLE_EXTRACT_BASE_DIR` when set, otherwise Windows defaults to `%TEMP%\.net`. It does not justify choosing A/B/C from a final empty-directory snapshot. [Official .NET single-file deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/).

## Practical next evidence ladder — *all require a separate coordinator gate*

1. **Low-risk, synthetic-only environment key-presence oracle (recommended first).** Under a new explicitly scoped synthetic child (not the vendor UIA server), exercise the same installed SDK transport and emit only a fixed allowlisted set of **present/missing booleans** for variables such as `DOTNET_BUNDLE_EXTRACT_BASE_DIR`, `TEMP`, `PATH`, `USERPROFILE`. Do **not** print environment values, tokens, profile paths, raw JSON or command lines. Also test whether SDK `env` entries set to `undefined` suppress default inheritance as expected, using actual Windows process env semantics; fail closed on uncertainty. No production package modifications.
2. **Prefer an isolated v3.1 native runner with a complete explicit Unicode environment block.** A separate `CreateProcessW` helper could replace `lpEnvironment=IntPtr.Zero` with an exact NUL-delimited current-user child environment and `CREATE_UNICODE_ENVIRONMENT`, supplying only known required keys for Node module resolution and Windows startup. If Node's inherited defaults are absent, the SDK's default merge cannot forward them. Do not globally edit PATH or environment; pin new helper source/hash, compile to a new ignored executable, test syntax and synthetic echo before any real server. This is a design recommendation, **not implemented**.
3. **Prove bundle file destination without browsing unrelated user temp.** At a new protocol-only pilot, record file creation under the unique ignored extraction base with a pre-armed local file watcher and exact run/sample ID. This can prove positive use of that base if events occur; *absence of watcher events cannot prove zero extraction elsewhere*. To rule out default-temp alternatives or transient file writes, a separately approved short kernel ETW FileIo trace (process/PID and creation-time filtered, writing only safe counts/bucketed `private-vs-other` verdicts) is stronger but can require elevated trace authority and adds system diagnostic state. Do not start ETW/procmon/audit policy now. [Microsoft FileIo/Create ETW](https://learn.microsoft.com/en-us/windows/win32/etw/fileio), [Microsoft FileIo_Create](https://learn.microsoft.com/en-us/windows/win32/etw/fileio-create).
4. **Prove outside-Job process ancestry.** Current Job `Snapshot()` at READY and `WaitEmpty()` at termination are not a lifecycle-complete process event trace. `JOB_OBJECT_MSG_NEW_PROCESS/EXIT_PROCESS` completion port notifications could supplement, but Microsoft explicitly cautions delivery of ordinary messages is not guaranteed. A bounded kernel Process Start/Stop ETW session keyed by process key, exact PID, parent PID, creation time, session and basename/path trust offers more complete ancestry evidence, including console helpers outside Job. Store only required known-process metadata (no full command line) and classify dropped events as UNKNOWN. ETW setup/teardown itself needs a separate permission decision and is not part of ordinary desktop input. [Microsoft Job objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [Microsoft job completion port](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_associate_completion_port), [Microsoft process ETW events](https://learn.microsoft.com/en-us/windows/win32/etw/process).
5. **No GUI/UIA until then.** Continue with owner-only private extraction root, exact one-file hash, suspended Job assignment, bound timeouts, fixed result receipts, external reviewer and watchdog lease if a separately approved disposable DesktopProbe read-only pilot is pursued. Do not infer singlefile speed benefit from one 1142ms protocol sample vs earlier 1291ms multi-file sample.

## Explicit hold and correction trail

- Source-only audit; **no new `Sbroenne.WindowsMcp.exe` run, no `tools/call`, no GUI, no VM, no RIFT interaction, no hidden daemon**.
- Prior v3 protocol evidence committed in `e6e4047`; corrections committed `86d97e0` and `5441489` while retaining true OS0 and private Job0.
- **Decision: 🟢 single-file provenance and supervised protocol lifecycle; 🟡 child-env/base override *source verified*; 🔴 exact server env, effective extraction destination, and outside-Job process side effects not yet proven.**
