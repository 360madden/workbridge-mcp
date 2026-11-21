import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runResearch, verifyResearchRun } from '../../research/src/run.mjs';

const HOST = 'AMD-DESKTOP';
const sum = (value) => createHash('sha256').update(value).digest('hex');

// Host-specific integration: the real RIFT doctor uses sibling RPT source in C:\work.
// It stays in WB-001's complete suite, never the portable GitHub research glob.
test('a minimal real RIFT doctor workflow reuses existing native file identity code', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wb-research-run-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const planFile = join(root, 'plan.json');
  const outputDir = join(root, 'run');
  const pe = Buffer.alloc(1024);
  pe.write('MZ', 0, 'ascii');
  pe.writeUInt32LE(0x80, 0x3c);
  pe.write('PE\0\0', 0x80, 'ascii');
  pe.writeUInt16LE(0x8664, 0x84);
  pe.writeUInt16LE(1, 0x86);
  pe.writeUInt16LE(0xf0, 0x94);
  pe.writeUInt16LE(0x20b, 0x98);
  const client = join(root, 'rift_x64.exe');
  await writeFile(client, pe);
  await writeFile(
    planFile,
    JSON.stringify({
      schema: 'workbridge.research-plan.v1',
      planId: 'rift-doctor-fixture',
      expectedHost: HOST,
      profile: 'rift.offline.v1',
      inputs: { client: { path: client, sha256: sum(pe) } },
      steps: [{ id: 'identify', action: 'rift.doctor', needs: [] }],
    }),
  );
  const result = await runResearch({ planFile, outputDir, host: HOST });
  assert.equal(result.bundleVerified, true);
  assert.deepEqual(result.actions, ['rift.doctor']);
  assert.equal((await verifyResearchRun(outputDir)).verified, true);
  const observed = JSON.parse(await readFile(join(outputDir, 'steps', 'identify', 'result.json')));
  assert.equal(observed.result.client.sha256, sum(pe));
  assert.equal(observed.result.gameContacted, false);
});
