# Workbridge-MCP improvements for RIFT reverse engineering

**Investigation:** November 20, 2026 (America/New_York)  
**Host proven:** AMD-DESKTOP (hostname.exe returned exact hostname; exit code 0)  
**Workbridge owner:** 0.16.5-dev; root C:\work; 36 job slots and 36 worker assignment slots  
**Git starting point:** main, clean, two local commits ahead of origin/main  
**Mode:** source inspection, installed-tool inventory and public tool documentation. No game interaction, service deployment, package installation, live memory acquisition or API spending.

## Executive conclusion

Do not rebuild RIFT native readers or increase Workbridge's worker count first. The highest-value investment is a _small RIFT research companion_, running outside the existing Workbridge owner, that normalizes process/build identity, invokes existing analysis tools, correlates telemetry/trace evidence and replays recorded experiments. Only expose a few stable MCP commands after the CLI contracts are proven.

Workbridge's 36 assigned workers are coordination records, **not** 36 spawned AI reasoning agents. The OpenAI companion under `integrations/openai/` is separate source work, not a prerequisite for the RIFT improvements.

## Verified reusable baseline

| Existing component                                                         | Confirmed evidence                                                                                                                                     | Missing integration                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Workbridge `snapshot_read` / `snapshot_search` / `snapshot_manifest`       | Saved raw/gzip byte range and typed reads, exact 1–256-byte search, original RiftReader manifests; offline only                                        | Wildcards, typed semantic scanning, snapshot-vs-snapshot comparison, common finding registry               |
| `scripts/Rift-Update-Helper.ps1` and `scripts/rift-update-contingency.mjs` | Pre/post file tree inventory, partial hashes, changed-path summaries                                                                                   | No function relocation, PE-level symbol/anchor requalification, or live memory verification                |
| `rre/tools/rift_update_analyzer.py` + `rift_update_anchors.json`           | SHA-pinned AMD64 PE section/block diffs and original-byte anchor comparisons                                                                           | Does not recover moved functions or prove runtime identity; should be invoked, not reimplemented           |
| RR2 (`C:\work\riftreader2`)                                                | Read-only native discovery, .NET 10 reader, versioned Lua capture, process/build/source qualifications                                                 | General Workbridge adapter and reproducible cross-repository evidence indexing                             |
| Telemetry (`C:\work\Telemetry`)                                            | `telemetry.cmd snapshot` JSON, `watch` JSONL, and local dashboard `GET /api/target` + `GET /events` SSE; current native reader checks exact build hash | Source-bound ingestion into common evidence timeline; Workbridge should not resample at high frequency     |
| RIFT Personal Teleporter (`C:\work\Rift-Personal-Teleporter`)              | Goal precommit, position-gap reporting, phase annotations, ordinary in-game travel experiments                                                         | Single bundle combining goal, client build, Lua/native state, screenshots, debugger events and score       |
| RiftWorld (`C:\work\RiftWorld`)                                            | Geometry/collision corpus, direct-Win32 debugger evidence methodology                                                                                  | Correlated executed contact/event trace remains unproven; preserve its native collector as source of truth |
| Game-player MCP (`src/game-player.ts`)                                     | Source exposes `game_player_list_windows` through fixed Python child, with bounded display-only window list                                            | Source deployment documented HOLD on Nov 18; no authoritative HWND/PID or input control from its text      |
| Existing toolchain                                                         | `C:\work\tools\ghidra_12.1.2_PUBLIC\support\analyzeHeadless.bat`, two x64dbg binaries, ImHex 1.38.1, Kaitai 0.11 and REA directory found on disk       | Automated version/compatibility doctor and reproducible scripted invocation                                |
| OpenAI integration                                                         | Two local commits on Nov 20 add isolated SDK companion and read-only CLI adapter                                                                       | Paid live call, model-managed agents and desktop control **not established**                               |

