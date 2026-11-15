import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../dist/workspace.js';
import { Jobs } from '../dist/jobs.js';
const sha = (b) => createHash('sha256').update(b).digest('hex');
async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-job-archive-write-')),
    state = path.join(root, 'state');
  await fs.mkdir(path.join(state, 'jobs'), { recursive: true });
  const workspace = await Workspace.create(root),
    jobs = new Jobs(workspace, state);
  t.after(async () => {
    await jobs.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const record = {
    id: 'saved',
    project: '.',
    command: 'node',
    request: 'a'.repeat(64),
    status: 'passed',
    startedAt: '2026-10-21T03:00:00.000Z',
    endedAt: '2026-10-21T03:00:01.000Z',
    exitCode: 0,
    output: 'repeated value '.repeat(3000),
    outputTruncated: false,
    stdout: 'hello 😀',
    stderr: '',
    extraUnknown: { preserved: true },
    ...overrides,
  };
  const raw = Buffer.from(JSON.stringify(record)),
    file = path.join(state, 'jobs', 'saved.json');
  await fs.writeFile(file, raw);
  return { root, state, jobs, raw, file, expected: sha(raw), record };
}
test(
  'compact and restore exact bytes; old operation retry after restore never reapplies',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const fresh = await f.jobs.archiveStatus('saved', 'not-started');
    assert.equal(fresh.status, 'unknown');
    assert.equal(fresh.currentRecordSha256, f.expected);
    assert.equal(fresh.currentRepresentation, 'raw');
    assert.equal(fresh.pendingOperationId, null);
    await assert.rejects(fs.access(path.join(f.state, 'job-archives')), { code: 'ENOENT' });
    const compact = await f.jobs.archive('saved', 'compact', 'compact1', f.expected);
    assert.equal(compact.status, 'completed');
    assert.ok(compact.logicalBytesSaved > 0);
    const descriptor = await fs.readFile(f.file);
    assert.notDeepEqual(descriptor, f.raw);
    assert.equal(sha(descriptor), compact.resultRecordSha256);
    assert.equal((await f.jobs.status('saved')).status, 'passed');
    assert.equal((await f.jobs.output('saved', 0, 20)).text, f.record.output.slice(0, 20));
    assert.equal((await f.jobs.archiveStatus('saved', 'compact1')).status, 'completed');
    const archived = await f.jobs.archiveStatus('saved', 'other');
    assert.equal(archived.currentRecordSha256, compact.resultRecordSha256);
    assert.equal(archived.currentRepresentation, 'archived');
    const restored = await f.jobs.archive('saved', 'restore', 'restore1', compact.resultRecordSha256);
    assert.equal(restored.resultRecordSha256, f.expected);
    assert.deepEqual(await fs.readFile(f.file), f.raw);
    const historical = await f.jobs.archiveStatus('saved', 'compact1');
    assert.equal(historical.resultRecordSha256, compact.resultRecordSha256);
    assert.equal(historical.currentRecordSha256, f.expected);
    assert.equal(historical.currentRepresentation, 'raw');
    const again = await f.jobs.archive('saved', 'compact', 'compact1', f.expected);
    assert.equal(again.alreadyCompleted, true);
    assert.deepEqual(await fs.readFile(f.file), f.raw);
    await assert.rejects(
      f.jobs.archive('saved', 'restore', 'compact1', compact.resultRecordSha256),
      (e) => e.code === 'JOB_ARCHIVE_OPERATION_ID_REUSE',
    );
  },
);
test(
  'rejects active, pending-owner, stale SHA, ineligible and nonbeneficial cases',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    f.jobs.live.set('saved', {});
    await assert.rejects(
      f.jobs.archive('saved', 'compact', 'op1', f.expected),
      (e) => e.code === 'JOB_ARCHIVE_ACTIVE',
    );
    f.jobs.live.delete('saved');
    await assert.rejects(
      f.jobs.archive('saved', 'compact', 'op1', 'b'.repeat(64)),
      (e) => e.code === 'JOB_ARCHIVE_PRECONDITION',
    );
    assert.deepEqual(await fs.readFile(f.file), f.raw);
    const running = await fixture(t, { status: 'running' });
    await assert.rejects(
      running.jobs.archive('saved', 'compact', 'op', running.expected),
      (e) => e.code === 'JOB_ARCHIVE_INELIGIBLE',
    );
    const small = await fixture(t, { output: 'tiny' });
    await assert.rejects(
      small.jobs.archive('saved', 'compact', 'op', small.expected),
      (e) => e.code === 'JOB_ARCHIVE_NOT_BENEFICIAL',
    );
    assert.deepEqual(await fs.readFile(small.file), small.raw);
  },
);
test(
  'crash after record rename resumes same operation and blocks a different one',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      original = fs.rename;
    let injected = false;
    try {
      fs.rename = async function (a, b, ...rest) {
        const result = await original.call(this, a, b, ...rest);
        if (path.resolve(String(b)) === f.file && !injected) {
          injected = true;
          throw Error('simulated crash');
        }
        return result;
      };
      syncBuiltinESMExports();
      await assert.rejects(f.jobs.archive('saved', 'compact', 'op1', f.expected), /simulated crash/);
    } finally {
      fs.rename = original;
      syncBuiltinESMExports();
    }
    assert.equal(injected, true);
    assert.equal((await f.jobs.archiveStatus('saved', 'op1')).status, 'pending');
    const otherStatus = await f.jobs.archiveStatus('saved', 'different');
    assert.equal(otherStatus.status, 'unknown');
    assert.equal(otherStatus.pendingOperationId, 'op1');
    assert.equal(otherStatus.pendingDirection, 'compact');
    assert.equal(otherStatus.pendingExpectedRecordSha256, f.expected);
    assert.equal(otherStatus.pendingResultRecordSha256, otherStatus.currentRecordSha256);
    assert.equal(otherStatus.currentRepresentation, 'archived');
    await assert.rejects(
      f.jobs.archive('saved', 'compact', 'different', f.expected),
      (e) => e.code === 'JOB_ARCHIVE_BUSY',
    );
    const result = await f.jobs.archive('saved', 'compact', 'op1', f.expected);
    assert.equal(result.status, 'completed');
    assert.equal((await f.jobs.status('saved')).status, 'passed');
  },
);
for (const phase of ['pending', 'blob', 'done'])
  test(`recovers crash after ${phase} no-replace link`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t),
      original = fs.unlink;
    let injected = false;
    try {
      fs.unlink = async function (file, ...args) {
        const name = path.basename(String(file));
        if (
          !injected &&
          (phase === 'pending'
            ? name === 'stage-pending-op1.json'
            : phase === 'blob'
              ? name.startsWith('stage-') && name.endsWith('.blob')
              : name === 'stage-done-op1.json')
        ) {
          injected = true;
          throw Error('simulated crash');
        }
        return original.call(this, file, ...args);
      };
      syncBuiltinESMExports();
      await assert.rejects(f.jobs.archive('saved', 'compact', 'op1', f.expected), /simulated crash/);
    } finally {
      fs.unlink = original;
      syncBuiltinESMExports();
    }
    assert.equal(injected, true);
    const result = await f.jobs.archive('saved', 'compact', 'op1', f.expected);
    assert.equal(result.status, 'completed');
    assert.equal((await f.jobs.status('saved')).status, 'passed');
  });

