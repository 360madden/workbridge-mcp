import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const execute = promisify(execFile),
  repo = path.resolve('.');
const maxBytes = 4 * 1024 * 1024;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
let suite,
  sequence = 0;
const owners = [];
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-input-consistency-'));
});
after(async () => {
  await Promise.all(owners.map((client) => client.close()));
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
const batch = (content = 'A') => [
  {
    tool: 'write_file',
    arguments: { operationId: 'original-write', path: 'effect.txt', content, expectedHash: null },
  },
];
async function fixture(bytes = Buffer.from(JSON.stringify(batch()))) {
  const home = path.join(suite, String(sequence++)),
    root = path.join(home, 'Workspace ü');
  await fs.mkdir(root, { recursive: true });
  const input = path.join(home, 'requests ü.json'),
    state = path.join(home, 'State');
  await fs.writeFile(input, bytes);
  await fs.writeFile(path.join(root, 'keep.txt'), 'preserve this\n');
  return { home, root, input, state };
}
async function instrument(f, mode) {
  const script = path.join(f.home, 'reader.mjs'),
    observation = path.join(f.home, 'reader-observation.json');
  // Only this disposable CLI caller is instrumented, not its owner or the installed service.
  await fs.writeFile(
    script,
    `
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const input = ${JSON.stringify(f.input)}, mode = ${JSON.stringify(mode)}, observation = ${JSON.stringify(observation)};
const originalOpen = fs.open;
fs.open = async function(name, ...rest) {
  const handle = await originalOpen.call(this, name, ...rest);
  if (path.resolve(String(name)) !== input) return handle;
  const originalStat = handle.stat.bind(handle), originalRead = handle.read.bind(handle), originalClose = handle.close.bind(handle);
  let first, changed = false, stats = 0, readCalls = 0, maximumReadBuffer = 0;
  async function mutate() {
    if (changed) return;
    changed = true;
    const milliseconds = Number(first.mtimeMs);
    if (mode.startsWith('grow')) await fs.appendFile(input, ' EXTRA_BYTES_MUST_NOT_BE_IGNORED');
    else if (mode.startsWith('rewrite')) {
      await fs.writeFile(input, ${JSON.stringify(JSON.stringify(batch('B')))});
      await fs.utimes(input, new Date(milliseconds), new Date(milliseconds + 5000));
    } else if (mode === 'replace-after-stat') {
      await fs.rename(input, input + '.original');
      await fs.writeFile(input, ${JSON.stringify(JSON.stringify(batch('B')))});
      await fs.utimes(input, new Date(milliseconds), new Date(milliseconds));
    } else if (mode === 'remove-after-read') await fs.unlink(input);
    else if (mode === 'shrink-after-stat') await fs.truncate(input, 8);
    else if (mode === 'touch-after-stat') await fs.utimes(input, new Date(milliseconds), new Date(milliseconds + 5000));
  }
  handle.stat = async function(...args) {
    const result = await originalStat(...args);
    stats++;
    if (!first) {
      first = result;
      if (mode.endsWith('after-stat')) await mutate();
    }
    return result;
  };
  handle.read = async function(...args) {
    readCalls++;
    maximumReadBuffer = Math.max(maximumReadBuffer, args[0].length);
    if (mode === 'zero-progress') return { bytesRead: 0, buffer: args[0] };
    if (mode === 'short-chunks') args[2] = Math.min(args[2], 7);
    const result = await originalRead(...args);
    if (result.bytesRead && mode.endsWith('after-read')) await mutate();
    return result;
  };
  handle.close = async function() {
    await originalClose();
    await fs.writeFile(observation, JSON.stringify({ mode, changed, stats, readCalls, maximumReadBuffer, closed: true }), { flag: 'wx' });
  };
  return handle;
};
syncBuiltinESMExports();
`,
    { flag: 'wx' },
  );
  return { preload: pathToFileURL(script).href, observation };
}
async function cli(f, { gate, expected = 0, connected = false } = {}) {
  const args = [
    ...(gate ? ['--import', gate.preload] : []),
    path.join(repo, 'scripts/workbridge-cli.mjs'),
    '--root',
    f.root,
    ...(connected ? ['--service-state', f.state] : ['--state-dir', f.state]),
    '--input',
    f.input,
    '--timeout',
    '15',
    '--json',
  ];
  let raw;
  try {
    raw = {
      exitCode: 0,
      ...(await execute(process.execPath, args, {
        cwd: repo,
        windowsHide: true,
        timeout: 25000,
        maxBuffer: 4 * 1024 * 1024,
      })),
    };
  } catch (error) {
    raw = { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
  assert.equal(raw.exitCode, expected, JSON.stringify(raw));
  const rows = raw.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (!expected)
    assert.ok(
      rows.every((row) => row.ok),
      JSON.stringify(rows),
    );
  return { rows, observation: gate ? JSON.parse(await fs.readFile(gate.observation, 'utf8')) : null };
}
async function rejected(f, result, connected = false) {
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].ok, false);
  assert.equal(result.rows[0].error.code, 'INVALID_INPUT');
  assert.equal(Object.hasOwn(result.rows[0].error, 'requestContext'), false);
  await assert.rejects(fs.access(path.join(f.root, 'effect.txt')), (error) => error.code === 'ENOENT');
  if (!connected) await assert.rejects(fs.access(f.state), (error) => error.code === 'ENOENT');
  assert.equal(await fs.readFile(path.join(f.root, 'keep.txt'), 'utf8'), 'preserve this\n');
  if (result.observation) assert.equal(result.observation.closed, true);
}

for (const mode of [
  'grow-after-stat',
  'grow-after-read',
  'rewrite-after-stat',
  'rewrite-after-read',
  'replace-after-stat',
  'remove-after-read',
  'touch-after-stat',
]) {
  test(mode + ' is refused before owner creation or any batch write', async () => {
    const f = await fixture(),
      gate = await instrument(f, mode);
    const result = await cli(f, { gate, expected: 2 });
    await rejected(f, result);
    assert.equal(result.observation.changed, true);
    if (mode.startsWith('rewrite') || mode.startsWith('replace'))
      assert.deepEqual(JSON.parse(await fs.readFile(f.input, 'utf8')), batch('B'));
  });
}
for (const mode of ['shrink-after-stat', 'zero-progress']) {
  test(mode + ' cannot execute a partial request array', async () => {
    const f = await fixture(),
      gate = await instrument(f, mode);
    await rejected(f, await cli(f, { gate, expected: 2 }));
  });
}
test('stable input tolerates legitimate short read chunks without rewriting the source file', async () => {
  const f = await fixture(),
    gate = await instrument(f, 'short-chunks'),
    before = sha(await fs.readFile(f.input));
  const result = await cli(f, { gate });
  assert.equal(await fs.readFile(path.join(f.root, 'effect.txt'), 'utf8'), 'A');
  assert.equal(sha(await fs.readFile(f.input)), before);
  assert.ok(result.observation.readCalls > 2);
  assert.equal(result.observation.closed, true);
});
test('stable exactly-4-MiB request is accepted, bounded, and byte-preserving', async () => {
  const request = JSON.stringify(batch()),
    f = await fixture(Buffer.from(request + ' '.repeat(maxBytes - Buffer.byteLength(request))));
  const before = sha(await fs.readFile(f.input)),
    gate = await instrument(f, 'observe');
  const result = await cli(f, { gate });
  assert.equal(await fs.readFile(path.join(f.root, 'effect.txt'), 'utf8'), 'A');
  assert.ok(result.observation.maximumReadBuffer <= maxBytes + 1);
  assert.equal(result.observation.closed, true);
  assert.equal(sha(await fs.readFile(f.input)), before);
});
test('over-4-MiB input is refused before allocating a read buffer or creating state', async () => {
  const f = await fixture(Buffer.alloc(maxBytes + 1, 32)),
    gate = await instrument(f, 'observe');
  const result = await cli(f, { gate, expected: 2 });
  await rejected(f, result);
  assert.equal(result.observation.readCalls, 0);
  assert.equal(result.observation.maximumReadBuffer, 0);
});
test('UTF-8 BOM and Unicode request content remain supported', async () => {
  const content = 'Hello ü — 世界\n',
    f = await fixture(Buffer.from('\uFEFF' + JSON.stringify(batch(content))));
  await cli(f);
  assert.equal(await fs.readFile(path.join(f.root, 'effect.txt'), 'utf8'), content);
});
test('invalid UTF-8 is refused before any side effect', async () => {
  const f = await fixture(Buffer.concat([Buffer.from(JSON.stringify(batch())), Buffer.from([0xff])]));
  await rejected(f, await cli(f, { expected: 2 }));
});
for (const [name, value] of [
  ['empty', []],
  ['over-100-steps', Array.from({ length: 101 }, () => ({ tool: 'workspace_info' }))],
  ['invalid-later-step', [...batch(), { bad: true }]],
]) {
  test(name + ' structural input is rejected as a whole batch', async () => {
    const f = await fixture(Buffer.from(JSON.stringify(value)));
    await rejected(f, await cli(f, { expected: 2 }));
  });
}
test('stable 100-step request is accepted without changing the input file', async () => {
  const f = await fixture(
    Buffer.from(JSON.stringify(Array.from({ length: 100 }, () => ({ tool: 'workspace_info' })))),
  );
  const before = sha(await fs.readFile(f.input)),
    result = await cli(f);
  assert.equal(result.rows.length, 100);
  assert.equal(sha(await fs.readFile(f.input)), before);
});
test('connected owner stays available and its history unchanged when a growing input is refused', async () => {
  const f = await fixture();
  await fs.mkdir(f.state);
  const owner = new Client({ name: 'input-consistency-fixture', version: '1' });
  owners.push(owner);
  await owner.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repo, 'dist/server.js')],
      cwd: repo,
      stderr: 'pipe',
      env: {
        ...process.env,
        WORKBRIDGE_ROOT: f.root,
        WORKBRIDGE_STATE_DIR: f.state,
        WORKBRIDGE_LOCAL_CLI: '1',
      },
    }),
  );
  async function call(name) {
    const response = await owner.callTool({ name, arguments: {} });
    assert.equal(Boolean(response.isError), false);
    return response.structuredContent ?? JSON.parse(response.content[0].text);
  }
  const before = await call('workspace_info'),
    beforeChanges = await call('change_list');
  const gate = await instrument(f, 'grow-after-stat');
  await rejected(f, await cli(f, { gate, expected: 2, connected: true }), true);
  assert.equal((await call('workspace_info')).localCli.instanceId, before.localCli.instanceId);
  assert.deepEqual(await call('change_list'), beforeChanges);
});