Tool PATH probe found `dotnet`, `python` and `git`, but not `frida`, `frida-ps`, `windbg`, `cdb`, `procdump64` or `procmon64`. This means _not found on PATH_, not conclusively uninstalled.

An uploaded November 15 RIFT Lua API reference lists `Inspect.Unit.Detail("player")`, `Inspect.Stat()`, `Inspect.Unit.Castbar`, `Inspect.Buff.List/Detail` and target/zone lookups. These are useful comparison channels, but actual current RIFT Live fields must be tested; null/missing fields are not zeroes.

## Ranked improvements (expected practical payoff)

| Priority | Improvement                                               | Reuse strategy                                                                                   | Measurable first acceptance                                                                                                                                                   |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1     | **RIFT session/epoch identity coordinator**               | Compose Workbridge native window status, RR2 identity and module hash tools                      | Reject wrong hostname, missing/ambiguous PID, process restart, unknown build; produce one bounded manifest with PID+creation time+EXE SHA-256+window identity                 |
| P0-2     | **Cross-repository telemetry/evidence adapter**           | Consume existing Telemetry CLI JSON and RR2/RRE receipts; do not reimplement readers             | Ingest fixture and real saved receipts with provenance, timestamp source, dropped sample count, field availability, immutable content hash                                    |
| P0-3     | **Patch-diff orchestration**                              | Call existing RRE section/anchor analyzer + Workbridge pre/post manifest; add per-build findings | Offline old/new baseline comparison and downstream candidate invalidation report; never promote matching RVA alone to working pointer chain                                   |
| P1-4     | **Targeted Ghidra headless automation**                   | Ghidra 12.1.2 and existing REA first; bounded scripts, immutable project copies                  | Scripted import/process of _selected_ binaries/functions with log, timeout, source hash and export; no surprise full import of live shared project                            |
| P1-5     | **Native debugger and trace evidence ingestion**          | RiftWorld direct-Win32 debugger first; x64dbg/DbgEng when specifically beneficial                | One recorded breakpoint/contact candidate includes exact PID/start, instruction address, register/stack sample and clean exit/recovery; mock-only is not executed-event proof |
| P1-6     | **Offset, signature and pointer-chain findings registry** | Index RRE/RR2 reports and existing raw snapshots                                                 | Query by build+function+RVA+field; annotate static candidate vs live field-qualified vs restart-qualified; invalidate on build drift                                          |
| P1-7     | **Teleporter experiment recorder**                        | Reuse RPT `recallscope`, goal-precommit, native XYZ and phase analyzers                          | One replayable trial with predeclared destination, timestamps, capture coverage, source-specific gaps, client vs independent arrival evidence                                 |
| P1-8     | **RIFT Lua addon QA/deployment**                          | Reuse RCM and Telemetry install/status tools, RRE collector packaging tests                      | Validate .toc name/version/email/files; compare actual OneDrive addon path + hashes, preserve backup, prove actual load separately                                            |
| P2-9     | **Toolchain doctor**                                      | Extend existing RRE doctor and `C:\work\tools` inventory                                         | Versioned JSON of installed paths, SHA/version, CLI tests and tool compatibility; report absent-on-PATH honestly                                                              |
| P2-10    | **Dependency-aware research worker coordination**         | Current 36 job/assignment system                                                                 | Source hash and file ownership pinned; parallel offline lanes, one owner for debugger/input; no claim of creating AI agents                                                   |

## Proposed design

Keep Workbridge's live owner stable. Start with `integrations/rift/` as a **separate local .NET 10 or Node 24+ CLI companion** using the existing authenticated Workbridge CLI only where needed. Do not put a high-frequency sampling loop in the MCP request path.

Recommended contract:

1. `rift-doctor` — host identity, installed toolchain, supported repositories and offline build baseline inventory.
2. `rift-session` — read-only process/window/executable/module epoch; source stamp must be fresh and never silently rebinding a PID.
3. `rift-evidence import` — normalize existing RR2/RRE/Telemetry/RPT/RiftWorld outputs into append-only, content-hashed JSONL and summary metadata.
4. `rift-patch compare` — invoke the existing RRE PE analyzer and output candidate qualifications and invalidations.
5. `rift-experiment plan|review` — prepare a destination/observation plan and score existing evidence. Any future live debugger or input action is a separate reviewed operation.