test('archive status reports a missing current job', async (t) => {
  const f = await fixture(t);
  await fs.unlink(f.file);
  const result = await f.jobs.archiveStatus('saved', 'new');
  assert.equal(result.status, 'unknown');
  assert.equal(result.currentRecordSha256, null);
  assert.equal(result.currentRepresentation, 'missing');
  assert.equal(result.pendingOperationId, null);
});
test('positive savings near a decimal boundary do not oscillate', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  let selected;
  for (let n = 300; n < 5000; n++) {
    const raw = Buffer.from(JSON.stringify({ ...f.record, output: 'x'.repeat(n) }));
    const zipped = gzipSync(raw, { level: 9 });
    const descriptor = {
      schema: 'workbridge-job-archive/1',
      id: 'saved',
      sourceSha256: sha(raw),
      sourceBytes: raw.length,
      gzipSha256: sha(zipped),
      gzipBytes: zipped.length,
    };
    const descriptorBytes = Buffer.from(JSON.stringify(descriptor));
    const marker = {
      schema: 'workbridge-job-archive-operation/1',
      jobId: 'saved',
      operationId: 'edge',
      direction: 'compact',
      expectedRecordSha256: sha(raw),
      resultRecordSha256: sha(descriptorBytes),
      descriptor,
      sourceRecordBytes: raw.length,
      resultRecordBytes: descriptorBytes.length,
    };
    const saved =
      raw.length - descriptorBytes.length - zipped.length - 2 * Buffer.byteLength(JSON.stringify(marker));
    if (saved >= 1 && saved <= 10) {
      selected = { raw, saved };
      break;
    }
  }
  assert.ok(selected, 'expected a bounded small-positive fixture');
  await fs.writeFile(f.file, selected.raw);
  const result = await f.jobs.archive('saved', 'compact', 'edge', sha(selected.raw));
  assert.equal(result.logicalBytesSaved, selected.saved);
});
test(
  'historical retry leaves a different hardlinked pending operation intact',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const first = await f.jobs.archive('saved', 'compact', 'compactA', f.expected);
    const original = fs.unlink;
    let injected = false;
    try {
      fs.unlink = async function (file, ...args) {
        if (!injected && path.basename(String(file)) === 'stage-pending-restoreB.json') {
          injected = true;
          throw Error('simulated crash');
        }
        return original.call(this, file, ...args);
      };
      syncBuiltinESMExports();
      await assert.rejects(
        f.jobs.archive('saved', 'restore', 'restoreB', first.resultRecordSha256),
        /simulated crash/,
      );
    } finally {
      fs.unlink = original;
      syncBuiltinESMExports();
    }
    const historical = await f.jobs.archive('saved', 'compact', 'compactA', f.expected);
    assert.equal(historical.alreadyCompleted, true);
    const status = await f.jobs.archiveStatus('saved', 'restoreB');
    assert.equal(status.status, 'pending');
    assert.equal(status.pendingOperationId, 'restoreB');
    const restored = await f.jobs.archive('saved', 'restore', 'restoreB', first.resultRecordSha256);
    assert.equal(restored.status, 'completed');
    assert.deepEqual(await fs.readFile(f.file), f.raw);
  },
);
for (const [status, exitCode] of [
  ['failed', 1],
  ['cancelled', null],
  ['timed_out', null],
]) {
  test(`lossless archive preserves terminal ${status} exactly`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t, { status, exitCode, error: 'fixture terminal note' });
    const compact = await f.jobs.archive('saved', 'compact', `compact-${status}`, f.expected);
    assert.equal((await f.jobs.status('saved')).status, status);
    const restored = await f.jobs.archive(
      'saved',
      'restore',
      `restore-${status}`,
      compact.resultRecordSha256,
    );
    assert.equal(restored.status, 'completed');
    assert.deepEqual(await fs.readFile(f.file), f.raw);
  });
}
for (const overrides of [
  { status: 'interrupted' },
  { status: 'failed', errorCode: 'JOB_RECORD_SAVE_FAILED' },
]) {
  test(`refuses ${overrides.errorCode ?? overrides.status} records`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t, overrides);
    await assert.rejects(
      f.jobs.archive('saved', 'compact', 'op', f.expected),
      (error) => error.code === 'JOB_ARCHIVE_INELIGIBLE',
    );
    assert.deepEqual(await fs.readFile(f.file), f.raw);
  });
}
test(
  'compaction and restoration preserve same-ID replay without starting a command',
  { timeout: 30000 },
  async (t) => {
    const args = ['-e', "require('fs').writeFileSync('must-not-start','bad')"];
    const request = sha(
      JSON.stringify({ mode: 'terminal', cwd: '.', executable: process.execPath, args, timeoutSeconds: 30 }),
    );
    const f = await fixture(t, { request });
    const compact = await f.jobs.archive('saved', 'compact', 'compact', f.expected);
    assert.equal((await f.jobs.terminal('.', process.execPath, args, 30, 'saved')).status, 'passed');
    await assert.rejects(
      f.jobs.terminal('.', process.execPath, ['-e', 'different'], 30, 'saved'),
      (e) => e.code === 'ID_REUSE',
    );
    await f.jobs.archive('saved', 'restore', 'restore', compact.resultRecordSha256);
    assert.equal((await f.jobs.terminal('.', process.execPath, args, 30, 'saved')).status, 'passed');
    await assert.rejects(fs.access(path.join(f.root, 'must-not-start')), { code: 'ENOENT' });
  },
);
test('archive status refuses a broken current descriptor', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.jobs.archive('saved', 'compact', 'op', f.expected);
  await fs.unlink(path.join(f.state, 'job-archives', 'saved', `${f.expected}.json.gz`));
  await assert.rejects(
    f.jobs.archiveStatus('saved', 'op'),
    (error) => error.code === 'UNREADABLE_JOB_RECORD',
  );
});
test(
  'restore accepts a valid noncanonical descriptor using its exact disk hash',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await f.jobs.archive('saved', 'compact', 'compact', f.expected);
    const value = JSON.parse(await fs.readFile(f.file, 'utf8'));
    const formatted = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    await fs.writeFile(f.file, formatted);
    const status = await f.jobs.archiveStatus('saved', 'restore');
    assert.equal(status.currentRecordSha256, sha(formatted));
    const restored = await f.jobs.archive('saved', 'restore', 'restore', status.currentRecordSha256);
    assert.equal(restored.status, 'completed');
    assert.deepEqual(await fs.readFile(f.file), f.raw);
  },
);
test(
  'archive status refuses a receipt stored under the wrong operation name',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await f.jobs.archive('saved', 'compact', 'actual', f.expected);
    const directory = path.join(f.state, 'job-archives', 'saved');
    await fs.copyFile(path.join(directory, 'done-actual.json'), path.join(directory, 'done-other.json'));
    await assert.rejects(
      f.jobs.archiveStatus('saved', 'other'),
      (error) => error.code === 'JOB_ARCHIVE_CONFLICT',
    );
  },
);
test('a valid existing blob is reused even when gzip options differ', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const first = await f.jobs.archive('saved', 'compact', 'first', f.expected);
  await f.jobs.archive('saved', 'restore', 'restore', first.resultRecordSha256);
  const blob = path.join(f.state, 'job-archives', 'saved', `${f.expected}.json.gz`);
  const different = gzipSync(f.raw, { level: 1 });
  await fs.writeFile(blob, different);
  const second = await f.jobs.archive('saved', 'compact', 'second', f.expected);
  const descriptor = JSON.parse(await fs.readFile(f.file, 'utf8'));
  assert.equal(second.status, 'completed');
  assert.equal(descriptor.gzipSha256, sha(different));
  assert.deepEqual(await fs.readFile(blob), different);
});
test(
  'a completed prior operation clears its lingering pending marker for a new restore',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const original = fs.unlink;
    let injected = false;
    try {
      fs.unlink = async function (file, ...args) {
        if (!injected && path.basename(String(file)) === 'pending.json') {
          injected = true;
          throw Error('simulated crash');
        }
        return original.call(this, file, ...args);
      };
      syncBuiltinESMExports();
      await assert.rejects(f.jobs.archive('saved', 'compact', 'op1', f.expected), /simulated crash/);
    } finally {
      fs.unlink = original;
      syncBuiltinESMExports();
    }
    const status = await f.jobs.archiveStatus('saved', 'op1');
    assert.equal(status.status, 'completed');
    assert.equal(status.pendingOperationId, 'op1');
    assert.equal(status.currentRepresentation, 'archived');
    const restored = await f.jobs.archive('saved', 'restore', 'op2', status.currentRecordSha256);
    assert.equal(restored.status, 'completed');
    assert.deepEqual(await fs.readFile(f.file), f.raw);
  },
);

