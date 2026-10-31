import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildCheckpointPlan,
  parseStatus,
  parseNumstat,
  planScopedGitCheckpoints,
  serializePlan,
  plannerLimits,
  previousMilestones,
} from '../scripts/plan-scoped-git-checkpoints.mjs';

const status = (...rows) => (rows.length ? rows.join('\0') + '\0' : '');
const plan = (rows, more = {}) => buildCheckpointPlan({ status: status(...rows), ...more });
const entries = (p) => [
  ...p.candidateGroups.flatMap((g) => g.files),
  ...p.unreviewedFiles,
  ...p.excludedFiles,
];
function exactPartition(p) {
  assert.equal(
    p.counts.statusEntries,
    p.counts.candidateEntries + p.counts.unreviewedEntries + p.counts.excludedEntries,
  );
  assert.equal(entries(p).length, new Set(entries(p).map((e) => e.path)).size);
  assert.equal(p.actionableGroups, 0);
  assert.ok(p.candidateGroups.every((g) => g.readyToCommit === false && g.requiresHumanReview));
}
function mockGit(outputs) {
  const calls = [];
  return {
    calls,
    runGit: async (args, options) => {
      assert.ok(calls.length < outputs.length, 'unexpected Git operation');
      calls.push({ args: [...args], options });
      return Buffer.from(outputs[calls.length - 1]);
    },
  };
}

test('pairs exact source, script, test and doc stems, requiring shared dependency review', () => {
  const p = plan(
    [
      ' M src/apple.ts',
      '?? test/apple.test.mjs',
      '?? docs/apple.md',
      '?? scripts/pear.mjs',
      '?? test/pear.test.mjs',
      ' M package.json',
      ' M package-lock.json',
      ' M src/server.ts',
      '?? src/lonely.ts',
      '?? test/orphan.test.mjs',
      '?? docs/notes.md',
    ],
    {
      unstaged: status(
        '12\t3\tsrc/apple.ts',
        '1\t1\tpackage.json',
        '2\t0\tpackage-lock.json',
        '4\t0\tsrc/server.ts',
      ),
    },
  );
  assert.equal(p.counts.statusEntries, 11);
  assert.equal(p.counts.candidateGroups, 3);
  assert.equal(p.counts.candidateEntries, 6);
  const apple = p.candidateGroups.find((g) => g.topic === 'apple');
  assert.deepEqual(apple.areas, ['documentation', 'source', 'test']);
  assert.deepEqual(apple.dependsOnReviewOf, ['package-lock.json', 'package.json', 'src/server.ts']);
  assert.deepEqual(apple.files.find((e) => e.path === 'src/apple.ts').unstagedNumstat, [
    { added: 12, deleted: 3, binary: false, path: 'src/apple.ts' },
  ]);
  assert.deepEqual(apple.files.find((e) => e.untracked).unstagedNumstat, []);
  assert.ok(
    p.unreviewedFiles
      .find((e) => e.path === 'src/lonely.ts')
      .reasons.includes('no_matching_dirty_source_or_test'),
  );
  assert.ok(p.warnings.some((w) => w.code === 'DEPENDENCIES_NOT_ANALYZED'));
  exactPartition(p);
});

test('staged, partially staged, deleted, type-changed and conflicted paths are withheld', () => {
  const p = plan(
    [
      'MM src/a.ts',
      '?? test/a.test.mjs',
      'A  src/b.ts',
      ' D docs/deleted.md',
      ' T src/link.ts',
      'UU src/conflict.ts',
      'AA src/both.ts',
      'DD src/gone.ts',
    ],
    {
      unstaged: status('3\t2\tsrc/a.ts', '0\t4\tdocs/deleted.md', '-\t-\tsrc/link.ts'),
      staged: status('2\t1\tsrc/a.ts', '5\t0\tsrc/b.ts'),
    },
  );
  assert.equal(p.counts.stagedEntries, 5);
  assert.equal(p.candidateGroups.length, 0);
  const a = p.unreviewedFiles.find((e) => e.path === 'src/a.ts');
  assert.equal(a.stagedNumstat[0].added, 2);
  assert.equal(a.unstagedNumstat[0].added, 3);
  assert.ok(a.reasons.includes('existing_index_changes_preserved'));
  assert.ok(p.warnings.some((w) => w.code === 'EXISTING_STAGING_PRESERVED'));
  assert.equal(p.unreviewedFiles.find((e) => e.path === 'src/link.ts').unstagedNumstat[0].binary, true);
  exactPartition(p);
});

