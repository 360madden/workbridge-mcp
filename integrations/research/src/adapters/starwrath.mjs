import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { hostname } from 'node:os';
import { win32 } from 'node:path';
import { promisify } from 'node:util';
import { PlanError } from '../plan.mjs';

const executeFile = promisify(execFile);
export const DEFAULT_STAR_WRATH_ROOT = 'C:\\work\\Star_Wrath_RE';
export const DEFAULT_STAR_WRATH_PYTHON = 'C:\\Python314\\python.exe';
const HASH = /^[0-9a-f]{64}$/;
const SNAPSHOT_MAX = 96 * 1024;
const REPORT_MAX = 1024 * 1024;
const SCRIPT_MAX = 128 * 1024;
const SCRIPT_NAMES = Object.freeze({
  comparator: 'compare_physics_runs.py',
  physicsInspector: 'inspect_physics_params.py',
  indexInspector: 'inspect_tgp2_index.py',
  gamedataInspector: 'inspect_gamedata.py',
});

export class StarWrathAdapterError extends PlanError {
  constructor(code, detail) {
    super(code, detail);
    this.name = 'StarWrathAdapterError';
  }
}
function fail(code, detail) {
  throw new StarWrathAdapterError(code, detail);
}
const digest = (value) => createHash('sha256').update(value).digest('hex');

function sameStat(a, b) {
  return (
    a.isFile() &&
    b.isFile() &&
    !a.isSymbolicLink() &&
    !b.isSymbolicLink() &&
    a.size === b.size &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

/** Open only bounded ordinary saved files; no game executable/assets are opened. */
async function readPinned(input, maxBytes, role) {
  const file = input.path;
  let handle;
  try {
    const before = await lstat(file);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size < 2 ||
      before.size > maxBytes ||
      before.nlink !== 1
    ) {
      fail('STAR_SOURCE_UNSAFE', 'Source is not a bounded ordinary saved file: ' + role);
    }
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!sameStat(before, opened)) fail('STAR_SOURCE_CHANGED', 'Source changed before reading: ' + role);
    const bytes = await handle.readFile();
    if (
      bytes.length !== before.size ||
      !sameStat(opened, await handle.stat()) ||
      !sameStat(before, await lstat(file))
    ) {
      fail('STAR_SOURCE_CHANGED', 'Source changed while being read: ' + role);
    }
    const sha256 = digest(bytes);
    if (sha256 !== input.sha256)
      fail('STAR_SOURCE_HASH', 'Pinned SHA-256 differs from selected source: ' + role);
    return { path: file, sha256, bytes: bytes.length, data: bytes };
  } catch (error) {
    if (error instanceof StarWrathAdapterError) throw error;
    fail('STAR_SOURCE_UNAVAILABLE', 'Unable to verify saved source: ' + role);
  } finally {
    await handle?.close();
  }
}

function json(bytes, role) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('STAR_JSON_INVALID', 'Saved report is not valid UTF-8 JSON: ' + role);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('STAR_JSON_INVALID', 'Saved report is not an object: ' + role);
  }
  return parsed;
}

function metadataSha(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) {
    fail('STAR_REPORT_SCHEMA', 'Invalid saved hash field: ' + label);
  }
  return value;
}
function observed(value, label) {
  if (
    typeof value !== 'string' ||
    value.length > 50 ||
    value.length < 20 ||
    !Number.isFinite(Date.parse(value)) ||
    !/(?:Z|\+00:00)$/.test(value)
  ) {
    fail('STAR_REPORT_SCHEMA', 'Invalid saved UTC timestamp: ' + label);
  }
  return value;
}

