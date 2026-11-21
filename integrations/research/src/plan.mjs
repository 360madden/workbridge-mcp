import { hostname } from 'node:os';
import { win32 } from 'node:path';
import { PROFILE_REGISTRY } from './registry.mjs';

export class PlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PlanError';
    this.code = code;
  }
}

const MAX_PLAN_BYTES = 32 * 1024;
const MAX_STEPS = 12;
const MAX_INPUTS = 12;
const STEP_ID = /^[a-z][a-z0-9-]{1,31}$/;
const PLAN_ID = /^[a-z][a-z0-9-]{2,63}$/;
const HOST = /^[A-Z0-9-]{3,64}$/;
const SHA = /^[a-f0-9]{64}$/i;

function fail(code, message) {
  throw new PlanError(code, message);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keysExactly(value, allowed, label) {
  if (!object(value)) fail('INVALID_SHAPE', label + ' must be an object.');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('UNKNOWN_FIELD', label + ' has unsupported field ' + key);
  }
}

function windowsSourcePath(value, kind, label) {
  if (
    typeof value !== 'string' ||
    value.length < 5 ||
    value.length > 2048 ||
    !/^[A-Za-z]:\\/.test(value) ||
    !win32.isAbsolute(value) ||
    /[\u0000-\u001f\u007f<>|"?*]/.test(value) ||
    value.slice(2).includes(':') ||
    value.split('\\').some((segment) => segment === '.' || segment === '..' || segment === '')
  ) {
    fail('INVALID_SOURCE_PATH', label + ' must be a bounded absolute local Windows path with no traversal.');
  }
  if (kind === 'file' && value.endsWith('\\')) {
    fail('INVALID_SOURCE_PATH', label + ' must name a file, not a directory.');
  }
  return win32.normalize(value);
}

function normalizedInput(raw, contract, label) {
  keysExactly(raw, ['path', 'sha256'], label);
  const path = windowsSourcePath(raw.path, contract.kind, label);
  if (contract.shaRequired && typeof raw.sha256 !== 'string') {
    fail('INPUT_HASH_REQUIRED', label + ' requires an expected SHA-256.');
  }
  if (raw.sha256 !== undefined && (typeof raw.sha256 !== 'string' || !SHA.test(raw.sha256))) {
    fail('INVALID_INPUT_HASH', label + ' SHA-256 must contain exactly 64 hex characters.');
  }
  return Object.freeze({ path, ...(raw.sha256 === undefined ? {} : { sha256: raw.sha256.toLowerCase() }) });
}

export function validatePlan(raw, { host = hostname(), registry = PROFILE_REGISTRY } = {}) {
  if (!object(raw)) fail('PLAN_INVALID', 'Research plan must be a JSON object.');
  const bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  if (bytes < 16 || bytes > MAX_PLAN_BYTES) {
    fail('PLAN_SIZE', 'Research plan exceeds the 32 KiB limit.');
  }
  keysExactly(raw, ['schema', 'planId', 'expectedHost', 'profile', 'inputs', 'steps'], 'plan');
  if (raw.schema !== 'workbridge.research-plan.v1') fail('PLAN_VERSION', 'Unsupported research plan schema.');
  if (typeof raw.planId !== 'string' || !PLAN_ID.test(raw.planId)) {
    fail('PLAN_ID', 'Plan ID must be 3–64 lowercase letters, numbers or hyphens starting with a letter.');
  }
  if (typeof raw.expectedHost !== 'string' || !HOST.test(raw.expectedHost)) {
    fail('HOST_INVALID', 'Plan must name an explicit uppercase Windows hostname.');
  }
  if (String(host).toUpperCase() !== raw.expectedHost) {
    fail('WRONG_HOST', 'Research plan targets ' + raw.expectedHost + ', not verified host ' + host + '.');
  }
  const profile = registry[raw.profile];
  if (!profile) fail('UNKNOWN_PROFILE', 'No reviewed research profile registered for ' + String(raw.profile));
  keysExactly(raw.inputs, Object.keys(profile.inputs), 'inputs');
  if (Object.keys(raw.inputs).length < 1 || Object.keys(raw.inputs).length > MAX_INPUTS) {
    fail('INPUT_COUNT', 'Plan must provide 1–12 declared input sources.');
  }
  const inputs = {};
  for (const [name, source] of Object.entries(raw.inputs)) {
    inputs[name] = normalizedInput(source, profile.inputs[name], 'inputs.' + name);
  }
  for (const [first, second] of profile.inputPairs ?? []) {
    if ((inputs[first] !== undefined) !== (inputs[second] !== undefined)) {
      fail('INPUT_PAIR', first + ' and ' + second + ' must be supplied together.');
    }
  }
  if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > MAX_STEPS) {
    fail('STEP_COUNT', 'Plan must declare 1–12 steps.');
  }
  const steps = [];
  const ids = new Set();
  const actions = new Map();
  for (const [index, rawStep] of raw.steps.entries()) {
    keysExactly(rawStep, ['id', 'action', 'needs'], 'steps[' + index + ']');
    if (typeof rawStep.id !== 'string' || !STEP_ID.test(rawStep.id)) {
      fail('STEP_ID', 'Invalid step ID at index ' + index);
    }
    if (ids.has(rawStep.id)) fail('DUPLICATE_STEP', 'Repeated step ID: ' + rawStep.id);
    if (typeof rawStep.action !== 'string' || !profile.actions[rawStep.action]) {
      fail('UNKNOWN_ACTION', 'Unsupported adapter action for step ' + rawStep.id);
    }
    if (profile.uniqueActions && actions.has(rawStep.action)) {
      fail('DUPLICATE_ACTION', 'Only one ' + rawStep.action + ' action is supported in this profile.');
    }
    if (!Array.isArray(rawStep.needs) || rawStep.needs.length > MAX_STEPS) {
      fail('STEP_NEEDS', 'Each step must declare a bounded needs array.');
    }
    const dependencies = new Set();
    for (const need of rawStep.needs) {
      if (typeof need !== 'string' || !STEP_ID.test(need)) {
        fail('STEP_NEEDS', 'Dependencies must reference valid step IDs.');
      }
      if (need === rawStep.id) fail('STEP_SELF_DEPENDENCY', 'Step cannot depend on itself.');
      if (dependencies.has(need)) fail('DUPLICATE_DEPENDENCY', 'Repeated dependency ' + need);
      dependencies.add(need);
    }
    ids.add(rawStep.id);
    actions.set(rawStep.action, rawStep.id);
    steps.push(
      Object.freeze({
        id: rawStep.id,
        action: rawStep.action,
        needs: Object.freeze([...dependencies]),
      }),
    );
  }
  for (const step of steps) {
    for (const need of step.needs) {
      if (!ids.has(need)) fail('MISSING_DEPENDENCY', 'Step ' + step.id + ' refers to unknown step ' + need);
    }
    const action = profile.actions[step.action];
    for (const input of action.requires) {
      if (!inputs[input]) fail('MISSING_INPUT', 'Step ' + step.id + ' requires input ' + input);
    }
    for (const prerequisite of action.prior) {
      const id = actions.get(prerequisite);
      if (!id || !step.needs.includes(id)) {
        fail('ACTION_PREREQUISITE', step.action + ' must directly depend on ' + prerequisite);
      }
    }
  }
  for (const [sourceAction, dependencyAction] of profile.conditionalDependencies ?? []) {
    const sourceId = actions.get(sourceAction);
    const dependencyId = actions.get(dependencyAction);
    if (
      sourceId &&
      dependencyId &&
      !steps.find((step) => step.id === sourceId).needs.includes(dependencyId)
    ) {
      fail('ACTION_PREREQUISITE', sourceAction + ' must depend on ' + dependencyAction + ' when present.');
    }
  }
  const pending = new Map(steps.map((step) => [step.id, step]));
  const ordered = [];
  const completed = new Set();
  while (pending.size) {
    const ready = [...pending.values()].find((step) => step.needs.every((need) => completed.has(need)));
    if (!ready) fail('DEPENDENCY_CYCLE', 'Research plan has cyclic dependencies.');
    pending.delete(ready.id);
    completed.add(ready.id);
    ordered.push(ready);
  }
  return Object.freeze({
    schema: raw.schema,
    planId: raw.planId,
    expectedHost: raw.expectedHost,
    profile: raw.profile,
    executionMode: profile.executionMode,
    inputs: Object.freeze(inputs),
    steps: Object.freeze(steps),
    orderedSteps: Object.freeze(ordered),
    hasExecution: false,
  });
}

export function describePlan(validated) {
  return {
    schema: 'workbridge.research-plan-preview.v1',
    planId: validated.planId,
    expectedHost: validated.expectedHost,
    profile: validated.profile,
    executionMode: validated.executionMode,
    inputRoles: Object.keys(validated.inputs),
    stepCount: validated.steps.length,
    executionOrder: validated.orderedSteps.map((step, index) => ({
      order: index + 1,
      id: step.id,
      action: step.action,
      needs: [...step.needs],
    })),
    toolsInvoked: false,
    gameContacted: false,
    writesPerformed: false,
  };
}