Minimum evidence fields: schema version, UTC wall timestamp, monotonic clock epoch/offset where measured, machine, process PID and start time, executable full-path hash, game build, source repository+commit, source type, sample sequence, field-level availability/status, expected vs observed values, gap/truncation flags, artifact SHA-256, and explicit claim level (`candidate`, `observed`, `reproduced`, `restart-qualified`). Keep raw files outside Git; commit only schemas, scripts, fixtures, documentation and summaries.

### Teleporter-specific distinction

A local XYZ change, native memory write acknowledgement or matching HUD location alone does not establish custom teleportation. Compare desired destination committed _before_ an experiment against observable scene/zone/position transitions, stabilization after transition, and any independent game evidence. Keep ordinary Recall/dimension travel as separate controls. A general-purpose live memory-write MCP endpoint is not needed for P0; if targeted mutation experiments are later requested, keep them as version-pinned independent drivers with expected-byte preconditions, exact identity, recorded readback and explicit recovery.

### Native analysis posture

- **Ghidra:** use official `analyzeHeadless`, bounded `-max-cpu` / `-analysisTimeoutPerFile`, named scripts, input build hashes and separate project directories. Existing REA may cover queries; avoid duplicate analyzers.
- **x64dbg:** official script/trace facilities can record executed instructions and accesses; consume existing trace files rather than blindly attaching several debuggers. Prefer RiftWorld's current direct-Win32 method for its ongoing executed-Havok-event investigation.
- **DbgEng/TTD:** potential second-stage replay tools. Trace recording can add major runtime/storage overhead and should be demonstrated on a disposable target first.
- **Frida:** optional dynamic function tracing, not a prerequisite; the local probe did not find it on PATH. Evaluate only for a concrete unanswered question.
- **iced-x86:** strong candidate for .NET 10 offline disassembly, instruction normalization and candidate matching; this is _not_ a substitute for live behavior proof.

## Implementation slices and gates

**Slice A — offline foundation (no service restart):** create `integrations/rift/` doctor, source adapters, common `rift-re-evidence-v1` JSON schema and fixture tests. Acceptance: wrong host/build/PID fixtures rejected, unchanged input hashes, consistent null/gap accounting, all tests passing.

**Slice B — real saved-data integration:** ingest one existing Telemetry JSON snapshot, one RR2/RRE evidence generation, and one RPT position trial. Verify ownership, capture ages, schema mappings, no skipped records or false freshness. Output human-readable comparison with conflicts, not silently reconciled data.

**Slice C — patch regression:** run existing RRE `rift_update_analyzer.py` against two pinned offline executables, preserve generated receipts, attach analyzed code sections to the finding registry. Introduce typed snapshot compare only after a fixture proves addressing and NaN/endianness/gap behavior.

**Slice D — targeted offline disassembly:** use present Ghidra/REA and iced-x86 for a selected function/anchor. Check byte matching, relocation/callgraph candidates and explicit uncertainty; avoid large indiscriminate full-project reanalysis.

**Slice E — live experiment/trace (separately scoped):** fresh physical-RIFT identity, bounded capture broker, one active desktop/debugger owner, timestamp correlation with Telemetry and screenshot receipts. Acceptance requires independently observed event evidence; an exit code or breakpoint configured is not enough.

## Do not prioritize now

- More than 36 assignment slots: not the current bottleneck.
- A new duplicate RIFT memory reader or addon telemetry collector: RR2 and Telemetry already provide these.
- Generic write-process-memory tools or arbitrary shell access under a new model-controlled tool name: narrower experiment drivers are more reproducible.
- Enabling paid OpenAI API orchestration as a prerequisite: the first four slices run with existing local tools, without Codex, Ollama or OpenCode.
- Automatic live RIFT UI control, VM fallback, or unqualified post-patch pointer reuse.
- Claiming uninstalled tools solely because the executable is not on PATH.

