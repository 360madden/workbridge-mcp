import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { win32 as winPath } from 'node:path';
import { promisify } from 'node:util';
import { runWinapp } from '../../../scripts/desktop-ui.mjs';
import { inspectOfflineClient, ResearchError, SHA256 } from './identity.mjs';

const execFileAsync = promisify(execFile);
const RIFT = 'rift_x64';
const WINDOW_CLASS = 'TWNClientFramework';
const WINAPP_VERSION = '0.7.1';
const MAX_PROCESSES = 16;

// This fixed Windows query contains no user-provided interpolated commands,
// never reads process command lines and requests no input or memory writes.
const CENSUS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$items=@(Get-Process -Name 'rift_x64' -ErrorAction SilentlyContinue)",
  '$out=@()',
  'foreach($p in $items) {',
  '  try {',
  '    $main=$p.MainModule',
  "    if($null -eq $main) { throw 'MAIN_MODULE_UNAVAILABLE' }",
  '    $start=$p.StartTime.ToUniversalTime()',
  '    $out += [pscustomobject]@{',
  '      pid=[int]$p.Id',
  '      processName=[string]$p.ProcessName',
  '      processStartUtcTicks=$start.Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)',
  "      startedUtc=$start.ToString('o',[System.Globalization.CultureInfo]::InvariantCulture)",
  '      sessionId=[int]$p.SessionId',
  '      executablePath=[string]$main.FileName',
  '      moduleName=[string]$main.ModuleName',
  "      moduleBaseHex=('0x{0:X}' -f $main.BaseAddress.ToInt64())",
  '      moduleSizeBytes=[int64]$main.ModuleMemorySize',
  '    }',
  '  } catch {',
  "    $out += [pscustomobject]@{pid=[int]$p.Id;processName='rift_x64';error='PROCESS_DETAILS_UNAVAILABLE'}",
  '  } finally { $p.Dispose() }',
  '}',
  'ConvertTo-Json -InputObject @($out) -Compress -Depth 4',
].join('\n');

function fault(code, message) {
  throw new ResearchError(code, message);
}

function isPid(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff;
}

function exactTicks(value) {
  return typeof value === 'string' && /^[1-9][0-9]{1,21}$/.test(value);
}

function exactTime(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function normalizedPath(value) {
  return winPath.normalize(value).toLowerCase();
}

function checkProcess(raw) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !isPid(raw.pid) ||
    raw.processName?.toLowerCase() !== RIFT ||
    raw.error
  ) {
    fault('PROCESS_IDENTITY_UNAVAILABLE', 'Selected RIFT process identity could not be inspected.');
  }
  if (
    !exactTicks(raw.processStartUtcTicks) ||
    !exactTime(raw.startedUtc) ||
    !Number.isSafeInteger(raw.sessionId) ||
    raw.sessionId < 0 ||
    typeof raw.executablePath !== 'string' ||
    winPath.basename(raw.executablePath).toLowerCase() !== RIFT + '.exe' ||
    raw.moduleName?.toLowerCase() !== RIFT + '.exe' ||
    typeof raw.moduleBaseHex !== 'string' ||
    !/^0x[0-9a-f]+$/i.test(raw.moduleBaseHex) ||
    !Number.isSafeInteger(raw.moduleSizeBytes) ||
    raw.moduleSizeBytes < 1024 * 1024
  ) {
    fault(
      'PROCESS_IDENTITY_INVALID',
      'Selected RIFT process has an incomplete or inconsistent epoch/module identity.',
    );
  }
  return {
    pid: raw.pid,
    startedUtc: raw.startedUtc,
    processStartUtcTicks: raw.processStartUtcTicks,
    sessionId: raw.sessionId,
    executablePath: raw.executablePath,
    moduleName: raw.moduleName,
    moduleBaseHex: raw.moduleBaseHex.toUpperCase().replace(/^0X/, '0x'),
    moduleSizeBytes: raw.moduleSizeBytes,
  };
}

function sameProcess(a, b) {
  return (
    a.pid === b.pid &&
    a.startedUtc === b.startedUtc &&
    a.processStartUtcTicks === b.processStartUtcTicks &&
    a.sessionId === b.sessionId &&
    normalizedPath(a.executablePath) === normalizedPath(b.executablePath) &&
    a.moduleName === b.moduleName &&
    a.moduleBaseHex === b.moduleBaseHex &&
    a.moduleSizeBytes === b.moduleSizeBytes
  );
}

