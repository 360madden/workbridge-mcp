# RIFT Update Contingency Helper (AMD-DESKTOP)

The helper captures a read-only baseline of the physical RIFT client and optional OneDrive addon directory before a game patch, then captures a second snapshot afterward and produces a machine-bound comparison.

**Install:** Ships inside the Workbridge-MCP repository. Uses existing Node.js 24+; no installer, administrator rights, network connection, MCP server restart, RIFT interaction, or game memory access required.

## Before the launcher installs the update

In **PowerShell 7**, run:

    & 'C:\work\workbridge-mcp\scripts\Rift-Update-Helper.ps1' -Action Before

This observes the installed client at C:\Program Files (x86)\Glyph\Games\RIFT\Live and the OneDrive addon folder. It writes a timestamped before-*.json manifest under C:\work\workbridge-mcp\.tools\rift-update\. **Save this before applying the patch.** A baseline taken after patching cannot reconstruct the old executable.

## After the launcher finishes updating

    & 'C:\work\workbridge-mcp\scripts\Rift-Update-Helper.ps1' -Action After

This writes an after-*.json manifest and automatically compares it against the newest complete pre-update manifest for the same machine and roots. Outputs include comparison-*.json (all changed paths) and comparison-*.md (readable summary, first 300 changes).

If the installation is elsewhere, pass -GameDir 'X:\path\to\RIFT\Live'; if OneDrive is elsewhere, pass -AddonsDir 'X:\path\to\RIFT\Interface\AddOns'. Use -NoAddons on both invocations to inventory only the game.

For an explicit comparison of archived manifests:

    & 'C:\work\workbridge-mcp\scripts\Rift-Update-Helper.ps1' -Action Compare -BeforeManifest 'PATH\before.json' -AfterManifest 'PATH\after.json'

## Scope and safeguards

- Captures relative filenames, sizes, modification times, and SHA-256 for important code/configuration extensions (.exe, .dll, .ocx, .toc, .lua, .xml, .cfg, .ini, .json). Large assets are **metadata-only**; size/mtime changes are indicators, not proof of different content.
- Hashing is streamed and bounded (256 MiB per file, 1 GiB total). At most 80,000 recorded files, 250,000 inspected entries and 20 directory levels are scanned. Symbolic links/junctions are not followed.
- The addon inventory focuses on RIFT-loadable code and configuration extensions, not large archives, images or generated documentation. It skips disabled top-level addon folders, RIFT_API_Docs and development/cache folders. The game installation still receives a complete metadata inventory.
- The hash/metadata capture refuses to claim completeness if a read fails or a file changes while being hashed. A comparison refuses incomplete manifests, root mismatches, or different hostnames.
- Evidence is only written inside the ignored .tools/rift-update folder, using new unique filenames; existing snapshots are not overwritten. No RIFT client, addon file, SavedVariables, running process, launcher, or Workbridge service is changed.
- Captures installed files, **not live memory layouts or compatibility**. RRE/RR2 still need their own post-update read-only telemetry and pointer-chain validation. Fresh process identity (PID/HWND/start time) is required after restarting the client.

## Developer tests

    node --test test/rift-update-contingency.test.mjs

This uses only temporary synthetic fixtures; it does not launch or modify the installed RIFT game.
