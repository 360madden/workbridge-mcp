import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDesktopPrototypeInvoker,
  DesktopPrototypeError,
  invokeDesktopPrototype,
} from '../src/desktop-cli-runner.ts';

function fixture(respond = (child) => child.emit('close', 0, null)) {
  const calls = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kills: [],
    unrefs: 0,
    kill(signal) {
      this.kills.push(signal);
      return true;
    },
    unref() {
      this.unrefs++;
    },
  });
  const invoke = createDesktopPrototypeInvoker((...args) => {
    calls.push(args);
    queueMicrotask(() => respond(child));
    return child;
  });
  return { invoke, calls, child };
}

const fails =
  (code, interruptedBy = undefined) =>
  (error) => {
    assert.ok(error instanceof DesktopPrototypeError);
    assert.equal(error.code, code);
    assert.equal(error.interruptedBy, interruptedBy);
    assert.doesNotMatch(JSON.stringify(error) + error.message + error.stack, /PRIVATE_SENTINEL/);
    assert.equal(error.cause, undefined);
    return true;
  };

test('all four allowlisted scripts use runner siblings and safe Node spawn options', async () => {
  assert.equal(typeof invokeDesktopPrototype, 'function');
  for (const script of [
    'desktop-ui.mjs',
    'desktop-capture.mjs',
    'vmware-host-capture.mjs',
    'desktop-probe-act.mjs',
  ]) {
    const f = fixture((child) => {
      child.stdout.write('{"ok":true,"value":"bounded"}\n');
      child.emit('close', 0, null);
    });
    const args = ['--title', 'spaces & $(PRIVATE_SENTINEL); `literal`'];
    assert.deepEqual(await f.invoke(script, args), { ok: true, value: 'bounded' });
    const [executable, argv, options] = f.calls[0];
    assert.equal(executable, process.execPath);
    // Source imports resolve beside src; compilation preserves the same URLs beside dist.
    assert.deepEqual(argv, [fileURLToPath(new URL(`../src/${script}`, import.meta.url)), ...args]);
    assert.equal(options.cwd, fileURLToPath(new URL('..', import.meta.url)));
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(f.child.kills.length, 0);
    assert.ok(
      !Object.keys(options.env).some((key) => ['NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase())),
    );
  }
});

test('rejects arbitrary paths, invalid argv and out-of-bound execution options before spawning', async () => {
  const f = fixture();
  for (const [script, args, options] of [
    ['../scripts/desktop-ui.mjs', []],
    ['C:\\PRIVATE_SENTINEL.mjs', []],
    ['constructor', []],
    ['__proto__', []],
    ['desktop-ui.mjs', 'windows'],
    ['desktop-ui.mjs', [null]],
    ['desktop-ui.mjs', Array(1)],
    ['desktop-ui.mjs', ['bad\0argument']],
    ['desktop-ui.mjs', ['x'.repeat(8193)]],
    ['desktop-ui.mjs', Array(65).fill('x')],
    ['desktop-ui.mjs', Array(3).fill('x'.repeat(8192))],
    ...[0, 999, 45001, NaN, Infinity, 1000.5, '1000'].map((timeoutMs) => [
      'desktop-ui.mjs',
      [],
      { timeoutMs },
    ]),
    ...[0, -1, 1048577, Infinity, 1.5, '100'].map((maxOutputBytes) => [
      'desktop-ui.mjs',
      [],
      { maxOutputBytes },
    ]),
  ]) {
    await assert.rejects(f.invoke(script, args, options), fails('DESKTOP_INVALID_ARGUMENTS'));
  }
  assert.equal(f.calls.length, 0);
});

test('accepts split UTF-8 JSON and counts bytes without corrupting multibyte text', async () => {
  const raw = Buffer.from('{"ok":true,"text":"café ☃"}\n');
  const f = fixture((child) => {
    for (const byte of raw) child.stdout.write(Buffer.from([byte]));
    child.emit('close', 0, null);
  });
  assert.deepEqual(await f.invoke('desktop-ui.mjs', [], { maxOutputBytes: raw.length }), {
    ok: true,
    text: 'café ☃',
  });
});

test('ambient Node overrides and credentials are not passed to a prototype', async (t) => {
  for (const key of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'CONTROL_PLANE_API_KEY',
    'WORKBRIDGE_LOCAL_TOKEN',
    'GITHUB_TOKEN',
    'PROBE_SECRET',
  ]) {
    const original = process.env[key];
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
    process.env[key] = 'PRIVATE_SENTINEL';
  }
  const f = fixture((child) => {
    child.stdout.write('{"ok":true}');
    child.emit('close', 0, null);
  });
  await f.invoke('desktop-ui.mjs', []);
  for (const key of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'CONTROL_PLANE_API_KEY',
    'WORKBRIDGE_LOCAL_TOKEN',
    'GITHUB_TOKEN',
    'PROBE_SECRET',
  ]) {
    assert.equal(f.calls[0][2].env[key], undefined);
  }
  assert.ok(
    Object.entries(f.calls[0][2].env).some(
      ([name, value]) => name.toLowerCase() === 'path' && typeof value === 'string',
    ),
  );
});

