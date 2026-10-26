/**
 * Pure projection of supplied tool responses; never polls, executes, recovers or writes.
 * Wrap each raw diagnostics/command_list/workflow_list response with its observation
 * time. `now` is supplied by the caller so age checks are deterministic. These are
 * separate observations, not an atomic snapshot or proof that an owner is alive.
 * Optional agent data has the explicit shape { agents: [{ agentId, status }], complete };
 * it describes reported agents only and is never inferred from command capacity.
 */
export type OperationsObservation = { data: unknown; observedAt?: string };
export type OperationsSummaryInput = {
  now: string;
  maxAgeSeconds?: number;
  sourceVersion?: string;
  diagnostics?: OperationsObservation;
  commandList?: OperationsObservation;
  workflowList?: OperationsObservation;
  agents?: OperationsObservation;
};

type ObjectData = Record<string, unknown>;
type Freshness = 'fresh' | 'stale' | 'unknown';
type NextAction = {
  tool: 'diagnostics' | 'command_list' | 'workflow_list' | 'command_status' | 'workflow_status';
  reason: string;
  jobId?: string;
  workflowId?: string;
  offset?: number;
};
const rowLimit = 20;
const commandStatuses = ['running', 'passed', 'failed', 'cancelled', 'timed_out', 'interrupted'] as const;
const workflowStates = [
  'pending',
  'validating',
  'ready_for_review',
  'failed',
  'stale',
  'blocked',
  'cancelled',
  'undone',
] as const;
const agentStatuses = ['running', 'idle', 'pending', 'blocked', 'failed', 'completed', 'stopped'] as const;
const sensitive =
  /secret|password|passwd|token|api[_-]?key|authorization|bearer|credential|^sk-|^gh[pousr]_|^github_pat_|^eyJ/i;

function object(value: unknown): ObjectData {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectData) : {};
}
function integer(value: unknown, max = 1_000_000): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
    ? value
    : null;
}
function identifier(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length <= 100 &&
    /^[A-Za-z0-9_-]+$/.test(value) &&
    !sensitive.test(value)
    ? value
    : null;
}
function version(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length <= 64 &&
    /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(value) &&
    !sensitive.test(value)
    ? value
    : null;
}
function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 32 || !/^\d{4}-\d\d-\d\dT.*Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function freshness(observation: OperationsObservation | undefined, now: number | null, maxAge: number) {
  const observed = timestamp(observation?.observedAt);
  const ageSeconds = now !== null && observed !== null ? (now - observed) / 1000 : null;
  const state: Freshness =
    ageSeconds === null || ageSeconds < 0 ? 'unknown' : ageSeconds > maxAge ? 'stale' : 'fresh';
  return { state, ageSeconds: ageSeconds !== null && ageSeconds >= 0 ? ageSeconds : null };
}
function member<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : null;
}

function catalog(observation: OperationsObservation | undefined, field: string, scanLimit: number) {
  const data = object(observation?.data);
  const allRows = Array.isArray(data[field]) ? data[field] : [];
  const nextOffset = integer(data.nextOffset, 100_000);
  const hasErrors = data.hasErrors === true || (Array.isArray(data.issues) && data.issues.length > 0);
  const limitReached = [
    'catalogTruncated',
    'scanLimitReached',
    'outputLimitReached',
    'timeLimitReached',
  ].some((key) => data[key] === true);
  return {
    rows: allRows.slice(0, scanLimit) as unknown[],
    metadata: {
      provided: observation !== undefined,
      // Even an empty filtered page can have a continuation. A single supplied page
      // cannot certify earlier pages; these flags describe this response only.
      complete:
        observation !== undefined &&
        Array.isArray(data[field]) &&
        data.complete === true &&
        data.nextOffset === null &&
        !hasErrors &&
        !limitReached &&
        allRows.length <= scanLimit,
      nextOffset,
      hasErrors,
      limitReached,
      inputTruncated: allRows.length > scanLimit,
    },
  };
}

