import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RESEARCH_RUNTIME_FILES,
  RESEARCH_RUNTIME_MANIFEST,
  verifyResearchRuntime,
} from '../scripts/stage-research-runtime.mjs';

test('runtime verification rejects malformed entries with a stable error code', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'wb-manifest-'));
  try {
    const destination = path.join(repoRoot, 'dist', 'research-runtime');
    await mkdir(destination, { recursive: true });
    const records = RESEARCH_RUNTIME_FILES.map((file) => ({
      path: file,
      sha256: 'a'.repeat(64),
      bytes: 1,
    }));
    // Invalid records must fail before staged files are opened.
    for (const invalid of [
      null,
      42,
      [],
      { ...records[0], sha256: ['a'.repeat(64)] },
    ]) {
      await writeFile(
        path.join(destination, RESEARCH_RUNTIME_MANIFEST),
        JSON.stringify({ schemaVersion: 1, files: [invalid, ...records.slice(1)] }),
      );
      await assert.rejects(
        verifyResearchRuntime({ repoRoot }),
        { code: 'RESEARCH_STAGE_MANIFEST_INVALID' },
      );
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