function selectedWindow(rawWindows, pid) {
  const rows = Array.isArray(rawWindows) ? rawWindows : rawWindows?.windows;
  if (!Array.isArray(rows) || rows.length > 500) {
    fault('WINDOW_INVENTORY_INVALID', 'Read-only WinApp window inventory was missing or unbounded.');
  }
  const matched = rows.filter(
    (w) =>
      w?.processName?.toLowerCase() === RIFT &&
      w.processId === pid &&
      w.title === 'RIFT' &&
      w.className === WINDOW_CLASS &&
      (w.ownerHwnd === null || w.ownerHwnd === 0 || w.ownerHwnd === undefined) &&
      Number.isSafeInteger(w.hwnd) &&
      w.hwnd > 0 &&
      Number.isFinite(w.width) &&
      w.width >= 700 &&
      w.width <= 15000 &&
      Number.isFinite(w.height) &&
      w.height >= 500 &&
      w.height <= 15000,
  );
  if (matched.length !== 1) {
    fault(
      matched.length === 0 ? 'WINDOW_NOT_FOUND' : 'WINDOW_AMBIGUOUS',
      'Expected exactly one visible-size RIFT window for the explicitly selected process; observed ' +
        matched.length +
        '.',
    );
  }
  const w = matched[0];
  return {
    hwnd: w.hwnd,
    pid,
    processName: RIFT,
    title: 'RIFT',
    className: WINDOW_CLASS,
    foreground: w.isForeground === true,
    width: w.width,
    height: w.height,
  };
}

function sameWindow(a, b) {
  return (
    a.hwnd === b.hwnd &&
    a.pid === b.pid &&
    a.processName === b.processName &&
    a.title === b.title &&
    a.className === b.className
  );
}

export async function probeRiftProcesses() {
  let raw;
  try {
    ({ stdout: raw } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', CENSUS_SCRIPT],
      { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 },
    ));
  } catch {
    fault('PROCESS_CENSUS_UNAVAILABLE', 'Windows RIFT process census failed; absence cannot be claimed.');
  }
  try {
    const rows = JSON.parse(raw);
    if (
      !Array.isArray(rows) ||
      rows.length > MAX_PROCESSES ||
      rows.some((p) => !p || !isPid(p.pid) || p.processName?.toLowerCase() !== RIFT) ||
      new Set(rows.map((p) => p.pid)).size !== rows.length
    ) {
      fault('PROCESS_CENSUS_INVALID', 'Process census contained invalid or ambiguous entries.');
    }
    return rows;
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    fault('PROCESS_CENSUS_INVALID', 'Process census returned malformed JSON.');
  }
}

export async function probeRiftWindows(runner = runWinapp) {
  try {
    const version = String(await runner(['--version']))
      .trim()
      .split(/\s+/)
      .at(-1);
    if (version !== WINAPP_VERSION) {
      fault('WINAPP_VERSION', 'Expected WinApp CLI 0.7.1; observed ' + version);
    }
    const raw = await runner(['ui', 'list-windows', '-a', 'rift', '--json']);
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    fault('WINDOW_INVENTORY_UNAVAILABLE', 'Read-only window inventory unavailable: ' + error.message);
  }
}

/**
 * Read-only physical process/window identity. The image is hashed from the
 * executable path reported by Windows, not a caller-selected replacement.
 * This does not inspect memory, attach a debugger, focus or send input.
 */
