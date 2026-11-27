import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { RESEARCH_RUNTIME_FILES } from '../scripts/stage-research-runtime.mjs';

const script = fileURLToPath(new URL('../scripts/stage-research-runtime.mjs', import.meta.url));
const run = (args) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
};

test('runtime CLI rejects invalid arguments before staging files', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'wb-stage-cli-'));
  try {
    for (const args of [
      ['--verfiy', '--repo-root', repoRoot],
      ['--verify', '--verify', '--repo-root', repoRoot],
      ['--repo-root', repoRoot, '--repo-root', repoRoot],
      ['--repo-root'],
      ['--repo-root', '--verify'],
      ['--repo-root', ''],
      ['--repo-root', repoRoot, 'unexpected'],
    ]) {
      const result = run(args);
      assert.equal(result.status, 2, JSON.stringify(args));
      assert.equal(result.stdout, '');
      assert.deepEqual(JSON.parse(result.stderr), { code: 'RESEARCH_STAGE_ARGUMENTS' });
    }
    await assert.rejects(access(path.join(repoRoot, 'dist')), { code: 'ENOENT' });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('runtime CLI stages fixtures and verifies them in either flag order', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'wb-stage-order-'));
  try {
    for (const rel of RESEARCH_RUNTIME_FILES) {
      const file = rel === 'support/desktop-ui.mjs'
        ? path.join(repoRoot, 'scripts', 'desktop-ui.mjs')
        : path.join(repoRoot, 'integrations', ...rel.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `fixture: ${rel}\n`);
    }
    const staged = run(['--repo-root', repoRoot]);
    assert.equal(staged.status, 0, staged.stderr);
    const first = JSON.parse(staged.stdout);
    assert.equal(first.status, 'staged');
    assert.equal(first.fileCount, RESEARCH_RUNTIME_FILES.length);
    for (const args of [
      ['--verify', '--repo-root', repoRoot],
      ['--repo-root', repoRoot, '--verify'],
    ]) {
      const result = run(args);
      assert.equal(result.status, 0, result.stderr);
      const verified = JSON.parse(result.stdout);
      assert.equal(verified.verified, true);
      assert.equal(verified.manifestSha256, first.manifestSha256);
    }
    const again = run(['--repo-root', repoRoot]);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(again.stdout).status, 'unchanged');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