## Implementation checkpoint — November 20, 2026, 9:45 PM ET

**Offline Slice A implemented and run** under `integrations/rift/` without changing the live Workbridge owner, attaching to RIFT, downloading dependencies, invoking an API or modifying other repositories.

- Strict machine guard (`AMD-DESKTOP` verified through hostname.exe), on-disk AMD64 PE32+ identification, file SHA-256 and optional expected-build pin.
- Saved Telemetry JSON/JSONL importer with source-state/provenance labels, numeric null preservation, and build conflicts surfaced rather than silently reconciled.
- Reuses `Rift-Personal-Teleporter/src/teleport_analyzer.py` as the **actual offline experiment engine**, rather than writing a duplicate classifier.
- Produces a complete no-overwrite bundle: original telemetry, original position track, exact analyzer source, analysis JSONL, normalized evidence JSONL, manifest JSON and SHA256SUMS.txt. Independent verify checks six saved file digests.
- **14/14 focused tests pass** after formatting and additional input-validation hardening. Prettier check passed before the final hardening; recheck formatting at commit gate.
- Real saved-data acceptance: 60,493,640-byte SHA-pinned archived RIFT image, `Telemetry/artifacts/bridge-live/cli-snapshot.json` (one historical sample), and `Rift-Personal-Teleporter/tests/sample_track.jsonl` (four sample positions). Classification counts: 1 baseline, 1 continuous candidate, 1 candidate discontinuity, 1 context boundary. Bundle `C:\work\workbridge-mcp\.tools\rift-research-session-20261120-first` independently verified; **no live teleport was demonstrated**.
- This is a coordinated **offline** research session. Live PID/HWND/process start time, RR2/RRE adapter support, high-frequency telemetry and server-confirmed custom teleportation remain separate future work.

**Next recommended executable gate:** add a saved RR2 or RRE generation adapter and formal capture-epoch validation before introducing a live-process session collector.

## Implementation checkpoint — November 20, 2026, 10:55 PM ET

**Offline Slice B: RR2/RRE archived receipts integrated.** The standalone companion now supports optional `--rr2`, `--rre` and `--rre-binding` source files, preserving their exact bytes and adding source-specific normalized records without changing RIFT, VMware, RR2/RRE repositories, or the live Workbridge service.

- Verified Windows hostname: AMD-DESKTOP via hostname.exe (exit 0). No other machine accessed.
- RR2 adapter supports the pinned `native-current-facing-candidate-samples/1` record and preserves original 64-bit Windows process-start tick **source digits** using Node's JSON parse context; rounded double values are never used for the epoch comparison. Repeated RR2 report/observation identities must agree.
- RRE adapter supports a historical complete saved-publication receipt paired with its `rre-lab2-publication-binding/1` receipt. It validates matching source token/sequence/addon version/part and payload count; does not decode or authenticate RREC2 wire frames.
- A shared archive-epoch comparison distinguishes differing saved process IDs/start ticks/builds, or labels matching declared fields with host unverified. Cross-source causal inference and live freshness remain **false**.
- Source files, normalized evidence and checksum lists preserve old bundle compatibility (six files), while the new combined session contains **nine source/derived artifacts** plus SHA256SUMS.txt. Source files are rehashed after the offline analyzer, and the selected executable is rechecked before publishing.
- Focused regression result **24/24 passing**, Prettier formatting check passing; earlier six-file bundle independently verifies.
- Real saved-data acceptance used archived SHA-256 `1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8`; historical Telemetry + RR2 native report + RRE publication/binding + RPT sample track. RR2 PID `40452` and RRE PID `9752` were correctly classified `different_declared_epoch`, despite the same executable hash. Output package: `C:\work\workbridge-mcp\.tools\rift-research-session-20261120-rr2-rre-01`.
- This is **offline historical data**; a source's "live" status at recording time, same build, or a replay discontinuity does not establish current client presence, a shared process lifetime, arbitrary destination control, or server-confirmed relocation.

