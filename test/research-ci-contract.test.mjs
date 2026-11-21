import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('GitHub Windows CI includes research changes and exercises portable two-provider fixtures', async () => {
  const workflow = await readFile(new URL('../.github/workflows/build-test.yml', import.meta.url), 'utf8');
  assert.match(workflow, /runs-on: windows-2025/);
  // Windows-hosted tests require one canonical temp path; a RUNNER~1 alias
  // otherwise differs from fs.realpath() and invalidates scoped root fixtures.
  assert.match(workflow, /TMPDIR=\$env:RUNNER_TEMP/);
  assert.match(workflow, /TMP=\$env:RUNNER_TEMP/);
  assert.match(workflow, /TEMP=\$env:RUNNER_TEMP/);
  assert.match(workflow, /\$env:GITHUB_ENV/);
  assert.match(workflow, /Set canonical Windows fixture temp/);
  assert.match(workflow, /Verify canonical temporary fixture root/);
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

test('WB-001 carries the CI workflow into its isolated full-test payload', async () => {
  const updater = await readFile(new URL('../scripts/Workbridge-Update.ps1', import.meta.url), 'utf8');
  const builder = await readFile(new URL('../scripts/New-WorkbridgeRelease.ps1', import.meta.url), 'utf8');
  assert.match(updater, /\$script:WBSourceNames\s*=\s*@\([^\r\n]*'\.github'/);
  assert.match(builder, /foreach\s*\(\$name in \$script:WBSourceNames\)/);
  // The workflow is validation source, not part of the activated runtime.
  assert.doesNotMatch(updater.match(/\$script:WBRuntimeNames\s*=\s*@\([^\r\n]*/)?.[0] ?? '', /\.github/);
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
