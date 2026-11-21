import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('..', import.meta.url));
const staged = join(repo, '.tools', 'research-m4-isolated-dist', 'research-registration.js');
const normal = join(repo, 'dist', 'research-registration.js');
const candidate = existsSync(staged) ? staged : normal;
const { createResearchFacade, registerResearchTools } = await import(pathToFileURL(candidate).href);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'wb-research-m4-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'workbridge-mcp');
  const companionRoot = join(project, 'integrations', 'research');
  const sourceFile = join(companionRoot, 'src', 'cli.mjs');
  const planPath = join(project, 'plans', 'selected.json');
  await mkdir(dirname(sourceFile), { recursive: true });
  await mkdir(dirname(planPath), { recursive: true });
  await mkdir(join(project, '.tools'), { recursive: true });
  await writeFile(sourceFile, '// approved isolated dummy CLI\n');
  await writeFile(planPath, '{}\n');
  const calls = [];
  const job = {
    id: 'research-facade-test-0001',
    project: relative(root, companionRoot).replaceAll('\\', '/'),
    command: process.execPath,
    status: 'passed',
    completionPending: false,
    startedAt: '2026-11-20T23:40:00.000Z',
    exitCode: 0,
  };
  const workspace = {
    root,
    directory: async (input) => {
      if (!existsSync(input)) throw new Error('missing directory: ' + input);
      return input;
    },
    resolve: async (input) => {
      if (!existsSync(input)) throw new Error('missing source: ' + input);
      return input;
    },
    relative: (input) => relative(root, input).replaceAll('\\', '/'),
  };
  const jobs = {
    terminal: async (cwd, executable, args, timeoutSeconds, requestId) => {
      calls.push({ cwd, executable, args, timeoutSeconds, requestId });
      return { ...job, id: requestId, project: workspace.relative(cwd), status: 'running' };
    },
    status: async (_jobId) => job,
  };
  return { root, project, companionRoot, sourceFile, planPath, workspace, jobs, job, calls };
}

test('plan uses a fixed Node executable and approved planner subcommand via existing jobs', async (t) => {
  const f = await fixture(t);
  const facade = createResearchFacade(f);
  const result = await facade.plan({ planPath: f.planPath, requestId: 'plan-request-0001' });
  assert.equal(result.id, 'plan-request-0001');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].executable, process.execPath);
  assert.equal(f.calls[0].cwd, f.companionRoot);
  assert.deepEqual(f.calls[0].args, [f.sourceFile, 'plan', '--plan', f.planPath]);
  assert.equal(f.calls[0].timeoutSeconds, 40);
});

test('run can only select one bounded output identifier below ignored .tools', async (t) => {
  const f = await fixture(t);
  const facade = createResearchFacade(f);
  await facade.run({ planPath: f.planPath, runId: 'rift-session-001', requestId: 'run-request-0001' });
  assert.equal(f.calls[0].timeoutSeconds, 600);
  assert.deepEqual(f.calls[0].args, [
    f.sourceFile,
    'run',
    '--plan',
    f.planPath,
    '--out',
    join(f.project, '.tools', 'research-runs', 'rift-session-001'),
  ]);
  assert.equal(existsSync(join(f.project, '.tools', 'research-runs')), true);
});

test('invalid run identifiers reject without launching any job', async (t) => {
  const f = await fixture(t);
  const facade = createResearchFacade(f);
  for (const runId of ['../escape', 'x', '\\\\server\\share', 'RIFTSESSION01', 'test/../../x']) {
    await assert.rejects(
      () => facade.run({ planPath: f.planPath, runId, requestId: 'reject-request-0001' }),
      (error) => error.code === 'RESEARCH_RUN_ID',
    );
  }
  assert.equal(f.calls.length, 0);
});

test('verify is fixed to a validated run ID; cannot read an arbitrary bundle', async (t) => {
  const f = await fixture(t);
  const facade = createResearchFacade(f);
  await facade.run({ planPath: f.planPath, runId: 'rift-session-001', requestId: 'run-request-0001' });
  await facade.verify({ runId: 'rift-session-001', requestId: 'verify-request-0001' });
  assert.deepEqual(f.calls[1].args, [
    f.sourceFile,
    'verify',
    '--bundle',
    join(f.project, '.tools', 'research-runs', 'rift-session-001'),
  ]);
  assert.equal(f.calls[1].timeoutSeconds, 90);
});

test('status returns only a job scoped to the research companion', async (t) => {
  const f = await fixture(t);
  const facade = createResearchFacade(f);
  const result = await facade.status({ jobId: f.job.id });
  assert.equal(result.researchScopeVerified, true);
  const foreign = createResearchFacade({
    ...f,
    jobs: { ...f.jobs, status: async () => ({ ...f.job, project: 'other-repository' }) },
  });
  await assert.rejects(
    () => foreign.status({ jobId: f.job.id }),
    (error) => error.code === 'RESEARCH_JOB_SCOPE',
  );
});

test('shutdown state rejects all research job starts', async (t) => {
  const f = await fixture(t);
  const facade = createResearchFacade({ ...f, isClosing: () => true });
  await assert.rejects(
    () => facade.plan({ planPath: f.planPath, requestId: 'close-test-0001' }),
    (error) => error.code === 'SERVER_CLOSING',
  );
  assert.equal(f.calls.length, 0);
});

test('MCP facade registers only four named typed research operations', async (t) => {
  const f = await fixture(t);
  const registered = new Map();
  const server = {
    registerTool: (name, config, action) => registered.set(name, { config, action }),
  };
  registerResearchTools(server, f);
  assert.deepEqual(
    [...registered.keys()],
    ['research_plan', 'research_run', 'research_status', 'research_verify'],
  );
  const tool = registered.get('research_plan');
  const result = await tool.action({ planPath: f.planPath, requestId: 'tool-plan-0001' });
  assert.equal(result.structuredContent.id, 'tool-plan-0001');
  assert.equal(tool.config.annotations.openWorldHint, false);
  assert.equal(tool.config.inputSchema.safeParse({ planPath: f.planPath, requestId: 'x' }).success, true);
  assert.equal(
    registered.get('research_run').config.inputSchema.safeParse({
      planPath: f.planPath,
      runId: '../escape',
      requestId: 'test-id',
    }).success,
    false,
  );
});
