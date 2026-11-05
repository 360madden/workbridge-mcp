// Pure formatting and bounded transport for the WPF desktop monitor.
// This module has no MCP connection or process-lifecycle side effects.
export const MAX_DESKTOP_LINE_CHARS = 60_000;
const MAX_JOBS = 36;

function limitString(value, maximum) {
  if (typeof value !== 'string') return { text: '', shortened: false };
  if (value.length <= maximum) return { text: value, shortened: false };
  return { text: value.slice(0, maximum - 1) + '…', shortened: true };
}

function jobRow(job) {
  const id = limitString(job?.jobId, 100);
  const project = limitString(job?.project, 512);
  const status = limitString(job?.status, 40);
  const kind = limitString(job?.kind, 40);
  const nextAction = limitString(job?.nextAction, 64);
  return {
    row: {
      id: id.text,
      project: project.text,
      status: status.text,
      kind: kind.text,
      nextAction: nextAction.text,
    },
    shortened: [id, project, status, kind, nextAction].some((x) => x.shortened),
  };
}

export function formatStatus(result, endpoint) {
  const capacity = result?.jobs?.capacity ?? {};
  const incoming = Array.isArray(capacity.jobs) ? capacity.jobs : [];
  const entries = incoming.slice(0, MAX_JOBS).map(jobRow);
  const truncated = incoming.length > MAX_JOBS || entries.some((entry) => entry.shortened);
  return {
    ok: true,
    version: limitString(result?.version ?? endpoint?.version, 100).text,
    tunnelReady: result?.tunnel?.ready === true,
    controlPlane: limitString(result?.tunnel?.controlPlane ?? 'unknown', 64).text,
    capacity: {
      limit: capacity.limit ?? null,
      occupied: capacity.occupied ?? null,
      available: capacity.available ?? null,
      retainedResults: capacity.retainedResults ?? null,
    },
    runningJobs: result?.jobs?.runningJobs ?? null,
    // Never report a complete inventory if we shortened or dropped records.
    inventoryComplete: result?.jobs?.inventory?.complete === true && !truncated,
    jobs: entries.map((entry) => entry.row),
    sampledUtc: new Date().toISOString(),
  };
}

export function serializeStatus(data) {
  let json = JSON.stringify(data);
  if (json.length <= MAX_DESKTOP_LINE_CHARS) return json + '\n';

  // Preserve engine status/counters while dropping job rows if a diagnostic
  // payload uses unusual length or escape-heavy metadata.
  if (data?.ok === true) {
    const compact = {
      ...data,
      inventoryComplete: false,
      jobs: Array.isArray(data.jobs) ? [...data.jobs] : [],
    };
    do {
      json = JSON.stringify(compact);
      if (json.length <= MAX_DESKTOP_LINE_CHARS) return json + '\n';
      if (compact.jobs.length === 0) break;
      compact.jobs.pop();
    } while (true);
  }

  // No unchecked diagnostic data can make the monitor's transport unbounded.
  return (
    JSON.stringify({
      ok: false,
      error: 'Diagnostic sample exceeds desktop transport limit',
      sampledUtc: new Date().toISOString(),
    }) + '\n'
  );
}