export async function physicalRiftIdentity({
  expectedHost,
  expectedSha256 = null,
  pid = null,
  host = hostname(),
  processProbe = probeRiftProcesses,
  windowsProbe = probeRiftWindows,
  imageProbe = inspectOfflineClient,
  now = () => new Date().toISOString(),
} = {}) {
  if (!expectedHost || String(host).toUpperCase() !== String(expectedHost).toUpperCase()) {
    fault('WRONG_HOST', 'Expected host ' + (expectedHost ?? '(missing)') + ' but observed ' + host);
  }
  if (pid !== null && !isPid(pid)) fault('INVALID_PID', 'Use a positive decimal PID within Windows bounds.');
  if (expectedSha256 !== null && (typeof expectedSha256 !== 'string' || !SHA256.test(expectedSha256))) {
    fault('INVALID_HASH', 'Pinned executable hash must contain 64 hex digits.');
  }
  const observed = await processProbe();
  if (!Array.isArray(observed) || observed.length > MAX_PROCESSES) {
    fault('PROCESS_CENSUS_INVALID', 'Process census is invalid or exceeds the 16-target limit.');
  }
  if (observed.length === 0) {
    if (pid !== null) fault('TARGET_NOT_FOUND', 'Requested PID was not in the current physical RIFT census.');
    return {
      schema: 'workbridge.rift-physical-epoch.v1',
      status: 'no_process_observed',
      machine: String(host).toUpperCase(),
      processCount: 0,
      selected: null,
      readOnly: true,
      inputSent: false,
      memoryRead: false,
      liveBindingVerified: false,
      sampledUtc: now(),
    };
  }
  if (
    observed.some((p) => !p || !isPid(p.pid)) ||
    new Set(observed.map((p) => p.pid)).size !== observed.length
  ) {
    fault('PROCESS_CENSUS_INVALID', 'Process census contains duplicate or invalid PIDs.');
  }
  if (pid === null && observed.length !== 1) {
    return {
      schema: 'workbridge.rift-physical-epoch.v1',
      status: 'explicit_pid_required',
      machine: String(host).toUpperCase(),
      processCount: observed.length,
      candidates: observed.map((entry) => ({
        pid: entry.pid,
        startedUtc: entry.startedUtc ?? null,
        processStartUtcTicks: entry.processStartUtcTicks ?? null,
        processDetailsAvailable: !entry.error,
      })),
      selected: null,
      readOnly: true,
      inputSent: false,
      memoryRead: false,
      liveBindingVerified: false,
      sampledUtc: now(),
    };
  }
  const chosen = observed.find((entry) => entry.pid === (pid ?? observed[0].pid));
  if (!chosen) fault('TARGET_NOT_FOUND', 'Requested PID is not in the physical RIFT census.');
  const before = checkProcess(chosen);
  const windowBefore = selectedWindow(await windowsProbe(), before.pid);
  const image = await imageProbe(before.executablePath, expectedHost, expectedSha256, host);
  if (
    normalizedPath(image.path) !== normalizedPath(before.executablePath) ||
    !SHA256.test(image.sha256) ||
    image.format?.kind !== 'AMD64_PE32_PLUS' ||
    image.identity !== 'on_disk_image_only'
  ) {
    fault('CLIENT_IMAGE_MISMATCH', 'On-disk executable check does not match the running process path.');
  }
  const afterCensus = await processProbe();
  if (!Array.isArray(afterCensus)) fault('PROCESS_CENSUS_INVALID', 'Second process census failed.');
  const second = afterCensus.find((entry) => entry?.pid === before.pid);
  if (!second || !sameProcess(before, checkProcess(second))) {
    fault(
      'PROCESS_EPOCH_CHANGED',
      'RIFT process start, session, path or module identity changed while hashing.',
    );
  }
  const windowAfter = selectedWindow(await windowsProbe(), before.pid);
  if (!sameWindow(windowBefore, windowAfter)) {
    fault('WINDOW_CHANGED', 'RIFT HWND/process binding changed while sampling.');
  }
  return {
    schema: 'workbridge.rift-physical-epoch.v1',
    status: 'read_only_identity_observed',
    machine: String(host).toUpperCase(),
    processCount: observed.length,
    selected: {
      ...before,
      window: windowAfter,
      executableSha256: image.sha256.toLowerCase(),
      executableBytes: image.bytes,
      executableFormat: image.format.kind,
    },
    validation: {
      processEpochRechecked: true,
      hwndRechecked: true,
      executableHashFromProcessPath: true,
      moduleBaseIsReadOnlyObserved: true,
      moduleMemoryBytesVerifiedByRead: false,
      memoryLayoutQualified: false,
      sourceTelemetryLinked: false,
    },
    readOnly: true,
    inputSent: false,
    memoryRead: false,
    liveBindingVerified: true,
    sampledUtc: now(),
  };
}
