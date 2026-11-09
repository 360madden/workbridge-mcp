# LEGION developer tools and helper repair — November 8, 2026

Status at 20:54 EST: **tool/Python/dependency setup verified; deployed Workbridge desktop repair NOT completed.**
This record is for the LEGION laptop only. Re-run actual hostname verification on resume; it does not identify AMD-DESKTOP or either VMware lab.

## Completed

| Area | Verified result |
| --- | --- |
| Python | Standard x64 CPython 3.14.10, signed official installer; pip 26.2.2 |
| Isolation | Workbridge .venv has its own pip/site-packages, no base-package leakage; pip check and 6 VT assertions pass |
| Persistent paths | User Path, DOTNET_ROOT and WORKBRIDGE_WINAPP_EXE configured; raw ExpandString PATH and unrelated entries preserved |
| Repeatability | Configurator backs up before writes, rejects wrong host/missing tools, checks concurrent changes; second apply is a no-op |
| Command resolution | python, py, pip, dotnet, winapp, pwsh, git, gh, node and npm all resolve correctly in a reconstructed fresh child environment |
| Native helpers | DesktopProbe and ChatInputProbe published with SDK 10.0.403; DLLs and standalone EXEs return expected no-argument exit 2 before UI initialization |
| LuaPad dependencies | Exact local Fengari dependency plus integrity lockfile; five packages installed offline without scripts or version changes |
| LuaPad gates | 60 structural checks, 538 Lua runtime/bridge assertions and 137 HostCore assertions passed |

PowerShell **7.6.9** is the traditional MSI installation; Windows PowerShell 5.1 remains available.
Other verified versions: .NET SDK **10.0.403** / runtime **10.0.14**, pinned WinApp **0.7.1**, Node **24.20.0**, npm **11.19.0**, Git **2.56.0.windows.4**, GitHub CLI **2.103.3**. WinGet **1.29.380** was already current when checked earlier.

### Important paths

- Python: C:\Users\mrkoo\AppData\Local\Programs\Python\Python314\python.exe
- Launcher: C:\Users\mrkoo\AppData\Local\Programs\Python\Launcher\py.exe
- Project Python: C:\work\workbridge-mcp\.venv\Scripts\python.exe
- Shared SDK: C:\work\tools\dotnet\10.0.403
- WinApp: C:\work\tools\winappcli\0.7.1\winapp.exe
- Durable configurator: C:\work\workbridge-mcp\scripts\Configure-DeveloperToolPaths.ps1
- Environment backup: C:\work\workbridge-mcp\.local\environment-backups\developer-paths-20261109T014426037Z-4a92593a.json
- Native fixtures: C:\work\workbridge-mcp\.tools\legion-fixtures-20261108-2033
- HostCore isolated build: C:\work\LuaPadModern\.tools\legion-host-deps-20261108-2049

No global PYTHONHOME/PYTHONPATH was added. No speculative third-party Python packages were installed because the audited Workbridge Python code uses the standard library and its local module.
LuaPad's existing private SDK was preserved, not deleted or confused with the new shared SDK.

Persistent environment changes do **not** update an already-running Workbridge owner or shell. Command verification explicitly reconstructed machine + user registry environment in a bounded child; it is not proof of propagation into owner PID 23232.

For Python project checks, use the explicit .venv interpreter. For reproducible Lua test dependencies, run npm ci --ignore-scripts in C:\work\LuaPadModern, then node verify-preview.cjs and node verify-bridge.cjs. The gate now uses the local CLI and never downloads packages while testing.

## Workbridge repair: blocked, not deployed

The installed desktop helper closure is missing six files and its manifest. A committed installation-inspector fix now detects missing or tampered deployed helper files; its focused 50-test suite passed. Nine existing formatting failures were fixed mechanically; 60 affected tests and the formatting gate passed.

Official isolated candidate **legion-desktop-runtime-20261108-01**, from source commit **848da00803f1cb3f37fccaf26228adc5e3d8d120**, passed dependency installation, build and helper staging. Its full test gate failed: **1,132 passed, 6 failed, 1 cancelled, 3 skipped** out of 1,142.

Failures include Python resolution in an inherited old environment, deadline/timeouts, a bounded catalog scan and one synthetic file-lock failure. Load sensitivity remains a hypothesis, not a verified cause. **No validated receipt was issued; this candidate is not deployable.**

A direct diagnostic command using the failed payload as cwd was refused with **PROTECTED_PATH before execution**. That route stopped. Do not route around it with Set-Location, an alternate cwd or a copied protected payload. The failed candidate and logs remain intact.

Node 24.20.0 accepts **--test-concurrency as an explicit CLI argument**, but not in NODE_OPTIONS. Do not weaken test assertions or timeouts to obtain a pass.

The active server remains version 0.16.4-dev, PID 23232, instance dca381aa-a8f1-4eda-9777-e6d4732610f7. No Workbridge restart or active-dist build/copy occurred.

## Correct installation rule

RIFT can remain running during first-time addon installation and updates. Finish copying the complete addon files, then use **/reloadui**. This reloads the game's UI, not RIFT, Workbridge or Windows.

LuaPad README's obsolete first-install exit requirement was corrected, and its strict runtime gate now expects the actually observed **204** runtime assertions rather than 198. Runtime addon files themselves were not changed by this tooling step.

## Source checkpoints

Workbridge:
- 22c5a7f — deployed desktop closure diagnostics
- 9ac7369 — mechanical formatting for official release validation
- 848da00 — backed-up idempotent developer PATH setup

LuaPadModern:
- 6fc2f5f — corrected test count and reload-only installation guidance
- 559a721 — pinned local Fengari dependencies and no automatic test-time downloads

All are local commits; no push was performed. Pre-existing Workbridge changes to scripts/freebuff-conpty-probe.py and LEGION-COPY-MANIFEST.json were preserved and not committed.

## Resume in this order

1. Obtain direction for a fresh diagnostic build from ordinary source in an allowed separate directory, without accessing the protected failed payload.
2. Verify hostname and exact source base; refresh only the diagnostic child's environment. Run the original failing files with explicit node --test --test-concurrency=1 and investigate without skipping cases.
3. Prepare a **new** official release ID and require every original validation gate.
4. Only after a valid candidate, obtain/confirm the explicit **Workbridge-only restart** approval and exclusive quiet window. Leave RIFT and Windows running.
5. Verify hosted helper behavior after activation; use disposable fixtures before live LuaPad editor/Run input.

No game input was sent during this setup. RIFT PID 21140 / start UTC 2026-11-08T10:52:35.8105227Z remained observed unchanged. This handoff makes no claim that live editor/Run acceptance is complete.

See the adjacent JSON record for exact hashes, job IDs and machine-readable state. Counts from overlapping test suites must not be summed into a claimed unique-test total.
