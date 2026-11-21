# WB-RIFT-001 M5 — Sealed Research Runtime and Staged Release Gate

**Prepared:** November 20–21, 2026 (EST)  
**Verified Windows host:** AMD-DESKTOP  
**Current active owner:** Workbridge 0.16.5-dev; unchanged through all M5 source and isolated validation work  
**Scope:** M5 offline release closure and candidate validation only. **No Apply, restart, service update, VM, or game action.**

## Why the existing release path needed changes

The M4 research facade originally referenced mutable `integrations/research` source files outside the deployed runtime. WB-001 `New-WorkbridgeRelease.ps1` copies source names from `Workbridge-Update.ps1`; that list omitted `integrations`. The updater copies only `dist`, `node_modules`, `package.json` and `package-lock.json` to the active service.

Consequences before M5: a staged release could expose four valid new MCP tools but lack the companion program those tools invoke, and `scripts/release-acceptance.mjs` would reject their changed tool count. A source-only TypeScript build was insufficient to demonstrate a self-contained release.

## Code changes

- `scripts/Workbridge-Update.ps1`: include `integrations` in WB-001 source copying and source-backup inventory. The existing runtime copy policy remains `dist`/`node_modules`/package files.
- `package.json`: after the normal TS/C# command host build, call `scripts/stage-research-runtime.mjs`. This stages the **exact 21-source-file** fixed closure from `integrations/research` and `integrations/rift` into `dist/research-runtime`, preserving the relative module imports.
- `scripts/stage-research-runtime.mjs`: explicit source allowlist, bounded regular-file checks, SHA-256 manifest, marker-last publication, idempotent repeat stage, and `--verify` mode. The candidate's `dist` is published by the independent WB-001 release payload and already included in its release manifest. A partial stage has no valid manifest.
- `src/research-registration.ts`: the new MCP facade uses **`dist/research-runtime/research`** as its fixed coordinator root; it never loads mutable `integrations` source after installation.
- `integrations/rift/src/workspace-path.mjs` and its two consumers: provide stable sibling project lookup for source checkout, installed sealed closure, and explicitly configured release validation root. External RR2/RRE/RPT source files are still independently hashed research _inputs_, not part of the Workbridge runtime closure.
- `scripts/research-tool-catalog.mjs` and `scripts/release-acceptance.mjs`: check the full four-tool catalog and exact tool annotations (or zero tools for older rollback releases), adjust the expected MCP tool count, and require an independently verified sealed research runtime if the four research tools are present.

## Completed acceptance

| Gate                                                                                                 | Result           |
| ---------------------------------------------------------------------------------------------------- | ---------------- |
| Workbridge strict TypeScript no-emit                                                                 | PASS             |
| Isolated TS emission to ignored `.tools`, no live `dist` change                                      | PASS             |
| M5 staging + research catalog focused tests                                                          | **12/12 PASS**   |
| RIFT companion tests (including workspace paths)                                                     | **70/70 PASS**   |
| Research coordinator tests                                                                           | **40/40 PASS**   |
| Fake MCP-owner facade tests (including sealed default path)                                          | **8/8 PASS**     |
| Combined focused tests                                                                               | **130/130 PASS** |
| Actual 21-file source closure staged beneath `.tools/m5-research-isolated/dist/research-runtime`     | PASS             |
| Actual sealed companion ran archived RIFT doctor/replay/PE patch/audit and verified checksum package | PASS             |
| Actual live Workbridge 0.16.5-dev replacement / hosted ChatGPT tool rediscovery                      | **NOT DONE**     |

The isolated closure manifest had SHA-256 `d9b680f9215e0dce5443396e1084007ad3d49f7dd4baff6c9c6fbf73d6ee8492` at its first successful stage. Its separate four-step evidence package is under ignored `C:\work\workbridge-mcp\.tools\m5-research-isolated\research-run-01`. The tested command used an explicit `WORKBRIDGE_ROOT=C:\work` for the isolated staged layout; installed runtime path resolution is tested separately.

## Remaining M5 steps (no service activation yet)

1. Commit exact current code/tests/docs, capture commit hash, and check a clean working tree.
2. Run **WB-001 `New-WorkbridgeRelease.ps1` from committed source** using a unique release ID with registered tool environment and serial tests if needed. The builder must copy `integrations` into an isolated payload, execute all standard gates, create a verified manifest, pass the new 4-tool research catalog/closure probe, and issue `validated.json` **without stopping the service**.
3. Check the release's manifest digest, exact payload content, compiled MCP tool list and rollback-capable previous state. Treat failure as a blocker; do not bypass a gate or claim readiness from an exit code alone.
4. **Apply HOLD** until an exclusive all-client quiet window, independently verified zero active Workbridge jobs, an approved Workbridge-only service restart, and staged rollback preflight. Then use the existing WB-001 updater, _not_ direct `dist` copying.
5. After any later Apply, reverify actual AMD-DESKTOP identity, Workbridge owner PID/start, 36-slot job limit, four `research_*` hosted MCP registrations, a fixed saved-plan preview and no-game-input read-only run. On failure use WB-001 rollback and preserve the evidence.

**Known architectural boundary:** The staged research runtime is sealed in `dist`. Existing RRE, RR2, Telemetry and RPT project-specific binaries and data remain separately owned dependencies. A closure manifest does not validate those external source files until a research plan's preflight checks them by exact identity.

## Operator commands (PowerShell 7)

Prepare an **isolated release only**, with a NEW ID, from the committed Workbridge source:

```powershell
cd 'C:\work\workbridge-mcp'
.\scripts\New-WorkbridgeRelease.ps1 -ReleaseId 'wb-rift001-m5-candidate-NEW_ID' -WorkspaceRoot 'C:\work' -RefreshUserEnvironment -SerialTests
```

**No** `Update-Workbridge.ps1 -Action Apply` should be executed until the separate exclusive maintenance gate is satisfied. The WB-001 release builder is independent of deployment.

[Master roadmap](wb-rift-001-unified-research-coordinator-roadmap-20261120.md) · [WB-001 updater contract](updates.md)