test('hardlinked records and closing owners refuse maintenance', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'hardlink');
  await fs.link(f.file, alias);
  await assert.rejects(
    f.jobs.archive('saved', 'compact', 'op', f.expected),
    (e) => e.code === 'JOB_ARCHIVE_CONFLICT',
  );
  await fs.unlink(alias);
  await f.jobs.close();
  await assert.rejects(
    f.jobs.archive('saved', 'compact', 'op', f.expected),
    (e) => e.code === 'SERVER_CLOSING',
  );
  assert.deepEqual(await fs.readFile(f.file), f.raw);
});
test(
  'exclusive updater lease blocks archive maintenance',
  { skip: process.platform !== 'win32', timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const code =
      "$h=[IO.File]::Open($env:WB_TEST_LOCK,'OpenOrCreate','ReadWrite','None');try{[Console]::Out.WriteLine('LOCKED');[Console]::In.ReadLine()|Out-Null}finally{$h.Dispose()}";
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, WB_TEST_LOCK: path.join(f.state, 'updater.lock') },
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('lock fixture timeout')), 8000);
        child.stdout.once('data', () => {
          clearTimeout(timer);
          resolve();
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      await assert.rejects(
        f.jobs.archive('saved', 'compact', 'op', f.expected),
        (e) => e.code === 'SERVER_UPDATING',
      );
      assert.deepEqual(await fs.readFile(f.file), f.raw);
    } finally {
      const exited = new Promise((resolve) => child.once('close', resolve));
      child.stdin.end('\n');
      await exited;
    }
  },
);
test(
  'existing non-private archive root is refused without changing its ACL',
  { skip: process.platform !== 'win32', timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const root = path.join(f.state, 'job-archives');
    await fs.mkdir(root);
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const set =
      "$p=$env:WB_TEST_DIR;$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$user=[Security.Principal.WindowsIdentity]::GetCurrent().User;$world=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');foreach($s in @($user,$world)){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};[IO.Directory]::SetAccessControl($p,$acl)";
    const get =
      '[Console]::Out.WriteLine(([IO.Directory]::GetAccessControl($env:WB_TEST_DIR)).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access))';
    const run = (command) =>
      spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true,
        env: { ...process.env, WB_TEST_DIR: root },
        encoding: 'utf8',
      });
    assert.equal(run(set).status, 0);
    const before = run(get);
    assert.equal(before.status, 0);
    await assert.rejects(f.jobs.archive('saved', 'compact', 'op', f.expected));
    const after = run(get);
    assert.equal(after.status, 0);
    assert.equal(after.stdout, before.stdout);
    assert.deepEqual(await fs.readFile(f.file), f.raw);
  },
);
