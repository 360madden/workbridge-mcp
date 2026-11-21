import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const PYTHON = 'C:\\Python314\\python.exe';
const ROOT = 'C:\\work';
const SCRIPT = join(ROOT, 'workbridge-mcp', 'integrations', 'rift', 'tools', 'telemetry-locator-drift.py');
const OLD = '1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8';
const CURRENT = 'df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01';
const READER_SHA = '197f4af53be8fe597e17424066139e1735b6c063cb17589840de3c7418d3a1aa';
const RRE_SHA = '6b77d964ec493221b8bb6240da6fcac7f489cdc540bad0c67d20f902991f84ae';
const READER = join(ROOT, 'Telemetry', 'src', 'Telemetry.Cli', 'Sources', 'LiveTargetSource.cs');
const INPUTS = [
  '--expect-host',
  'AMD-DESKTOP',
  '--workspace-root',
  ROOT,
  '--before',
  join(ROOT, 'RIFT-Build-Baselines', OLD, 'rift_x64.exe'),
  '--after',
  join(ROOT, 'RIFT-Build-Baselines', CURRENT, 'rift_x64.exe'),
  '--reader',
  READER,
  '--expected-before-sha',
  OLD,
  '--expected-after-sha',
  CURRENT,
  '--expected-reader-sha',
  READER_SHA,
  '--expected-rre-parser-sha',
  RRE_SHA,
];

function execute(extra = [], replacement = {}) {
  if (!existsSync(PYTHON))
    throw Error('Required Python 3.14 missing from the host-specific RIFT test machine.');
  const args = [...INPUTS];
  for (const [flag, value] of Object.entries(replacement)) {
    const index = args.indexOf(flag);
    assert.ok(index >= 0, 'Test attempts unknown flag ' + flag);
    args[index + 1] = value;
  }
  try {
    const stdout = execFileSync(PYTHON, ['-B', SCRIPT, ...args, ...extra], {
      cwd: join(ROOT, 'workbridge-mcp'),
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    return { exitCode: 0, stdout, parsed: JSON.parse(stdout) };
  } catch (error) {
    return {
      exitCode: error.status ?? null,
      stderr: error.stderr,
      parsed: JSON.parse(error.stderr?.toString().trim() || '{}'),
    };
  }
}

test('nine pinned Telemetry native locators expose static-only patch drift', () => {
  const result = execute();
  assert.equal(result.exitCode, 0);
  const data = result.parsed;
  assert.equal(data.schema, 'workbridge.telemetry-static-locator-drift.v1');
  assert.equal(data.summary.locatorCount, 9);
  assert.equal(data.summary.oldToDifferentSection, 6);
  assert.equal(data.summary.notByteComparableAtOldRva, 3);
  assert.equal(data.summary.identical16AtSameRva, 0);
  assert.equal(data.summary.identical16AtSectionRelativeHypothesis, 6);
  assert.equal(data.summary.nativeLocatorsQualified, 0);
  assert.equal(data.limitations.runtimeLocatorQualified, false);
  assert.equal(data.limitations.processMemoryRead, false);
  assert.equal(data.source.before.sha256, OLD);
  assert.equal(data.source.after.sha256, CURRENT);
  assert.equal(data.source.rreParser.sha256, RRE_SHA);
  const selectorNames = [
    'HealthSelectorRva',
    'NameSelectorRva',
    'LocalizedNameSelectorRva',
    'AlternateSelectorRva',
    'SelectionSelectorRva',
    'PositionSelectorRva',
  ];
  for (const name of selectorNames) {
    const row = data.locators.find((x) => x.name === name);
    assert.ok(row);
    assert.equal(row.oldSection, '.data');
    assert.equal(row.newSectionAtHistoricalRva, '.rdata');
    assert.equal(row.sameHistoricalRvaBytes16, false);
    assert.equal(row.sectionRelativeHypothesis.sameBytes16, true);
    assert.equal(row.sectionRelativeHypothesis.nativeLocatorQualified, false);
  }
  for (const name of ['ManagerRva', 'PlayerSystemRva', 'ClockRootRva']) {
    const row = data.locators.find((x) => x.name === name);
    assert.ok(row);
    assert.equal(row.oldFileBacked16, false);
    assert.equal(row.sameHistoricalRvaBytes16, null);
    assert.equal(row.sectionRelativeHypothesis.nativeLocatorQualified, false);
  }
});

test('a wrong old or current PE hash refuses the analysis', () => {
  const wrongOld = execute([], { '--expected-before-sha': '0'.repeat(64) });
  assert.equal(wrongOld.exitCode, 2);
  assert.equal(wrongOld.parsed.code, 'SOURCE_SHA_MISMATCH');
  const wrongNew = execute([], { '--expected-after-sha': '1'.repeat(64) });
  assert.equal(wrongNew.exitCode, 2);
  assert.equal(wrongNew.parsed.code, 'SOURCE_SHA_MISMATCH');
});

test('wrong reader or RRE analyzer SHA fails before untrusted code executes', () => {
  const wrongReader = execute([], { '--expected-reader-sha': '0'.repeat(64) });
  assert.equal(wrongReader.exitCode, 2);
  assert.equal(wrongReader.parsed.code, 'SOURCE_SHA_MISMATCH');
  const wrongParser = execute([], { '--expected-rre-parser-sha': '0'.repeat(64) });
  assert.equal(wrongParser.exitCode, 2);
  assert.equal(wrongParser.parsed.code, 'SOURCE_SHA_MISMATCH');
});

test('wrong verified hostname stops before source inspection', () => {
  const result = execute([], { '--expect-host': 'LEGION' });
  assert.equal(result.exitCode, 2);
  assert.equal(result.parsed.code, 'WRONG_HOST');
});

test('unexpected reader RVA declaration refuses rather than guessing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wb-m6b-reader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await readFile(READER, 'utf8');
  const modified = Buffer.from(source.replace('HealthSelectorRva', 'HealthUnknownRva'), 'utf8');
  const copy = join(root, 'LiveTargetSource.cs');
  await writeFile(copy, modified);
  const result = execute([], {
    '--reader': copy,
    '--expected-reader-sha': createHash('sha256').update(modified).digest('hex'),
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.parsed.code, 'READER_LOCATORS_CHANGED');
});

test('explicit output never overwrites an existing saved analysis', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wb-m6b-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'locator-audit.json');
  const one = execute(['--output', path]);
  assert.equal(one.exitCode, 0);
  const original = await readFile(path);
  assert.equal(JSON.parse(original).schema, 'workbridge.telemetry-static-locator-drift.v1');
  const repeated = execute(['--output', path]);
  assert.equal(repeated.exitCode, 2);
  assert.equal(repeated.parsed.code, 'OUTPUT_EXISTS');
  assert.deepEqual(await readFile(path), original);
});
