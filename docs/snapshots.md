# Saved memory snapshots

Workbridge inspects **existing files** under its workspace root. Raw binary dumps use direct file seeks; gzip files decompress once to the bridge's private `.local/snapshots` cache. The source file is never rewritten by these tools. No live process is opened and no new game snapshot is captured.

There is no 2 MiB whole-file limit. Reads beyond 4 GiB were tested using an NTFS sparse fixture. Byte offsets are limited by Node's safe-integer file positions (far beyond ordinary memory dumps); virtual addresses retain the full unsigned 64-bit range using strings and BigInt arithmetic.

## Practical ChatGPT workflow

1. Discover/list the snapshot directory. For JSON/JSONL summaries and candidate reports, use `read_file` (paged text) and `search_text` (`includeIgnored=true` when appropriate).
2. For a RiftReader sequence, call `snapshot_manifest` on `manifest.json`. Select its numeric `pose` index before address mapping if multiple captures exist. `address` must be a decimal or `0x` string; never approximate a large JSON number.
3. The mapping returns the segment's workspace-relative `path`, `baseAddress`, declared `sha256` (if present), byte `offset`, available bytes, and bounded read length. A range crossing a segment boundary is explicitly clipped; map the next address separately. Missing addresses return `mapping=null`; overlapping mappings fail rather than guessing.
4. For gzip, call `snapshot_cache` with `action="prepare"` and the segment `path`, then poll the same path with `action="status"` until `status="ready"`. This returns progress bytes and the actual decompressed SHA256. Compare it with the manifest's declared hash before trusting the capture. Files ending in `.gz` or carrying gzip magic bytes are recognized.
5. Call `snapshot_read` with that path and byte offset. Choose `type="f32"` for XYZ floats or `type="u64"` for 64-bit pointers; little endian is the default, big endian is supported. Alternatively pass `baseAddress` and `address` with offset zero. No address-to-file mapping is guessed.
6. Call `snapshot_search` with exact hex bytes such as `00 00 C8 42 00 00 A0 41 00 00 48 43`. Follow `nextOffset`, repeating `version` from the first result to detect a changed file. A scan-budget or result-limit page is incomplete until `complete=true`.

Example calls (replace the paths and addresses with values returned by the manifest):

```json
{"path":"RiftReader/snapshots/run/manifest.json","pose":0,"address":"0x10000000023","length":12}
```

```json
{"path":"RiftReader/snapshots/run/baseline/segments/seg.bin.gz","action":"prepare"}
```

```json
{"path":"RiftReader/snapshots/run/baseline/segments/seg.bin.gz","offset":"35","length":12,"type":"f32"}
```

`snapshot_read` returns hex, printable ASCII, and typed values. Types: `u8/i8/u16/i16/u32/i32/u64/i64/f32/f64`. 64-bit integers are decimal strings; non-finite floating values are explicit strings. Trailing incomplete values and clipped value arrays are reported. Reads/searches detect ordinary file modifications using file identity, size and timestamps; this is not a cryptographic guarantee against a concurrent adversarial writer. Inspect immutable captures for consistent analysis. Snapshot evidence alone does not establish a current, restart-stable pointer chain.

## Limits and recovery

- Raw files: no disk copy, at most 4,096 bytes per read, at most 128 decoded values, direct seek by byte offset.
- Search: exact patterns of 1..256 bytes, including overlapping matches and matches crossing internal chunks; at most 100 hits, 64 MiB of candidate offsets/about five seconds per call. Small overlap read-ahead can make `scannedBytes` slightly larger. Wildcard/semantic scanning and snapshot comparison are not implemented.
- Manifest: UTF-8 JSON up to 16 MiB, up to 200 poses, up to 100,000 inspected segments and 100 segment results per page. Supports `poses[].segments[]`, `path`/`snapshotPath`, `baseHex`/`baseAddressHex`/`base`, and `sizeBytes`. Other snapshot formats remain accessible as raw bytes/text; they are not silently reinterpreted. No Windows minidump parser is included.
- Gzip: one background preparation at a time, streamed with bounded memory, 32 GiB total decompressed cache by default, 30-minute deadline. Gzip CRC/truncation errors fail preparation. Prepared data survives server restart; an interrupted partial is discarded on the next preparation. The cache is shared across ChatGPT sessions.
- `snapshot_cache(action="cancel")` stops preparation. `release` removes cached copies for one existing source path, including older versions. `clear` cancels preparation and removes all managed snapshot-cache files, including orphaned data whose source was moved/deleted. These actions leave the original snapshots untouched. Cache clearing can interrupt concurrent reads; retry after preparing again.
- Budget/full disk/corrupt gzip: preserve the original, check `status.error`, release unused entries or clear the cache, then retry. Sources changing during preparation require a fresh run. Corrupt cache metadata can be recovered with `clear`. `CACHE_BUSY` means wait for the active preparation or cancel its path. Raw files do not use the cache budget.

Increase the budget for a foreground run:

```powershell
Set-Location C:\work\workbridge-mcp
$env:WORKBRIDGE_SNAPSHOT_CACHE_GIB = '64'
.\scripts\Start-Tunnel.ps1 -Root C:\work
```

For automatic startup, configure the protected local settings file instead (takes effect on the next Workbridge restart):

```powershell
Set-Location C:\work\workbridge-mcp
'{"snapshotCacheGiB":64}' | Set-Content .local\settings.json -Encoding ASCII
.\scripts\Restart-Workbridge.ps1
.\scripts\Show-Status.ps1
```

Environment overrides that setting; otherwise the default is 32. The settings file accepts only `snapshotCacheGiB` (positive, up to 1024); use enough free disk space. `clear` is the practical cleanup command; caches are not automatically evicted. Keep captures under `C:\work`; manifest paths outside that root, links/junctions, `.git`, and protected bridge state remain inaccessible.

## Compatibility evidence

`RiftReader/scripts/current_pid_family_snapshot_sequence.py` writes gzip segment files and pose manifests. `family_snapshot_delta_analyzer.py` reads that same mapping. Workbridge was tested with **RiftReader's own `build_self_test_manifest` output**, mapping `0x10000000023` to byte offset 35 and decoding `[100, 20, 200]`, then finding the same byte pattern. These are deliberately synthetic offline coordinates; no live RIFT process is involved. The local acceptance script is `node scripts/snapshot-acceptance.mjs <self-test-manifest-path>`; evidence is saved under `.local/snapshot-acceptance.json`.

Streaming decompression uses Node's standard [zlib](https://nodejs.org/api/zlib.html) and [pipeline](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback) APIs; there is no new runtime dependency.
