import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createTwoFilesPatch } from 'diff';
import { Workspace } from '../dist/workspace.js';
import { TaskContext, taskContextResultSchema } from '../dist/context.js';
import { Workflows } from '../dist/workflows.js';
import { Patches } from '../dist/patches.js';
import { Jobs } from '../dist/jobs.js';
import { Serial, digest } from '../dist/changes.js';
import { limits } from '../dist/core.js';

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'wb-context-'));
  const root = path.join(home, 'Workspace ü'),
    state = path.join(root, '.state');
  await mkdir(path.join(root, 'Project space/src'), { recursive: true });
  await mkdir(state);
  const workspace = await Workspace.create(root);
  workspace.protect(state);
  const patches = new Patches(workspace, path.join(state, 'patches'), new Serial());
  const workflows = new Workflows(
    workspace,
    path.join(state, 'workflows'),
    patches,
    new Jobs(workspace, state),
  );
  const context = new TaskContext(workspace, workflows);
  const put = async (p, text) => {
    await mkdir(path.dirname(path.join(root, p)), { recursive: true });
    await writeFile(path.join(root, p), text);
  };
  t.after(async () => {
    assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(home, { recursive: true, force: true });
  });
  return { root, state, workspace, patches, workflows, context, put, project: 'Project space' };
}
const only = {
  includeOverview: false,
  includeInstructions: false,
  includeDocuments: false,
  includeWorkflows: false,
};
async function all(context, args) {
  const pages = [];
  let offset = 0,
    expectedPlanHash;
  for (let i = 0; i < 150; i++) {
    const page = await context.collect({ ...args, offset, expectedPlanHash });
    taskContextResultSchema.parse(page);
    assert.ok(JSON.stringify(page).length <= 60000);
    pages.push(page);
    if (page.nextOffset === null) return { pages, sections: pages.flatMap((p) => p.sections) };
    assert.ok(page.nextOffset > offset, 'context paging must progress');
    offset = page.nextOffset;
    expectedPlanHash = page.planHash;
  }
  assert.fail('context did not end');
}
test('scoped instructions, root documents, source and tests retain hashes without executing scripts', async (t) => {
  const f = await fixture(t);
  await f.put('AGENTS.md', 'ancestor instruction\n');
  await f.put('Project space/AGENTS.md', 'project instruction\n');
  await f.put('Project space/src/AGENTS.md', 'source instruction\n');
  await f.put('Project space/sibling/AGENTS.md', 'unrelated instruction\n');
  await f.put('Project space/README.md', 'README evidence\n');
  await f.put(
    'Project space/package.json',
    JSON.stringify({ scripts: { test: 'node -e "throw Error(123)"' } }),
  );
  await f.put('Project space/src/code.ts', 'function calculate() {return 2}\n');
  await f.put('Project space/tests/code.test.ts', 'test calculate\n');
  const a = {
    project: f.project,
    files: [{ path: 'Project space/src/code.ts' }, { path: 'Project space/tests/code.test.ts' }],
  };
  const result = await all(f.context, a);
  const instructions = result.sections.filter((s) => s.kind === 'instruction');
  assert.deepEqual(
    instructions.map((s) => s.request.arguments.path),
    ['AGENTS.md', 'Project space/AGENTS.md', 'Project space/src/AGENTS.md'],
  );
  assert.deepEqual(
    instructions.map((s) => s.scope),
    ['.', 'Project space', 'Project space/src'],
  );
  assert.ok(result.sections.some((s) => s.kind === 'document' && s.result.text.includes('README evidence')));
  for (const s of result.sections.filter((s) => ['source', 'document', 'instruction'].includes(s.kind)))
    assert.equal(s.result.sha256, digest(await readFile(path.join(f.root, s.result.path))));
  assert.ok(result.sections.every((s) => s.ok));
  assert.equal((await f.workflows.list({ offset: 0, limit: 10, scanLimit: 100 })).workflows.length, 0);
});
test('context pages preserve order and reject altered selections or new instruction paths', async (t) => {
  const f = await fixture(t);
  await f.put('Project space/README.md', 'original\n');
  await f.put('Project space/src/a.txt', 'a\nb\n');
  const args = { project: f.project, files: [{ path: 'Project space/src/a.txt' }], limit: 1 };
  const result = await all(f.context, args);
  assert.ok(result.pages.length > 1);
  assert.deepEqual(
    result.sections.map((s) => s.index),
    result.sections.map((_, i) => i),
  );
  const first = result.pages[0];
  await assert.rejects(f.context.collect({ ...args, offset: 1 }), { code: 'CONTEXT_PLAN_REQUIRED' });
  await assert.rejects(
    f.context.collect({ ...args, offset: 1, expectedPlanHash: first.planHash, files: [] }),
    { code: 'CONTEXT_PLAN_CHANGED' },
  );
  await f.put('Project space/src/AGENTS.md', 'new scope\n');
  await assert.rejects(f.context.collect({ ...args, offset: 1, expectedPlanHash: first.planHash }), {
    code: 'CONTEXT_PLAN_CHANGED',
  });
  const fresh = await all(f.context, args);
  assert.ok(fresh.sections.some((s) => s.kind === 'instruction'));
});
test('content changes preserve selection identity but return fresh hashes and reject stale read cursors', async (t) => {
  const f = await fixture(t);
  await f.put('Project space/src/a.txt', 'one\ntwo\nthree\n');
  const args = { ...only, project: f.project, files: [{ path: 'Project space/src/a.txt', lineCount: 1 }] };
  const first = await f.context.collect(args),
    s = first.sections[0];
  assert.ok(s.result.cursor);
  assert.equal(s.followUp.tool, 'read_file');
  const second = await f.workspace.read(s.followUp.arguments.path, 1, 1, s.followUp.arguments.cursor);
  assert.ok(second.text.includes('two'));
  assert.equal(second.startLine, 2);
  await f.put('Project space/src/a.txt', 'changed\nsecond changed\n');
  const fresh = await f.context.collect({ ...args, expectedPlanHash: first.planHash });
  assert.notEqual(fresh.sections[0].result.sha256, s.result.sha256);
  await assert.rejects(f.workspace.read(s.followUp.arguments.path, 1, 1, s.followUp.arguments.cursor), {
    code: 'FILE_CHANGED',
  });
});
test('literal search finds test references with bounded pagination and actionable source reads', async (t) => {
  const f = await fixture(t);
  const dir = path.join(f.root, f.project);
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: dir, windowsHide: true, stdio: 'pipe' });
  await f.put('Project space/.gitignore', 'ignored/*.test.ts\n');
  for (const p of ['tests/a.test.ts', 'tests/b.test.ts', 'node_modules/skip.test.ts', 'ignored/skip.test.ts'])
    await f.put('Project space/' + p, 'header\ncalculate(value)\nfooter\n');
  const result = await f.context.collect({
    ...only,
    project: f.project,
    searches: [{ query: 'calculate(', glob: ['tests/**/*.test.ts'], limit: 1 }],
  });
  const item = result.sections[0];
  assert.equal(item.result.matches.length, 1);
  assert.equal(item.result.matches[0].path, 'Project space/tests/a.test.ts');
  assert.equal(item.followUp.arguments.offset, 1);
  assert.equal(item.suggestedReads[0].tool, 'read_file');
  const next = await import('../dist/search.js').then((m) => m.search(f.workspace, item.followUp.arguments));
  assert.equal(next.matches[0].path, 'Project space/tests/b.test.ts');
  assert.equal(next.nextOffset, null);
  assert.equal(item.result.matches[0].sha256, undefined);
  const explicit = await f.context.collect({
    ...only,
    project: f.project,
    searches: [{ query: 'calculate(', glob: ['**/*.test.ts'] }],
  });
  assert.ok(explicit.sections[0].result.matches.every((m) => !m.path.includes('node_modules')));
  assert.ok(explicit.sections[0].result.matches.some((m) => m.path.includes('ignored/')));
  const defaults = await f.context.collect({
    ...only,
    project: f.project,
    searches: [{ query: 'calculate(' }],
  });
  assert.ok(
    defaults.sections[0].result.matches.every(
      (m) => !m.path.includes('ignored/') && !m.path.includes('node_modules'),
    ),
  );
});
test('missing, sibling-project and protected source errors preserve valid sections', async (t) => {
  const f = await fixture(t);
  await f.put('Project space/src/a.txt', 'safe\n');
  await f.put('Other/private.txt', 'other\n');
  await f.put('.state/secret.txt', 'private\n');
  f.workspace.protect(path.join(f.root, 'Project space/protected'));
  await f.put('Project space/protected/secret.txt', 'private\n');
  const result = await f.context.collect({
    ...only,
    project: f.project,
    files: [
      { path: 'Project space/src/a.txt' },
      { path: 'Project space/missing.txt' },
      { path: 'Other/private.txt' },
      { path: 'Project space/protected/secret.txt' },
    ],
  });
  assert.equal(result.hasErrors, true);
  assert.equal(result.sections[0].ok, true);
  assert.deepEqual(
    result.sections.slice(1).map((s) => s.error.code),
    ['ENOENT', 'OUTSIDE_PROJECT', 'PROTECTED_PATH'],
  );
  assert.ok(!JSON.stringify(result).includes('other\\n'));
  assert.ok(!JSON.stringify(result).includes('private\\n'));
});
test('junctions are refused for source files and discovered instructions', async (t) => {
  const f = await fixture(t);
  await f.put('Other/AGENTS.md', 'do not read\n');
  await f.put('Other/a.txt', 'private\n');
  await symlink(path.join(f.root, 'Other'), path.join(f.root, 'Project space/link'), 'junction');
  const r = await f.context.collect({
    ...only,
    includeInstructions: true,
    project: f.project,
    files: [{ path: 'Project space/link/a.txt' }],
  });
  assert.equal(r.sections.find((s) => s.kind === 'source').error.code, 'LINK_NOT_ALLOWED');
  await symlink(path.join(f.root, 'Other'), path.join(f.root, 'Project space/AGENTS.md'), 'junction');
  const next = await f.context.collect({ ...only, includeInstructions: true, project: f.project });
  assert.equal(next.sections[0].kind, 'instruction');
  assert.equal(next.sections[0].error.code, 'LINK_NOT_ALLOWED');
});
test('UTF16 and additional roots preserve reusable absolute paths and raw-byte hashes', async (t) => {
  const f = await fixture(t);
  const other = path.join(path.dirname(f.root), 'Second ü');
  await mkdir(other);
  const bytes = Buffer.concat([Buffer.from([255, 254]), Buffer.from('unicode café\r\nnext', 'utf16le')]);
  await writeFile(path.join(other, 'a.cs'), bytes);
  const ws = await Workspace.create(f.root, [other]);
  const c = new TaskContext(ws, f.workflows);
  const r = await c.collect({
    ...only,
    project: other,
    files: [{ path: path.join(other, 'a.cs'), lineCount: 1 }],
  });
  assert.equal(r.sections[0].result.sha256, digest(bytes));
  assert.equal(r.sections[0].result.encoding, 'utf-16le');
  assert.ok(path.isAbsolute(r.sections[0].result.path));
});
test('large editable-boundary files return excerpts without invented hashes', async (t) => {
  const f = await fixture(t);
  await f.put(
    'Project space/large.txt',
    Buffer.concat([Buffer.from('first\n'), Buffer.alloc(17 * 1024 * 1024, 97)]),
  );
  const r = await f.context.collect({
    ...only,
    project: f.project,
    files: [{ path: 'Project space/large.txt', lineCount: 1 }],
  });
  assert.equal(r.sections[0].ok, true);
  assert.equal(r.sections[0].result.sha256, null);
  assert.ok(r.sections[0].followUp);
});
test('escaped response budgets page without skips and oversized sections fail with direct follow-up', async (t) => {
  const f = await fixture(t);
  for (const name of ['a', 'b', 'c']) await f.put('Project space/' + name + '.txt', '"'.repeat(16000) + '\n');
  const r = await all(f.context, {
    ...only,
    project: f.project,
    files: ['a', 'b', 'c'].map((n) => ({ path: 'Project space/' + n + '.txt' })),
  });
  assert.equal(r.sections.length, 3);
  assert.ok(r.pages.length >= 2);
  assert.ok(r.sections.every((s) => s.ok));
  await f.put('Project space/big.txt', '"'.repeat(45000) + '\n');
  const oversized = await f.context.collect({
    ...only,
    project: f.project,
    files: [{ path: 'Project space/big.txt' }, { path: 'Project space/a.txt' }],
  });
  assert.equal(oversized.sections[0].error.code, 'CONTEXT_ITEM_LIMIT');
  assert.equal(oversized.sections[0].followUp.tool, 'read_file');
  assert.equal(oversized.hasErrors, true);
  assert.equal(oversized.outputLimitReached, true);
  assert.equal(oversized.nextOffset, null);
  assert.equal(oversized.sections[1].ok, true);
});
test('instruction discovery, request size, invalid offsets and search failures stay explicit', async (t) => {
  const f = await fixture(t);
  const nested = 'Project space/' + Array(65).fill('d').join('/');
  await f.put(nested + '/a.txt', 'a');
  await assert.rejects(
    f.context.collect({
      ...only,
      includeInstructions: true,
      project: f.project,
      files: [{ path: nested + '/a.txt' }],
    }),
    { code: 'CONTEXT_DISCOVERY_LIMIT' },
  );
  await assert.rejects(
    f.context.collect({ project: f.project, files: Array(20).fill({ path: 'x'.repeat(3000) }) }),
    { code: 'CONTEXT_REQUEST_LIMIT' },
  );
  const base = await f.context.collect({ ...only, project: f.project });
  await assert.rejects(
    f.context.collect({ ...only, project: f.project, offset: 1, expectedPlanHash: base.planHash }),
    { code: 'INVALID_OFFSET' },
  );
  const bad = await f.context.collect({
    ...only,
    project: f.project,
    searches: [{ query: '[', regex: true }],
  });
  assert.equal(bad.hasErrors, true);
  assert.equal(bad.sections[0].error.code, 'SEARCH_ERROR');
});
test('time budget is checked between sections and provides a resumable section offset', async (t) => {
  const f = await fixture(t);
  await f.put('Project space/a.txt', 'a');
  const original = f.workspace.read.bind(f.workspace);
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  f.workspace.read = async (...args) => {
    const r = await original(...args);
    clock += limits.scanMs + 1;
    return r;
  };
  const result = await f.context.collect({
    ...only,
    project: f.project,
    files: [{ path: 'Project space/a.txt' }, { path: 'Project space/a.txt' }],
  });
  assert.equal(result.timeLimitReached, true);
  assert.equal(result.nextOffset, 1);
  assert.equal(result.sections.length, 1);
});
test('workflow context discovers exact-project patch IDs without launching validation', async (t) => {
  const f = await fixture(t);
  await f.put('Project space/a.txt', 'before\n');
  await f.patches.apply('context-patch', [
    {
      path: 'Project space/a.txt',
      expectedHash: digest('before\n'),
      patch: createTwoFilesPatch('a/Project space/a.txt', 'b/Project space/a.txt', 'before\n', 'after\n'),
    },
  ]);
  await f.workflows.create({
    workflowId: 'context-flow',
    title: 'fixture',
    project: f.project,
    patchOperationId: 'context-patch',
    inputs: [],
    checks: [
      {
        name: 'never run',
        kind: 'terminal',
        executable: process.execPath,
        args: ['-e', 'process.exit(99)'],
        timeoutSeconds: 10,
      },
    ],
  });
  const result = await f.context.collect({ ...only, includeWorkflows: true, project: f.project });
  assert.equal(result.sections[0].result.workflows[0].patchOperationId, 'context-patch');
  assert.equal(result.sections[0].result.workflows[0].recordedState, 'pending');
  assert.equal((await f.workflows.status('context-flow')).steps[0].attempts.length, 0);
  await writeFile(path.join(f.state, 'workflows/broken.json'), '{');
  const broken = await f.context.collect({ ...only, includeWorkflows: true, project: f.project });
  assert.equal(broken.hasErrors, true);
  assert.equal(broken.sections[0].error.code, 'CONTEXT_CATALOG_ISSUES');
  assert.equal(broken.sections[0].result.workflows[0].workflowId, 'context-flow');
  assert.equal(broken.sections[0].result.issues[0].workflowId, 'broken');
});
test('binary instructions and clipped instruction pages stay visible beside good source context', async (t) => {
  const f = await fixture(t);
  await f.put('AGENTS.md', Buffer.from([0, 1, 2]));
  await f.put(
    'Project space/AGENTS.md',
    Array.from({ length: 140 }, (_, i) => 'instruction ' + i).join('\n'),
  );
  await f.put('Project space/src/a.txt', 'source\n');
  const result = await f.context.collect({
    ...only,
    includeInstructions: true,
    project: f.project,
    files: [{ path: 'Project space/src/a.txt' }],
  });
  assert.equal(result.hasErrors, true);
  assert.equal(result.sections[0].error.code, 'NOT_TEXT');
  const instructions = result.sections[1];
  assert.equal(instructions.result.truncated, true);
  assert.ok(instructions.followUp.arguments.cursor);
  assert.equal(result.sections[2].result.sha256, digest('source\n'));
});
