import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/Audit-WorkbridgeGit.ps1', import.meta.url));
const windows = { skip: process.platform !== 'win32' };
const sha = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');

async function put(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, value);
}

// Build disposable Git objects/index bytes ourselves. Tests never run Git init,
// add, commit, config, checkout, reset, worktree or any other mutating Git verb.
async function fixture({
  files = {},
  index = Object.entries(files).map(([name, content]) => ({ name, content, stage: 0 })),
  working = files,
  recovery = {},
  detached = false,
  unborn = false,
  linked = false,
  missingIndex = false,
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wb-git-audit-'));
  const repo = path.join(directory, 'repo space & $() caf\u00e9');
  const admin = linked ? path.join(directory, 'admin') : path.join(repo, '.git');
  const common = linked ? path.join(directory, 'common') : admin;
  await mkdir(repo, { recursive: true });
  await mkdir(admin, { recursive: true });
  await mkdir(path.join(common, 'objects'), { recursive: true });
  await mkdir(path.join(common, 'refs', 'heads'), { recursive: true });
  await put(
    path.join(common, 'config'),
    '[core]\nrepositoryformatversion = 0\nbare = false\nfilemode = false\nautocrlf = false\n' +
      'fsmonitor = false\nuntrackedCache = false\nlogallrefupdates = false\n',
  );
  if (linked) {
    await put(path.join(repo, '.git'), `gitdir: ${admin.replaceAll('\\', '/')}\n`);
    await put(path.join(admin, 'commondir'), '../common\n');
    await put(path.join(admin, 'gitdir'), `${path.join(repo, '.git').replaceAll('\\', '/')}\n`);
  }
  async function object(type, content) {
    const buffer = Buffer.from(content);
    const encoded = Buffer.concat([Buffer.from(`${type} ${buffer.length}\0`), buffer]);
    const hash = sha(encoded, 'sha1');
    await put(path.join(common, 'objects', hash.slice(0, 2), hash.slice(2)), deflateSync(encoded));
    return hash;
  }
  async function tree(entries) {
    const nodes = new Map();
    for (const [name, content] of entries) {
      const slash = name.indexOf('/');
      if (slash < 0) nodes.set(name, { directory: false, hash: await object('blob', content) });
      else {
        const directory = name.slice(0, slash);
        const node = nodes.get(directory) ?? { directory: true, entries: [] };
        node.entries.push([name.slice(slash + 1), content]);
        nodes.set(directory, node);
      }
    }
    const rows = [];
    const ordered = [...nodes].sort(([a, av], [b, bv]) =>
      Buffer.compare(Buffer.from(a + (av.directory ? '/' : '')), Buffer.from(b + (bv.directory ? '/' : ''))),
    );
    for (const [name, node] of ordered) {
      const hash = node.directory ? await tree(node.entries) : node.hash;
      rows.push(Buffer.from(`${node.directory ? '40000' : '100644'} ${name}\0`), Buffer.from(hash, 'hex'));
    }
    return object('tree', Buffer.concat(rows));
  }
  const treeHash = await tree(Object.entries(files));
  const head = await object(
    'commit',
    `tree ${treeHash}\nauthor Synthetic <fixture@example.invalid> 1 +0000\n` +
      'committer Synthetic <fixture@example.invalid> 1 +0000\n\nSynthetic baseline\n',
  );
  await put(path.join(admin, 'HEAD'), detached ? `${head}\n` : 'ref: refs/heads/main\n');
  if (!unborn) await put(path.join(common, 'refs', 'heads', 'main'), `${head}\n`);
  if (!missingIndex) {
    const header = Buffer.alloc(12);
    header.write('DIRC');
    header.writeUInt32BE(2, 4);
    header.writeUInt32BE(index.length, 8);
    const rows = [header];
    for (const entry of [...index].sort(
      (a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)) || a.stage - b.stage,
    )) {
      const name = Buffer.from(entry.name);
      const row = Buffer.alloc(Math.ceil((62 + name.length + 1) / 8) * 8);
      row.writeUInt32BE(0o100644, 24);
      row.writeUInt32BE(Buffer.byteLength(entry.content), 36);
      Buffer.from(await object('blob', entry.content), 'hex').copy(row, 40);
      row.writeUInt16BE((entry.stage << 12) | Math.min(name.length, 0xfff), 60);
      name.copy(row, 62);
      rows.push(row);
    }
    const body = Buffer.concat(rows);
    await put(path.join(admin, 'index'), Buffer.concat([body, Buffer.from(sha(body, 'sha1'), 'hex')]));
  }
  for (const [name, content] of Object.entries(working)) {
    if (content !== null) await put(path.join(repo, name), content);
  }
  for (const [name, content] of Object.entries(recovery)) await put(path.join(admin, name), content);
  return { directory, repo, admin, common, head };
}

async function snapshot(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result[entry.name] = await snapshot(full);
    else {
      const info = await stat(full);
      result[entry.name] = { sha256: sha(await readFile(full)), mtimeMs: info.mtimeMs, mode: info.mode };
    }
  }
  return result;
}