/** Only known, sanitized stable metadata is ever promoted to a result. */
export function summarizeStarSnapshot(value, expectedHost) {
  if (
    value.snapshot_schema !== 'star_wrath_offline_build_v1' ||
    value.machine !== expectedHost ||
    value.executable?.filename !== 'StarWrath.exe' ||
    value.executable?.pe?.is_pe !== true ||
    value.executable?.pe?.pe_type !== 'PE32+' ||
    value.executable?.pe?.machine_hex !== '0x8664' ||
    value.gamedata?.index?.filename !== 'gamedata.index' ||
    value.gamedata?.package?.filename !== 'gamedata.pk2' ||
    value.privacy?.absolute_input_paths_in_snapshot !== false ||
    value.privacy?.data_written_from_game !== false ||
    value.privacy?.included_raw_assets_or_logs !== false
  ) {
    fail('STAR_REPORT_SCHEMA', 'Saved snapshot does not meet the expected archived metadata contract.');
  }
  const product = value.executable.version_info?.ProductVersion;
  if (typeof product !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.()_-]{0,79}$/.test(product)) {
    fail('STAR_REPORT_SCHEMA', 'Unexpected saved product-version text.');
  }
  const exeSha256 = metadataSha(value.executable.sha256, 'exe');
  const archiveSha256 = metadataSha(value.gamedata.package.sha256, 'archive');
  const indexSha256 = metadataSha(value.gamedata.index.sha256, 'index');
  const count = value.gamedata.zstd_xml_scan?.xml_documents_parsed;
  if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) {
    fail('STAR_REPORT_SCHEMA', 'Invalid saved snapshot XML document count.');
  }
  return {
    schema: 'workbridge.starwrath.snapshot-v1',
    observedUtc: observed(value.observed_utc, 'snapshot'),
    host: value.machine,
    productVersion: product,
    exeSha256,
    archiveSha256,
    indexSha256,
    xmlDocumentsInBoundedScan: count,
    evidenceKind: 'archived_static_file_metadata',
    gameContacted: false,
    liveRoleVerified: false,
    serverAuthorityVerified: false,
    antiCheatActivationVerified: false,
  };
}

export function summarizeStarPhysics(value) {
  const archive = value.files?.archive,
    index = value.files?.index,
    scan = value.scan;
  if (
    archive?.basename !== 'gamedata.pk2' ||
    index?.basename !== 'gamedata.index' ||
    (scan?.incomplete !== true && scan?.incomplete !== false) ||
    !Number.isSafeInteger(scan?.xml_documents_parsed) ||
    scan.xml_documents_parsed < 0 ||
    scan.xml_documents_parsed > 5_000
  ) {
    fail('STAR_REPORT_SCHEMA', 'Saved physics metadata is not a bounded inspector report.');
  }
  return {
    observedUtc: observed(value.observed_utc, 'physics'),
    archiveSha256: metadataSha(archive.sha256, 'physics archive'),
    indexSha256: metadataSha(index.sha256, 'physics index'),
    xmlDocumentsParsed: scan.xml_documents_parsed,
    incomplete: scan.incomplete,
  };
}

function within(parent, child) {
  const relative = win32.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..\\') && !win32.isAbsolute(relative);
}

function authorizedInputPath(root, role, filename) {
  const path = win32.normalize(filename);
  if (Object.hasOwn(SCRIPT_NAMES, role)) {
    if (path.toLowerCase() !== win32.join(root, 'tools', SCRIPT_NAMES[role]).toLowerCase()) {
      fail('STAR_TOOL_PATH', 'The selected script role is not the reviewed Star Wrath helper: ' + role);
    }
  } else if (role === 'snapshot') {
    if (!within(win32.join(root, 'reports', 'snapshots'), path) || !/\.json$/i.test(path)) {
      fail('STAR_SOURCE_SCOPE', 'Snapshot must be under the reviewed Star Wrath snapshots directory.');
    }
  } else if (role === 'physicsBefore' || role === 'physicsAfter') {
    if (
      !within(win32.join(root, 'reports'), path) ||
      win32.dirname(path).toLowerCase() !== win32.join(root, 'reports').toLowerCase() ||
      !/\.json$/i.test(path)
    ) {
      fail('STAR_SOURCE_SCOPE', 'Physics input must be an approved saved report under Star Wrath reports.');
    }
  } else {
    fail('STAR_INPUT_ROLE', 'Unknown saved Star Wrath input role.');
  }
}

/** Refuse reparse points/junctions in the source tree before reading any file. */
async function verifyTrustedParents(root, target, role) {
  const relative = win32.relative(root, target);
  if (!within(root, target)) fail('STAR_SOURCE_SCOPE', 'Source is not inside the approved project: ' + role);
  let cursor = root;
  const directories = ['', ...relative.split('\\').slice(0, -1)];
  for (const part of directories) {
    if (part) cursor = win32.join(cursor, part);
    let entry;
    try {
      entry = await lstat(cursor);
    } catch {
      fail('STAR_SOURCE_UNAVAILABLE', 'Missing source ancestor: ' + role);
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      fail('STAR_SOURCE_LINK', 'Source ancestor is a link/junction or not a directory: ' + role);
    }
  }
}

