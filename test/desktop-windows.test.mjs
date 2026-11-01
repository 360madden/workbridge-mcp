import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopInspect, desktopWindows } from '../dist/desktop-windows.js';
import { parseRequest } from '../scripts/desktop-ui.mjs';

const target = { pid: 9911, hwnd: 224466, process: 'dummyapp' };

function fakeRunner(result = { ok: true, readOnly: true, windows: [] }) {
  const calls = [];
  const runner = async (script, args, options) => {
    calls.push({ script, args, options });
    return result;
  };
  return { calls, runner, result };
}

test('GUI-006 discovery maps only bounded read-only windows arguments', async () => {
  for (const app of [undefined, 'vmware', '-app with spaces', 'a'.repeat(100)]) {
    const f = fakeRunner();
    assert.equal(await desktopWindows(app, f.runner), f.result);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0], {
      script: 'desktop-ui.mjs',
      args: app === undefined ? ['windows'] : ['windows', `--app=${app}`],
      options: { timeoutMs: 45000, maxOutputBytes: 512 * 1024 },
    });
    assert.deepEqual(parseRequest(f.calls[0].args), { operation: 'windows', app: app ?? null });
  }
});

test('GUI-006 inspection maps mandatory identity, exact title and depth to the existing CLI', async () => {
  for (const depth of [undefined, 1, 2, 3, 4]) {
    const f = fakeRunner({ ok: true, readOnly: true, target, tree: { windows: [] } });
    const title = '-Disposable Test Window = exact';
    assert.equal(await desktopInspect({ ...target, title, depth }, f.runner), f.result);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0], {
      script: 'desktop-ui.mjs',
      args: [
        'inspect',
        '--pid',
        '9911',
        '--hwnd',
        '224466',
        '--process=dummyapp',
        '--depth',
        String(depth ?? 2),
        `--title=${title}`,
      ],
      options: { timeoutMs: 45000, maxOutputBytes: 512 * 1024 },
    });
    assert.deepEqual(parseRequest(f.calls[0].args), {
      operation: 'inspect',
      ...target,
      title,
      depth: depth ?? 2,
    });
  }
  const f = fakeRunner();
  await desktopInspect({ pid: 0x7fffffff, hwnd: Number.MAX_SAFE_INTEGER, process: 'x'.repeat(80) }, f.runner);
  assert.equal(parseRequest(f.calls[0].args).title, null);
  assert.equal(parseRequest(f.calls[0].args).hwnd, Number.MAX_SAFE_INTEGER);
});

test('GUI-006 invalid app filters are rejected before any runner call', async () => {
  for (const app of [null, 1, {}, '', ' ', 'a'.repeat(101), 'a\nb', 'a\rb', 'a\0b', 'a\tb', '\x7f']) {
    const f = fakeRunner();
    await assert.rejects(desktopWindows(app, f.runner), { code: 'INVALID_ARGUMENTS' });
    assert.equal(f.calls.length, 0);
  }
});

test('GUI-006 PID/HWND and depth must be numeric positive safe integers within backend limits', async () => {
  for (const field of ['pid', 'hwnd', 'depth']) {
    const values = [undefined, null, '1', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
    if (field === 'pid') values.push(0x80000000);
    if (field === 'depth') values.push(5);
    for (const value of values) {
      if (field === 'depth' && value === undefined) continue;
      const f = fakeRunner();
      await assert.rejects(desktopInspect({ ...target, [field]: value }, f.runner), {
        code: 'INVALID_TARGET',
      });
      assert.equal(f.calls.length, 0);
    }
  }
  for (const value of [undefined, null, [], 1, 'target']) {
    const f = fakeRunner();
    await assert.rejects(desktopInspect(value, f.runner), { code: 'INVALID_TARGET' });
    assert.equal(f.calls.length, 0);
  }
});

test('GUI-006 process identity is mandatory and title guards remain bounded and exact', async () => {
  for (const process of [undefined, null, 1, '', ' ', 'a'.repeat(81), 'dummy app', 'a/b', 'a\nb', 'a\0b']) {
    const f = fakeRunner();
    await assert.rejects(desktopInspect({ ...target, process }, f.runner), { code: 'INVALID_ARGUMENTS' });
    assert.equal(f.calls.length, 0);
  }
  for (const title of [null, 1, '', ' ', 'x'.repeat(201), 'a\nb', 'a\rb', 'a\0b', '\x7f']) {
    const f = fakeRunner();
    await assert.rejects(desktopInspect({ ...target, title }, f.runner), { code: 'INVALID_ARGUMENTS' });
    assert.equal(f.calls.length, 0);
  }
  const f = fakeRunner();
  await desktopInspect({ ...target, process: 'Dummy-App_1.exe', title: 'x'.repeat(200) }, f.runner);
  assert.equal(parseRequest(f.calls[0].args).title.length, 200);
  assert.equal(parseRequest(f.calls[0].args).process, 'Dummy-App_1.exe');
});

test('GUI-006 propagates typed stale-target and backend failures without retry or input', async () => {
  for (const code of ['STALE_TARGET', 'WINAPP_TIMEOUT', 'WINAPP_NOT_INSTALLED']) {
    const error = Object.assign(new Error('Sanitized backend failure'), { code });
    for (const invoke of [
      (runner) => desktopWindows('vmware', runner),
      (runner) => desktopInspect(target, runner),
    ]) {
      let calls = 0;
      await assert.rejects(
        invoke(async () => {
          calls++;
          throw error;
        }),
        (caught) => caught === error,
      );
      assert.equal(calls, 1);
    }
  }
});

test('GUI-006 response bound also rejects oversized UTF-8 metadata from an injected runner', async () => {
  for (const invoke of [
    (runner) => desktopWindows(undefined, runner),
    (runner) => desktopInspect(target, runner),
  ]) {
    const f = fakeRunner({ ok: true, tree: '\u00e9'.repeat(256 * 1024) });
    await assert.rejects(invoke(f.runner), { code: 'OUTPUT_TOO_LARGE' });
    assert.equal(f.calls.length, 1);
  }
});