function audit(repo, { env = {}, expectedExit = 0, cwd = os.tmpdir() } = {}) {
  const completed = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-RepositoryPath', repo],
    {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      cwd,
      env: { ...process.env, ...env },
    },
  );
  assert.equal(completed.error, undefined);
  assert.equal(completed.status, expectedExit, completed.stderr || completed.stdout);
  assert.equal(completed.stderr, '');
  return JSON.parse(completed.stdout);
}

async function unchanged(f, options) {
  const before = await snapshot(f.directory);
  try {
    return audit(f.repo, options);
  } finally {
    assert.deepEqual(
      await snapshot(f.directory),
      before,
      'audit must preserve all fixture bytes, mtimes and modes',
    );
  }
}

function partition(report) {
  assert.equal(report.ok, true);
  assert.equal(report.complete, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.indexWrites, false);
  assert.equal(report.baselineAgreedBeforeAfter, true);
  assert.equal(report.groups.tracked.length, report.counts.tracked);
  assert.equal(report.groups.untracked.length, report.counts.untracked);
  const entries = [...report.groups.tracked, ...report.groups.untracked];
  assert.equal(new Set(entries.map((e) => e.path)).size, entries.length);
  assert.ok(report.groups.tracked.every((e) => !e.untracked));
  assert.ok(report.groups.untracked.every((e) => e.untracked && e.status === '??'));
  assert.ok(report.candidateCommits.every((c) => c.requiresHumanReview && !c.readyToCommit));
  assert.match(report.checkpointPlannerSha256, /^[0-9a-f]{64}$/);
  return entries;
}

test(
  'dirty fixture: exact tracked/untracked groups, index baseline and small review candidates',
  windows,
  async () => {
    const f = await fixture({
      files: { 'src/apple.ts': 'export const a = 1;\n', 'docs/gone.md': 'removed\n' },
      working: {
        'src/apple.ts': 'export const a = 2;\n',
        'test/apple.test.mjs': 'PRIVATE_SOURCE_CONTENT_NOT_FOR_OUTPUT\n',
        'docs/review notes.md': 'PRIVATE_DOC_CONTENT_NOT_FOR_OUTPUT\n',
        '.local/token': 'PRIVATE_RUNTIME_SECRET_NOT_FOR_OUTPUT',
      },
    });
    const report = await unchanged(f);
    const entries = partition(report);
    assert.equal(report.baseline.head, f.head);
    assert.equal(report.baseline.headRef, 'refs/heads/main');
    assert.equal(report.baseline.unborn, false);
    assert.equal(report.baseline.indexSha256, sha(await readFile(path.join(f.admin, 'index'))));
    assert.equal(report.counts.tracked, 2);
    assert.equal(report.counts.untracked, 3);
    assert.equal(entries.find((e) => e.path === 'docs/gone.md').status, ' D');
    const pair = report.candidateCommits.find((c) => c.topic === 'apple');
    assert.deepEqual(
      pair.files.map((e) => e.path),
      ['src/apple.ts', 'test/apple.test.mjs'],
    );
    assert.ok(!report.candidateCommits.some((c) => c.files.some((e) => e.path.startsWith('.local/'))));
    assert.equal(report.counts.excluded, 1);
    assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  },
);

test(
  'staged, partially staged, rename and conflict entries retain status and are withheld',
  windows,
  async () => {
    const files = {
      'docs/old name.md': 'renamed identical content\n',
      'src/partial.ts': 'base\n',
      'src/staged.ts': 'base\n',
      'src/conflict.ts': 'base\n',
    };
    const f = await fixture({
      files,
      index: [
        { name: 'docs/new name.md', content: files['docs/old name.md'], stage: 0 },
        { name: 'src/partial.ts', content: 'staged\n', stage: 0 },
        { name: 'src/staged.ts', content: 'staged\n', stage: 0 },
        ...[1, 2, 3].map((stage) => ({ name: 'src/conflict.ts', content: `${stage}\n`, stage })),
      ],
      working: {
        'docs/new name.md': files['docs/old name.md'],
        'src/partial.ts': 'further working change\n',
        'src/staged.ts': 'staged\n',
        'src/conflict.ts': 'conflict\n',
        'test/partial.test.mjs': 'test\n',
      },
    });
    const report = await unchanged(f);
    partition(report);
    const byPath = new Map(report.groups.tracked.map((e) => [e.path, e]));
    assert.equal(byPath.get('src/partial.ts').status, 'MM');
    assert.equal(byPath.get('src/staged.ts').status, 'M ');
    assert.equal(byPath.get('src/conflict.ts').status, 'UU');
    assert.equal(byPath.get('docs/new name.md').originalPath, 'docs/old name.md');
    assert.equal(report.counts.staged, 4);
    assert.deepEqual(report.candidateCommits, []);
    assert.ok(report.warnings.some((w) => w.code === 'EXISTING_STAGING_PRESERVED'));
  },
);