/** Only allowlisted metadata is copied; paths, titles, commands, errors and logs are omitted. */
export function summarizeOperations(input: OperationsSummaryInput) {
  const now = timestamp(input.now);
  const maxAge = integer(input.maxAgeSeconds, 3600) ?? 60;
  const diagnosticAge = freshness(input.diagnostics, now, maxAge);
  const commandAge = freshness(input.commandList, now, maxAge);
  const workflowAge = freshness(input.workflowList, now, maxAge);
  const diagnostics = object(input.diagnostics?.data);
  const local = object(diagnostics.localCli);
  const instanceId =
    typeof local.instanceId === 'string' &&
    local.instanceId.length === 36 &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(local.instanceId)
      ? local.instanceId
      : null;
  const pid = integer(local.pid, 0xffffffff);
  const started = timestamp(local.startedUtc);
  const observed = timestamp(input.diagnostics?.observedAt);
  const ownerKnown =
    local.enabled === true &&
    instanceId !== null &&
    pid !== null &&
    pid > 0 &&
    started !== null &&
    (observed === null || started <= observed);
  const owner = {
    instanceId: ownerKnown ? instanceId : null,
    pid: ownerKnown ? pid : null,
    startedUtc: ownerKnown ? new Date(started!).toISOString() : null,
    identityKnown: ownerKnown,
    freshness: diagnosticAge,
    liveVerified: false as const,
  };
  const sourceVersion = version(input.sourceVersion);
  const installedVersion = version(diagnostics.version);
  const endpointVersion = version(local.version);
  const versions = {
    source: sourceVersion,
    installed: installedVersion,
    mismatch: sourceVersion !== null && installedVersion !== null ? sourceVersion !== installedVersion : null,
    ownerVersionConflict:
      endpointVersion !== null && installedVersion !== null ? endpointVersion !== installedVersion : null,
  };

  const jobs = object(diagnostics.jobs);
  const capacity = object(jobs.capacity);
  const limit = integer(capacity.limit, 100);
  const occupied = integer(capacity.occupied, 100);
  const available = integer(capacity.available, 100);
  const inProgress = integer(capacity.inProgress, 100);
  const retainedResults = integer(capacity.retainedResults, 100);
  const capacityRows = Array.isArray(capacity.jobs) ? capacity.jobs : [];
  const slotIds = new Set<string>();
  const slots: { jobId: string; kind: 'in_progress' | 'retained_result'; nextAction: 'command_status' }[] =
    [];
  for (const value of capacityRows.slice(0, 100)) {
    const row = object(value);
    const jobId = identifier(row.jobId);
    const kind = member(row.kind, ['in_progress', 'retained_result'] as const);
    if (jobId && kind && !slotIds.has(jobId)) {
      slotIds.add(jobId);
      slots.push({ jobId, kind, nextAction: 'command_status' });
    }
  }
  const capacityValid =
    capacity.schemaVersion === 1 &&
    limit !== null &&
    limit > 0 &&
    occupied !== null &&
    available !== null &&
    inProgress !== null &&
    retainedResults !== null &&
    occupied + available === limit &&
    inProgress + retainedResults === occupied &&
    typeof capacity.closing === 'boolean' &&
    Array.isArray(capacity.jobs) &&
    capacityRows.length === occupied &&
    slots.length === occupied &&
    slots.filter((row) => row.kind === 'retained_result').length === retainedResults;
  const activeSlots = {
    valid: capacityValid,
    limit: capacityValid ? limit : null,
    occupied: capacityValid ? occupied : null,
    available: capacityValid ? available : null,
    inProgress: capacityValid ? inProgress : null,
    retainedResults: capacityValid ? retainedResults : null,
    closing: typeof capacity.closing === 'boolean' ? capacity.closing : null,
    jobs: capacityValid ? slots.slice(0, rowLimit) : [],
    rowsOmitted: capacityValid ? Math.max(0, slots.length - rowLimit) : 0,
    freshness: diagnosticAge,
    reservation: false as const,
  };
  const inventory = object(jobs.inventory);
  const stored = integer(jobs.storedJobs);
  const inventoryComplete =
    stored !== null &&
    inventory.complete === true &&
    inventory.limitReached === false &&
    inventory.timeLimitReached === false &&
    inventory.errorCode === null;
  const savedInventory = {
    recordNames: stored,
    complete: inventoryComplete,
    countKind: stored === null ? 'unknown' : inventoryComplete ? 'exact_names' : 'lower_bound_names',
    validatesResults: false as const,
  };

  const commandPage = catalog(input.commandList, 'jobs', 100);
  const commandCounts = { running: 0, passed: 0, failed: 0, cancelled: 0, timed_out: 0, interrupted: 0 };
  const commandRows = [];
  const commandIds = new Set<string>();
  let invalidCommands = 0;
  let pendingCommands = 0;
  for (const value of commandPage.rows) {
    const row = object(value);
    const jobId = identifier(row.id);
    const status = member(row.status, commandStatuses);
    if (!jobId || !status || commandIds.has(jobId)) {
      invalidCommands++;
      continue;
    }
    commandIds.add(jobId);
    commandCounts[status]++;
    if (status === 'running' || row.completionPending === true) pendingCommands++;
    commandRows.push({
      jobId,
      status,
      completionPending: typeof row.completionPending === 'boolean' ? row.completionPending : null,
      nextAction: 'command_status' as const,
    });
  }
  const commands = {
    ...commandPage.metadata,
    complete: commandPage.metadata.complete && invalidCommands === 0,
    freshness: commandAge,
    scope: 'supplied_page_only' as const,
    counts: commandCounts,
    pending: pendingCommands,
    invalidRows: invalidCommands,
    rows: commandRows.slice(0, rowLimit),
    rowsOmitted: Math.max(0, commandRows.length - rowLimit),
  };

  const workflowPage = catalog(input.workflowList, 'workflows', 50);
  const workflowCounts = {
    pending: 0,
    validating: 0,
    ready_for_review: 0,
    failed: 0,
    stale: 0,
    blocked: 0,
    cancelled: 0,
    undone: 0,
  };
  const workflowRows = [];
  const workflowIds = new Set<string>();
  let invalidWorkflows = 0;
  for (const value of workflowPage.rows) {
    const row = object(value);
    const workflowId = identifier(row.workflowId);
    const recordedState = member(row.recordedState, workflowStates);
    if (!workflowId || !recordedState || workflowIds.has(workflowId)) {
      invalidWorkflows++;
      continue;
    }
    workflowIds.add(workflowId);
    workflowCounts[recordedState]++;
    workflowRows.push({ workflowId, recordedState, nextAction: 'workflow_status' as const });
  }
  const workflows = {
    ...workflowPage.metadata,
    complete: workflowPage.metadata.complete && invalidWorkflows === 0,
    freshness: workflowAge,
    scope: 'supplied_page_only' as const,
    stateFreshness: 'recorded; inspect workflow_status for current evidence',
    counts: workflowCounts,
    invalidRows: invalidWorkflows,
    rows: workflowRows.slice(0, rowLimit),
    rowsOmitted: Math.max(0, workflowRows.length - rowLimit),
  };

  const agentPage = object(input.agents?.data);
  const agentInput = Array.isArray(agentPage.agents) ? agentPage.agents : [];
  const agentRows = [];
  const agentIds = new Set<string>();
  let invalidAgents = 0;
  for (const value of agentInput.slice(0, 100)) {
    const row = object(value);
    const agentId = identifier(row.agentId);
    const status = member(row.status, agentStatuses);
    if (!agentId || !status || agentIds.has(agentId)) {
      invalidAgents++;
      continue;
    }
    agentIds.add(agentId);
    agentRows.push({ agentId, status });
  }
  const agents = {
    provided: input.agents !== undefined,
    complete:
      input.agents !== undefined &&
      Array.isArray(agentPage.agents) &&
      agentPage.complete === true &&
      agentInput.length <= 100 &&
      invalidAgents === 0,
    freshness: freshness(input.agents, now, maxAge),
    reportedCount: input.agents === undefined ? null : agentRows.length,
    scope: 'supplied_metadata_only' as const,
    invalidRows: invalidAgents,
    inputTruncated: agentInput.length > 100,
    rows: agentRows.slice(0, rowLimit),
    rowsOmitted: Math.max(0, agentRows.length - rowLimit),
    inferredFromSlots: false as const,
  };

  let nextAction: NextAction;
  if (!ownerKnown || diagnosticAge.state !== 'fresh' || !capacityValid || activeSlots.closing)
    nextAction = { tool: 'diagnostics', reason: 'Refresh owner identity and capacity before acting.' };
  else if (versions.mismatch || versions.ownerVersionConflict)
    nextAction = {
      tool: 'diagnostics',
      reason: 'Inspect source and installed version evidence; use WB-001 for any later update.',
    };
  else if (retainedResults! > 0)
    nextAction = {
      tool: 'command_status',
      jobId: slots.find((row) => row.kind === 'retained_result')!.jobId,
      reason: 'Inspect the retained result and storage; recovery requires an explicit separate action.',
    };
  else if (!commands.complete || commandAge.state !== 'fresh')
    nextAction = {
      tool: 'command_list',
      offset: commandAge.state === 'fresh' ? (commands.nextOffset ?? 0) : 0,
      reason: 'Inspect missing or incomplete command evidence; preserve issues from earlier pages.',
    };
  else if (!workflows.complete || workflowAge.state !== 'fresh')
    nextAction = {
      tool: 'workflow_list',
      offset: workflowAge.state === 'fresh' ? (workflows.nextOffset ?? 0) : 0,
      reason: 'Inspect missing or incomplete workflow evidence; preserve issues from earlier pages.',
    };
  else if (!inventoryComplete)
    nextAction = { tool: 'diagnostics', reason: 'Inspect incomplete saved-record inventory.' };
  else {
    const job = slots[0] ?? commandRows.find((row) => row.status !== 'passed');
    const workflow = workflowRows.find((row) => row.recordedState !== 'undone');
    nextAction = job
      ? { tool: 'command_status', jobId: job.jobId, reason: 'Inspect current command evidence.' }
      : workflow
        ? {
            tool: 'workflow_status',
            workflowId: workflow.workflowId,
            reason: 'Inspect current workflow evidence; recorded state can be outdated.',
          }
        : { tool: 'diagnostics', reason: 'Refresh evidence before planning further work.' };
  }
  return {
    schemaVersion: 1 as const,
    readOnly: true as const,
    owner,
    versions,
    activeSlots,
    savedInventory,
    commands,
    workflows,
    agents,
    nextAction,
    notes: [
      'Command slots are not agents; available capacity is not reserved.',
      'Counts describe supplied pages and observations, not all operations or an atomic snapshot.',
      'Observation freshness does not prove that a service or agent is still alive.',
      'Raw arguments, output, errors, titles and paths are omitted; unsafe identifiers are suppressed.',
    ],
  };
}
