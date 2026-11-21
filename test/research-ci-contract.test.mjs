import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('GitHub Windows CI includes research changes and exercises portable two-provider fixtures', async () => {
  const workflow = await readFile(new URL('../.github/workflows/build-test.yml', import.meta.url), 'utf8');
  assert.match(workflow, /runs-on: windows-2025/);
  assert.match(workflow, /node-version: '24'/);
  assert.match(workflow, /- 'integrations\/\*\*'/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /node --test test\/\*\.test\.mjs/);
  assert.match(workflow, /node --test integrations\/research\/test\/\*\.test\.mjs/);
  assert.match(workflow, /stage-research-runtime\.mjs --verify --repo-root \./);
  assert.match(workflow, /WB-001 runs/);
  // Hosted CI cannot substitute for the full host-specific release gate.
  assert.doesNotMatch(workflow, /run: npm test\b/);
});

test('benchmark and synthetic adapter tests are covered by the research CI glob', async () => {
  const benchmark = await readFile(
    new URL('../integrations/research/test/benchmark.test.mjs', import.meta.url),
    'utf8',
  );
  const star = await readFile(
    new URL('../integrations/research/test/starwrath.test.mjs', import.meta.url),
    'utf8',
  );
  const rift = await readFile(new URL('../integrations/research/test/run.test.mjs', import.meta.url), 'utf8');
  assert.match(benchmark, /benchmarkSavedPackage/);
  assert.match(star, /starwrath\.snapshot-audit/);
  assert.match(rift, /generic coordinator executes validated DAG/);
});
