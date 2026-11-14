import os from 'node:os';

// Fixed historical evidence, not an operator-supplied override. This records a
// narrowly observed pre-deployment refusal; it does not reconstruct a journal.
const common = {
  'controller/Invoke-WorkbridgeUpdate.ps1':
    '76ccc09417b2cf80f6a81e1d4c0542eaca36a803aa0c18aa806278c976e182c4',
  'service-task.xml': '5dea6847d1966b8ccc0c5087f5ed54f12d580d2b1356408cae63d9f134efb34e',
};
const catalog = Object.freeze({
  'agent12-activate-20261031-01': {
    files: {
      ...common,
      'request.json': '059bc93901b75fb1805000dafcbba0cd3c6038d9ee3ea7a4bcccfa2167e18902',
      'controller-error.json': 'dcf895c1bc765e83392672f64eb1949f5f35e9eb8d91808d1d6b99ebe2a4d1af',
      'controller/Workbridge-Update.ps1': '1890da9408376b270bc2aa7847382d1f2a2ad595512526d098aa023bf06df375',
      'controller/release-acceptance.mjs': 'ea292b6562f8379347b4e89c5ba75741188df7f2b926b40b7e0785064f3d72d3',
      'probe.log': 'd055c2a2c49c0e7b2d69893366a83aeb04b4758ce2fc7a77696ab26d0a1922cd',
    },
    probeState: [],
  },
  'gui006-activate-20261026-01': {
    files: {
      ...common,
      'request.json': 'c87cb6e4b6f0575694132ee4c119ace46abe73e48e80a70e45dfc2c22bd3b4eb',
      'controller-error.json': 'f9d2075a54e4cf37826f0ea6a422263179a58e885d6072902df82f9d468476aa',
      'controller/Workbridge-Update.ps1': '38610c7e031455f6917ad8dbc412bf5c2e720e77d0b40e41b48f0d4b5f02cfe6',
      'controller/release-acceptance.mjs': '7ba7b3f5f58dbb3f1d0a6e5793bdbe7ea8fd4a2ffa2e68d53f8a199dc3b33fa7',
      'probe.log': '433b090b5df3f89e0fdbf8f0756e2a64140b3345da64bd01a4f71518813c5e76',
      'probe-state/release-probe.json': '3403216d41983ac5b88f5ad1167616bfe87bb72daf6456acc91dac91eadacdf0',
    },
    probeState: ['release-probe.json'],
  },
});
const rootNames = [
  'controller',
  'controller-error.json',
  'probe-state',
  'probe.log',
  'request.json',
  'service-task.xml',
];
const controllerNames = ['Invoke-WorkbridgeUpdate.ps1', 'Workbridge-Update.ps1', 'release-acceptance.mjs'];
const fail = () =>
  Object.assign(new Error('CONTROLLER_PREFLIGHT_EVIDENCE_INVALID'), {
    code: 'CONTROLLER_PREFLIGHT_EVIDENCE_INVALID',
  });
function exactDirectory(actual, names, directories = []) {
  if (!actual || !Array.isArray(actual.entries) || actual.entries.length !== names.length) throw fail();
  const seen = new Set();
  for (const entry of actual.entries) {
    if (
      seen.has(entry.name) ||
      !names.includes(entry.name) ||
      entry.type !== (directories.includes(entry.name) ? 'directory' : 'file')
    )
      throw fail();
    seen.add(entry.name);
  }
}
// This helper compares read-only evidence to a caller-provided catalog but grants
// no authority; the reference graph uses only the fixed wrapper below.
export async function matchControllerEvidence(spec, io) {
  if (!spec || typeof io?.readFile !== 'function' || typeof io?.readDirectory !== 'function') throw fail();
  const root = await io.readDirectory('');
  const controller = await io.readDirectory('controller');
  const probe = await io.readDirectory('probe-state');
  exactDirectory(root, rootNames, ['controller', 'probe-state']);
  exactDirectory(controller, controllerNames);
  exactDirectory(probe, spec.probeState);
  const files = {};
  for (const [name, expected] of Object.entries(spec.files)) {
    const entry = await io.readFile(name);
    if (typeof entry?.sha256 !== 'string' || entry.sha256.toLowerCase() !== expected || !entry.identity)
      throw fail();
    files[name] = { sha256: entry.sha256.toLowerCase(), identity: entry.identity };
  }
  const rootAfter = await io.readDirectory('');
  const controllerAfter = await io.readDirectory('controller');
  const probeAfter = await io.readDirectory('probe-state');
  if (
    JSON.stringify(rootAfter) !== JSON.stringify(root) ||
    JSON.stringify(controllerAfter) !== JSON.stringify(controller) ||
    JSON.stringify(probeAfter) !== JSON.stringify(probe)
  )
    throw fail();
  return {
    schema: 'workbridge-historical-controller-preflight/1',
    catalogVersion: 1,
    observedInvocationOnly: true,
    earlierHistoryUnproven: true,
    directories: { root, controller, probeState: probe },
    files,
  };
}
export async function classifyControllerPreflight(operationId, io) {
  if (os.hostname().toUpperCase() !== 'AMD-DESKTOP') return null;
  const spec = Object.hasOwn(catalog, operationId) ? catalog[operationId] : null;
  if (!spec) return null;
  return matchControllerEvidence(spec, io);
}
