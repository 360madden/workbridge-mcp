import assert from 'node:assert/strict';
import test from 'node:test';
import { executeReadOnly, parseRequest, DesktopUiError } from '../scripts/desktop-ui.mjs';

const win = {
  hwnd: 224466,
  processId: 9911,
  processName: 'dummyapp',
  title: 'Disposable Test Window',
  className: 'TestWindowClass',
  width: 900,
  height: 600,
  isForeground: false,
  ownerHwnd: 0,
};
function fakeWinapp({ version = '0.7.1', windows = [win], inspectHwnd = win.hwnd } = {}) {
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    if (args[0] === '--version') return version + '\n';
    if (args[0] === 'ui' && args[1] === 'list-windows') return JSON.stringify(windows);
    if (args[0] === 'ui' && args[1] === 'inspect') {
      return JSON.stringify({ windows: [{ hwnd: inspectHwnd, elements: [] }] });
    }
    throw new Error('Unexpected WinApp command: ' + args.join(' '));
  };
  return { calls, runner };
}

test('GUI-002 only accepts read-only verbs and bounded selectors', () => {
  assert.throws(
    () => parseRequest(['click', '--hwnd', '1']),
    (e) => e.code === 'INVALID_OPERATION',
  );
  assert.throws(
    () => parseRequest(['inspect', '--hwnd', '123']),
    (e) => e.code === 'INVALID_TARGET',
  );
  assert.throws(
    () => parseRequest(['inspect', '--pid', '123', '--hwnd=-1']),
    (e) => e.code === 'INVALID_TARGET',
  );
  assert.throws(
    () => parseRequest(['inspect', '--pid', '123', '--hwnd', '99', '--depth', '9']),
    (e) => e.code === 'INVALID_TARGET',
  );
  assert.throws(
    () => parseRequest(['windows', '--title', 'foo']),
    (e) => e.code === 'INVALID_ARGUMENTS',
  );
  assert.deepEqual(parseRequest(['windows', '--app', 'vmware']), { operation: 'windows', app: 'vmware' });
});

test('GUI-002 lists bounded window metadata with no mutation verbs', async () => {
  const { calls, runner } = fakeWinapp();
  const result = await executeReadOnly(parseRequest(['windows', '--app', 'dummyapp']), runner);
  assert.equal(result.readOnly, true);
  assert.equal(result.windows[0].hwnd, win.hwnd);
  assert.equal(result.windows[0].process, 'dummyapp');
  assert.deepEqual(calls[1], ['ui', 'list-windows', '-a', 'dummyapp', '--json']);
  assert.equal(calls.length, 2);
});

test('GUI-002 rechecks PID/HWND and expected identity before reading UIA', async () => {
  const { calls, runner } = fakeWinapp();
  const result = await executeReadOnly(
    parseRequest([
      'inspect',
      '--pid',
      '9911',
      '--hwnd',
      '224466',
      '--title',
      win.title,
      '--process',
      'dummyapp',
    ]),
    runner,
  );
  assert.equal(result.target.pid, 9911);
  assert.equal(result.tree.windows[0].hwnd, win.hwnd);
  assert.deepEqual(calls[1], ['ui', 'list-windows', '-a', '9911', '--json']);
  assert.deepEqual(calls[2], ['ui', 'inspect', '-w', '224466', '--depth', '2', '--json']);
});

test('GUI-002 rejects stale PID/HWND or title and does not inspect another window', async () => {
  for (const args of [
    ['inspect', '--pid', '9911', '--hwnd', '567890'],
    ['inspect', '--pid', '9911', '--hwnd', '224466', '--title', 'Changed'],
  ]) {
    const { calls, runner } = fakeWinapp();
    await assert.rejects(
      () => executeReadOnly(parseRequest(args), runner),
      (e) => e instanceof DesktopUiError && e.code === 'STALE_TARGET',
    );
    assert.equal(calls.length, 2, 'must stop before UIA inspect');
  }
});

test('GUI-002 refuses unpinned WinApp versions and invalid CLI JSON', async () => {
  await assert.rejects(
    () => executeReadOnly(parseRequest(['windows']), fakeWinapp({ version: '0.8.0' }).runner),
    (e) => e.code === 'UNSUPPORTED_WINAPP_VERSION',
  );
  const runner = async (args) => (args[0] === '--version' ? '0.7.1' : 'not json');
  await assert.rejects(
    () => executeReadOnly(parseRequest(['windows']), runner),
    (e) => e.code === 'INVALID_WINAPP_JSON',
  );
});
