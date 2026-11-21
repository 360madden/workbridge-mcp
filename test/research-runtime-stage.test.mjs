import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  RESEARCH_RUNTIME_FILES,
  stageResearchRuntime,
  verifyResearchRuntime,
} from '../scripts/stage-research-runtime.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'wb-research-runtime-stage-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  for (const rel of RESEARCH_RUNTIME_FILES) {
    const filename =
      rel === 'support/desktop-ui.mjs'
        ? join(root, 'scripts', 'desktop-ui.mjs')
        : join(root, 'integrations', ...rel.split('/'));
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, '// ' + rel + '\n');
  }
  return { root, dest: join(root, 'dist', 'research-runtime') };
}

test('fixed runtime closure stages exact declared files and verifies their content', async (t) => {
  const f = await fixture(t);
  const first = await stageResearchRuntime({ repoRoot: f.root });
  assert.equal(first.status, 'staged');
  assert.equal(first.verified, true);
  assert.equal(first.fileCount, RESEARCH_RUNTIME_FILES.length);
  const one = await readFile(join(f.dest, 'research', 'src', 'cli.mjs'), 'utf8');
  assert.equal(one, '// research/src/cli.mjs\n');
  assert.equal(
    await readFile(join(f.dest, 'support', 'desktop-ui.mjs'), 'utf8'),
    '// support/desktop-ui.mjs\n',
  );
  assert.equal((await verifyResearchRuntime({ repoRoot: f.root })).manifestSha256, first.manifestSha256);
});

test('repeated stage preserves byte-identical manifest and reports unchanged', async (t) => {
  const f = await fixture(t);
  const first = await stageResearchRuntime({ repoRoot: f.root });
  const second = await stageResearchRuntime({ repoRoot: f.root });
  assert.equal(second.status, 'unchanged');
  assert.equal(second.manifestSha256, first.manifestSha256);
});

test('changed sealed file is detected independently of mutable source', async (t) => {
  const f = await fixture(t);
  await stageResearchRuntime({ repoRoot: f.root });
  await writeFile(join(f.dest, 'research', 'src', 'cli.mjs'), 'tampered\n');
  await assert.rejects(
    () => verifyResearchRuntime({ repoRoot: f.root }),
    (error) => error.code === 'RESEARCH_STAGE_HASH_MISMATCH',
  );
  const repaired = await stageResearchRuntime({ repoRoot: f.root });
  assert.equal(repaired.status, 'staged');
  assert.equal((await verifyResearchRuntime({ repoRoot: f.root })).verified, true);
});

test('changing mutable source does not change the already sealed runtime', async (t) => {
  const f = await fixture(t);
  const before = await stageResearchRuntime({ repoRoot: f.root });
  const filename = join(f.root, 'integrations', 'research', 'src', 'cli.mjs');
  await writeFile(filename, '// changed source\n');
  assert.equal((await verifyResearchRuntime({ repoRoot: f.root })).manifestSha256, before.manifestSha256);
  const after = await stageResearchRuntime({ repoRoot: f.root });
  assert.equal(after.status, 'staged');
  assert.notEqual(after.manifestSha256, before.manifestSha256);
});

test('the sealed WinApp helper is a separate immutable copy of the canonical script', async (t) => {
  const f = await fixture(t);
  await stageResearchRuntime({ repoRoot: f.root });
  const original = await verifyResearchRuntime({ repoRoot: f.root });
  await writeFile(join(f.root, 'scripts', 'desktop-ui.mjs'), '// changed helper source\n');
  assert.equal((await verifyResearchRuntime({ repoRoot: f.root })).manifestSha256, original.manifestSha256);
  const updated = await stageResearchRuntime({ repoRoot: f.root });
  assert.equal(updated.status, 'staged');
  assert.notEqual(updated.manifestSha256, original.manifestSha256);
  assert.equal(
    await readFile(join(f.dest, 'support', 'desktop-ui.mjs'), 'utf8'),
    '// changed helper source\n',
  );
});

test('real sealed physical module imports the exact staged WinApp helper', async (t) => {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  await mkdir(join(repo, '.tools'), { recursive: true });
  const temporary = await mkdtemp(join(repo, '.tools', 'research-m6-import-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = join(temporary, 'dist', 'research-runtime');
  const stage = await stageResearchRuntime({ repoRoot: repo, destination });
  assert.equal(stage.verified, true);
  const physicalUrl = pathToFileURL(join(destination, 'rift', 'src', 'physical-epoch.mjs'));
  const physical = await import(physicalUrl.href);
  assert.equal(typeof physical.physicalRiftIdentity, 'function');
  const workspace = await import(pathToFileURL(join(destination, 'rift', 'src', 'workspace-path.mjs')).href);
  const helperUrl = workspace.desktopUiHelperUrl(physicalUrl);
  const helper = await import(helperUrl.href);
  assert.equal(typeof helper.runWinapp, 'function');
  const original = await readFile(join(repo, 'scripts', 'desktop-ui.mjs'));
  const packaged = await readFile(join(destination, 'support', 'desktop-ui.mjs'));
  assert.deepEqual(packaged, original);
});

test('missing source rejects before publishing a manifest', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wb-research-missing-stage-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => stageResearchRuntime({ repoRoot: root }), { code: 'ENOENT' });
});

test('WB-001 release packaging includes integrations and seals runtime during build', async () => {
  const repo = new URL('..', import.meta.url);
  const update = await readFile(new URL('./scripts/Workbridge-Update.ps1', repo), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('./package.json', repo), 'utf8'));
  const catalog = await readFile(new URL('./scripts/release-acceptance.mjs', repo), 'utf8');
  assert.match(update, /\$script:WBSourceNames\s*=\s*@\([^\n]*'integrations'/);
  assert.match(update, /\$script:WBRuntimeNames\s*=\s*@\([^\n]*'dist'/);
  assert.match(pkg.scripts.build, /stage-research-runtime\.mjs/);
  assert.match(catalog, /checkResearchToolCatalog/);
  assert.match(catalog, /verifyResearchRuntime/);
});

test('stage never writes outside the explicitly selected repository root', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => stageResearchRuntime({ repoRoot: f.root, destination: join(f.root, '..', 'outside') }),
    (error) => error.code === 'RESEARCH_STAGE_OUTSIDE_ROOT',
  );
});