**Reprioritized next step:** add a narrow offline patch-drift adapter that invokes the already maintained RRE PE section/anchor comparator, then revisit live process-epoch inventory and debugger-trace correlation.

## Implementation checkpoint — November 20, 2026, 10:59 PM ET

**Offline Slice C: pinned executable patch-drift orchestration implemented.** The companion's `patch`/`verify-patch` commands reuse the unchanged RRE `tools/rift_update_analyzer.py` comparator and optional `rift_update_anchors.json`, adding strict preflight, input revalidation, a saved RRE source copy, source-hashed report manifest, and checksum verification.

- Preserved two archived AMD64 PE32+ RIFT images, SHA-256 `1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8` and `df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01`. Comparison ran entirely offline; no process inspection, memory write, game input, network datastream handling, VMware activity or Workbridge service deployment.
- RRE verdict: `CHANGED`. All seven sections had changed bytes or changed metadata/layout. Main changes: `.text` 608, `.rdata` 152, `.data` 66, `.pdata` 57, `.reloc` 35 and `.rsrc` 1 changed comparison blocks; `_RDATA` retained raw bytes but differed in layout. Four RRE ROOT-001 anchors all had different bytes at their historical RVAs. This does **not** locate moved functions; `nativeOffsetsQualified=false` remains mandatory.
- Output archive `C:\work\workbridge-mcp\.tools\rift-pe-drift-20261120-01`: original RRE report JSON/Markdown, source analyzer, anchor manifest, patch provenance, SHA256SUMS; five archive artifacts verified.
- Synthetic MATCH/CHANGED tests, baseline SHA mismatch, bad anchor manifest, output-no-clobber, wrong hostname and checksum tampering are covered. Total focused suite **34/34 passed** before final documentation/formatting gate; earlier offline-session bundles remain compatible.

**Next work:** exact on-host physical RIFT process epoch observation, with PID, start tick, executable/module hash and HWND binding. This must be a distinct read-only data source; archived-file identity is never upgraded automatically to a live session claim.

## Sources consulted

### Local, inspected November 20

- `workbridge-mcp/AGENTS.md`, `src/snapshots.ts`, `docs/snapshots.md`, `src/game-player.ts`, `docs/game-player-mcp-integration.md`
- `workbridge-mcp/scripts/rift-update-contingency.mjs`, `docs/rift-update-contingency.md`, `scripts/physical-rift-status.mjs`
- `workbridge-mcp/docs/openai-api-agent-roadmap-20261120.md`, `docs/job-capacity.md`
- `rre/tools/rift_update_analyzer.py` and `rift_update_anchors.json`
- `Rift-Personal-Teleporter/src/offline_patch_identity.py` and `README.md`
- `Telemetry/README.md`, `riftreader2/README.md`, `RiftWorld/README.md`
- `C:\work\tools\README-navigation-tools.md` and actual local path/CLI inventory

### Maintained external references

- Ghidra headless analyzer: https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/RuntimeScripts/support/analyzeHeadlessREADME.md
- x64dbg script and trace reference: https://help.x64dbg.com/en/latest/commands/tracing/index.html
- Windows DbgEng API: https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/debugger-engine-and-extension-apis
- WinDbg TTD.exe: https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/time-travel-debugging-ttd-exe-command-line-util
- iced-x86 .NET decoder: https://github.com/icedland/iced
- Frida news (November 16, 2026): https://frida.re/news/2026/11/16/frida-17-26-4-released/
- Sysinternals ProcMon (November 5, 2026): https://learn.microsoft.com/sysinternals/downloads/procmon

**Status at document creation:** investigation and prioritized roadmap only. No new runtime adapter, live RIFT measurement, GitHub push or service deployment is claimed.
