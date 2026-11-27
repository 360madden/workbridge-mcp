import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RESEARCH_RUNTIME_FILES,
  RESEARCH_RUNTIME_MANIFEST,
  stageResearchRuntime,
  verifyResearchRuntime,
} from '../scripts/stage-research-runtime.mjs';

async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'wb-stage-recovery-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const source = (rel) =>
    rel === 'support/desktop-ui.mjs'
      ? path.join(repoRoot, 'scripts', 'desktop-ui.mjs')
      : path.join(repoRoot, 'integrations', ...rel.split('/'));
  const destination = path.join(repoRoot, 'dist', 'research-runtime');
  const staged = (rel) => path.join(destination, ...rel.split('/'));
  for (const rel of RESEARCH_RUNTIME_FILES) {
    await mkdir(path.dirname(source(rel)), { recursive: true });
    await writeFile(source(rel), `fixture: ${rel}\n`);
  }
  return { repoRoot, source, staged, destination };
}

test('a late destination obstruction is rejected before invalidating the old marker', async (t) => {
  const { repoRoot, source, staged } = await fixture(t);
  await stageResearchRuntime({ repoRoot });
  const first = RESEARCH_RUNTIME_FILES[0];
  const last = RESEARCH_RUNTIME_FILES.at(-1);
  const marker = staged(RESEARCH_RUNTIME_MANIFEST);
  const original = await readFile(staged(first));
  const oldMarker = await readFile(marker);
  await writeFile(source(first), 'new release contents\n');
  await unlink(staged(last));
  await mkdir(staged(last));
  await assert.rejects(stageResearchRuntime({ repoRoot }), { code: 'RESEARCH_STAGE_UNSAFE_DESTINATION' });
  assert.deepEqual(await readFile(marker), oldMarker);
  assert.deepEqual(await readFile(staged(first)), original);
});

test('an interrupted stage repairs missing and corrupt files without rewriting correct files', async (t) => {
  const { repoRoot, source, staged } = await fixture(t);
  const initial = await stageResearchRuntime({ repoRoot });
  const [keep, corrupt, missing] = RESEARCH_RUNTIME_FILES;
  await unlink(staged(RESEARCH_RUNTIME_MANIFEST));
  const damaged = await readFile(staged(corrupt));
  damaged[0] ^= 1; // Same length, wrong hash: size-only checks cannot detect it.
  await writeFile(staged(corrupt), damaged);
  await unlink(staged(missing));
  const fixedTime = new Date('2020-01-01T00:00:00Z');
  await utimes(staged(keep), fixedTime, fixedTime);
  const before = await stat(staged(keep));
  const recovered = await stageResearchRuntime({ repoRoot });
  assert.equal(recovered.status, 'staged');
  assert.equal(recovered.manifestSha256, initial.manifestSha256);
  assert.equal((await stat(staged(keep))).mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(staged(corrupt)), await readFile(source(corrupt)));
  assert.deepEqual(await readFile(staged(missing)), await readFile(source(missing)));
  assert.equal((await verifyResearchRuntime({ repoRoot })).verified, true);
});

test('a redirected destination directory is rejected before any staged writes', async (t) => {
  const { repoRoot, destination } = await fixture(t);
  const redirected = path.join(repoRoot, 'redirected');
  await mkdir(redirected);
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(redirected, destination, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageResearchRuntime({ repoRoot }), { code: 'RESEARCH_STAGE_UNSAFE_DESTINATION' });
  await assert.rejects(stat(path.join(redirected, RESEARCH_RUNTIME_MANIFEST)), { code: 'ENOENT' });
});
