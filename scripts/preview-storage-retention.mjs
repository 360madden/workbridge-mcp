import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// Inventory only: file bodies are never opened and nothing is modified.
export const defaults = Object.freeze({ maxEntries: 50000, maxScanMs: 20000, maxDepth: 64, maxUnits: 500 });
const ceilings = Object.freeze({ maxEntries: 1000000, maxScanMs: 60000, maxDepth: 128, maxUnits: 500 });

function parsePositive(value, name, ceiling) {
  if (!/^\d+$/.test(value ?? '')) throw new Error(`${name} requires a positive integer`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > ceiling)
    throw new Error(`${name} must be in 1..${ceiling}`);
  return result;
}

export function parseArgs(args) {
  const opts = { ...defaults };
  const seen = new Set();
  const names = {
    '--install-root': 'installRoot',
    '--max-entries': 'maxEntries',
    '--max-scan-ms': 'maxScanMs',
    '--max-depth': 'maxDepth',
    '--max-units': 'maxUnits',
  };
  for (let i = 0; i < args.length; i++) {
    const key = names[args[i]];
    if (!key || seen.has(key) || i + 1 >= args.length)
      throw new Error(`Unknown, repeated or valueless option: ${args[i]}`);
    seen.add(key);
    const value = args[++i];
    opts[key] = key === 'installRoot' ? value : parsePositive(value, args[i - 1], ceilings[key]);
  }
  if (!opts.installRoot || !path.isAbsolute(opts.installRoot))
    throw new Error('--install-root must be an absolute path');
  opts.installRoot = path.resolve(opts.installRoot);
  return opts;
}

// Check all ancestors before use. This is a best-effort metadata snapshot, not
// a race-free handle-based traversal or a basis for destructive operations.
async function verifyDirectoryChain(dir, verifyAttributes = async () => {}) {
  const parsed = path.parse(dir);
  let current = parsed.root;
  await verifyAttributes(current);
  for (const component of dir.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw Object.assign(new Error('unsafe directory chain'), { code: 'UNSAFE_DIRECTORY_CHAIN' });
    await verifyAttributes(current);
  }
}

function windowsMetadata() {
  if (process.platform !== 'win32') return { check: async () => {}, close: () => {} };
  // Fixed executable and script; user paths go only through JSON stdin.
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = fileURLToPath(new URL('./storage-retention-metadata.ps1', import.meta.url));
  const child = spawn(
    executable,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', script],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
  );
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const replies = lines[Symbol.asyncIterator]();
  let failed = null;
  child.on('error', () => {
    failed = 'METADATA_PROVIDER_FAILED';
  });
  child.stdin.on('error', () => {
    failed = 'METADATA_PROVIDER_FAILED';
  });
  child.on('exit', () => {
    failed ??= 'METADATA_PROVIDER_EXITED';
  });
  return {
    async check(file) {
      if (failed) throw Object.assign(new Error(failed), { code: failed });
      let timer;
      try {
        child.stdin.write(`${JSON.stringify(file)}\n`);
        const response = await Promise.race([
          replies.next(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Object.assign(new Error('metadata timeout'), { code: 'METADATA_TIMEOUT' })),
              2000,
            );
          }),
        ]);
        if (response.done || response.value.length > 512)
          throw Object.assign(new Error('metadata failed'), { code: 'METADATA_PROVIDER_FAILED' });
        const result = JSON.parse(response.value);
        if (result.error || typeof result.reparse !== 'boolean')
          throw Object.assign(new Error('metadata unavailable'), { code: 'METADATA_UNAVAILABLE' });
        if (result.reparse)
          throw Object.assign(new Error('reparse point'), { code: 'REPARSE_POINT_SKIPPED' });
      } catch (error) {
        if (!['REPARSE_POINT_SKIPPED'].includes(error.code)) {
          failed = error.code ?? 'METADATA_PROVIDER_FAILED';
          child.kill();
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      child.stdin.end();
      child.kill();
      lines.close();
    },
  };
}

