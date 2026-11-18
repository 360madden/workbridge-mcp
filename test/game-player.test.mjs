import assert from 'node:assert/strict';
import test from 'node:test';
const { createGamePlayerDiscovery, createGamePlayerWindowSession } = await import(
  process.env.WB_GAME_PLAYER_TEST_MODULE ?? '../dist/game-player.js'
);

const response = (text) => ({ content: [{ type: 'text', text }] });
const fails = (code) => (error) => error?.code === code && !error.message.includes('private');
const fixture = (reply, overrides = {}) => {
  const calls = [];
  const session = {
    async connect() {
      calls.push('connect');
    },
    async listWindows() {
      calls.push('list_windows');
      return reply;
    },
    async close() {
      calls.push('close');
    },
    ...overrides,
  };
  return { calls, run: createGamePlayerDiscovery(() => session, 1_000, 100) };
};

test('SDK boundary pins interpreter, cwd, method and arguments, no private stderr', async () => {
  let params;
  const seen = [];
  const transport = {
    async close() {
      seen.push('transport-close');
    },
  };
  const client = {
    async connect(actual, options) {
      assert.equal(actual, transport);
      assert.ok(options.signal instanceof AbortSignal);
      seen.push('connect');
    },
    getServerVersion: () => ({ name: 'game-player' }),
    async callTool(req, options) {
      seen.push(req);
      assert.ok(options.signal instanceof AbortSignal);
      return response('no windows found');
    },
    async close() {
      seen.push('client-close');
    },
  };
  const make = () =>
    createGamePlayerWindowSession(
      () => client,
      (value) => {
        params = value;
        return transport;
      },
    );
  const result = await createGamePlayerDiscovery(make)();
  assert.deepEqual(seen, [
    'connect',
    { name: 'list_windows', arguments: {} },
    'client-close',
    'transport-close',
  ]);
  assert.equal(params.command, 'C:\\work\\game-player-mcp\\.venv\\Scripts\\python.exe');
  assert.deepEqual(params.args, ['-X', 'utf8', '-m', 'game_player_mcp']);
  assert.equal(params.cwd, 'C:\\work\\game-player-mcp');
  assert.equal(params.stderr, 'ignore');
  assert.equal(params.maxBufferSize, 128 * 1024);
  assert.deepEqual(Object.keys(params.env).sort(), [
    'PYTHONDONTWRITEBYTECODE',
    'PYTHONNOUSERSITE',
    'PYTHONSAFEPATH',
  ]);
  assert.deepEqual(result, {
    source: 'game-player-mcp',
    tool: 'list_windows',
    scope: 'host-desktop',
    format: 'display-text',
    includesWindowIds: false,
    text: 'no windows found',
    truncated: false,
  });
});

test('unexpected MCP server identity never receives a tool call', async () => {
  let invoked = 0;
  const make = () =>
    createGamePlayerWindowSession(
      () => ({
        async connect() {},
        getServerVersion: () => ({ name: 'wrong' }),
        async callTool() {
          invoked++;
        },
        async close() {},
      }),
      () => ({ async close() {} }),
    );
  await assert.rejects(createGamePlayerDiscovery(make)(), fails('GAME_PLAYER_UNAVAILABLE'));
  assert.equal(invoked, 0);
});

test('fixed-width display is sanitized without inventing IDs or trimming alignment', async () => {
  const f = fixture(response('  sample\u001b[31m title\u001b[0m\r\n* game\u202e.exe\u0000'));
  assert.equal((await f.run()).text, '  sample title\n* game.exe');
  assert.deepEqual(f.calls, ['connect', 'list_windows', 'close']);
  const long = fixture(response('x'.repeat(16_383) + '\u{1f4bb}end'));
  const result = await long.run();
  assert.equal(result.truncated, true);
  assert.equal(result.text, 'x'.repeat(16_383));
});

test('mixed, empty, oversize and upstream errors fail closed without echoing child output', async () => {
  for (const reply of [
    null,
    {},
    response('\u0001'),
    response('x'.repeat(128 * 1024 + 1)),
    { content: [{ type: 'image', data: 'private' }] },
    { content: [...response('line').content, ...response('private').content] },
  ]) {
    const f = fixture(reply);
    await assert.rejects(f.run(), fails('GAME_PLAYER_RESPONSE'));
    assert.equal(f.calls.at(-1), 'close');
  }
  await assert.rejects(
    fixture({ ...response('private'), isError: true }).run(),
    fails('GAME_PLAYER_UPSTREAM'),
  );
  const broken = fixture(null, {
    async connect() {
      throw new Error('private');
    },
  });
  await assert.rejects(broken.run(), fails('GAME_PLAYER_UNAVAILABLE'));
  assert.deepEqual(broken.calls, ['close']);
});

test('a stuck connect times out, closes once and never enumerates after cancellation', async () => {
  let resume;
  let entered = 0;
  let closed = 0;
  const f = createGamePlayerDiscovery(
    () => ({
      connect: () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
      async listWindows() {
        entered++;
        return response('unexpected');
      },
      async close() {
        closed++;
      },
    }),
    20,
    150,
  );
  await assert.rejects(f(), fails('GAME_PLAYER_TIMEOUT'));
  resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(entered, 0);
  assert.equal(closed, 1);
});

test('an unsettled shutdown blocks new sessions until it actually finishes', async () => {
  let release;
  let created = 0;
  const f = createGamePlayerDiscovery(
    () => {
      created++;
      return {
        async connect() {},
        async listWindows() {
          return response('sample');
        },
        close: () =>
          created === 1
            ? new Promise((resolve) => {
                release = resolve;
              })
            : Promise.resolve(),
      };
    },
    200,
    20,
  );
  const first = f();
  await assert.rejects(f(), fails('GAME_PLAYER_BUSY'));
  await assert.rejects(first, fails('GAME_PLAYER_CLEANUP'));
  await assert.rejects(f(), fails('GAME_PLAYER_BUSY'));
  assert.equal(created, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await f()).text, 'sample');
  assert.equal(created, 2);
});
