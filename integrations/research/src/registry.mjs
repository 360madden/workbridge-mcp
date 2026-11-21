// Reviewed adapter declarations only. New research profiles register their
// own explicit input/action contracts; never accept executable commands from
// user-supplied plan JSON.
export const PROFILE_REGISTRY = Object.freeze({
  'rift.offline.v1': Object.freeze({
    description: 'Saved-file RIFT research; no game/process interaction.',
    inputs: Object.freeze({
      client: { kind: 'file', shaRequired: true },
      telemetry: { kind: 'file' },
      track: { kind: 'file' },
      rr2: { kind: 'file' },
      rre: { kind: 'file' },
      rreBinding: { kind: 'file' },
      afterClient: { kind: 'file', shaRequired: true },
      anchors: { kind: 'file' },
      physicalReceipt: { kind: 'directory' },
    }),
    actions: Object.freeze({
      'rift.doctor': { requires: ['client'], prior: [] },
      'rift.saved-session': { requires: ['client', 'telemetry', 'track'], prior: ['rift.doctor'] },
      'rift.patch-compare': { requires: ['client', 'afterClient'], prior: ['rift.doctor'] },
      'rift.compat-audit': { requires: ['physicalReceipt'], prior: ['rift.saved-session'] },
    }),
    inputPairs: [['rre', 'rreBinding']],
    conditionalDependencies: [['rift.compat-audit', 'rift.patch-compare']],
    uniqueActions: true,
    executionMode: 'offline_saved_data',
  }),
  'starwrath.offline.v1': Object.freeze({
    description:
      'Saved Star Wrath RE snapshot and bounded physics aggregate comparison; no game assets or process access.',
    inputs: Object.freeze({
      snapshot: { kind: 'file', shaRequired: true },
      physicsBefore: { kind: 'file', shaRequired: true },
      physicsAfter: { kind: 'file', shaRequired: true },
      comparator: { kind: 'file', shaRequired: true },
      physicsInspector: { kind: 'file', shaRequired: true },
      indexInspector: { kind: 'file', shaRequired: true },
      gamedataInspector: { kind: 'file', shaRequired: true },
    }),
    actions: Object.freeze({
      'starwrath.snapshot-audit': { requires: ['snapshot'], prior: [] },
      'starwrath.physics-compare': {
        requires: [
          'physicsBefore',
          'physicsAfter',
          'comparator',
          'physicsInspector',
          'indexInspector',
          'gamedataInspector',
        ],
        prior: ['starwrath.snapshot-audit'],
      },
      'starwrath.correlate': {
        requires: ['snapshot', 'physicsAfter'],
        prior: ['starwrath.snapshot-audit', 'starwrath.physics-compare'],
      },
    }),
    inputPairs: [['physicsBefore', 'physicsAfter']],
    uniqueActions: true,
    executionMode: 'offline_saved_data',
  }),
});