test('NUL rename and copy records preserve exact destination/source, spaces, tabs and newlines', () => {
  const p = plan(
    [
      'R  docs/new name.md',
      'docs/old\tname\n.md',
      ' C scripts/new.mjs',
      'scripts/old.mjs',
      '?? docs/a -> b.md',
    ],
    {
      staged: status('2\t1\t', 'docs/old\tname\n.md', 'docs/new name.md'),
      unstaged: status('0\t0\t', 'scripts/old.mjs', 'scripts/new.mjs'),
    },
  );
  assert.equal(p.counts.statusEntries, 3);
  assert.equal(p.counts.uniquePaths, 5);
  const rename = p.unreviewedFiles.find((e) => e.status === 'R ');
  assert.equal(rename.path, 'docs/new name.md');
  assert.equal(rename.originalPath, 'docs/old\tname\n.md');
  assert.equal(rename.stagedNumstat.length, 1);
  assert.equal(rename.stagedNumstat[0].originalPath, rename.originalPath);
  assert.ok(rename.reasons.includes('rename_copy_delete_type_or_conflict_requires_review'));
  assert.equal(p.candidateGroups[0].files[0].path, 'docs/a -> b.md');
  exactPartition(p);
});

test('protected paths are excluded even on a rename crossing the boundary and mixed case', () => {
  const p = plan([
    '?? .local/token',
    '?? .tools/evidence',
    '?? node_modules/pkg/x.js',
    '?? scripts/NODE_MODULES/pkg/a.mjs',
    'R  src/from-protected.ts',
    '.LOCAL/secret',
    '?? docs/normal.md',
  ]);
  assert.equal(p.counts.excludedEntries, 5);
  assert.equal(p.candidateGroups.length, 1);
  assert.ok(p.excludedFiles.every((f) => f.reasons.includes('protected_path')));
  assert.equal(p.excludedFiles.find((f) => f.originalPath).originalPath, '.LOCAL/secret');
  exactPartition(p);
});

test('previous milestones warn for untracked/modified paths and original rename paths', () => {
  const p = plan(
    [
      '?? docs/gui006-desktop-vmware-2026-10-26.md',
      ' M scripts/desktop-ui.mjs',
      'R  scripts/new-ui.mjs',
      'scripts/desktop-capture.mjs',
      '?? docs/custom.md',
    ],
    { knownMilestones: [...previousMilestones, ['WB-PRIOR', 'docs/custom.md']] },
  );
  assert.equal(p.candidateGroups.length, 0);
  const warnings = p.warnings.filter((w) => w.code === 'PREVIOUS_MILESTONE_OVERLAP');
  assert.equal(warnings.length, 4);
  assert.deepEqual(warnings.find((w) => w.originalPath).milestones, ['GUI-003']);
  assert.equal(warnings.find((w) => w.path === 'docs/custom.md').status, '??');
  assert.ok(p.unreviewedFiles.every((f) => f.reasons.includes('previous_milestone_overlap')));
  exactPartition(p);
});

test('Unicode bidi, control, decomposed text and shell-like paths round trip as inert ASCII JSON', () => {
  const names = [
    'docs/good\u202eexe.md',
    'docs/evil\u001b[31m.md',
    'docs/cafe\u0301.md',
    'docs/-option.md',
    'docs/$(touch NEVER);`id`.md',
    'docs/日本語😀.md',
    'docs/back\\slash.md',
  ];
  const p = plan(names.map((n) => `?? ${n}`));
  assert.equal(p.unreviewedFiles.length, 5);
  const json = serializePlan(p);
  assert.equal(/[^\x20-\x7e\n\r]/.test(json), false);
  assert.equal(json.includes('\u202e'), false);
  assert.deepEqual(
    entries(JSON.parse(json))
      .map((e) => e.path)
      .sort(),
    [...names].sort(),
  );
  assert.ok(p.unreviewedFiles.every((f) => f.reasons.includes('suspicious_path_requires_exact_review')));
  exactPartition(p);
});

