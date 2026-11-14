import { createHash } from 'node:crypto';
import { normalizePurgeInventory } from './storage-retention-purge-inventory.mjs';

const fail = (code) => Object.assign(new Error(code), { code });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const exact = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join('\0') === [...keys].sort().join('\0');
export const canonicalPurgeJson = (v) =>
  v && typeof v === 'object'
    ? Array.isArray(v)
      ? `[${v.map(canonicalPurgeJson).join(',')}]`
      : `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonicalPurgeJson(v[k])}`)
          .join(',')}}`
    : JSON.stringify(v);
const recordBytes = (v) => Buffer.from(`${canonicalPurgeJson(v)}\n`, 'utf8');
const batchName = (start, suffix) => `purge-batch-${String(start).padStart(5, '0')}.${suffix}.json`;
const same = (a, b) => canonicalPurgeJson(a) === canonicalPurgeJson(b);

// The lease provider is the trust boundary: it must pin the fixed journal directory,
// reject links/hardlinks and changes while reading, and atomically publish only fixed records.
function parseFile(files, name, required = true) {
  const raw = files[name];
  if (raw === undefined && !required) return null;
  if (!(raw instanceof Uint8Array)) throw fail('PURGE_JOURNAL_MISSING');
  const bytes = Buffer.from(raw);
  const max = name === 'purge-manifest.json' ? 8 * 1024 * 1024 : 65536;
  if (!bytes.length || bytes.length > max) throw fail('PURGE_JOURNAL_SIZE');
  let text, value;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw fail('PURGE_JOURNAL_INVALID');
  }
  if (!recordBytes(value).equals(bytes)) throw fail('PURGE_JOURNAL_NONCANONICAL');
  return { value, sha256: hash(bytes) };
}

export function inspectPurgeLedger(files, ctx) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw fail('PURGE_JOURNAL_INVALID');
  for (const name of Object.keys(files)) {
    if (
      /^purg(?:e|ing)/i.test(name) &&
      !/^(purge-manifest\.json|purge-approval\.json|purging\.json|purged\.json|purge-batch-\d{5}\.(intent|done)\.json)$/.test(
        name,
      )
    )
      throw fail('PURGE_JOURNAL_NAMESPACE');
  }
  if (Object.keys(files).some((n) => /^(restoring|restored)\.json$/i.test(n)))
    throw fail('PURGE_RESTORE_CONFLICT');
  const manifestFile = parseFile(files, 'purge-manifest.json');
  const approvalFile = parseFile(files, 'purge-approval.json');
  const m = manifestFile.value,
    a = approvalFile.value;
  if (
    !exact(m, [
      'schema',
      'operationId',
      'planSha256',
      'quarantineReceiptSha256',
      'expectedRoot',
      'entries',
    ]) ||
    m.schema !== 'workbridge-purge-manifest/1' ||
    m.operationId !== ctx.operationId ||
    m.planSha256 !== ctx.planSha256 ||
    m.quarantineReceiptSha256 !== ctx.quarantineReceiptSha256 ||
    !digest(m.planSha256) ||
    !digest(m.quarantineReceiptSha256) ||
    !Array.isArray(m.entries) ||
    !exact(m.expectedRoot, ['volume', 'id'])
  )
    throw fail('PURGE_MANIFEST_INVALID');
  const bytes = m.entries.reduce((sum, e) => sum + (e.type === 'file' ? e.size : 0), 0);
  let normalized;
  try {
    normalized = normalizePurgeInventory(
      {
        schema: 'workbridge-retention-inventory/1',
        complete: true,
        nonAtomic: true,
        namedStreams: 0,
        totalBytes: bytes,
        entries: m.entries,
      },
      m.expectedRoot,
    );
  } catch {
    throw fail('PURGE_MANIFEST_INVALID');
  }
  if (!same(normalized.entries, m.entries)) throw fail('PURGE_MANIFEST_INVALID');
  if (
    !exact(a, [
      'schema',
      'operationId',
      'planSha256',
      'quarantineReceiptSha256',
      'manifestSha256',
      'referencesSha256',
      'retainedProofSha256',
    ]) ||
    a.schema !== 'workbridge-purge-approval/1' ||
    a.operationId !== ctx.operationId ||
    a.planSha256 !== m.planSha256 ||
    a.quarantineReceiptSha256 !== m.quarantineReceiptSha256 ||
    a.manifestSha256 !== manifestFile.sha256 ||
    !digest(a.referencesSha256) ||
    !digest(a.retainedProofSha256) ||
    approvalFile.sha256 !== ctx.expectedPurgeSha256
  )
    throw fail('PURGE_APPROVAL_MISMATCH');
  const base = {
    operationId: ctx.operationId,
    purgeSha256: approvalFile.sha256,
    manifestSha256: manifestFile.sha256,
  };
  const marker = parseFile(files, 'purging.json', false)?.value;
  const markerExpected = {
    schema: 'workbridge-purging/1',
    ...base,
    planSha256: m.planSha256,
    entryCount: m.entries.length,
    batchLimit: 32,
  };
  if (marker && !same(marker, markerExpected)) throw fail('PURGE_LEDGER_CONFLICT');
  let prefix = 0,
    openBatch = null;
  const seen = new Set();
  while (prefix < m.entries.length) {
    const iname = batchName(prefix, 'intent'),
      dname = batchName(prefix, 'done');
    const intent = parseFile(files, iname, false)?.value;
    const done = parseFile(files, dname, false)?.value;
    if (!intent) {
      if (done) throw fail('PURGE_LEDGER_CONFLICT');
      break;
    }
    seen.add(iname);
    if (
      !exact(intent, ['schema', 'operationId', 'purgeSha256', 'manifestSha256', 'start', 'end']) ||
      intent.schema !== 'workbridge-purge-batch/1' ||
      intent.operationId !== base.operationId ||
      intent.purgeSha256 !== base.purgeSha256 ||
      intent.manifestSha256 !== base.manifestSha256 ||
      intent.start !== prefix ||
      !Number.isSafeInteger(intent.end) ||
      intent.end <= prefix ||
      intent.end > Math.min(prefix + 32, m.entries.length)
    )
      throw fail('PURGE_LEDGER_CONFLICT');
    if (!done) {
      openBatch = { start: prefix, end: intent.end };
      break;
    }
    seen.add(dname);
    if (
      !exact(done, [
        'schema',
        'operationId',
        'purgeSha256',
        'manifestSha256',
        'start',
        'end',
        'priorAbsent',
        'observedRemoved',
      ]) ||
      done.schema !== 'workbridge-purge-batch-done/1' ||
      done.operationId !== base.operationId ||
      done.purgeSha256 !== base.purgeSha256 ||
      done.manifestSha256 !== base.manifestSha256 ||
      done.start !== prefix ||
      done.end !== intent.end ||
      !Number.isSafeInteger(done.priorAbsent) ||
      !Number.isSafeInteger(done.observedRemoved) ||
      done.priorAbsent < 0 ||
      done.observedRemoved < 0 ||
      done.priorAbsent + done.observedRemoved !== done.end - done.start
    )
      throw fail('PURGE_LEDGER_CONFLICT');
    prefix = intent.end;
  }
  if (Object.keys(files).some((n) => n.startsWith('purge-batch-') && !seen.has(n)))
    throw fail('PURGE_LEDGER_CONFLICT');
  const final = parseFile(files, 'purged.json', false)?.value;
  const finalExpected = {
    schema: 'workbridge-purged/1',
    ...base,
    planSha256: m.planSha256,
    entryCount: m.entries.length,
    logicalBytesRemoved: bytes,
  };
  if (
    (!marker && (prefix || openBatch || final)) ||
    (final && (prefix !== m.entries.length || openBatch || !same(final, finalExpected)))
  )
    throw fail('PURGE_LEDGER_CONFLICT');
  return {
    status: final ? 'purged' : !marker ? 'prepared' : prefix || openBatch ? 'partial' : 'purging',
    manifest: m,
    approval: a,
    base,
    markerExpected,
    finalExpected,
    prefix,
    openBatch,
  };
}

export async function runPurge(ctx, deps) {
  if (
    ctx?.maintenanceConfirmed !== true ||
    ctx.confirmPermanentlyDelete !== ctx.operationId ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(ctx.operationId ?? '') ||
    !digest(ctx.expectedPurgeSha256)
  )
    throw fail('PURGE_CONFIRMATION_REQUIRED');
  if (typeof deps?.withPurgeLease !== 'function' || typeof deps?.revalidateSafety !== 'function')
    throw fail('PURGE_NATIVE_CAPABILITY_REQUIRED');
  return deps.withPurgeLease(ctx, async (guard) => {
    if (
      ['readJournals', 'inspectRemaining', 'publish', 'deleteBatch'].some(
        (k) => typeof guard?.[k] !== 'function',
      )
    )
      throw fail('PURGE_NATIVE_CAPABILITY_REQUIRED');
    let state = inspectPurgeLedger(await guard.readJournals(), ctx);
    const requireSafety = async () => {
      const proof = await deps.revalidateSafety(ctx);
      if (
        proof?.referencesSha256 !== state.approval.referencesSha256 ||
        proof?.retainedProofSha256 !== state.approval.retainedProofSha256
      )
        throw fail('PURGE_SAFETY_CHANGED');
    };
    await requireSafety();
    const inspect = async (prefix, open) => {
      const result = await guard.inspectRemaining({
        committedPrefix: prefix,
        inflightEnd: open?.end ?? null,
      });
      const r = result?.remaining;
      if (
        result?.status !== 'ok' ||
        r?.complete !== true ||
        r.sourcePresent !== false ||
        r.committedPrefix !== prefix ||
        r.entryCount !== state.manifest.entries.length ||
        !Number.isSafeInteger(r.observedAbsentPrefix) ||
        r.observedAbsentPrefix < prefix ||
        r.observedAbsentPrefix > (open?.end ?? prefix) ||
        r.rootPresent !== r.observedAbsentPrefix < r.entryCount
      )
        throw fail('PURGE_TREE_CONFLICT');
      return r;
    };
    await inspect(state.prefix, state.openBatch);
    if (state.status === 'purged') return { status: 'purged', alreadyPurged: true };
    if (state.status === 'prepared') await guard.publish('purging', state.markerExpected);
    while (state.prefix < state.manifest.entries.length) {
      const batch = state.openBatch ?? {
        start: state.prefix,
        end: Math.min(state.prefix + 32, state.manifest.entries.length),
      };
      await requireSafety();
      if (!state.openBatch)
        await guard.publish('intent', { schema: 'workbridge-purge-batch/1', ...state.base, ...batch });
      const before = await inspect(state.prefix, batch);
      await requireSafety();
      const result = await guard.deleteBatch(batch);
      if (
        result?.status !== 'ok' ||
        result.firstIndex !== before.observedAbsentPrefix ||
        result.nextIndex !== batch.end ||
        result.removedCount !== batch.end - before.observedAbsentPrefix
      )
        throw fail('PURGE_DELETE_UNCERTAIN');
      const after = await inspect(state.prefix, batch);
      if (after.observedAbsentPrefix !== batch.end) throw fail('PURGE_DELETE_UNCERTAIN');
      await guard.publish('done', {
        schema: 'workbridge-purge-batch-done/1',
        ...state.base,
        ...batch,
        priorAbsent: before.observedAbsentPrefix - batch.start,
        observedRemoved: result.removedCount,
      });
      state.prefix = batch.end;
      state.openBatch = null;
    }
    await inspect(state.prefix, null);
    await requireSafety();
    await guard.publish('purged', state.finalExpected);
    return {
      status: 'purged',
      alreadyPurged: false,
      logicalBytesRemoved: state.finalExpected.logicalBytesRemoved,
    };
  });
}
