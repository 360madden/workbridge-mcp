const fail = () => Object.assign(new Error('PURGE_INVENTORY_INVALID'), { code: 'PURGE_INVENTORY_INVALID' });
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');

// Read-only normalization. This evidence never authorizes deletion by itself.
export function normalizePurgeInventory(receipt, expectedRoot) {
  if (
    typeof expectedRoot?.volume !== 'string' ||
    typeof expectedRoot?.id !== 'string' ||
    !/^[a-f0-9]{16}$/i.test(expectedRoot.volume) ||
    !/^[a-f0-9]{32}$/i.test(expectedRoot.id)
  )
    throw fail();
  if (
    !exact(receipt, ['schema', 'complete', 'nonAtomic', 'namedStreams', 'totalBytes', 'entries']) ||
    receipt.schema !== 'workbridge-retention-inventory/1' ||
    receipt.complete !== true ||
    receipt.nonAtomic !== true ||
    receipt.namedStreams !== 0 ||
    !Number.isSafeInteger(receipt.totalBytes) ||
    receipt.totalBytes < 0 ||
    receipt.totalBytes > 512 * 1024 * 1024 ||
    !Array.isArray(receipt.entries) ||
    receipt.entries.length < 1 ||
    receipt.entries.length > 20000
  )
    throw fail();
  const names = new Map(),
    identities = new Set();
  let bytes = 0;
  const entries = receipt.entries.map((entry) => {
    if (
      !exact(entry, ['path', 'type', 'identity', 'size', 'nlink', 'sha256']) ||
      !exact(entry.identity, ['volume', 'id']) ||
      typeof entry.path !== 'string' ||
      !entry.path.isWellFormed() ||
      entry.path.length > 32767 ||
      !['file', 'directory'].includes(entry.type) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      !Number.isSafeInteger(entry.nlink) ||
      entry.nlink < 1 ||
      !/^[a-f0-9]{16}$/i.test(entry.identity?.volume ?? '') ||
      !/^[a-f0-9]{32}$/i.test(entry.identity?.id ?? '') ||
      /^0{32}$/.test(entry.identity.id)
    )
      throw fail();
    if (
      entry.path &&
      entry.path
        .split('/')
        .some(
          (part) =>
            !part ||
            part === '.' ||
            part === '..' ||
            /[\\<>:"|?*\x00-\x1f]/.test(part) ||
            /[. ]$/.test(part) ||
            /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i.test(part),
        )
    )
      throw fail();
    const key = entry.path.toLowerCase();
    const identity = { volume: entry.identity.volume.toLowerCase(), id: entry.identity.id.toLowerCase() };
    const identityKey = `${identity.volume}:${identity.id}`;
    if (
      names.has(key) ||
      identities.has(identityKey) ||
      identity.volume !== expectedRoot?.volume?.toLowerCase()
    )
      throw fail();
    if (entry.type === 'file') {
      if (entry.nlink !== 1 || !/^[a-f0-9]{64}$/i.test(entry.sha256 ?? '')) throw fail();
      bytes += entry.size;
    } else if (entry.size !== 0 || entry.sha256 != null) throw fail();
    const normalized = {
      path: entry.path,
      type: entry.type,
      identity,
      size: entry.size,
      nlink: entry.nlink,
      sha256: entry.type === 'file' ? entry.sha256.toLowerCase() : null,
    };
    names.set(key, normalized);
    identities.add(identityKey);
    return normalized;
  });
  const root = names.get('');
  if (
    root?.type !== 'directory' ||
    root.identity.id !== expectedRoot?.id?.toLowerCase() ||
    bytes !== receipt.totalBytes
  )
    throw fail();
  for (const entry of entries) {
    const index = entry.path.lastIndexOf('/');
    if (
      entry.path &&
      names.get(index < 0 ? '' : entry.path.slice(0, index).toLowerCase())?.type !== 'directory'
    )
      throw fail();
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return {
    schema: receipt.schema,
    complete: true,
    nonAtomic: true,
    namedStreams: 0,
    totalBytes: receipt.totalBytes,
    entries,
    mutationAuthorized: false,
  };
}