/** Only the pre-reviewed source scripts inside a fixed trusted local project may run. */
export function createStarWrathProvider({
  projectRoot = DEFAULT_STAR_WRATH_ROOT,
  python = DEFAULT_STAR_WRATH_PYTHON,
  executeComparator = runStarPythonComparator,
} = {}) {
  const root = win32.normalize(projectRoot);
  const preflight = async (plan, host = hostname()) => {
    if (plan.profile !== 'starwrath.offline.v1' || host.toUpperCase() !== plan.expectedHost) {
      fail('STAR_HOST', 'The selected Star Wrath plan is not bound to this host/profile.');
    }
    const sources = {};
    for (const [role, input] of Object.entries(plan.inputs)) {
      authorizedInputPath(root, role, input.path);
      await verifyTrustedParents(root, input.path, role);
      const result = await readPinned(
        input,
        role === 'snapshot' ? SNAPSHOT_MAX : role.startsWith('physics') ? REPORT_MAX : SCRIPT_MAX,
        role,
      );
      if (role === 'snapshot') summarizeStarSnapshot(json(result.data, role), plan.expectedHost);
      if (role === 'physicsBefore' || role === 'physicsAfter') summarizeStarPhysics(json(result.data, role));
      sources[role] = {
        path: result.path,
        sha256: result.sha256,
        bytes: result.bytes,
        kind: Object.hasOwn(SCRIPT_NAMES, role) ? 'reviewed_python_source' : 'saved_report',
      };
    }
    return sources;
  };
  const actions = Object.freeze({
    'starwrath.snapshot-audit': async ({ plan }) => {
      await verifyTrustedParents(root, plan.inputs.snapshot.path, 'snapshot');
      const saved = await readPinned(plan.inputs.snapshot, SNAPSHOT_MAX, 'snapshot');
      return {
        result: {
          ...summarizeStarSnapshot(json(saved.data, 'snapshot'), plan.expectedHost),
          sourceReportSha256: saved.sha256,
        },
        childBundle: null,
      };
    },
    'starwrath.physics-compare': async ({ plan }) => {
      await verifyTrustedParents(root, plan.inputs.physicsBefore.path, 'physicsBefore');
      await verifyTrustedParents(root, plan.inputs.physicsAfter.path, 'physicsAfter');
      const before = await readPinned(plan.inputs.physicsBefore, REPORT_MAX, 'physicsBefore');
      const after = await readPinned(plan.inputs.physicsAfter, REPORT_MAX, 'physicsAfter');
      // Re-pin all imported Python sources immediately before launching the reviewed helper.
      // A change after run preflight must never become silently executable.
      for (const role of Object.keys(SCRIPT_NAMES)) {
        await verifyTrustedParents(root, plan.inputs[role].path, role);
        await readPinned(plan.inputs[role], SCRIPT_MAX, role);
      }
      // Python's existing strict validator checks every numeric field and labels incomplete scans.
      const compared = await executeComparator({
        python,
        root,
        script: plan.inputs.comparator.path,
        before: before.path,
        after: after.path,
      });
      if (
        compared?.schema !== 'star-wrath-physics-report-diff-v1' ||
        typeof compared.coverage?.previous_incomplete !== 'boolean' ||
        typeof compared.coverage?.current_incomplete !== 'boolean' ||
        typeof compared.hash_changes?.index !== 'boolean' ||
        typeof compared.hash_changes?.archive !== 'boolean' ||
        !compared.previous ||
        !compared.current
      ) {
        fail('STAR_COMPARATOR_RESULT', 'The reviewed comparator returned an incompatible saved-report diff.');
      }
      const previous = summarizeStarPhysics(json(before.data, 'physicsBefore'));
      const current = summarizeStarPhysics(json(after.data, 'physicsAfter'));
      for (const [label, source, verified] of [
        ['previous', compared.previous, previous],
        ['current', compared.current, current],
      ]) {
        if (
          source.index?.sha256 !== verified.indexSha256 ||
          source.archive?.sha256 !== verified.archiveSha256 ||
          source.scan_incomplete !== verified.incomplete ||
          source.observed_utc !== verified.observedUtc
        ) {
          fail('STAR_COMPARATOR_RESULT', 'Comparator output disagrees with pinned input metadata: ' + label);
        }
      }
      const selfComparison = before.sha256 === after.sha256;
      const groups = [
        'global_scalar_parameters',
        'global_array_numeric_tokens',
        'ship_design.numeric_identifiers',
      ];
      if (!groups.every((group) => Array.isArray(compared.numeric_parameter_changes?.[group]))) {
        fail('STAR_COMPARATOR_RESULT', 'Comparator result is missing controlled numerical change rows.');
      }
      return {
        result: {
          schema: 'workbridge.starwrath.physics-diff-v1',
          comparator: 'compare_physics_runs.py',
          comparatorSourceSha256: plan.inputs.comparator.sha256,
          previousReportSha256: before.sha256,
          currentReportSha256: after.sha256,
          comparisonMode: selfComparison ? 'same_saved_report_self_check' : 'two_saved_reports',
          previous,
          current,
          hashChanges: { archive: compared.hash_changes.archive, index: compared.hash_changes.index },
          observedChangeCounts: {
            scan: Object.keys(compared.scan_count_changes ?? {}).length,
            summary: Object.keys(compared.ship_design_summary_changes ?? {}).length,
            globalScalars: compared.numeric_parameter_changes.global_scalar_parameters.length,
            globalArrays: compared.numeric_parameter_changes.global_array_numeric_tokens.length,
            shipNumericIdentifiers:
              compared.numeric_parameter_changes['ship_design.numeric_identifiers'].length,
          },
          incomplete: previous.incomplete || current.incomplete,
          exhaustive: compared.coverage.same_scan_scope_and_no_reported_skips === true,
          authorityOrLiveExecutionVerified: false,
        },
        childBundle: null,
      };
    },
    'starwrath.correlate': async ({ outcomes }) => {
      const snapshot = outcomes.get('starwrath.snapshot-audit')?.result;
      const comparison = outcomes.get('starwrath.physics-compare')?.result;
      if (!snapshot || !comparison) {
        fail('STAR_DEPENDENCY_RESULT', 'Cannot correlate before verified snapshot and diff.');
      }
      const archiveMatch = snapshot.archiveSha256 === comparison.current.archiveSha256;
      const indexMatch = snapshot.indexSha256 === comparison.current.indexSha256;
      return {
        result: {
          schema: 'workbridge.starwrath.cross-source-v1',
          evidenceLevel: 'saved_static_metadata_only',
          historicalBuildLabel: snapshot.productVersion,
          physicsCurrentCorrespondsToSnapshotAssets: archiveMatch && indexMatch,
          archiveShaMatches: archiveMatch,
          indexShaMatches: indexMatch,
          referenceSelfComparison: comparison.comparisonMode === 'same_saved_report_self_check',
          physicsScanIncomplete: comparison.incomplete,
          claim:
            archiveMatch && indexMatch
              ? 'saved archive/index fingerprints agree; runtime behavior is unobserved'
              : 'saved sources describe different archive/index versions; do not attribute one build to both',
          gameContacted: false,
          liveExecutionVerified: false,
          serverAuthorityVerified: false,
        },
        childBundle: null,
      };
    },
  });
  return Object.freeze({ actions, verifiers: Object.freeze({}), preflight });
}

async function runStarPythonComparator({ python, root, script, before, after }) {
  let output;
  try {
    // Python receives vetted, SHA-pinned local source/report files; never a plan-supplied command.
    ({ stdout: output } = await executeFile(python, ['-B', script, '--allow-incomplete', before, after], {
      cwd: root,
      windowsHide: true,
      shell: false,
      timeout: 40_000,
      maxBuffer: 256 * 1024,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) =>
            !/^(PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|PYTHONINSPECT|OPENAI_|CONTROL_PLANE_|WORKBRIDGE_)/i.test(
              name,
            ),
        ),
      ),
    }));
  } catch (error) {
    const code = Number.isSafeInteger(error?.code) ? error.code : null;
    fail(
      'STAR_COMPARATOR_FAILED',
      'Pinned offline Python comparator failed' +
        (code === null ? ' or timed out.' : ' (exit ' + code + ').'),
    );
  }
  try {
    if (!output || Buffer.byteLength(output, 'utf8') > 256 * 1024) throw Error();
    const value = JSON.parse(output);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch {
    fail('STAR_COMPARATOR_RESULT', 'Pinned offline Python comparator returned malformed JSON.');
  }
}

export const STAR_WRATH_PROVIDER = createStarWrathProvider();
