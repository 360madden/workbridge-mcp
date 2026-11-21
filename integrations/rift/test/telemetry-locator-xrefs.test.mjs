import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = 'C:\\work';
const PYTHON = 'C:\\work\\rre\\.venv\\Scripts\\python.exe';
const SCRIPT = join(ROOT, 'workbridge-mcp', 'integrations', 'rift', 'tools', 'telemetry-locator-xrefs.py');
const BEFORE = '1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8';
const AFTER = 'df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01';
const READER = '197f4af53be8fe597e17424066139e1735b6c063cb17589840de3c7418d3a1aa';
const RRE = '6b77d964ec493221b8bb6240da6fcac7f489cdc540bad0c67d20f902991f84ae';
const STATIC = '737873e0ba3802874f466999f8ee01703ad804346e00666e6584efd57c38ce9c';
const OPTIONS = [
  '--expect-host',
  'AMD-DESKTOP',
  '--workspace-root',
  ROOT,
  '--before',
  join(ROOT, 'RIFT-Build-Baselines', BEFORE, 'rift_x64.exe'),
  '--after',
  join(ROOT, 'RIFT-Build-Baselines', AFTER, 'rift_x64.exe'),
  '--reader',
  join(ROOT, 'Telemetry', 'src', 'Telemetry.Cli', 'Sources', 'LiveTargetSource.cs'),
  '--expected-before-sha',
  BEFORE,
  '--expected-after-sha',
  AFTER,
  '--expected-reader-sha',
  READER,
  '--expected-rre-parser-sha',
  RRE,
  '--expected-static-helper-sha',
  STATIC,
];
function execute(changes = {}, extra = []) {
  const args = [...OPTIONS];
  for (const [flag, value] of Object.entries(changes)) {
    const i = args.indexOf(flag);
    assert.ok(i >= 0, 'Unknown test flag ' + flag);
    args[i + 1] = value;
  }
  try {
    const stdout = execFileSync(PYTHON, ['-B', SCRIPT, ...args, ...extra], {
      cwd: join(ROOT, 'workbridge-mcp'),
      encoding: 'utf8',
      timeout: 90_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, result: JSON.parse(stdout) };
  } catch (error) {
    assert.ok(error.status !== null, 'Timed-out xref process');
    return { exitCode: error.status, result: JSON.parse(String(error.stderr).trim()) };
  }
}

test('full pinned Capstone scan matches all nine static reference counts', async () => {
  const { exitCode, result } = execute();
  assert.equal(exitCode, 0);
  assert.equal(result.schema, 'workbridge.telemetry-pdata-xrefs.v1');
  assert.equal(result.sectionBaseDelta, '0x11000');
  assert.equal(result.commonRootResidualShift, '0x7C0');
  assert.equal(result.sources.capstoneVersion, '5.0.7');
  assert.equal(
    result.sources.xrefToolSha256,
    createHash('sha256')
      .update(await readFile(SCRIPT))
      .digest('hex'),
  );
  assert.equal(result.summary.locators, 9);
  assert.equal(result.summary.selectorsWithEqualReferenceCounts, 6);
  assert.equal(result.summary.rootsWithUniqueEqualCountCandidates, 3);
  assert.equal(result.summary.allNineStaticReferenceCountsMatch, true);
  assert.equal(result.summary.qualifiedNativeLocators, 0);
  assert.equal(result.summary.independentLivePointerOrOwnershipProof, false);
  assert.equal(result.oldScan.functionCount, 303143);
  assert.equal(result.newScan.functionCount, 303450);
  assert.ok(result.oldScan.decodedFraction > 0.998);
  assert.ok(result.newScan.decodedFraction > 0.998);
  assert.ok(result.oldScan.textCoveredFraction > 0.78);
  assert.ok(result.newScan.textCoveredFraction > 0.78);
  assert.equal(result.oldScan.unparsedRipOperands, 0);
  assert.equal(result.newScan.unparsedRipOperands, 0);
  const expected = {
    ManagerRva: [595, '0x3373C68', '0x7C0'],
    PlayerSystemRva: [605, '0x3373BA0', '0x7C0'],
    ClockRootRva: [583, '0x33EDA70', '0x7C0'],
    HealthSelectorRva: [575, '0x2F68850', null],
    NameSelectorRva: [385, '0x2F692E0', null],
    LocalizedNameSelectorRva: [2, '0x2F689F0', null],
    AlternateSelectorRva: [93, '0x2F69270', null],
    SelectionSelectorRva: [239, '0x2F68260', null],
    PositionSelectorRva: [306, '0x2F698A0', null],
  };
  for (const [name, [count, rva, residual]] of Object.entries(expected)) {
    const row = result.locators.find((item) => item.name === name);
    assert.ok(row, 'Missing locator ' + name);
    assert.equal(row.oldRIPReferences, count);
    assert.equal(row.newRIPReferencesAtCandidate, count);
    assert.equal(row.candidateRva, rva);
    assert.equal(row.rootResidualShift, residual);
    assert.equal(row.equalReferenceCounts, true);
    assert.equal(row.nativeLocatorQualified, false);
    assert.equal(row.typedOperandWitnessesValidated, row.historicalSamples.length + row.newSamples.length);
    assert.ok(row.typedOperandWitnessesValidated >= 4);
    if (residual !== null) assert.equal(row.countMatchingNearbyCandidates, 1);
  }
});

test('wrong host fails without executing an offline analysis', () => {
  const x = execute({ '--expect-host': 'LEGION' });
  assert.equal(x.exitCode, 2);
  assert.equal(x.result.code, 'WRONG_HOST');
  assert.equal(x.result.nativeLocatorsQualified, 0);
});

test('wrong static helper SHA is rejected before its Python module loads', () => {
  const x = execute({ '--expected-static-helper-sha': '0'.repeat(64) });
  assert.equal(x.exitCode, 2);
  assert.equal(x.result.code, 'XREF_SOURCE_HASH');
});

test('changed baseline or Telemetry reader hashes fail closed', () => {
  const a = execute({ '--expected-before-sha': '0'.repeat(64) });
  const b = execute({ '--expected-reader-sha': '0'.repeat(64) });
  assert.equal(a.exitCode, 2);
  assert.equal(b.exitCode, 2);
  assert.equal(a.result.code, 'XREF_STATIC_SOURCE_SHA_MISMATCH');
  assert.equal(b.result.code, 'XREF_STATIC_SOURCE_SHA_MISMATCH');
});

test('existing report cannot be overwritten even if sources are otherwise valid', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'wb-xrefs-no-clobber-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, 'saved-xrefs.json');
  const sentinel = Buffer.from('preexisting evidence\n');
  await writeFile(target, sentinel);
  const r = execute({}, ['--output', target]);
  assert.equal(r.exitCode, 2);
  assert.equal(r.result.code, 'XREF_OUTPUT_EXISTS_OR_INVALID');
  assert.deepEqual(await readFile(target), sentinel);
});

test('multiple equal-count root candidates stay ambiguous; never pick nearest by accident', () => {
  const source = [
    'import importlib.util,collections',
    'spec=importlib.util.spec_from_file_location("xref",r"' + SCRIPT + '")',
    'm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)',
    'original=0x33624A8',
    'base=0x11000',
    'center=original+base',
    'data={"rva":0x2F67000,"rawSize":0x40c400,"virtualSize":0x430000}',
    'counts=collections.Counter({center+0x7c0:595,center+0x800:595})',
    'candidate,matches=m.choose_root_matches(original,595,base,counts,data)',
    'assert candidate is None and len(matches)==2',
    'del counts[center+0x800]',
    'candidate,matches=m.choose_root_matches(original,595,base,counts,data)',
    'assert candidate==center+0x7c0 and len(matches)==1',
    'counts.clear()',
    'candidate,matches=m.choose_root_matches(original,595,base,counts,data)',
    'assert candidate is None and matches==[]',
    'print("ambiguity guards passed")',
  ].join('\n');
  const output = execFileSync(PYTHON, ['-B', '-c', source], {
    cwd: join(ROOT, 'workbridge-mcp'),
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  assert.match(output, /ambiguity guards passed/);
});
