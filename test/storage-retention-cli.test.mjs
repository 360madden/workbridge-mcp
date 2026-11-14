import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { parseArgs, runRetention } from '../scripts/storage-retention.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex').toUpperCase();
test('CLI refuses missing maintenance, mutation aliases, and unbounded source paths', () => {
  assert.throws(() => parseArgs(['purge', '--install-root', os.tmpdir()]));
  assert.throws(() =>
    parseArgs([
      'quarantine',
      '--plan',
      path.join(os.tmpdir(), 'plan'),
      '--expect-plan-sha256',
      'a'.repeat(64),
      '--operation-id',
      'q',
    ]),
  );
  assert.throws(() =>
    parseArgs([
      'plan',
      '--install-root',
      os.tmpdir(),
      '--updater-operation',
      '../escape',
      '--kind',
      'candidate',
    ]),
  );
  assert.throws(() => parseArgs(['constructor']));
});

test(
  'full Windows CLI plan, quarantine, status and restore preserve fixture bytes',
  {
    skip: process.platform !== 'win32' || os.hostname().toUpperCase() !== 'AMD-DESKTOP',
    timeout: 180000,
  },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wb-gc-cli-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const put = async (name, data) => {
      const file = path.join(root, ...name.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
      return file;
    };
    const json = (name, value) => put(name, JSON.stringify(value));
    const files = {
      'dist/app.js': 'app',
      'node_modules/pkg/index.js': 'pkg',
      'package.json': '{}',
      'package-lock.json': '{ }',
    };
    const manifest = {
      schema: 1,
      version: 'fixture',
      files: Object.entries(files).map(([name, text]) => ({
        path: name,
        bytes: Buffer.byteLength(text),
        sha256: hash(text),
      })),
    };
    const manifestText = JSON.stringify(manifest);
    const releaseDigest = hash(manifestText);
    const release = path.join(root, '.local', 'releases', 'sealed');
    await put('.local/releases/sealed/manifest.json', manifestText);
    await json('.local/releases/sealed/validated.json', {
      schema: 1,
      version: 'fixture',
      result: 'passed',
      manifestSha256: releaseDigest,
      checks: { install: 0, tests: 0, startup: 0, updater: 0, format: 0, acceptance: 0 },
    });
    for (const [name, text] of Object.entries(files)) {
      await put(`.local/releases/sealed/payload/${name}`, text);
      await put(`.local/update-operations/old/candidate/${name}`, text);
    }
    const marker = (operationId) => ({ schema: 1, operationId, version: 'fixture', releaseDigest });
    const operations = ['old', 'previous', 'current'];
    for (const [index, operationId] of operations.entries()) {
      await json(`.local/update-operations/${operationId}/request.json`, {
        schema: 1,
        operationId,
        installRoot: root,
        action: 'Apply',
        releasePath: release,
        releaseDigest,
      });
      await json(`.local/update-operations/${operationId}/journal.json`, {
        schema: 1,
        operationId,
        installRoot: root,
        releaseDigest,
        version: 'fixture',
        previousVersion: 'fixture',
        previousRelease: index ? marker(operations[index - 1]) : null,
        phase: 'completed',
        updatedUtc: '2000-01-01T00:00:00Z',
      });
    }
    await json('.local/installed-release.json', marker('current'));
    const planFile = path.join(root, 'reviewed-plan.json');
    const planned = await runRetention(
      parseArgs([
        'plan',
        '--install-root',
        root,
        '--updater-operation',
        'old',
        '--kind',
        'candidate',
        '--output',
        planFile,
      ]),
    );
    assert.equal(planned.status, 'planned', JSON.stringify(planned));
    assert.equal(planned.mutationPerformed, false);
    const common = [
      '--expect-plan-sha256',
      planned.planSha256,
      '--operation-id',
      'fixture-q',
      '--maintenance-confirmed',
    ];
    const moved = await runRetention(parseArgs(['quarantine', '--plan', planFile, ...common]));
    assert.equal(moved.state, 'quarantined', JSON.stringify(moved));
    const state = await runRetention(
      parseArgs(['status', '--install-root', root, '--operation-id', 'fixture-q']),
    );
    assert.equal(state.state, 'quarantined');
    const archived = path.join(
      root,
      '.local',
      'storage-quarantine',
      'fixture-q',
      'payload',
      'dist',
      'app.js',
    );
    assert.equal(await readFile(archived, 'utf8'), 'app');
    const restored = await runRetention(parseArgs(['restore', '--install-root', root, ...common]));
    assert.equal(restored.state, 'restored', JSON.stringify(restored));
    assert.equal(
      await readFile(
        path.join(root, '.local', 'update-operations', 'old', 'candidate', 'dist', 'app.js'),
        'utf8',
      ),
      'app',
    );
    for (const [name, text] of Object.entries(files))
      assert.equal(await readFile(path.join(release, 'payload', name), 'utf8'), text);
  },
);
