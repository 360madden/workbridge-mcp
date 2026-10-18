import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { Workspace } from '../dist/workspace.js';
import { overview } from '../dist/overview.js';
import { Jobs } from '../dist/jobs.js';
import { readRoots, rootsFile } from '../dist/roots-config.js';

let fixture, root, state, extra, workspace, client, transport;
const env = () => ({ ...getDefaultEnvironment(), WORKBRIDGE_ROOT: root, WORKBRIDGE_STATE_DIR: state });
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env: getDefaultEnvironment(), windowsHide: true, encoding: 'utf8' });
async function connect() {
  client = new Client({ name: 'independence-tests', version: '1' });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/server.js')],
    env: env(),
    stderr: 'pipe',
  });
  await client.connect(transport);
}
async function call(name, args = {}, error) {
  const result = await client.callTool({ name, arguments: args });
  const data = JSON.parse(result.content[0].text);
  if (error) {
    assert.ok(result.isError);
    assert.equal(data.error.code, error);
  } else {
    assert.ok(!result.isError, JSON.stringify(data));
    assert.deepEqual(data, result.structuredContent);
  }
  return data;
}
function manage(action, target, expectError) {
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'RemoteSigned',
    '-File',
    path.resolve('scripts/Manage-WorkspaceRoots.ps1'),
    '-Action',
    action,
    '-StateDirectory',
    state,
    '-PrimaryRoot',
    root,
  ];
  if (target) args.push('-Path', target);
  try {
    const output = execFileSync('powershell.exe', args, {
      windowsHide: true,
      env: env(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (expectError) assert.fail('Expected configuration error');
    return JSON.parse(output.trim());
  } catch (error) {
    if (!expectError) throw error;
    assert.match(String(error.stdout) + String(error.stderr), expectError);
    return null;
  }
}
before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'workbridge-independent-'));
  root = path.join(fixture, 'arbitrary projects ü');
  state = path.join(fixture, 'private-state');
  extra = path.join(fixture, 'another folder ü');
  for (const dir of [root, state, extra]) await mkdir(dir, { recursive: true });
  await writeFile(path.join(root, 'base.txt'), 'original root\n');
  await writeFile(path.join(extra, 'other.txt'), 'additional root\n');
  for (const group of ['one', 'two']) {
    const repo = path.join(root, group, 'same-name');
    await mkdir(path.join(repo, 'sub'), { recursive: true });
    git(repo, 'init', '--initial-branch=main');
    await writeFile(path.join(repo, 'source.py'), '# source fixture\n');
    git(repo, 'add', 'source.py');
    git(
      repo,
      '-c',
      'user.name=Independence Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Fixture',
    );
  }
  git(
    path.join(root, 'one', 'same-name'),
    'worktree',
    'add',
    '-b',
    'fixture-worktree',
    path.join(root, 'linked checkout'),
  );
  await mkdir(path.join(root, 'unborn'));
  git(path.join(root, 'unborn'), 'init', '--initial-branch=main');
  await mkdir(path.join(root, 'plain'));
  await writeFile(path.join(root, 'plain', 'notes.txt'), 'ordinary folder');
  await mkdir(path.join(root, 'node_modules', 'hidden-repo'), { recursive: true });
  git(path.join(root, 'node_modules', 'hidden-repo'), 'init');
  await writeFile(path.join(root, 'AGENTS.md'), 'Synthetic root context\n');
  await writeFile(path.join(root, 'one', 'same-name', 'AGENTS.md'), 'Synthetic selected context\n');
  await writeFile(path.join(root, 'one', 'same-name', 'sub', 'AGENTS.md'), 'Synthetic nested context\n');
  await writeFile(path.join(root, 'one', 'same-name', 'README.md'), 'Synthetic README\n');
  workspace = await Workspace.create(root);
  await connect();
});
after(async () => {
  await client?.close();
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

test('nested discovery distinguishes identical names, repositories and linked worktrees', async () => {
  const direct = await call('discover_projects');
  assert.ok(!direct.projects.some((x) => x.path === 'one/same-name'));
  assert.equal(direct.selected.kind, 'folder');
  const nested = await call('discover_projects', { recursive: true, maxDepth: 3 });
  for (const name of ['one/same-name', 'two/same-name', 'unborn'])
    assert.ok(nested.projects.some((x) => x.path === name && x.repository.kind === 'repository'));
  assert.equal(nested.projects.find((x) => x.path === 'linked checkout').repository.kind, 'worktree');
  assert.ok(!nested.projects.some((x) => x.path.includes('node_modules')));
  const selected = await call('discover_projects', { directory: 'one/same-name' });
  assert.equal(selected.selected.kind, 'repository');
  assert.equal(selected.selected.isRoot, true);
});
test('discovery bounds depth and supplies reusable continuation offsets', async () => {
  const shallow = await call('discover_projects', { recursive: true, maxDepth: 1 });
  assert.ok(!shallow.projects.some((x) => x.path === 'one/same-name'));
  const all = [];
  let offset = 0;
  for (let n = 0; n < 100; n++) {
    const page = await call('discover_projects', { recursive: true, maxDepth: 3, limit: 2, offset });
    all.push(...page.projects.map((x) => x.path));
    if (page.nextOffset === null) break;
    assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
  }
  assert.ok(all.includes('one/same-name'));
  assert.ok(all.includes('two/same-name'));
  assert.equal(new Set(all).size, all.length);
});
test('overview reports scoped instructions and repository identity without requiring history', async () => {
  const context = await call('project_overview', { project: 'one/same-name' });
  assert.deepEqual(
    context.instructionFiles.map((x) => [x.path, x.scope]).sort(),
    [
      ['AGENTS.md', 'ancestor'],
      ['one/same-name/AGENTS.md', 'selected-folder'],
      ['one/same-name/sub/AGENTS.md', 'nested-directory-only'],
    ].sort(),
  );
  assert.ok(context.documentation.includes('one/same-name/README.md'));
  assert.equal(context.repository.root, 'one/same-name');
  assert.equal((await call('project_overview', { project: 'one/same-name/sub' })).repository.isRoot, false);
  assert.equal((await call('project_overview', { project: 'unborn' })).repository.kind, 'repository');
  assert.equal((await call('project_overview', { project: 'plain' })).repository.kind, 'folder');
});
test('linked-worktree inspection and dirty/unborn Git state remain supported', async () => {
  const context = await call('project_overview', { project: 'linked checkout' });
  assert.equal(context.repository.kind, 'worktree');
  await writeFile(path.join(root, 'linked checkout', 'source.py'), '# changed\n');
  assert.match((await call('git_status', { project: 'linked checkout' })).output, /source.py/);
  assert.match((await call('git_status', { project: 'unborn' })).output, /No commits yet/);
});
test('repository metadata errors are reported without misclassifying broken markers', async () => {
  const broken = path.join(root, 'broken');
  await mkdir(broken);
  await writeFile(path.join(broken, '.git'), 'gitdir: missing');
  assert.equal((await workspace.repositoryInfo(broken)).kind, 'unavailable');
});
test('configuration input remains fail-closed and optional project acceptance requires explicit arguments', async () => {
  const absent = await readRoots(state);
  assert.deepEqual(absent.additionalRoots, []);
  await writeFile(rootsFile(state), JSON.stringify({ additionalRoots: [], unknown: true }));
  await assert.rejects(readRoots(state), (e) => e.code === 'INVALID_CONFIG');
  await rm(rootsFile(state));
  assert.throws(
    () =>
      execFileSync(process.execPath, ['scripts/acceptance-project.mjs'], {
        windowsHide: true,
        env: env(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (e) => e.status === 1 && /explicit project/.test(String(e.stderr)),
  );
});
test(
  'root manager adds, deduplicates and backs up configuration without changing project files',
  { skip: process.platform !== 'win32' },
  async () => {
    const report = manage('Add', extra);
    assert.ok(report.changed);
    assert.ok(report.restartRequired);
    assert.equal(report.primaryRoot, root);
    assert.deepEqual(report.additionalRoots, [extra]);
    const backup = JSON.parse(await readFile(report.backup, 'utf8'));
    assert.equal(backup.previousFileExisted, false);
    assert.equal(manage('Add', extra).changed, false);
    assert.equal(manage('Show').restartRequired, null);
    assert.deepEqual(manage('Validate').additionalRoots, [extra]);
    assert.equal(await readFile(path.join(extra, 'other.txt'), 'utf8'), 'additional root\n');
    await call('read_file', { path: 'base.txt' }, 'WORKSPACE_RESTART_REQUIRED');
    await client.close();
    await connect();
    assert.match((await call('read_file', { path: path.join(extra, 'other.txt') })).text, /additional root/);
  },
);
test(
  'root removal revokes access; re-add preserves durable undo targets',
  { skip: process.platform !== 'win32' },
  async () => {
    const changed = await call('write_file', {
      path: path.join(extra, 'scratch.txt'),
      content: 'scratch',
      expectedHash: null,
      operationId: 'extra-scratch',
    });
    assert.ok(changed.afterHash);
    assert.ok(manage('Remove', extra).changed);
    await call('read_file', { path: path.join(extra, 'other.txt') }, 'WORKSPACE_RESTART_REQUIRED');
    await client.close();
    await connect();
    await call('read_file', { path: path.join(extra, 'other.txt') }, 'OUTSIDE_ROOT');
    await call('undo_change', { operationId: 'extra-scratch' }, 'OUTSIDE_ROOT');
    manage('Add', extra);
    await client.close();
    await connect();
    await call('undo_change', { operationId: 'extra-scratch' });
    await assert.rejects(readFile(path.join(extra, 'scratch.txt')), { code: 'ENOENT' });
  },
);
test(
  'root manager rejects primary replacement, relative paths, private state and junction aliases',
  { skip: process.platform !== 'win32' },
  async () => {
    const before = await readFile(rootsFile(state), 'utf8');
    manage('Remove', root, /primary root is fixed/);
    manage('Add', 'relative', /absolute/);
    manage('Add', state, /private state/);
    const hiddenState = path.join(state, '..private-child');
    await mkdir(hiddenState);
    manage('Add', hiddenState, /private state/);
    const link = path.join(fixture, 'alias');
    await symlink(extra, link, 'junction');
    try {
      manage('Add', link, /junctions/);
    } finally {
      await rm(link, { recursive: true, force: true });
    }
    assert.equal(await readFile(rootsFile(state), 'utf8'), before);
  },
);
test(
  'active native command locks prevent root edits and release automatically on cancellation',
  { skip: process.platform !== 'win32' },
  async () => {
    await call('terminal_run', {
      cwd: root,
      executable: process.execPath,
      args: ['-e', 'console.log("ready");setInterval(()=>{},1000)'],
      requestId: 'root-lock-job',
      timeoutSeconds: 20,
    });
    for (let n = 0; n < 100; n++) {
      if ((await call('command_output', { jobId: 'root-lock-job' })).text.includes('ready')) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    const before = await readFile(rootsFile(state), 'utf8');
    manage('Remove', extra, /configuration is busy/);
    assert.equal(await readFile(rootsFile(state), 'utf8'), before);
    await call('command_cancel', { jobId: 'root-lock-job' });
    assert.ok(manage('Remove', extra).changed);
    await client.close();
    await connect();
  },
);
test(
  'root manager can repair unavailable additional folders while retaining legacy default paths',
  { skip: process.platform !== 'win32' },
  async () => {
    const missing = path.join(fixture, 'unavailable');
    await writeFile(rootsFile(state), JSON.stringify({ additionalRoots: [missing] }));
    manage('Validate', undefined, /ENOENT/);
    assert.ok(manage('Remove', missing).changed);
    await client.close();
    await connect();
    assert.equal((await call('read_file', { path: 'base.txt' })).path, 'base.txt');
  },
);
test(
  'worker checks the initial configuration again after acquiring its native lease',
  { skip: process.platform !== 'win32' },
  async () => {
    const isolatedWorkspace = await Workspace.create(root);
    isolatedWorkspace.configuration = { state, fingerprint: (await readRoots(state)).fingerprint };
    const jobs = new Jobs(isolatedWorkspace, state);
    try {
      // Force a configuration update between initial path validation and command-host acquisition.
      const original = isolatedWorkspace.directory.bind(isolatedWorkspace);
      isolatedWorkspace.directory = async (...args) => {
        const directory = await original(...args);
        await writeFile(rootsFile(state), JSON.stringify({ additionalRoots: [extra] }));
        return directory;
      };
      await jobs.terminal(
        root,
        process.execPath,
        ['-e', 'require("fs").writeFileSync("must-not-run.txt","bad")'],
        10,
        'config-start-race',
      );
      let status;
      for (let n = 0; n < 100; n++) {
        status = await jobs.status('config-start-race');
        if (status.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 30));
      }
      assert.equal(status.status, 'failed');
      assert.equal(status.errorCode, 'WORKSPACE_RESTART_REQUIRED');
      await assert.rejects(readFile(path.join(root, 'must-not-run.txt')), { code: 'ENOENT' });
    } finally {
      await jobs.close();
    }
  },
);

test('self profiles use the package lifecycle and preserve existing operator choices', async () => {
  const profileState = path.join(fixture, 'isolated profiles');
  await mkdir(profileState);
  const project = path.resolve('.').split(path.sep).join('/');
  const existing = { executable: process.execPath, args: ['custom-build.js'], timeoutSeconds: 30 };
  const profileFile = path.join(profileState, 'commands.json');
  await writeFile(
    profileFile,
    JSON.stringify({ projects: { [project]: { build: existing }, untouched: { custom: existing } } }),
  );
  const output = execFileSync(process.execPath, ['scripts/configure-self-commands.mjs'], {
    env: { ...env(), WORKBRIDGE_STATE_DIR: profileState },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.match(output, /Preserved differing profiles: build/);
  const configured = JSON.parse(await readFile(profileFile, 'utf8'));
  assert.deepEqual(configured.projects[project].build, existing);
  assert.deepEqual(configured.projects.untouched.custom, existing);
  for (const [name, script] of [
    ['test', 'test'],
    ['acceptance', 'acceptance'],
    ['format_check', 'format:check'],
  ]) {
    assert.equal(configured.projects[project][name].args[0], path.resolve('scripts/run-package-script.mjs'));
    assert.equal(configured.projects[project][name].args[1], script);
  }
  const installation = await Workspace.create(path.dirname(path.resolve('.')));
  const legacyKey = installation.relative(path.resolve('.'));
  const legacy = { executable: process.execPath, args: ['-e', 'console.log("legacy")'], timeoutSeconds: 10 };
  configured.projects[legacyKey] = { build: legacy };
  configured.projects[project].probe = {
    executable: process.execPath,
    args: ['-e', 'process.exit(0)'],
    timeoutSeconds: 10,
  };
  await writeFile(profileFile, JSON.stringify(configured));
  const jobs = new Jobs(installation, profileState);
  try {
    const commands = (await jobs.list(project)).commands;
    assert.deepEqual(commands.find((entry) => entry.name === 'build').args, legacy.args);
    assert.equal(commands.find((entry) => entry.name === 'test').args[1], 'test');
    await jobs.run(project, 'probe', 'absolute-profile-route');
    let status;
    for (let n = 0; n < 100; n++) {
      status = await jobs.status('absolute-profile-route');
      if (status.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(status.exitCode, 0);
  } finally {
    await jobs.close();
  }
});

test('generic acceptance removes its owned fixture after an early failure', async () => {
  const temporary = path.join(fixture, 'acceptance failure cleanup');
  const emptyPath = path.join(fixture, 'no executables');
  await mkdir(temporary);
  await mkdir(emptyPath);
  assert.throws(() =>
    execFileSync(process.execPath, ['scripts/acceptance.mjs'], {
      env: { ...env(), PATH: emptyPath, Path: emptyPath, TMP: temporary, TEMP: temporary, TMPDIR: temporary },
      windowsHide: true,
      stdio: 'pipe',
      timeout: 20000,
    }),
  );
  assert.deepEqual(await readdir(temporary), []);
});

test(
  'unchanged native self-build succeeds while its command host is running',
  { skip: process.platform !== 'win32' },
  async () => {
    const installation = await Workspace.create(path.resolve('.'));
    const jobs = new Jobs(installation, path.join(fixture, 'self-build-state'));
    try {
      await jobs.terminal(
        '.',
        process.execPath,
        [path.resolve('scripts/build-command-host.mjs')],
        20,
        'native-self-build',
      );
      let result;
      for (let n = 0; n < 200; n++) {
        result = await jobs.status('native-self-build');
        if (result.status !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      assert.equal(result.exitCode, 0, JSON.stringify(await jobs.output('native-self-build')));
      assert.match((await jobs.output('native-self-build')).text, /command host is up to date/);
    } finally {
      await jobs.close();
    }
  },
);

test(
  'native build receipts verify source and executable content',
  { skip: process.platform !== 'win32' },
  async () => {
    const installation = path.join(fixture, 'native receipt fixture');
    await mkdir(path.join(installation, 'scripts'), { recursive: true });
    await mkdir(path.join(installation, 'dist'));
    for (const file of ['build-command-host.mjs', 'Command-Host.cs', 'Tunnel-ProcessLifetime.cs'])
      await copyFile(path.join('scripts', file), path.join(installation, 'scripts', file));
    const build = () =>
      execFileSync(process.execPath, ['scripts/build-command-host.mjs'], {
        cwd: installation,
        windowsHide: true,
        encoding: 'utf8',
      });
    build();
    const stamp = path.join(installation, 'dist/command-host-build.json');
    const initial = JSON.parse(await readFile(stamp, 'utf8'));
    assert.match(build(), /up to date/);
    await writeFile(
      path.join(installation, 'scripts/Command-Host.cs'),
      (await readFile('scripts/Command-Host.cs', 'utf8')) + '\n// fixture change\n',
    );
    build();
    assert.notEqual(JSON.parse(await readFile(stamp, 'utf8')).inputs, initial.inputs);
    await writeFile(path.join(installation, 'dist/command-host.exe'), 'damaged executable');
    build();
    assert.notEqual(
      (await readFile(path.join(installation, 'dist/command-host.exe'))).toString(),
      'damaged executable',
    );
  },
);
