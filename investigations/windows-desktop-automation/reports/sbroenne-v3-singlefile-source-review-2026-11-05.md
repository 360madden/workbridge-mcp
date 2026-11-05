# M3-P7 Sbroenne v3 single-file protocol supervisor — independent source gate

**2026-11-05. 🟢 GO one bounded no-GUI protocol-only smoke after compile; 🔴 HOLD all UIA calls, screenshots, focus/input and production registration.** This reviewer did not execute the supervisor or GUI.

## Pinning

- Host prototypes/Sbroenne-Mcp-Provider-Host-V3.cs: SHA256 **73d3f24297946f5c16ea701f58cab03314a6b5dc6b0b29e3d442db9e1a0ce068**.
- Node prototypes/sbroenne-mcp-v3-singlefile-protocol.mjs: SHA256 **79204d1230827979eb63c7c779c413a4fbfda9e917567b5de874c4905ed1409e**.
- Reused V2 suspended child launcher: SHA256 **96982e1b64dea6560827da3df309f40810cc2d90dc84352283b6029b7f3d5ce2**.
- Reused V2 private Job: SHA256 **55a3571647fcb525c605d7f922e63885809ec01dffd9f3a88f00f882ff6f9b30**.
- Expected single-file Sbroenne v1.3.28 EXE: size **59,893,792** bytes, SHA256 **ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128**, upstream commit 655b9fc92d03ad52a270067c6844ea1231c90559.

## Verified source gates

| Gate | Independent code observation |
| --- | --- |
| 🟢 Protocol-only allowlist | Native host requires exact protocol/-/sampleId syntax. Node checks the same, makes MCP connect and listTools() only, validates **exactly one** ui_snapshot tool. It contains no callTool, input, focus, screenshot or UIA tool invocation. |
| 🟢 No wincli daemon | Direct absolute pinned EXE launched via MCP stdio, literal arguments --tools ui_snapshot. Server stderr privately drained and discarded, no raw tool descriptions or UI text forwarded. |
| 🟢 Publish integrity | Both host and Node verify exactly one file under isolated singlefile publish directory, exact EXE SHA and size. Host separately pins exact Node EXE and protocol source SHA. |
| 🟢 Protected extraction root | Host validates C-work through temp ancestor paths are non-reparse directories, creates fresh sample-specific ignored directory, with protected DACL and only current user's full-access ACE, then verifies owner/DACL/emptiness. Node double-checks exact location and empty contents. |
| 🟢 Child-only env | Node passes SystemRoot, WINDIR, DOTNET_BUNDLE_EXTRACT_BASE_DIR and MCP_WINDOWS_TIMEOUT_MS only to the MCP server child through StdioClientTransport.env; no global environment mutation or inherited ambient secrets to that server. |
| 🟢 Process containment | Native Node created suspended with restricted STARTUPINFOEX inherited handles, attached to private KILL_ON_JOB_CLOSE Job before resume. Host checks exact runner/server PID, image, session and Job membership; extra members only recognized system conhost path/session/birth. |
| 🟢 Meaningful exit | Exact RESULT:success:PROTOCOL_ONLY:none, Node exit0 and stable Job empty required. After settlement, protected private extraction tree is inspected and bounded at 512 non-reparse entries; success emits EXTRACT_ITEMS and SETTLED:0 with OS exit0. Failure produces nonzero OS3/4 and bounded status. |

## Residual yellow limitations

1. Hash-before-launch is not an immutable open-handle lock: same-user time-of-check/time-of-use binary or directory replacement is theoretically possible. Parent-directory reparse checks also race. For this synthetic smoke, preserve current pins and classify changed files as BLOCKED; production hardening is a later gate.
2. DirectorySecurity ACL creation may fail under some Windows policies; **fail closed**. Microsoft documents native library extraction before managed startup when IncludeNativeLibrariesForSelfExtract=true. The source checks generated files **inside the private extraction root** after Job0 but does not independently measure whether Windows default TEMP/.net was untouched.
3. Job0 proves all **members of that private Job** settled; it does not independently inventory any console helper outside that Job. Retain Workbridge outer job/process census and do not infer a GUI-latency result.
4. The sanitized four-variable .NET child environment may benignly fail bootstrap. Preserve a nonzero outcome rather than widening environmental permissions unreviewed.
5. Actual UIA snapshot, modal behavior, foreground changes, stale targets and RIFT/VM desktop behavior remain **completely untested**; no new GUI permission follows from protocol success.

## One narrow future acceptance

Use a fresh unique run ID and outer Workbridge deadline at most 60s, source/binary SHA pin, no GUI fixture. Require entire nontruncated receipt in order: HOST:PRIVATE_EXTRACT_ROOT:1, HOST:ASSIGNED_SUSPENDED, HOST:READY_MEMBERS with runner/server, RESULT:success:PROTOCOL_ONLY:none, HOST:EXTRACT_ITEMS:n:RETAINED_FOR_AUDIT:1, HOST:SETTLED:0 and actual OS exit0. Preserve private extraction bytes for audit, do not auto-delete. Unknown/timeout requires held state and no blind replay. Old verified v2 and running Workbridge owner remain intact.

Primary docs: [Microsoft single-file extraction](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview), [Windows CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw).
