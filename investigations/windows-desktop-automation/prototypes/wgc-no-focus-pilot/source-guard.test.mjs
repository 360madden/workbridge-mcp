import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const source = readFileSync(new URL('./Program.cs', import.meta.url), 'utf8');
const project = readFileSync(new URL('./WgcNoFocusPilot.csproj', import.meta.url), 'utf8');
// This pilot intentionally has no block comments; remove one-line comments so
// documentation about forbidden APIs is not mistaken for a call.
const executableSource = source.replace(/\/\/[^\r\n]*/g, '');

test('direct Microsoft WinApp 0.7.1 WGC-only API is pinned', () => {
  assert.match(project, /Microsoft\.Windows\.SDK\.BuildTools\.WinApp\.UIAutomation" Version="0\.7\.1"/);
  assert.match(project, /net10\.0-windows10\.0\.19041\.0/);
  assert.match(executableSource, /capture\.StartFrameGrabber\(window\.Handle/);
  assert.match(executableSource, /WaitForFirstFrameAsync\(/);
  assert.match(executableSource, /TryGetLatest\(/);
  assert.doesNotMatch(executableSource, /RootCaptureBackend|CaptureWindowPixels/);
});

test('all external target HWND/PID capture is unavailable', () => {
  assert.match(executableSource, /"--capture-disposable"/);
  assert.match(executableSource, /new DisposableTestWindow\(/);
  assert.doesNotMatch(executableSource, /args\[[^\]]+\].*(?:--hwnd|--pid)/);
  assert.doesNotMatch(executableSource, /GetWindowThreadProcessId\s*\(/);
  assert.doesNotMatch(executableSource, /FindWindow\s*\(/);
});

test('no explicit focus, input, picker, PrintWindow or GDI fallback API calls', () => {
  const forbidden = [
    'SetForegroundWindow', 'ShowWindow', 'SetFocus', 'PrintWindow', 'BitBlt',
    'CaptureWindowPixels', 'SendInput', 'mouse_event', 'keybd_event',
    'SetWindowPos', 'SetActiveWindow', 'SetWindowPlacement', 'WindowPicker',
  ];
  for (const api of forbidden) {
    assert.doesNotMatch(
      executableSource,
      new RegExp('\\b' + api + '\\s*\\(', 'i'),
      `unexpected explicit ${api} call`,
    );
  }
  const nativeImports = Array.from(
    executableSource.matchAll(/extern\s+\w+\s+(\w+)\s*\(/g),
    m => m[1],
  );
  assert.deepEqual(nativeImports, ['GetForegroundWindow']);
});

test('no GUI/capture code path in --self-test branch', () => {
  const selfStart = executableSource.indexOf('args[0] == "--self-test"');
  const disposableStart = executableSource.indexOf('args[0] == "--capture-disposable"');
  assert.ok(selfStart >= 0 && disposableStart > selfStart);
  const segment = executableSource.substring(selfStart, disposableStart);
  assert.match(segment, /SelfTest\.Run\(\)/);
  assert.doesNotMatch(segment, /Application\.|new DisposableTestWindow|StartFrameGrabber/);
});
