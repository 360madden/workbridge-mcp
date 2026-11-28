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
  // Separate Windows runners contain native resource-heavy cases without dropping files.
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /partition: \[parallel, isolated\]/);
  assert.match(workflow, /npm run build\s+node scripts\/stage-desktop-runtime\.mjs/);
  assert.match(workflow, /node scripts\/ci-core-test-runner\.mjs inventory/);
  assert.match(workflow, /node scripts\/ci-core-test-runner\.mjs \$\{\{ matrix\.partition \}\}/);
  assert.match(workflow, /if: matrix\.partition == 'isolated'/);
  assert.match(workflow, /if: matrix\.partition == 'parallel'/);
  assert.match(
    workflow,
    /node --test --test-concurrency=1 test\/git-baseline-audit\.test\.mjs test\/job-archive-proposal\.test\.mjs test\/job-archive-write\.test\.mjs/,
  );
  assert.doesNotMatch(workflow, /node --test(?: --test-concurrency=\d+)? test\/\*\.test\.mjs/);
  assert.match(workflow, /node --test integrations\/research\/test\/\*\.test\.mjs/);
  assert.match(workflow, /stage-research-runtime\.mjs --verify --repo-root \./);
  // Verify executable CI configuration, not a prose comment.
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

test('the real RIFT doctor remains in full host tests, never portable research fixtures', async () => {
  const portable = await readFile(
    new URL('../integrations/research/test/run.test.mjs', import.meta.url),
    'utf8',
  );
  const host = await readFile(
    new URL('../integrations/rift/test/research-doctor.test.mjs', import.meta.url),
    'utf8',
  );
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.doesNotMatch(portable, /a minimal real RIFT doctor workflow/);
  assert.match(host, /a minimal real RIFT doctor workflow/);
  assert.match(host, /'rift\.doctor'/);
  for (const name of ['test', 'test:bounded', 'test:serial'])
    assert.match(pkg.scripts[name], /integrations\/rift\/test\/\*\.test\.mjs/, name);
});

test('RIFT synthetic CI is independent of core builds and uses an explicit hosted partition', async () => {
  const workflow = await readFile(new URL('../.github/workflows/build-test.yml', import.meta.url), 'utf8');
  // Inspect the top-level job block only, so a similarly named step in another
  // job cannot accidentally satisfy this contract.
  const job = /^  rift-offline:\s*\r?\n([\s\S]*?)(?=^  [\w-]+:\s*\r?$|(?![\s\S]))/m.exec(workflow)?.[1];
  assert.ok(job, 'dedicated RIFT offline job is missing');
  assert.match(job, /^    runs-on: windows-2025\s*$/m);
  assert.match(job, /node-version: '24'/);
  assert.match(job, /run: node --test test\/ci-rift-test-runner\.test\.mjs/);
  assert.match(job, /run: node scripts\/ci-rift-test-runner\.mjs hosted/);
  assert.doesNotMatch(job, /^    (?:needs|if):/m);
  assert.doesNotMatch(job, /run: (?:npm ci|npm run build|npm test)\b/);
  assert.doesNotMatch(job, /integrations\/rift\/test\/\*\.test\.mjs/);
});