test(
  'recovery markers and existing index.lock suppress candidates without reading/removing them',
  windows,
  async () => {
    const recovery = {
      'index.lock': 'PRIVATE_EXISTING_LOCK',
      MERGE_HEAD: 'PRIVATE_MERGE_STATE',
      'rebase-merge/head-name': 'PRIVATE_REBASE_STATE',
      'sequencer/todo': 'PRIVATE_SEQUENCER_STATE',
    };
    const f = await fixture({ recovery, working: { 'docs/candidate.md': 'doc\n' } });
    const report = await unchanged(f);
    partition(report);
    assert.deepEqual(report.baseline.recoveryMarkers, [
      'index.lock',
      'MERGE_HEAD',
      'rebase-merge',
      'sequencer',
    ]);
    assert.deepEqual(report.candidateCommits, []);
    assert.equal(report.counts.candidateCommits, 0);
    assert.ok(report.warnings.some((w) => w.code === 'RECOVERY_STATE_REQUIRES_REVIEW'));
    assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  },
);

test('clean detached baseline and linked-worktree metadata paths are supported', windows, async () => {
  const f = await fixture({ files: { 'tracked.txt': 'same\n' }, detached: true, linked: true });
  const report = await unchanged(f);
  partition(report);
  assert.equal(report.baseline.detached, true);
  assert.equal(report.baseline.headRef, null);
  assert.equal(report.baseline.head, f.head);
  assert.equal(report.baseline.indexSha256, sha(await readFile(path.join(f.admin, 'index'))));
  assert.equal(report.counts.tracked, 0);
  assert.equal(report.counts.untracked, 0);
  assert.deepEqual(report.candidateCommits, []);
});

test('unborn repository with no index reports a baseline without inventing a commit', windows, async () => {
  const f = await fixture({ unborn: true, missingIndex: true, working: { 'docs/new.md': 'new\n' } });
  const report = await unchanged(f);
  partition(report);
  assert.equal(report.baseline.unborn, true);
  assert.equal(report.baseline.head, null);
  assert.equal(report.baseline.indexExists, false);
  assert.equal(report.baseline.indexSha256, null);
  assert.equal(report.counts.untracked, 1);
  assert.equal(report.candidateCommits[0].topic, 'new');
});

test(
  'Unicode, shell-like names, subdirectory input and trailing slash round trip without execution',
  windows,
  async () => {
    const name = 'docs/caf\u00e9 \u65e5\u672c\u8a9e $(whoami) & semi;colon.md';
    const f = await fixture({ working: { [name]: 'not commands\n' } });
    const before = await snapshot(f.directory);
    const report = audit(path.join(f.repo, 'docs') + path.sep);
    assert.deepEqual(await snapshot(f.directory), before);
    partition(report);
    assert.equal(report.groups.untracked[0].path, name);
    assert.equal(path.resolve(report.repository), path.resolve(f.repo));
  },
);

test(
  'alternate Git routing/tracing is stripped; duplicate Path/PATH and caller configuration work',
  windows,
  async () => {
    const f = await fixture({ working: { 'docs/right.md': 'right\n' } });
    const other = await fixture({ working: { 'docs/wrong.md': 'wrong\n' } });
    const beforeOther = await snapshot(other.directory);
    const parentPath = process.env.Path ?? process.env.PATH;
    const report = await unchanged(f, {
      env: {
        Path: parentPath,
        PATH: parentPath,
        GIT_DIR: other.admin,
        GIT_WORK_TREE: other.repo,
        GIT_INDEX_FILE: path.join(other.admin, 'index'),
        GIT_TRACE: path.join(f.directory, 'must-not-create-trace.log'),
      },
    });
    partition(report);
    assert.deepEqual(
      report.groups.untracked.map((e) => e.path),
      ['docs/right.md'],
    );
    assert.deepEqual(await snapshot(other.directory), beforeOther);
  },
);

test(
  'invalid repository and corrupt index fail closed with JSON, no content leakage or writes',
  windows,
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'wb-git-audit-invalid-'));
    const before = await snapshot(directory);
    const invalid = audit(directory, { expectedExit: 1 });
    assert.equal(invalid.error, 'GIT_READ_FAILED');
    assert.equal(invalid.complete, false);
    assert.deepEqual(invalid.candidateCommits, []);
    assert.deepEqual(await snapshot(directory), before);

    const f = await fixture();
    await put(path.join(f.admin, 'index'), 'PRIVATE_CORRUPT_INDEX');
    const corrupt = await unchanged(f, { expectedExit: 1 });
    assert.equal(corrupt.error, 'CHECKPOINT_PLAN_FAILED');
    assert.deepEqual(corrupt.candidateCommits, []);
    assert.equal(corrupt.readOnly, true);
    assert.equal(JSON.stringify(corrupt).includes('PRIVATE_'), false);
  },
);
