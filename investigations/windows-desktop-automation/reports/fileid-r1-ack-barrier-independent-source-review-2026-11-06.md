# R1 .NET 10 synthetic native FileId lease — independent source gate

**Date:** 2026-11-06 UTC  
**Status:** 🟢 **GO for one investigation-only build and one bounded GUID-OS-temp synthetic negative matrix.** 🔴 **HOLD** the optional 40× benchmark, live desktop guard/admission files, provider integration, VMware/RIFT/OneDrive, service/scheduler changes, and production cleanup. Source-only assessment; reviewer performed no build, run, lock mutation or desktop input.

## Exact frozen sources reviewed

- `investigations/windows-desktop-automation/prototypes/fileid-lease-r0/Program.cs` SHA `ed8fb66db1cc37d7818a19fedcc3329b9b4ce2d53af0c19fdbe4cd3144eab586`
- `investigations/windows-desktop-automation/prototypes/fileid-lease-r0/r1-synthetic-run.mjs` SHA `e266b11ce367bb34607a06ec84514419b7f54bc1613d4209b2fbbb18a7ff0ebd`
- `investigations/windows-desktop-automation/prototypes/fileid-lease-r0/R1-DESIGN-2026-11-05.md` SHA `7fda6409c5358266b10a6988d3c46e0e741951a4a13e2f5fc3d5b2d256afcf9e`
- `investigations/windows-desktop-automation/prototypes/fileid-lease-r0/FileIdLeaseR0.csproj` SHA `6c09f924be3981b364383ec75f42277343b4d7076445db3592d8f19779df0312`, targeting `net10.0`, warnings-as-errors, build artifacts isolated under `temp/fileid-r1-{bin,artifacts}`.

## Critical proof construction, source-only

| Concern | Verified source gate |
| --- | --- |
| Fixed synthetic scope | 🟢 Native accepts only `create` / `release`, a normalized 32-hex GUID, fixed `workbridge-fileid-r0-<GUID>` directory and `synthetic-fileid-lease.lock` under Windows OS TEMP. It never accepts an absolute file operand. Directory ancestors/reparse and leaf identity validated. Node checks LocalAppData\Temp realpath, excludes workspace, live evidence, RIFT, VM, OneDrive and redirected temp, and confirms native temp hash on each created fixture. |
| True identity + bytes | 🟢 Release opens file via `CreateFileW(GENERIC_READ|DELETE, FILE_SHARE_READ, OPEN_EXISTING|OPEN_REPARSE_POINT)`; on this **same OS handle** checks NTFS volume 16 hex + 128-bit FileId 32 hex, `NumberOfLinks==1`, no reparse, no delete pending, 2–4096-byte size, exact SHA-256 and lease stamp, then rechecks handle FileId, size and links. No pathname-delete fallback. |
| Held-handle ACK race | 🟢 Native emits flushed `stage:pinned` **after** identity/hash verification while the same original DELETE-capable handle remains open. It reads exactly `ACK` from stdin, max 1500ms. Missing/invalid ACK returns explicit `BARRIER_TIMEOUT_RETAINED` / `BARRIER_ACK_INVALID_RETAINED` **without** disposition. Only valid ACK permits `SetFileInformationByHandle(FileDispositionInfo)` with asserted 1-byte native BOOLEAN; after handle disposal, checks original pathname genuinely absent. |
| Independent interleaving | 🟢 Node concurrently spawns separate exact owned release process, awaits `PINNED`, attempts `rename(original,alias)` **before** writing ACK, checks rename refused with Windows sharing/permission code; verifies native two-line result, original and alias absent only after ACK. B02 explicitly withholds ACK and requires nonzero native exit + surviving lock. H01 hardlink, S01 shared-read handle, R01 directory junction (SKIP if unavailable) are additional private negative cases. |
| Bounded process action | 🟢 Node calls `spawnSync` with 8s timeout and non-shell, `spawn` with 5.5s owned-child deadline and `windowsHide:true`, rejects absent READY and unexpected exit, drains bounded stdout/stderr, kills **only exact owned test child** on its timeout. Separate PowerShell holder reads only GUID fixture and exits after 1.5s. One negative matrix, optional 40× performance branch disabled. |
| Failure semantics | 🟢 Native returns safe fixed error code, no raw path/PII; harness aborts on first unknown outcome, retains private fixtures, no implicit retry or backup release. `FILE_SHARE_READ` deliberately excludes share-delete so competing rename should fail while pinned; test falsifies the assumption against actual host FS/filters. |

## Remaining conditions / scope limitations

1. **Executable provenance is a caller responsibility.** Node runner accepts any absolute `.exe` with a *caller-provided* SHA; that is not an intrinsic trust anchor. Coordinator must pass only the exact freshly built `C:\work\workbridge-mcp\investigations\windows-desktop-automation\temp\fileid-r1-bin\FileIdLeaseR0.exe`, independently hash that binary and recheck frozen source before one run. Do not pass the older R0 EXE or an arbitrary path.
2. **No private Job descendant guarantee.** Node deadline can signal-kill owned native child, but on an error rejects before proving full process-tree settlement. This pilot contains no synthetic child spawn beyond intended exact commands, and unknown outcome must block future retries. A production provider requires separate Job/lease integration.
3. **Filesystem reality is not yet tested.** Hardlinks, reparse privilege, antivirus filters and FILE_SHARE_READ share-deny interleaving may behave differently. A missing junction privilege is explicitly SKIP, never a pass; a failed case is a diagnostic HOLD, never authority to touch real guards.
4. **Temporary artifacts:** This matrix creates a small number of GUID-owned files/directories, retains them for evidence, and performs a few owned test-file releases. These synthetic fixture edits are authorized only for the single bounded trial; do not recursively clean unknown existing directories.
5. Successful R1 evidence would demonstrate a *file identity and release invariant*, not desktop action delivery, UIA reliability, process-tree ownership, or unattended production safety.

## Acceptance for author/coordinator's ONE run

Build only the reviewed `net10.0` source to the separate ignored R1 directory, zero errors/warnings, independently pin EXE SHA. Then one Workbridge-bounded `r1-synthetic-run.mjs ABS_R1_EXE EXACT_SHA` invocation **without `--benchmark`**. Require unique truthful H01, S01, B01, B02, R01 pass-or-explicit-skip receipts, native temp-root hash parity, no unexpected launch/timeout, verified original/alias state, and actual OS exit0 with untruncated output. Any uncertainty => HOLD and retain existing evidence. No live Workbridge path may be passed or accessed.