test('empty worktree returns exact zero counts with review limitations', () => {
  const p = plan([]);
  assert.equal(p.counts.statusEntries, 0);
  assert.equal(p.counts.uniquePaths, 0);
  assert.equal(p.readOnly, true);
  assert.equal(p.directContentReads, false);
  assert.equal(p.fileContentReturned, false);
  assert.equal(p.indexWrites, false);
  assert.ok(p.warnings.some((w) => w.code === 'SNAPSHOT_NOT_ATOMIC'));
  exactPartition(p);
});

test('malformed, truncated, traversal, duplicate and non-UTF8 Git outputs fail closed', () => {
  for (const input of [
    ' M src/a.ts',
    'bad\0',
    'R  src/a.ts\0',
    '!! x\0',
    '?? ../x\0',
    '?? /absolute\0',
    '?? C:/x\0',
    '?? docs//x\0',
    '?? x\0?? x\0',
    Buffer.from([63, 63, 32, 0xff, 0]),
  ])
    assert.throws(() => parseStatus(input));
  for (const input of [
    '1\t2\tx',
    '1\t-\tx\0',
    '-1\t2\tx\0',
    '9007199254740992\t1\tx\0',
    '1\t2\t\0old\0',
    '1\t2\tx\x001\t2\tx\0',
  ])
    assert.throws(() => parseNumstat(input));
  assert.throws(() => plan([' M src/a.ts'], { unstaged: status('1\t0\tsrc/other.ts') }), {
    code: 'NUMSTAT_STATUS_MISMATCH',
  });
});

test('output, path and entry budgets fail without partial candidate groups', () => {
  assert.throws(() => parseStatus(Buffer.alloc(plannerLimits.maxBytes + 1)), { code: 'GIT_OUTPUT_LIMIT' });
  assert.throws(() => parseStatus(status(`?? ${'a'.repeat(plannerLimits.maxPathBytes + 1)}`)), {
    code: 'INVALID_GIT_PATH',
  });
  assert.throws(
    () =>
      parseStatus(
        status(...Array.from({ length: plannerLimits.maxEntries + 1 }, (_, i) => `?? docs/${i}.md`)),
      ),
    { code: 'GIT_ENTRY_LIMIT' },
  );
});

test('only four bounded read-only Git calls; hooks, text conversion, pager and index refresh disabled', async () => {
  const s = status(' M src/a.ts', '?? test/a.test.mjs');
  const mock = mockGit([s, status('1\t0\tsrc/a.ts'), '', s]);
  const p = await planScopedGitCheckpoints({ repo: '.', runGit: mock.runGit });
  assert.equal(p.candidateGroups.length, 1);
  assert.equal(mock.calls.length, 4);
  const prefix = [
    '--no-optional-locks',
    '--no-pager',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
  ];
  const statusArgs = [...prefix, 'status', '--porcelain=v1', '-uall', '-z', '--ignore-submodules=all'];
  const diffArgs = [
    ...prefix,
    'diff',
    '--numstat',
    '-z',
    '--no-ext-diff',
    '--no-textconv',
    '--no-relative',
    '--ignore-submodules=all',
  ];
  const diffPaths = [
    '--',
    ':(top,glob)**',
    ...['.local', '.tools', '.git', 'node_modules'].flatMap((name) => [
      `:(top,glob,icase,exclude)**/${name}`,
      `:(top,glob,icase,exclude)**/${name}/**`,
    ]),
  ];
  assert.deepEqual(
    mock.calls.map((c) => c.args),
    [statusArgs, [...diffArgs, ...diffPaths], [...diffArgs, '--cached', ...diffPaths], statusArgs],
  );
  for (const { options } of mock.calls) {
    assert.equal(options.env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(options.env.GIT_NO_LAZY_FETCH, '1');
    assert.equal(options.maxBuffer, plannerLimits.maxBytes);
    assert.equal(options.timeout, plannerLimits.timeoutMs);
  }
});

test('changed snapshot and failing/malformed Git stop the plan without further commands', async () => {
  const s = status('?? docs/a.md');
  const changed = mockGit([s, '', '', status('?? docs/b.md')]);
  await assert.rejects(planScopedGitCheckpoints({ runGit: changed.runGit }), {
    code: 'STATUS_CHANGED_DURING_PLAN',
  });
  const broken = mockGit(['truncated']);
  await assert.rejects(planScopedGitCheckpoints({ runGit: broken.runGit }), {
    code: 'INCOMPLETE_GIT_OUTPUT',
  });
  assert.equal(broken.calls.length, 1);
  let calls = 0;
  await assert.rejects(
    planScopedGitCheckpoints({
      runGit: async () => {
        calls++;
        throw Object.assign(new Error('PRIVATE_STDERR'), { code: 'GIT_READ_FAILED' });
      },
    }),
    { code: 'GIT_READ_FAILED' },
  );
  assert.equal(calls, 1);
});

test('milestone metadata validates exact paths and bounded labels', () => {
  for (const knownMilestones of [
    null,
    {},
    [['bad\u202eID', 'docs/x.md']],
    [['WB-1', '../x']],
    [['WB-1']],
    [['WB-1', '']],
  ])
    assert.throws(() => plan([], { knownMilestones }));
});

test('documentation candidates depend on withheld staged or historical code with the same stem', () => {
  const p = plan(['M  src/apple.ts', '?? docs/apple.md', '?? scripts/pear.mjs', '?? docs/pear.md'], {
    knownMilestones: [['PRIOR', 'scripts/pear.mjs']],
  });
  assert.deepEqual(p.candidateGroups.find((g) => g.topic === 'apple').dependsOnReviewOf, ['src/apple.ts']);
  assert.deepEqual(p.candidateGroups.find((g) => g.topic === 'pear').dependsOnReviewOf, ['scripts/pear.mjs']);
  exactPartition(p);
});

test('many copy records sharing an original retain bounded per-entry numstat metadata', () => {
  const count = 1000;
  const rows = Array.from({ length: count }, (_, i) => [`C  src/copy-${i}.ts`, 'src/original.ts']).flat();
  const stats = Array.from({ length: count }, (_, i) => [
    '1\t0\t',
    'src/original.ts',
    `src/copy-${i}.ts`,
  ]).flat();
  const p = plan(rows, { staged: status(...stats) });
  assert.equal(p.counts.statusEntries, count);
  assert.ok(p.unreviewedFiles.every((e) => e.stagedNumstat.length === 1));
  exactPartition(p);
});

async function snapshot(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    result[entry.name] = entry.isDirectory()
      ? await snapshot(full)
      : createHash('sha256')
          .update(await readFile(full))
          .digest('hex');
  }
  return result;
}

