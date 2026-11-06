# DesktopProbe orphan-pair read-only inspector: synthetic e01 failure (2026-11-06 UTC)

**Status: FAIL, OS exit code 1.** No test retry or real incident recovery was performed. This is an investigation-only finding.

## Precise receipt

- Workbridge terminal job: wd_orphan_inspector_private_matrix_20261106_e01
- Executable: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe, -NoProfile -NonInteractive -File investigations/windows-desktop-automation/prototypes/desktopprobe-watchdog/Inspect-WatchdogOrphanPair-Synthetic.Tests.ps1
- Started: 2026-11-06T00:00:38.853Z; ended: 2026-11-06T00:00:40.828Z; elapsed approx. 1.975 s.
- True OS exitCode=1; status=failed; 1580 retained output bytes; 0 stdout bytes, 1580 stderr bytes; outputTruncated=false.
- First fixture I01_exact_pair_classified_review_only FAILED. Child returned EXPECTED_NATIVE_FILE_ID_INVALID; parent assertion EXPECTED_PASS_EXIT_FAILED_I01_exact_pair_classified_review_only_EXIT_1. No suite-end 11/11 result. **Passing case count is not established and must never be represented as success.**
- Source at e01: inspector SHA 1da6f560896b9a97ea9cc2cc1935acb336d4e302018f49c1cf113011947c1658; fixture harness SHA cda9160fb2f25e06a7b7c0581f2f6df09019a9e7667f4e725a5d10d623a4f05a.
- Private first fixture remains deliberately retained in a unique GUID-root OS-temp wb-orphan-recovery-fixture- directory because failure prevented normal cleanup. **Do not auto-delete** without exact owner/hash review.
- E01 fixture harness was bounded by <=90s Workbridge Job, 55s global pre-case check, and 4.5s+1.5s per child. Failure occurred before any timeout.

## Confirmed root cause (source-format mismatch)

The inspector's validation expected VolumeSerial16 plus 16 **dash-separated** FileId byte pairs. The exact hash-pinned native source at scripts/Archive-DesktopQuarantine.ps1:131 and :140 computes FileIdInfo identity as volumeSerial.ToString("x16") + colon + BitConverter.ToString(id.Identifier).Replace("-", ""): **16 lowercase hexadecimal volume characters, colon, 32 contiguous uppercase hexadecimal ID characters**. Thus a genuine native FileId was refused by the inspector before any attempt to classify the pair.

## Isolated correction prepared, NOT yet runtime-verified

- Inspector SHA 2703a06c062936cba47456515af316f35c1b28c85c7cee49d1ebaca08a3cc703 validates exact 16lower:32upper native identity using an end-of-string anchor; no producer or file-identity check was loosened.
- Harness SHA f9d18f3149b619a142e3c5d4bc973396e3abab4ae61ca5bd3e5060ab449c6d2a hash-pins updated inspector before any fixture and every child, updates dummy FileId to compact, and adds negative I12_dashed_native_file_id_rejected while I01 remains positive compact-format contract.
- Fresh non-mutating parser/NTFS/temp/source preflight job wd_orphan_inspector_fileid_parser_preflight_20261106_e02 **OS exit0**, syntaxErrors=0, sourceFilesParsed=2, nativeIdentityCompactSourceProof=true, osTempSafe=true, ntfs=true, ordinaryParents=true, noFixtureCreated=true and noLiveDesktopAccess=true.
- WinApp and FLAUI peers independently source-GO corrected source for a separately authorized bounded private 12-case e02; **that is a source/approval gate, not a runtime PASS**.

## Scope and current protection

The e01 test used only private synthetic Windows NTFS files and mock census; **no shared .tools desktop locks, live task/process inventory, physical RIFT, VMware guest, GUI input, service update or real archive**. Inspector -Execute remains deliberately disabled before file access. Historical GUI outcome remains unknown_outcome, and no quarantine admission/guard can be released based on this test.