test('rejects non-JSON, malformed envelopes, failed envelopes and invalid UTF-8 without raw diagnostics', async () => {
  for (const raw of [
    '',
    'PRIVATE_SENTINEL',
    'null',
    '[]',
    'true',
    '{}',
    '{"ok":1}',
    '{"ok":false,"error":{"message":"PRIVATE_SENTINEL"}}',
    '{"ok":true,"error":{"message":"PRIVATE_SENTINEL"}}',
    '{"ok":true}\n{"ok":true}',
    Buffer.concat([Buffer.from('{"ok":true,"value":"'), Buffer.from([0xff]), Buffer.from('"}')]),
  ]) {
    const f = fixture((child) => {
      child.stdout.write(raw);
      child.stderr.write('PRIVATE_SENTINEL');
      child.emit('close', 0, null);
    });
    await assert.rejects(
      f.invoke('desktop-ui.mjs', []),
      fails('DESKTOP_TREE_UNSETTLED', 'DESKTOP_INVALID_RESPONSE'),
    );
  }
});

test('never accepts ok=true when exit status or signal reports process failure', async () => {
  for (const [exitCode, signal] of [
    [1, null],
    [null, 'SIGTERM'],
    [0, 'SIGTERM'],
    [null, null],
  ]) {
    const f = fixture((child) => {
      child.stdout.write('{"ok":true}');
      child.stderr.write('PRIVATE_SENTINEL');
      child.emit('close', exitCode, signal);
    });
    await assert.rejects(
      f.invoke('desktop-capture.mjs', []),
      fails('DESKTOP_TREE_UNSETTLED', 'DESKTOP_PROCESS_FAILED'),
    );
  }
});

test('nested WinApp timeout cannot be mistaken for a settled wrapper failure', async () => {
  const f = fixture((child) => {
    child.stdout.write('{"ok":false,"error":{"code":"WINAPP_TIMEOUT"}}');
    child.emit('close', 1, null);
  });
  await assert.rejects(
    f.invoke('desktop-capture.mjs', []),
    fails('DESKTOP_TREE_UNSETTLED', 'DESKTOP_PROCESS_FAILED'),
  );
  assert.deepEqual(f.child.kills, []);
});

test('sanitizes synchronous and asynchronous launch failures and stream failures', async () => {
  const sync = createDesktopPrototypeInvoker(() => {
    throw new Error('PRIVATE_SENTINEL');
  });
  await assert.rejects(sync('desktop-ui.mjs', []), fails('DESKTOP_LAUNCH_FAILED'));
  for (const stream of ['child', 'stdout', 'stderr']) {
    const f = fixture((child) => {
      (stream === 'child' ? child : child[stream]).emit('error', new Error('PRIVATE_SENTINEL'));
    });
    await assert.rejects(
      f.invoke('desktop-ui.mjs', []),
      fails(
        stream === 'child' ? 'DESKTOP_LAUNCH_FAILED' : 'DESKTOP_TREE_UNSETTLED',
        stream === 'child' ? undefined : 'DESKTOP_PROCESS_FAILED',
      ),
    );
    assert.deepEqual(f.child.kills, stream === 'child' ? [] : ['SIGKILL']);
  }
});

