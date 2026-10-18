import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { BridgeError } from './core.js';
import { fingerprint } from './text.js';
import type { Workspace } from './workspace.js';

type Record = {
  id: string;
  path: string;
  version: string;
  status: 'running' | 'ready' | 'failed' | 'cancelled';
  bytes: number;
  sha256: string | null;
  cacheVersion: string | null;
  error: string | null;
};
type Active = { record: Record; abort: AbortController; done: Promise<void> };
export const snapshotVersion = (s: { size: number; mtimeMs: number; ino: number; ctimeMs: number }) =>
  `${fingerprint(s)}:${s.ctimeMs}`;

/** One streaming inflater; durable ready caches, bounded disk, no source mutation. */
export class SnapshotCache {
  private active?: Active;
  private last?: Record;
  private closed = false;
  private busy = false;
  constructor(
    private workspace: Workspace,
    private directory: string,
    public budgetBytes: number,
  ) {
    workspace.protect(directory);
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1)
      throw new BridgeError('INVALID_CONFIG', 'Snapshot cache budget must be a positive safe integer.');
  }
  async source(input: string) {
    const file = await realpath(await this.workspace.resolve(input));
    const handle = await open(file, 'r');
    let stat, compressed;
    try {
      stat = await handle.stat();
      if (!stat.isFile()) throw new BridgeError('NOT_FILE', 'Expected a regular snapshot file.');
      const magic = Buffer.alloc(2);
      await handle.read(magic, 0, 2, 0);
      compressed = /\.gz$/i.test(file) || (magic[0] === 0x1f && magic[1] === 0x8b);
    } finally {
      await handle.close();
    }
    const version = snapshotVersion(stat);
    const relative = this.workspace.relative(file);
    const id = createHash('sha256').update(`${file}\0${version}`).digest('hex');
    return { file, stat, version, relative, id, compressed };
  }
  private async stored(id: string): Promise<Record | null> {
    try {
      const r = JSON.parse(await readFile(path.join(this.directory, `${id}.json`), 'utf8')) as Record;
      if (r.id !== id || r.status !== 'ready') return null;
      const s = await lstat(path.join(this.directory, `${id}.bin`));
      if (!s.isFile() || s.isSymbolicLink() || snapshotVersion(s) !== r.cacheVersion) return null;
      return r;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new BridgeError('CACHE_INVALID', 'Cache metadata is invalid; release it and prepare again.');
    }
  }
  async materialized(input: string) {
    const source = await this.source(input);
    if (!source.compressed)
      return {
        ...source,
        dataFile: source.file,
        dataVersion: source.version,
        size: source.stat.size,
        sha256: null,
      };
    const ready = await this.stored(source.id);
    if (!ready)
      throw new BridgeError(
        'SNAPSHOT_NOT_READY',
        'Gzip needs snapshot_cache(action="prepare"), then poll status until ready.',
      );
    return {
      ...source,
      dataFile: path.join(this.directory, `${source.id}.bin`),
      dataVersion: ready.cacheVersion,
      size: ready.bytes,
      sha256: ready.sha256,
    };
  }
  async status(input: string) {
    const s = await this.source(input);
    const record =
      this.active?.record.id === s.id
        ? this.active.record
        : ((await this.stored(s.id)) ??
          (this.last?.id === s.id && this.last.status !== 'ready' ? this.last : null));
    return {
      path: s.relative,
      version: s.version,
      compressed: s.compressed,
      sourceBytes: s.stat.size,
      status: record?.status ?? (s.compressed ? 'unprepared' : 'raw'),
      bytes: record?.bytes ?? (s.compressed ? null : s.stat.size),
      sha256: record?.sha256 ?? null,
      error: record?.error ?? null,
      cacheBudgetBytes: this.budgetBytes,
    };
  }
  async action(input: string, action: 'prepare' | 'status' | 'cancel' | 'release' | 'clear') {
    if (action === 'status') return this.status(input);
    if (this.closed) throw new BridgeError('SHUTTING_DOWN', 'Snapshot worker is stopping.');
    if (this.busy) throw new BridgeError('CACHE_BUSY', 'Another cache request is starting; retry shortly.');
    this.busy = true;
    try {
      if (action === 'clear') {
        this.active?.abort.abort();
        await this.active?.done;
        for (const name of await readdir(this.directory).catch(() => [] as string[]))
          if (/^[0-9a-f]{64}\.(?:bin|json|part)$/.test(name))
            await rm(path.join(this.directory, name), { force: true });
        this.last = undefined;
        return { status: 'cleared', cacheBudgetBytes: this.budgetBytes };
      }
      const s = await this.source(input);
      if (action === 'cancel' || action === 'release') {
        // Match the path too, so a changed source can still cancel its older preparation.
        if (this.active?.record.path === s.relative) {
          this.active.abort.abort();
          await this.active.done;
        }
        if (action === 'release') {
          await this.removeForPath(s.relative);
          if (this.last?.path === s.relative) this.last = undefined;
        }
        return this.status(input);
      }
      if (!s.compressed || (await this.stored(s.id))) return this.status(input);
      if (this.active) {
        if (this.active.record.id === s.id) return this.status(input);
        throw new BridgeError(
          'CACHE_BUSY',
          'One gzip preparation runs at a time; poll or cancel the active path.',
        );
      }
      await mkdir(this.directory, { recursive: true });
      // Discard partial output left by an interrupted server, never project files.
      for (const name of await readdir(this.directory))
        if (/^[0-9a-f]{64}\.part$/.test(name)) await rm(path.join(this.directory, name));
      let used = 0;
      for (const name of await readdir(this.directory))
        if (/^[0-9a-f]{64}\.bin$/.test(name)) used += (await lstat(path.join(this.directory, name))).size;
      const allowance = this.budgetBytes - used;
      if (allowance <= 0)
        throw new BridgeError(
          'CACHE_LIMIT',
          'Snapshot cache is full. Release unused paths or increase WORKBRIDGE_SNAPSHOT_CACHE_GIB locally.',
        );
      const record: Record = {
        id: s.id,
        path: s.relative,
        version: s.version,
        status: 'running',
        bytes: 0,
        sha256: null,
        cacheVersion: null,
        error: null,
      };
      const abort = new AbortController();
      const active: Active = { record, abort, done: Promise.resolve() };
      if (this.closed) throw new BridgeError('SHUTTING_DOWN', 'Snapshot worker is stopping.');
      this.active = active;
      this.last = record;
      active.done = this.inflate(s.file, record, allowance, abort).finally(() => {
        if (this.active === active) this.active = undefined;
      });
      return this.status(input);
    } finally {
      this.busy = false;
    }
  }
  private async inflate(source: string, record: Record, allowance: number, abort: AbortController) {
    const part = path.join(this.directory, `${record.id}.part`);
    const data = path.join(this.directory, `${record.id}.bin`);
    const hash = createHash('sha256');
    const timer = setTimeout(() => abort.abort(), 30 * 60 * 1000);
    timer.unref();
    try {
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          if (record.bytes + chunk.length > allowance)
            return callback(
              new BridgeError(
                'CACHE_LIMIT',
                'Decompressed data exceeds available cache budget. Release unused snapshots or increase the local budget.',
              ),
            );
          record.bytes += chunk.length;
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        createReadStream(source),
        createGunzip(),
        meter,
        createWriteStream(part, { flags: 'wx' }),
        { signal: abort.signal },
      );
      if (snapshotVersion(await lstat(source)) !== record.version)
        throw new BridgeError('FILE_CHANGED', 'Compressed snapshot changed during preparation; start again.');
      await rename(part, data);
      record.cacheVersion = snapshotVersion(await lstat(data));
      record.sha256 = hash.digest('hex');
      // Only completed output is durable; interrupted jobs are simply unprepared after restart.
      await writeFile(
        path.join(this.directory, `${record.id}.json`),
        JSON.stringify({ ...record, status: 'ready' }),
        { flag: 'w' },
      );
      record.status = 'ready';
    } catch (error) {
      record.status = abort.signal.aborted ? 'cancelled' : 'failed';
      record.error =
        error instanceof BridgeError
          ? `${error.code}: ${error.message}`
          : abort.signal.aborted
            ? 'Cancelled or exceeded the 30 minute preparation deadline.'
            : 'Decompression failed: corrupt/truncated gzip or disk access failure.';
      await rm(part, { force: true }).catch(() => {});
      await rm(data, { force: true }).catch(() => {});
    } finally {
      clearTimeout(timer);
      console.error(
        JSON.stringify({ event: 'snapshot_cache_finished', status: record.status, bytes: record.bytes }),
      );
    }
  }
  private async removeForPath(relative: string) {
    for (const name of await readdir(this.directory).catch(() => [] as string[])) {
      if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
      const metadata = path.join(this.directory, name);
      const record = JSON.parse(await readFile(metadata, 'utf8')) as Record;
      if (record.path !== relative) continue;
      await rm(path.join(this.directory, name.replace(/\.json$/, '.bin')), { force: true });
      await rm(metadata);
    }
  }
  async close() {
    this.closed = true;
    this.active?.abort.abort();
    await this.active?.done;
  }
}
