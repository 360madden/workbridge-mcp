/**
 * Read-only classification of supplied diagnostics and command_list responses.
 * Observation times belong to the caller: freshness is not a heartbeat or proof
 * of a live process. No clocks, I/O, recovery, admission or retention changes.
 */
export type OperationalAlertsInput = {
  now: string;
  maxAgeSeconds?: number;
  diagnostics?: { data: unknown; observedAt?: string };
  commandList?: { data: unknown; observedAt?: string };
};

type Data = Record<string, unknown>;
type Freshness = 'fresh' | 'stale' | 'unknown';
type Status = 'running' | 'passed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
type State = 'live_reported' | 'finalizing' | 'blocked' | 'stale' | 'unknown' | 'completed' | 'attention';
type Action = { tool: 'diagnostics' | 'command_list' | 'command_status'; jobId?: string; offset?: number };
type Row = { jobId: string; status: Status; state: State; nextAction: Action };
type Alert = { code: string; severity: 'info' | 'warning'; nextAction: Action };
const statuses: readonly string[] = ['running', 'passed', 'failed', 'cancelled', 'timed_out', 'interrupted'];
// Current Jobs.capacity schema has six owner slots. Catalog pages contain at most 100 rows.
const slotLimit = 6;
const scanLimit = 100;
const rowLimit = 20;

function record(value: unknown): Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {};
}
function integer(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function id(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{1,100}$/.test(value) &&
    !/secret|password|passwd|token|credential|authorization|bearer|api[_-]?key|^sk-|^gh[pousr]_|^github_pat_|^eyJ/i.test(
      value,
    )
  );
}
function status(value: unknown): value is Status {
  return typeof value === 'string' && statuses.includes(value);
}
function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19)
    ? time
    : null;
}
function freshness(observation: Data, now: number | null, maxAge: number) {
  const observed = timestamp(observation.observedAt);
  const ageSeconds = now === null || observed === null ? null : (now - observed) / 1000;
  const state: Freshness =
    ageSeconds === null || ageSeconds < 0 ? 'unknown' : ageSeconds > maxAge ? 'stale' : 'fresh';
  return { state, ageSeconds: ageSeconds !== null && ageSeconds >= 0 ? ageSeconds : null };
}

