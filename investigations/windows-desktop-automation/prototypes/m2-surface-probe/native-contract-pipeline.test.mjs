import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assessDesktopProbeNativeSurface, nativeSurfaceSnapshotSchema } from './native-surface-snapshot.mjs';

// This test requires a prior isolated dotnet build. It runs ONLY the synthetic
// contract/self-test command branches; it never opens a window or calls --snapshot.
const here = fileURLToPath(new URL('.', import.meta.url));
const assembly = join(here, 'bin', 'Release', 'net10.0-windows', 'M2SurfaceProbe.dll');
const expected = {
  pid: 100,
  hwnd: 123456,
  sessionId: 2,
  processStartedAt: '2026-11-06T10:00:00.000Z',
};

function invoke(...args) {
  assert.equal(existsSync(assembly), true, 'Build the isolated M2SurfaceProbe project first');
  const run = spawnSync('dotnet', [assembly, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 16000,
    windowsHide: true,
  });
  if (run.error) throw run.error;
  assert.equal(run.stderr, '');
  const lines = run.stdout.trim().split(/\r?\n/u);
  assert.equal(lines.length, 1, 'Expected exactly one bounded JSON response line');
  return { exit: run.status, payload: JSON.parse(lines[0]) };
}

test('real .NET serializer produces a strictly valid M2 raw JSON envelope', () => {
  const { exit, payload } = invoke('--contract-fixture');
  assert.equal(exit, 0);
  const validated = nativeSurfaceSnapshotSchema.safeParse(payload);
  assert.equal(validated.success, true, JSON.stringify(validated.error?.issues));
  assert.deepEqual(payload.sample.clientRect, { x: -290, y: 140, width: 700, height: 410 });
  assert.equal(payload.target.processStartedAt, '2026-11-06T10:00:00.0000000Z');
  assert.equal(payload.status, 'OBSERVED_NOT_VERIFIED');
  const assessment = assessDesktopProbeNativeSurface(payload, expected);
  assert.equal(assessment.status, 'UNKNOWN');
  assert.equal(assessment.code, 'NATIVE_SNAPSHOT_ONLY');
  assert.equal(assessment.authorizesAction, false);
  assert.equal(assessment.retryAllowed, false);
});

test('real .NET synthetic self-test is successful without native desktop access', () => {
  const { exit, payload } = invoke('--self-test');
  assert.equal(exit, 0);
  assert.equal(payload.status, 'PASS');
  assert.equal(payload.noNativeCall, true);
  assert.equal(payload.inputInjected, false);
});

test('unsupported input request exits before reaching any native observer path', () => {
  const { exit, payload } = invoke('--click');
  assert.equal(exit, 2);
  assert.equal(payload.status, 'UNKNOWN');
  assert.equal(payload.code, 'INVALID_OR_UNAPPROVED_ARGUMENTS');
  assert.equal(payload.inputInjected, false);
  assert.equal(payload.actionAuthorized, false);
});
