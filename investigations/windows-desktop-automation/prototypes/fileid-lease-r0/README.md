# FileId native lease: R0 synthetic-only prototype

Status: **R0 isolated build and one four-case synthetic-only execution PASS**, 2026-11-05. See `R0-EVIDENCE-2026-11-05.md` for exact SHA, job IDs, results and limitations. This does **not** change any Workbridge, GUI, RIFT, VMware, OneDrive, installed provider, Windows Task or canonical `.tools/desktop-evidence` lock. Follow `reports/held-handle-node-gui-release-remediation-roadmap-2026-11-05.md` before broader development.

## Exact safety boundary

- One standalone .NET 10 `FileIdLeaseR0.exe` with only `create` and `release` verbs. Neither accepts an arbitrary filesystem path. The sole object is `synthetic-fileid-lease.lock` under a fresh OS temporary directory named `workbridge-fileid-r0-` + a 32-character GUID.
- `create --fixture-id <32hex>` uses Win32 `CreateDirectoryW` (exclusive) and `CreateFileW(CREATE_NEW)`. Test-only flags `--existing-root` and `--abort-after-fsync` respectively exercise a precreated synthetic root and simulate an owned helper process exiting with status **91** immediately after flushing the created lock but before publishing a token. No arbitrary PID is killed.
- A successful `create` returns exact native `VolumeSerialNumber` + 128-bit `FileId`, byte hash, lease ID, fixture ID. No release can be attempted safely without the original token.
- `release --fixture-id ... --volume ... --file-id ... --sha256 ... --lease-id ...` reopens only that synthetic pathname with DELETE permission, checks file identity, one-link/non-reparse/ordinary/bounded stamp, recomputes fingerprint and lease, calls `SetFileInformationByHandle(FileDispositionInfo)` **on its open file handle**, closes, verifies canonical absence via `GetFileAttributesW`. There is no pathname `unlink` or "force" mode. Another file with identical bytes but a different native FileId is preserved.
- Missing/partial/foreign/uncertain files are retained for review; the helper never deletes directories, never auto-cleans orphan fixtures, and never treats PID age as authority. Output is one bounded JSON line on normal termination (or none on deliberate status-91 abort).
- Synthetic test cases retain their uniquely generated temp directories and print only fixture GUIDs, not unrelated process metadata or user directories; Workbridge saves job output. Any later fixture disposal is a separate exact-target operation.

## Reproduction recipe (already executed once; new runs require a new bounded approval)

From `C:\work\workbridge-mcp`, use the approved Workbridge bounded job route after source review and main-chat approval:

1. `dotnet build investigations/windows-desktop-automation/prototypes/fileid-lease-r0/FileIdLeaseR0.csproj -c Release --artifacts-path investigations/windows-desktop-automation/temp/fileid-r0-artifacts --output investigations/windows-desktop-automation/temp/fileid-r0-bin --nologo`
2. Independently inspect build artifact/hash, verify exact existing Windows .NET 10 SDK/runtime, then
   `node investigations/windows-desktop-automation/prototypes/fileid-lease-r0/synthetic-run.mjs C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\fileid-r0-bin\FileIdLeaseR0.exe`

The four bounded tests (8s max per owned child, no shell, no live GUI) cover: ordinary create/release + refusal of replay; swapping original A away and putting **same-byte** foreign B at its name; status-91 owner exit leaving a durable lock with no token; and two concurrent creators racing the same synthetic `CREATE_NEW` leaf. **They do not prove an in-flight release-versus-rename race**; that requires a later barrier-controlled test before any production migration.

Actual evidence: one pinned .NET10 build completed with 0 warnings/errors; four synthetic cases passed 4/4, including native temp-root hash equality with Node. The four GUID temporary fixture roots remain for review. This is NOT authorization for `WB-001` or an actual Workbridge desktop-input turn. Current production check-then-pathname unlink remains unchanged.

## Sources

- `scripts/Archive-DesktopQuarantine.ps1:40-195`: existing native `FileIdInfo` and handle disposition P/Invoke precedent.
- `investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/DesktopTurnLease.cs:263-384`: existing safe retained native admission creation-handle precedent.
- [Microsoft SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)
- [Microsoft FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)
- [Microsoft CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