export async function inventory(options, dependencies = {}) {
  const root = path.resolve(options.installRoot);
  const limits = {
    maxEntries: options.maxEntries ?? defaults.maxEntries,
    maxScanMs: options.maxScanMs ?? defaults.maxScanMs,
    maxDepth: options.maxDepth ?? defaults.maxDepth,
    maxUnits: options.maxUnits ?? defaults.maxUnits,
  };
  for (const [key, value] of Object.entries(limits)) parsePositive(String(value), key, ceilings[key]);
  const started = performance.now();
  const metadata = dependencies.metadata ?? windowsMetadata();
  try {
    const checkDirectory = async (file) => {
      if (performance.now() - started >= limits.maxScanMs)
        throw Object.assign(new Error('time limit'), { code: 'TIME_LIMIT' });
      await metadata.check(file);
    };
    const verify = (file) => verifyDirectoryChain(file, checkDirectory);
    const out = {
      schema: 'workbridge-storage-inventory/1',
      root,
      mode: 'read-only-inventory',
      complete: true,
      limits,
      totals: { logicalFileBytes: 0, entryVisits: 0 },
      units: [],
      diagnostics: [],
      categories: {},
      measurement: 'logical file bytes; hard links may be counted multiple times',
      qualification:
        'live point-in-time best effort; non-atomic, path checks race, time limit is cooperative, names are shown, non-directory reparse attributes are not checked, not a deletion authorization',
    };
    const relative = (file) => path.relative(root, file).split(path.sep).join('/') || '.';
    let exhausted = false;
    const pending = [];
    const note = (unit, code, file) => {
      out.complete = false;
      if (unit) unit.complete = false;
      if (out.diagnostics.length < 200) out.diagnostics.push({ code, path: relative(file) });
    };
    const budget = (unit, file) => {
      if (exhausted) {
        if (unit) unit.complete = false;
        return false;
      }
      const code =
        performance.now() - started >= limits.maxScanMs
          ? 'TIME_LIMIT'
          : out.totals.entryVisits >= limits.maxEntries
            ? 'ENTRY_LIMIT'
            : null;
      if (code) {
        exhausted = true;
        note(unit, code, file);
        return false;
      }
      return true;
    };
    const count = (unit) => {
      out.totals.entryVisits++;
      if (unit) unit.entries++;
    };
    const size = (unit, amount, file) => {
      if (
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        !Number.isSafeInteger(out.totals.logicalFileBytes + amount) ||
        !Number.isSafeInteger(unit.logicalFileBytes + amount)
      ) {
        note(unit, 'SIZE_OVERFLOW', file);
        return;
      }
      unit.logicalFileBytes += amount;
      out.totals.logicalFileBytes += amount;
    };
    async function walk(file, unit, depth, route = () => unit) {
      unit = route(file);
      if (!budget(unit, file)) return;
      unit.visited = true;
      count(unit);
      let stat;
      try {
        stat = await lstat(file);
      } catch (error) {
        note(unit, error.code ?? 'LSTAT_FAILED', file);
        return;
      }
      if (stat.isSymbolicLink()) {
        unit.skippedLinks++;
        note(unit, 'LINK_SKIPPED', file);
        return;
      }
      if (stat.isFile()) {
        size(unit, stat.size, file);
        return;
      }
      if (!stat.isDirectory()) {
        note(unit, 'UNSUPPORTED_FILE_TYPE', file);
        return;
      }
      if (depth >= limits.maxDepth) {
        note(unit, 'DEPTH_LIMIT', file);
        return;
      }
      let dir;
      try {
        await checkDirectory(file);
        dir = await opendir(file);
        for await (const entry of dir) {
          if (!budget(unit, file)) break;
          await walk(path.join(file, entry.name), unit, depth + 1, route);
        }
      } catch (error) {
        note(unit, error.code ?? 'READ_DIR_FAILED', file);
      }
    }
    async function scanChildren(category, directory) {
      let stat;
      try {
        await verify(path.dirname(directory));
        stat = await lstat(directory);
      } catch (error) {
        if (error.code === 'ENOENT') {
          out.categories[category] = 'missing';
          return;
        }
        out.categories[category] = 'incomplete';
        note(null, error.code ?? 'LSTAT_FAILED', directory);
        return;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        out.categories[category] = 'incomplete';
        note(null, 'UNSAFE_DIRECTORY', directory);
        return;
      }
      out.categories[category] = 'scanned';
      try {
        await checkDirectory(directory);
        const dir = await opendir(directory);
        for await (const entry of dir) {
          if (!budget(null, directory)) {
            out.categories[category] = 'incomplete';
            break;
          }
          count(null);
          const file = path.join(directory, entry.name);
          const groups = new Map();
          const group = (name) => {
            if (!groups.has(name)) {
              if (out.units.length >= limits.maxUnits) {
                exhausted = true;
                note(null, 'UNIT_LIMIT', file);
                throw Object.assign(new Error('unit limit'), { code: 'UNIT_LIMIT' });
              }
              const unit = {
                category,
                path: relative(file),
                subgroup: name,
                classification: 'unclassified',
                logicalFileBytes: 0,
                entries: 0,
                complete: true,
                visited: false,
                skippedLinks: 0,
              };
              groups.set(name, unit);
              out.units.push(unit);
            }
            return groups.get(name);
          };
          const route = (current) => {
            if (category !== 'update-operations') return group('all');
            const parts = path.relative(file, current).split(path.sep);
            const first = parts[0];
            if (first === 'backup' && ['runtime', 'source', 'configuration'].includes(parts[1]))
              return group(`backup/${parts[1]}`);
            if (['candidate', 'displaced'].includes(first)) return group(first);
            return group('other');
          };
          group(category === 'update-operations' ? 'other' : 'all');
          pending.push(async () => {
            try {
              await walk(file, group(category === 'update-operations' ? 'other' : 'all'), 0, route);
            } catch (error) {
              for (const unit of groups.values()) unit.complete = false;
              throw error;
            }
            if ([...groups.values()].some((unit) => !unit.complete)) out.categories[category] = 'incomplete';
          });
        }
      } catch (error) {
        out.categories[category] = 'incomplete';
        note(null, error.code ?? 'READ_DIR_FAILED', directory);
      }
    }
    try {
      await verify(root);
    } catch (error) {
      note(null, error.code ?? 'ROOT_UNAVAILABLE', root);
      return out;
    }
    const local = path.join(root, '.local');
    await scanChildren('update-operations', path.join(local, 'update-operations'));
    await scanChildren('releases', path.join(local, 'releases'));
    await scanChildren('temp', path.join(root, 'temp'));
    // Discover staging roots without inspecting unrelated .local children.
    try {
      await verify(local);
      const dir = await opendir(local);
      out.categories.staging = 'scanned';
      for await (const entry of dir) {
        if (!budget(null, local)) {
          out.categories.staging = 'incomplete';
          break;
        }
        count(null);
        if (!entry.name.startsWith('wb001-gui-src-') || entry.name.toLowerCase().endsWith('.zip')) continue;
        const file = path.join(local, entry.name);
        const groups = new Map();
        const group = (name) => {
          if (!groups.has(name)) {
            if (out.units.length >= limits.maxUnits) {
              exhausted = true;
              note(null, 'UNIT_LIMIT', file);
              throw Object.assign(new Error('unit limit'), { code: 'UNIT_LIMIT' });
            }
            const unit = {
              category: 'staging',
              path: relative(name === 'nested-releases' ? path.join(file, '.local', 'releases') : file),
              subgroup: name,
              classification: 'unclassified',
              logicalFileBytes: 0,
              entries: 0,
              complete: true,
              visited: false,
              skippedLinks: 0,
            };
            groups.set(name, unit);
            out.units.push(unit);
          }
          return groups.get(name);
        };
        const route = (current) => {
          const parts = path.relative(file, current).split(path.sep);
          return group(parts[0] === '.local' && parts[1] === 'releases' ? 'nested-releases' : 'other');
        };
        group('other');
        // Discover the known nested release container before any recursive sizing.
        const nested = path.join(file, '.local', 'releases');
        if (budget(null, nested)) {
          try {
            await verify(path.dirname(nested));
            const info = await lstat(nested);
            if (info.isSymbolicLink() || !info.isDirectory())
              note(group('nested-releases'), 'UNSAFE_DIRECTORY', nested);
            else group('nested-releases');
          } catch (error) {
            if (error.code !== 'ENOENT')
              note(group('nested-releases'), error.code ?? 'NESTED_DISCOVERY_FAILED', nested);
          }
        }
        pending.push(async () => {
          try {
            await walk(file, group('other'), 0, route);
          } catch (error) {
            for (const unit of groups.values()) unit.complete = false;
            throw error;
          }
          if ([...groups.values()].some((unit) => !unit.complete)) out.categories.staging = 'incomplete';
        });
      }
    } catch (error) {
      if (error.code === 'ENOENT') out.categories.staging = 'missing';
      else {
        out.categories.staging = 'incomplete';
        note(null, error.code ?? 'READ_DIR_FAILED', local);
      }
    }
    for (const run of pending) {
      try {
        await run();
      } catch (error) {
        note(null, error.code ?? 'INVENTORY_FAILED', root);
      }
    }
    for (const unit of out.units) {
      if (!unit.visited) {
        unit.complete = false;
        out.complete = false;
        out.categories[unit.category] = 'incomplete';
      }
    }
    out.unscannedUnits = out.units.filter((unit) => !unit.visited).length;
    out.elapsedMs = Math.round(performance.now() - started);
    if (performance.now() - started >= limits.maxScanMs) note(null, 'TIME_LIMIT', root);
    return out;
  } finally {
    metadata.close();
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'Usage: node scripts/preview-storage-retention.mjs --install-root ABSOLUTE_PATH [--max-entries N] [--max-scan-ms N] [--max-depth N] [--max-units N]\nRead-only logical-byte inventory; no deletion eligibility. Exit: 0 complete, 1 incomplete, 2 invalid arguments.\n',
    );
    return 0;
  }
  try {
    const opts = parseArgs(args);
    const result = await inventory(opts);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.complete ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Inventory arguments: ${error.message}\n`);
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main(process.argv.slice(2));
