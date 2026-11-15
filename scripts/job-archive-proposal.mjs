import { constants } from 'node:fs';
import { lstat, open, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { windowsMetadata } from './preview-storage-retention.mjs';
const maxBytes = 16 * 1024 * 1024;
const fail = (code) => Object.assign(new Error(code), { code });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const stamp = (s) =>
  ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink'].map((k) => String(s[k])).join(':');
const idOf = (s) =>
  Object.fromEntries(
    ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink'].map((k) => [k, String(s[k])]),
  );
const sameDir = (a, b) => a.dev === b.dev && a.ino === b.ino;
const inside = (root, file) => {
  const r = path.relative(root, file);
  return !path.isAbsolute(r) && r !== '..' && !r.startsWith('..' + path.sep);
};
async function chain(dir, metadata) {
  const root = path.parse(dir).root;
  let current = root;
  const result = [];
  for (const part of ['', ...dir.slice(root.length).split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    const stat = await lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('UNSAFE_JOB_ANCESTRY');
    await metadata.check(current);
    if ((await realpath(current)).toLowerCase() !== current.toLowerCase()) throw fail('UNSAFE_JOB_ANCESTRY');
    result.push({ path: current, stat });
  }
  return result;
}
async function recheckChain(paths, metadata) {
  for (const entry of paths) {
    const now = await lstat(entry.path, { bigint: true });
    if (!now.isDirectory() || now.isSymbolicLink() || !sameDir(entry.stat, now))
      throw fail('JOB_ANCESTRY_CHANGED');
    await metadata.check(entry.path);
  }
}
async function readJob(file, root, metadata) {
  const parents = await chain(root, metadata),
    before = await lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(maxBytes))
    throw fail('UNSAFE_JOB_RECORD');
  await metadata.check(file);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || stamp(opened) !== stamp(before)) throw fail('JOB_RECORD_CHANGED');
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const part = await handle.read(bytes, count, bytes.length - count, count);
      count += part.bytesRead;
      if (!part.bytesRead) break;
    }
    const after = await handle.stat({ bigint: true }),
      named = await lstat(file, { bigint: true });
    await metadata.check(file);
    await recheckChain(parents, metadata);
    if (
      count !== Number(opened.size) ||
      !named.isFile() ||
      named.isSymbolicLink() ||
      stamp(opened) !== stamp(after) ||
      stamp(after) !== stamp(named)
    )
      throw fail('JOB_RECORD_CHANGED');
    return { bytes: bytes.subarray(0, count), identity: idOf(opened), sha256: sha(bytes.subarray(0, count)) };
  } finally {
    await handle.close();
  }
}
async function privateLease(dir) {
  if (process.platform !== 'win32') {
    const info = await lstat(dir);
    if ((info.mode & 0o077) !== 0) throw fail('PRIVATE_DIRECTORY_REQUIRED');
    return {
      assertAlive() {},
      async verify(name) {
        const info = await lstat(path.join(dir, name));
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
          throw fail('PRIVATE_FILE_REQUIRED');
      },
      async close() {},
    };
  }
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = fileURLToPath(new URL('./Job-Archive-Private.ps1', import.meta.url));
  const child = spawn(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'RemoteSigned',
      '-File',
      script,
      '-Directory',
      dir,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let failure = null,
    ended = false,
    stderrBytes = 0,
    stdoutBytes = 0,
    notify;
  const failed = new Promise((resolve) => {
    notify = resolve;
  });
  const reject = (code) => {
    if (!failure) {
      failure = code;
      notify(code);
    }
  };
  child.on('error', () => reject('PRIVATE_DIRECTORY_HELPER_FAILED'));
  child.stdin.on('error', () => reject('PRIVATE_DIRECTORY_HELPER_FAILED'));
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > 8192) {
      reject('PRIVATE_DIRECTORY_HELPER_FAILED');
      child.kill();
    }
  });
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > 4096) {
      reject('PRIVATE_DIRECTORY_HELPER_FAILED');
      child.kill();
    }
  });
  const exited = new Promise((resolve) =>
    child.once('close', (code) => {
      ended = true;
      resolve(code);
    }),
  );
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity }),
    iterator = lines[Symbol.asyncIterator]();
  const reply = async (expected) => {
    let timer;
    try {
      const item = await Promise.race([
        iterator.next(),
        failed.then((code) => {
          throw fail(code);
        }),
        new Promise((_, rejectTimeout) => {
          timer = setTimeout(() => rejectTimeout(fail('PRIVATE_DIRECTORY_TIMEOUT')), 15000);
        }),
      ]);
      if (item.done || item.value !== expected || failure || ended)
        throw fail('PRIVATE_DIRECTORY_HELPER_FAILED');
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await reply('READY');
  } catch (error) {
    child.kill();
    await exited;
    lines.close();
    throw error;
  }
  return {
    assertAlive() {
      if (ended || failure) throw fail('PRIVATE_DIRECTORY_HELPER_FAILED');
    },
    async verify(name) {
      if (!['original.json.gz', 'proposal.json'].includes(name) || ended || failure)
        throw fail('PRIVATE_DIRECTORY_HELPER_FAILED');
      child.stdin.write(`VERIFY ${name}\n`);
      await reply('VERIFIED');
    },
    async close() {
      child.stdin.end();
      let deadline;
      try {
        const result = await Promise.race([
          exited,
          new Promise((resolve) => {
            deadline = setTimeout(() => resolve(null), 5000);
          }),
        ]);
        if (result === null) {
          child.kill();
          throw fail('PRIVATE_DIRECTORY_CLEANUP_UNVERIFIED');
        }
        if (result !== 0) throw fail('PRIVATE_DIRECTORY_HELPER_FAILED');
      } finally {
        clearTimeout(deadline);
        lines.close();
      }
    },
  };
}
export async function createJobArchiveProposal(options = {}, testDependencies = {}) {
  const { jobsDirectory, jobId, outputDirectory } = options;
  if (
    typeof jobsDirectory !== 'string' ||
    !path.isAbsolute(jobsDirectory) ||
    typeof outputDirectory !== 'string' ||
    !path.isAbsolute(outputDirectory) ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(jobId ?? '') ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(jobId)
  )
    throw fail('INVALID_JOB_ARCHIVE_ARGUMENTS');
  const jobs = path.resolve(jobsDirectory),
    dest = path.resolve(outputDirectory);
  if (inside(jobs, dest) || inside(dest, jobs)) throw fail('OUTPUT_OVERLAPS_JOBS');
  const metadata = windowsMetadata();
  let lease;
  try {
    const source = path.join(jobs, `${jobId}.json`),
      initial = await readJob(source, jobs, metadata);
    await testDependencies.afterFirstRead?.();
    let record;
    try {
      record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(initial.bytes));
    } catch {
      throw fail('INVALID_JOB_RECORD');
    }
    if (
      !record ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      record.id !== jobId ||
      !['running', 'passed', 'failed', 'cancelled', 'timed_out', 'interrupted'].includes(record.status) ||
      typeof record.output !== 'string' ||
      (Object.hasOwn(record, 'stdout') && typeof record.stdout !== 'string') ||
      (Object.hasOwn(record, 'stderr') && typeof record.stderr !== 'string')
    )
      throw fail('INVALID_JOB_RECORD');
    const compressed = gzipSync(initial.bytes, { level: 9 });
    if (compressed.length > maxBytes + 1048576) throw fail('ARCHIVE_SIZE_LIMIT');
    const restored = gunzipSync(compressed, { maxOutputLength: maxBytes });
    if (!restored.equals(initial.bytes) || sha(restored) !== initial.sha256)
      throw fail('ARCHIVE_VERIFICATION_FAILED');
    const parent = path.dirname(dest),
      parents = await chain(parent, metadata);
    if (process.platform !== 'win32') await mkdir(dest, { mode: 0o700 });
    lease = await privateLease(dest);
    lease.assertAlive();
    const before = await lstat(dest, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) throw fail('PRIVATE_DIRECTORY_REQUIRED');
    const after = await lstat(dest, { bigint: true });
    await metadata.check(dest);
    await recheckChain(parents, metadata);
    if (!after.isDirectory() || after.isSymbolicLink() || !sameDir(before, after))
      throw fail('PRIVATE_DIRECTORY_CHANGED');
    const checkPrivateFile = async (file, handle, size) => {
      const opened = await handle.stat({ bigint: true });
      const named = await lstat(file, { bigint: true });
      await metadata.check(file);
      if (
        !opened.isFile() ||
        !named.isFile() ||
        named.isSymbolicLink() ||
        opened.nlink !== 1n ||
        named.nlink !== 1n ||
        opened.size !== BigInt(size) ||
        named.size !== BigInt(size) ||
        !sameDir(opened, named)
      )
        throw fail('PRIVATE_FILE_REQUIRED');
    };
    const blob = path.join(dest, 'original.json.gz'),
      out = await open(blob, 'wx', 0o600);
    try {
      await lease.verify('original.json.gz');
      await checkPrivateFile(blob, out, 0);
      await out.writeFile(compressed);
      await out.sync();
      await checkPrivateFile(blob, out, compressed.length);
    } finally {
      await out.close();
    }
    lease.assertAlive();
    const verify = await open(blob, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let written;
    try {
      const info = await verify.stat({ bigint: true });
      if (!info.isFile() || info.nlink !== 1n || info.size !== BigInt(compressed.length))
        throw fail('ARCHIVE_VERIFICATION_FAILED');
      const bounded = Buffer.alloc(compressed.length + 1);
      let count = 0;
      while (count < bounded.length) {
        const part = await verify.read(bounded, count, bounded.length - count, count);
        count += part.bytesRead;
        if (!part.bytesRead) break;
      }
      const afterRead = await verify.stat({ bigint: true });
      if (count !== compressed.length || stamp(info) !== stamp(afterRead))
        throw fail('ARCHIVE_VERIFICATION_FAILED');
      await checkPrivateFile(blob, verify, compressed.length);
      written = bounded.subarray(0, count);
    } finally {
      await verify.close();
    }
    if (
      sha(written) !== sha(compressed) ||
      sha(gunzipSync(written, { maxOutputLength: maxBytes })) !== initial.sha256
    )
      throw fail('ARCHIVE_VERIFICATION_FAILED');
    const final = await readJob(source, jobs, metadata);
    if (
      final.sha256 !== initial.sha256 ||
      JSON.stringify(final.identity) !== JSON.stringify(initial.identity)
    )
      throw fail('JOB_RECORD_CHANGED');
    lease.assertAlive();
    const result = {
      schema: 'workbridge-job-archive-proposal/1',
      jobId,
      sourceSha256: initial.sha256,
      sourceBytes: initial.bytes.length,
      sourceIdentity: initial.identity,
      gzipSha256: sha(compressed),
      gzipBytes: compressed.length,
      zlibVersion: process.versions.zlib,
      observedStatus: record.status,
      outputLength: record.output.length,
      stdoutLength: typeof record.stdout === 'string' ? record.stdout.length : null,
      stderrLength: typeof record.stderr === 'string' ? record.stderr.length : null,
      archiveFile: 'original.json.gz',
      losslessVerified: true,
      sourceMutationPerformed: false,
      compactionAuthorized: false,
      qualification:
        'Read-only non-atomic source observation; archive proposal does not establish job ownership, inactivity, replay safety, or permission to compact.',
    };
    result.proposalBytes = 0;
    result.hypotheticalLogicalBytesSaved = 0;
    let manifestBytes;
    for (let i = 0; i < 8; i++) {
      manifestBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
      const saved = initial.bytes.length - compressed.length - manifestBytes.length;
      if (result.proposalBytes === manifestBytes.length && result.hypotheticalLogicalBytesSaved === saved)
        break;
      result.proposalBytes = manifestBytes.length;
      result.hypotheticalLogicalBytesSaved = saved;
    }
    manifestBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    if (
      manifestBytes.length !== result.proposalBytes ||
      result.hypotheticalLogicalBytesSaved !== initial.bytes.length - compressed.length - manifestBytes.length
    )
      throw fail('PROPOSAL_SIZE_UNSTABLE');
    const receipt = await open(path.join(dest, 'proposal.json'), 'wx', 0o600);
    try {
      await lease.verify('proposal.json');
      await checkPrivateFile(path.join(dest, 'proposal.json'), receipt, 0);
      await receipt.writeFile(manifestBytes);
      await receipt.sync();
      await checkPrivateFile(path.join(dest, 'proposal.json'), receipt, manifestBytes.length);
    } finally {
      await receipt.close();
    }
    lease.assertAlive();
    await recheckChain(parents, metadata);
    const end = await lstat(dest, { bigint: true });
    if (!sameDir(before, end)) throw fail('PRIVATE_DIRECTORY_CHANGED');
    return result;
  } finally {
    try {
      await lease?.close();
    } finally {
      metadata.close();
    }
  }
}
export function parseArgs(args) {
  const keys = { '--jobs-dir': 'jobsDirectory', '--job-id': 'jobId', '--output-dir': 'outputDirectory' },
    result = {};
  for (let i = 0; i < args.length; i++) {
    const key = keys[args[i]];
    if (!key || Object.hasOwn(result, key) || i + 1 >= args.length)
      throw fail('INVALID_JOB_ARCHIVE_ARGUMENTS');
    result[key] = args[++i];
  }
  if (Object.keys(result).length !== 3) throw fail('INVALID_JOB_ARCHIVE_ARGUMENTS');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    process.stdout.write(
      'Usage: node scripts/job-archive-proposal.mjs --jobs-dir ABSOLUTE_PATH --job-id ID --output-dir NEW_ABSOLUTE_PATH\nProduces a private lossless proposal only; no job records are changed.\n',
    );
  } else
    try {
      const result = await createJobArchiveProposal(parseArgs(process.argv.slice(2)));
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      process.stderr.write(`${error.code ?? 'JOB_ARCHIVE_FAILED'}\n`);
      process.exitCode = 1;
    }
}