/** Accept raw tool data, wrapped with observation time; emit only bounded allowlisted metadata. */
export function classifyOperationalAlerts(input: OperationalAlertsInput) {
  const args = record(input);
  const now = timestamp(args.now);
  const maxAge = integer(args.maxAgeSeconds, 3600) && args.maxAgeSeconds > 0 ? args.maxAgeSeconds : 60;
  const diagnostics = record(args.diagnostics);
  const catalog = record(args.commandList);
  const capacityAge = freshness(diagnostics, now, maxAge);
  const catalogAge = freshness(catalog, now, maxAge);
  const capacity = record(record(record(diagnostics.data).jobs).capacity);
  const slots = Array.isArray(capacity.jobs) ? capacity.jobs : [];
  const slotMap = new Map<string, { status: Status; kind: 'in_progress' | 'retained_result' }>();
  let invalidSlots = false;
  for (const value of slots.slice(0, slotLimit)) {
    const row = record(value);
    if (
      !id(row.jobId) ||
      !status(row.status) ||
      (row.kind !== 'in_progress' && row.kind !== 'retained_result') ||
      (row.kind === 'retained_result' && row.status === 'running') ||
      slotMap.has(row.jobId)
    ) {
      invalidSlots = true;
      continue;
    }
    slotMap.set(row.jobId, { status: row.status, kind: row.kind });
  }
  const retained = [...slotMap.values()].filter((row) => row.kind === 'retained_result').length;
  const capacityValid =
    capacity.schemaVersion === 1 &&
    capacity.limit === slotLimit &&
    integer(capacity.occupied, slotLimit) &&
    integer(capacity.available, slotLimit) &&
    integer(capacity.inProgress, slotLimit) &&
    integer(capacity.retainedResults, slotLimit) &&
    capacity.occupied + capacity.available === slotLimit &&
    capacity.inProgress + capacity.retainedResults === capacity.occupied &&
    capacity.retainedResults === retained &&
    typeof capacity.closing === 'boolean' &&
    Array.isArray(capacity.jobs) &&
    slots.length === capacity.occupied &&
    slotMap.size === capacity.occupied &&
    !invalidSlots;
  if (!capacityValid) slotMap.clear();

  const page = record(catalog.data);
  const supplied = Array.isArray(page.jobs) ? page.jobs : [];
  const jobs = new Map<string, { status: Status; completionPending: boolean }>();
  let invalidRows = 0;
  for (const value of supplied.slice(0, scanLimit)) {
    const row = record(value);
    if (
      !id(row.id) ||
      !status(row.status) ||
      typeof row.completionPending !== 'boolean' ||
      jobs.has(row.id)
    ) {
      invalidRows++;
      continue;
    }
    jobs.set(row.id, { status: row.status, completionPending: row.completionPending });
  }
  const nextOffset = integer(page.nextOffset, 100000) ? page.nextOffset : null;
  const complete =
    Array.isArray(page.jobs) &&
    supplied.length <= scanLimit &&
    invalidRows === 0 &&
    page.complete === true &&
    page.nextOffset === null &&
    page.hasErrors === false &&
    Array.isArray(page.issues) &&
    page.issues.length === 0 &&
    !['catalogTruncated', 'scanLimitReached', 'outputLimitReached', 'timeLimitReached'].some(
      (key) => page[key] !== undefined && page[key] !== false,
    );

  const alerts: Alert[] = [];
  const alert = (code: string, tool: Action['tool'], severity: Alert['severity'] = 'warning') =>
    alerts.push({ code, severity, nextAction: { tool } });
  if (!capacityValid) alert('CAPACITY_UNKNOWN', 'diagnostics');
  if (capacityAge.state !== 'fresh')
    alert(capacityAge.state === 'stale' ? 'CAPACITY_STALE' : 'CAPACITY_FRESHNESS_UNKNOWN', 'diagnostics');
  if (catalogAge.state !== 'fresh')
    alert(catalogAge.state === 'stale' ? 'JOB_OBSERVATION_STALE' : 'JOB_FRESHNESS_UNKNOWN', 'command_list');
  if (!complete) alert('JOB_PAGE_INCOMPLETE', 'command_list');
  const current = capacityValid && capacityAge.state === 'fresh';
  if (current && capacity.closing) alert('OWNER_CLOSING', 'diagnostics');
  if (current && retained > 0) alert('RESULT_PUBLICATION_BLOCKED', 'command_status');
  if (current && capacity.available === 0)
    alert(
      retained > 0 ? 'CAPACITY_BLOCKED' : 'CAPACITY_BUSY',
      'diagnostics',
      retained > 0 ? 'warning' : 'info',
    );

  const counts: Record<State, number> = {
    live_reported: 0,
    finalizing: 0,
    blocked: 0,
    stale: 0,
    unknown: 0,
    completed: 0,
    attention: 0,
  };
  const rows: Row[] = [];
  let newerCatalogEvidence = false;
  // Slots come first so page truncation never hides the bounded owner workload.
  const ids = new Set([...slotMap.keys(), ...jobs.keys()]);
  for (const jobId of ids) {
    const slot = slotMap.get(jobId);
    const saved = jobs.get(jobId);
    // Prefer the newer observation when both exist. An older owner slot must
    // never override a newer completed record or imply current ownership.
    const slotIsNewest =
      current && (catalogAge.state !== 'fresh' || capacityAge.ageSeconds! <= catalogAge.ageSeconds!);
    const useSlot = slot !== undefined && (slotIsNewest || saved === undefined);
    if (slot && current && !useSlot) newerCatalogEvidence = true;
    const reportedStatus = useSlot ? slot!.status : saved!.status;
    const age = useSlot ? capacityAge.state : catalogAge.state;
    let state: State;
    if (age !== 'fresh') state = age === 'stale' ? 'stale' : 'unknown';
    else if (useSlot && slot!.kind === 'retained_result') state = 'blocked';
    else if (useSlot) state = reportedStatus === 'running' ? 'live_reported' : 'finalizing';
    else if (reportedStatus === 'running' || saved!.completionPending) state = 'unknown';
    else state = reportedStatus === 'passed' ? 'completed' : 'attention';
    counts[state]++;
    if (rows.length < rowLimit)
      rows.push({ jobId, status: reportedStatus, state, nextAction: { tool: 'command_status', jobId } });
  }
  if (newerCatalogEvidence) alert('CAPACITY_JOB_OBSERVATION_CHANGED', 'diagnostics');
  if (counts.unknown > 0) alert('JOB_OWNERSHIP_UNCONFIRMED', 'command_status');
  if (counts.attention > 0) alert('JOB_OUTCOME_ATTENTION', 'command_status');
  // Every per-job follow-up is an inspection. Retrying a save, cancelling or
  // restarting requires a separate, explicit decision after fresh evidence.
  for (const item of alerts) {
    if (item.nextAction.tool === 'command_status') {
      const target = rows.find((row) =>
        item.code === 'RESULT_PUBLICATION_BLOCKED'
          ? row.state === 'blocked'
          : item.code === 'JOB_OUTCOME_ATTENTION'
            ? row.state === 'attention'
            : row.state === 'unknown',
      );
      if (target) item.nextAction.jobId = target.jobId;
      else item.nextAction = { tool: 'command_list', offset: 0 };
    } else if (item.nextAction.tool === 'command_list')
      item.nextAction.offset = catalogAge.state === 'fresh' ? (nextOffset ?? 0) : 0;
  }
  const state =
    !capacityValid || capacityAge.state === 'unknown'
      ? 'unknown'
      : capacityAge.state === 'stale'
        ? 'stale'
        : capacity.closing || retained > 0
          ? 'blocked'
          : alerts.some((item) => item.severity === 'warning')
            ? 'attention'
            : slotMap.size > 0
              ? 'live_reported'
              : 'idle';
  return {
    schemaVersion: 1 as const,
    readOnly: true as const,
    state,
    capacity: {
      valid: capacityValid,
      freshness: capacityAge,
      available: capacityValid ? (capacity.available as number) : null,
      occupied: capacityValid ? (capacity.occupied as number) : null,
      inProgress: capacityValid ? (capacity.inProgress as number) : null,
      retainedResults: capacityValid ? retained : null,
      closing: capacityValid ? (capacity.closing as boolean) : null,
      reservation: false as const,
    },
    jobs: {
      freshness: catalogAge,
      scope: 'supplied_page_and_owner_slots' as const,
      complete,
      invalidRows,
      inputTruncated: supplied.length > scanLimit,
      nextOffset,
      counts,
      rows,
      rowsOmitted: ids.size - rows.length,
    },
    alerts,
    nextAction: alerts[0]?.nextAction ?? rows[0]?.nextAction ?? { tool: 'diagnostics' as const },
    notes: [
      'Live reported means a fresh supplied owner slot, not independently verified process liveness.',
      'Observation age, not job duration, determines stale evidence; observations are not atomic.',
      'Available command slots are neither agents nor reservations; catalog counts cover supplied rows only.',
      'Raw commands, paths, errors and output are omitted. No recovery or retention action is performed.',
    ],
  };
}