test('an asynchronous launch error after PID assignment quarantines the unknown tree', async () => {
  const f = fixture((child) => {
    child.pid = 43210;
    child.emit('error', new Error('PRIVATE_SENTINEL'));
  });
  await assert.rejects(
    f.invoke('desktop-ui.mjs', []),
    fails('DESKTOP_TREE_UNSETTLED', 'DESKTOP_LAUNCH_FAILED'),
  );
  assert.deepEqual(f.child.kills, ['SIGKILL']);
  assert.equal(f.child.unrefs, 1);
});

test('bounds stdout and stderr together, kills once, and discards late success and errors', async () => {
  for (const stream of ['stdout', 'stderr', 'combined']) {
    const f = fixture((child) => {
      if (stream === 'combined') {
        child.stdout.write('12345678');
        child.stderr.write('12345678');
      } else child[stream].write('PRIVATE_SENTINEL');
      child.emit('close', 0, null);
      child.emit('error', new Error('PRIVATE_SENTINEL'));
    });
    await assert.rejects(
      f.invoke('desktop-ui.mjs', [], { maxOutputBytes: 15 }),
      fails('DESKTOP_TREE_UNSETTLED', 'DESKTOP_OUTPUT_LIMIT'),
    );
    assert.deepEqual(f.child.kills, ['SIGKILL']);
    assert.equal(f.child.unrefs, 1);
    assert.ok(f.child.stdout.destroyed && f.child.stderr.destroyed);
  }
});

test('timeout settles and cleans up even if the child never closes or kill throws', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const killThrows of [false, true]) {
    const f = fixture(() => {});
    if (killThrows)
      f.child.kill = () => {
        throw new Error('PRIVATE_SENTINEL');
      };
    const pending = f.invoke('desktop-probe-act.mjs', [], { timeoutMs: 1000 });
    const rejected = assert.rejects(pending, fails('DESKTOP_TREE_UNSETTLED', 'DESKTOP_TIMEOUT'));
    t.mock.timers.tick(1000);
    await rejected;
    assert.equal(f.child.unrefs, 1);
    assert.ok(f.child.stdout.destroyed && f.child.stderr.destroyed);
    f.child.emit('close', 0, null);
    f.child.emit('error', new Error('PRIVATE_SENTINEL'));
  }
});

test('default and maximum deadlines are bounded, and success cancels the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const options of [undefined, { timeoutMs: 45000, maxOutputBytes: 1048576 }]) {
    const f = fixture(() => {});
    const pending = f.invoke('desktop-ui.mjs', [], options);
    t.mock.timers.tick(44999);
    assert.equal(f.child.kills.length, 0);
    f.child.stdout.write('{"ok":true}');
    f.child.emit('close', 0, null);
    assert.deepEqual(await pending, { ok: true });
    t.mock.timers.tick(1);
    assert.equal(f.child.kills.length, 0);
  }
});

test('real Node child transport works using an injected inline synthetic program only', async () => {
  const invoke = createDesktopPrototypeInvoker((executable, _args, options) =>
    spawn(
      executable,
      [
        '--input-type=module',
        '-e',
        'process.stdin.on("end",()=>process.stdout.write(JSON.stringify({ok:true,stdinClosed:true})));process.stdin.resume();',
      ],
      options,
    ),
  );
  assert.deepEqual(await invoke('desktop-ui.mjs', [], { timeoutMs: 1000 }), { ok: true, stdinClosed: true });
});

test('deadline terminates a real injected synthetic Node child', { timeout: 5000 }, async () => {
  let child;
  let closed;
  const invoke = createDesktopPrototypeInvoker((executable, _args, options) => {
    child = spawn(executable, ['-e', 'setInterval(()=>{},1000)'], options);
    closed = once(child, 'close');
    return child;
  });
  await assert.rejects(
    invoke('desktop-ui.mjs', [], { timeoutMs: 1000 }),
    fails('DESKTOP_TREE_UNSETTLED', 'DESKTOP_TIMEOUT'),
  );
  await closed;
  assert.equal(child.killed, true);
  assert.notEqual(child.signalCode, null);
});
