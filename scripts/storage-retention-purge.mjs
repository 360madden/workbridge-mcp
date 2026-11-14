import { loadRetentionJournal, classifyRetentionJournal } from './storage-retention-quarantine.mjs';

export const QUARANTINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// An offline point-in-time prerequisite only: no graph, duplicate, payload,
// maintenance-lease or native deletion authorization is established here.
export async function inspectPurgeGrace({ installRoot, operationId, now } = {}, deps = {}) {
  const base = {
    schema: 'workbridge-retention-purge-grace/1',
    operationId,
    eligible: false,
    mutationAuthorized: false,
    readOnly: true,
    nonAtomic: true,
    qualification:
      'Grace and location evidence only; current references, retained payload, maintenance ownership and purge authority are not established.',
  };
  try {
    const current = now === undefined ? Date.now() : now;
    if (!Number.isSafeInteger(current) || !Number.isFinite(new Date(current).getTime()))
      return { ...base, reason: 'INVALID_CLOCK' };
    if (typeof deps.inspectLocations !== 'function') return { ...base, reason: 'LOCATION_PROOF_UNAVAILABLE' };
    const journal = await loadRetentionJournal(installRoot, operationId);
    const marker = journal.markers.quarantined;
    if (journal.phases.restoring || journal.phases.restored)
      return { ...base, reason: 'RESTORE_IN_PROGRESS_OR_COMPLETE' };
    if (!marker) return { ...base, reason: 'QUARANTINE_RECEIPT_MISSING' };
    if (marker.schema !== 'workbridge-retention-phase/2')
      return { ...base, reason: 'LEGACY_RECEIPT_NO_TIME' };
    const locations = await deps.inspectLocations(journal.ctx);
    const state = classifyRetentionJournal(journal, locations);
    if (state.state !== 'quarantined' || state.pendingCommit) return { ...base, reason: 'LOCATION_CONFLICT' };
    const latest = await loadRetentionJournal(installRoot, operationId);
    if (JSON.stringify(journal.bindings) !== JSON.stringify(latest.bindings))
      return { ...base, reason: 'JOURNAL_CHANGED' };
    const since = Date.parse(marker.publishedAtUtc);
    const graceExpiresAt = since + QUARANTINE_GRACE_MS;
    if (since > current)
      return { ...base, reason: 'FUTURE_RECEIPT', quarantinedAtUtc: marker.publishedAtUtc };
    return {
      ...base,
      planSha256: journal.intent.planSha256,
      quarantineReceiptSha256: journal.bindings.quarantined.sha256,
      quarantinedAtUtc: marker.publishedAtUtc,
      graceExpiresAtUtc: new Date(graceExpiresAt).toISOString(),
      eligible: current >= graceExpiresAt,
      graceElapsed: current >= graceExpiresAt,
      reason: current >= graceExpiresAt ? 'GRACE_ELAPSED' : 'GRACE_NOT_ELAPSED',
    };
  } catch (error) {
    return { ...base, reason: error?.code || 'GRACE_INSPECTION_FAILED' };
  }
}