test('fixture repository, existing index/staging, config, sentinel secrets and filesystem remain byte-identical', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wb-checkpoint-readonly-'));
  await mkdir(path.join(directory, '.git'));
  await mkdir(path.join(directory, '.local'));
  await mkdir(path.join(directory, 'src'));
  await writeFile(path.join(directory, '.git', 'index'), 'EXISTING_STAGED_SPLIT_INDEX_SENTINEL');
  await writeFile(path.join(directory, '.git', 'config'), 'DO_NOT_READ_CONFIG_SECRET');
  await writeFile(path.join(directory, '.local', 'token'), 'DO_NOT_READ_TOKEN_SECRET');
  await writeFile(path.join(directory, 'src', 'a.ts'), 'DO_NOT_READ_SOURCE_SECRET');
  const before = await snapshot(directory);
  const s = status('MM src/a.ts', '?? .local/token', '?? test/a.test.mjs');
  const mock = mockGit([s, status('2\t1\tsrc/a.ts'), status('1\t0\tsrc/a.ts'), s]);
  const p = await planScopedGitCheckpoints({ repo: directory, runGit: mock.runGit });
  assert.deepEqual(await snapshot(directory), before);
  assert.equal(p.counts.stagedEntries, 1);
  assert.equal(p.candidateGroups.length, 0);
  assert.equal(serializePlan(p).includes('SECRET'), false);
  // Fixtures deliberately retained; tests perform no cleanup/deletion against user paths.
});

test('invalid CLI arguments return machine JSON without starting Git or leaking input', () => {
  const script = fileURLToPath(new URL('../scripts/plan-scoped-git-checkpoints.mjs', import.meta.url));
  for (const args of [
    ['--execute', 'PRIVATE_INPUT'],
    ['--repo'],
    ['--milestone-path', 'WB=../x'],
    ['--milestone-path', 'PRIVATE_INPUT'],
    ['--repo', '.', '--repo', '.'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PATH: '' },
    });
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      readOnly: true,
      complete: false,
      error: 'INVALID_ARGUMENTS',
    });
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.includes('PRIVATE_INPUT'), false);
  }
});
