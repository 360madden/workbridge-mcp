import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = 'C:\\work';
const PYTHON = join(ROOT, 'rre', '.venv', 'Scripts', 'python.exe');
const SCRIPT = join(
  ROOT,
  'workbridge-mcp',
  'integrations',
  'rift',
  'tools',
  'telemetry-inbound-callgraph.py',
);
const BEFORE = '1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8';
const AFTER = 'df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01';
const REPORT = join(ROOT, 'workbridge-mcp', '.tools', 'wb-m6e-function-relations-final-20261121.json');
const REPORT_SHA = 'e9537078d1944da7a763b622343477129f90c4df3ab491ef390a0bc264e181b4';
const M6E_SHA = '4d6e20ee60966de7710c819914935d54145370fb03cf1c0fc67d6acb949ed0fe';
const OPTIONS = [
  '--expect-host',
  'AMD-DESKTOP',
  '--workspace-root',
  ROOT,
  '--report',
  REPORT,
  '--expected-report-sha',
  REPORT_SHA,
  '--expected-m6e-tool-sha',
  M6E_SHA,
  '--before',
  join(ROOT, 'RIFT-Build-Baselines', BEFORE, 'rift_x64.exe'),
  '--after',
  join(ROOT, 'RIFT-Build-Baselines', AFTER, 'rift_x64.exe'),
  '--reader',
  join(ROOT, 'Telemetry', 'src', 'Telemetry.Cli', 'Sources', 'LiveTargetSource.cs'),
];

function execute(changes = {}, extra = []) {
  const args = [...OPTIONS];
  for (const [name, value] of Object.entries(changes)) {
    const index = args.indexOf(name);
    assert.ok(index >= 0, 'Unsupported flag ' + name);
    args[index + 1] = value;
  }
  const run = spawnSync(PYTHON, ['-B', SCRIPT, ...args, ...extra], {
    cwd: join(ROOT, 'workbridge-mcp'),
    timeout: 160_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ifError(run.error);
  assert.equal(run.signal, null, 'Unexpected process signal');
  assert.ok(run.status === 0 || run.status === 2, run.stderr);
  return { code: run.status, result: JSON.parse(run.status === 0 ? run.stdout : run.stderr) };
}

async function alteredReport(t, mutator) {
  const dir = await mkdtemp(join(tmpdir(), 'wb-m6f-report-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const report = JSON.parse(await readFile(REPORT, 'utf8'));
  mutator(report);
  const encoded = Buffer.from(JSON.stringify(report) + '\n');
  const output = join(dir, 'm6e-report.json');
  await writeFile(output, encoded);
  return {
    '--report': output,
    '--expected-report-sha': createHash('sha256').update(encoded).digest('hex'),
  };
}

function pythonSnippet(source) {
  const run = spawnSync(PYTHON, ['-B', '-c', source], {
    cwd: join(ROOT, 'workbridge-mcp'),
    windowsHide: true,
    timeout: 10_000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

test('pinned two-build census verifies all 5007 calls and pairs 2451 caller functions', async () => {
  const { code, result } = execute();
  assert.equal(code, 0);
  assert.equal(result.schema, 'workbridge.telemetry-inbound-callgraph.v1');
  assert.equal(result.sources.m6eReportSha256, REPORT_SHA);
  assert.equal(result.sources.m6eToolSha256, M6E_SHA);
  assert.equal(result.summary.selectedM6eFunctionPairs, 7);
  assert.equal(result.summary.oldDirectCalls, 5007);
  assert.equal(result.summary.newDirectCalls, 5007);
  assert.equal(result.summary.oldDistinctCallerFunctions, 3145);
  assert.equal(result.summary.newDistinctCallerFunctions, 3145);
  assert.equal(result.summary.allTargetCountsEqual, true);
  assert.equal(result.summary.pairedCallerFunctions, 2451);
  assert.equal(result.summary.pairedMappedCallSites, 3632);
  assert.equal(result.summary.ambiguousCallerFunctions, 135);
  assert.equal(result.summary.oldUnpairedCandidateFunctions, 611);
  assert.equal(result.summary.newUnpairedCandidateFunctions, 611);
  assert.equal(result.summary.nativeRuntimeLocatorsQualified, 0);
  assert.equal(result.summary.livePlayerTelemetryVerified, false);
  assert.equal(result.method.liveProcessContacted, false);
  assert.equal(result.oldScan.functionRanges, 303143);
  assert.equal(result.newScan.functionRanges, 303450);
  assert.equal(result.oldScan.decodedInstructions, 7633563);
  assert.equal(result.newScan.decodedInstructions, 7634005);
  assert.equal(result.oldScan.directCallSitesVerified, 5007);
  assert.equal(result.newScan.directCallSitesVerified, 5007);
  assert.deepEqual(
    result.targetCounts.map((x) => x.oldCallSites),
    [0, 3845, 0, 1160, 0, 0, 2],
  );
  assert.deepEqual(
    result.targetCounts.map((x) => x.newCallSites),
    [0, 3845, 0, 1160, 0, 0, 2],
  );
  assert.deepEqual(
    result.targetCounts.map((x) => x.pairedCallerCallSites),
    [0, 2677, 0, 953, 0, 0, 2],
  );
  assert.deepEqual(result.oldUnpairedFunctionReasons.counts, {
    M6E_FUNCTION_INCOMPLETE: 48,
    M6E_RIP_TARGET_UNVERIFIED: 4,
    function_too_large: 31,
  });
  assert.deepEqual(result.newUnpairedFunctionReasons.counts, {
    M6E_FUNCTION_INCOMPLETE: 51,
    M6E_RIP_TARGET_UNVERIFIED: 1,
    function_too_large: 31,
  });
  assert.equal(result.pairedCallerExamples.length, 48);
  assert.equal(result.summary.samplesTruncated, true);
  assert.ok(
    result.pairedCallerExamples.every(
      (x) => x.semanticallyQualified === false && x.mappedRootCalls.length >= 1,
    ),
  );
  assert.equal(
    result.sources.m6fToolSha256,
    createHash('sha256')
      .update(await readFile(SCRIPT))
      .digest('hex'),
  );
});

test('wrong host refuses before touching archived game inputs', () => {
  const r = execute({ '--expect-host': 'LEGION' });
  assert.equal(r.code, 2);
  assert.equal(r.result.code, 'M6F_WRONG_HOST');
  assert.equal(r.result.nativeRuntimeLocatorsQualified, 0);
});

test('changed or forged M6e report and source pins fail closed', () => {
  const a = execute({ '--expected-report-sha': '0'.repeat(64) });
  const b = execute({ '--expected-m6e-tool-sha': '0'.repeat(64) });
  assert.equal(a.code, 2);
  assert.equal(a.result.code, 'M6F_SOURCE_HASH');
  assert.equal(b.code, 2);
  assert.equal(b.result.code, 'M6F_TOOL_PIN');
});

test('wrong executable identity rejects before analyzing callers', () => {
  const wrong = execute({ '--after': join(ROOT, 'RIFT-Build-Baselines', BEFORE, 'rift_x64.exe') });
  assert.equal(wrong.code, 2);
  assert.equal(wrong.result.code, 'M6F_SOURCE_HASH');
});

test('a preexisting report is never overwritten', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'wb-m6f-existing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, 'existing.json');
  const original = Buffer.from('existing evidence stays intact\n');
  await writeFile(target, original);
  const x = execute({}, ['--output', target]);
  assert.equal(x.code, 2);
  assert.equal(x.result.code, 'M6F_OUTPUT_EXISTS');
  assert.deepEqual(await readFile(target), original);
});

test('rehashed M6e JSON cannot promote runtime locator qualification', async (t) => {
  const changes = await alteredReport(t, (r) => {
    r.summary.nativeLocatorsQualified = 1;
  });
  const result = execute(changes);
  assert.equal(result.code, 2);
  assert.equal(result.result.code, 'M6F_REPORT_SCHEMA');
});

test('independently decoded E8 rel32 target must match raw signed displacement', () => {
  const source = [
    'import importlib.util, capstone',
    'from pathlib import Path',
    'p=Path(r"' + SCRIPT + '")',
    'spec=importlib.util.spec_from_file_location("f",p)',
    'm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)',
    'md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True',
    'm.validated_call(0x100,bytes.fromhex("e80b000000"),0x110,capstone,md)',
    'try:m.validated_call(0x100,bytes.fromhex("e80b000000"),0x111,capstone,md)',
    'except m.CallgraphError as e:assert str(e)=="M6F_DIRECT_CALL_TARGET"',
    'else:raise AssertionError("target mismatch accepted")',
    'try:m.validated_call(0x100,bytes.fromhex("900b000000"),0x110,capstone,md)',
    'except m.CallgraphError as e:assert str(e)=="M6F_DIRECT_CALL_ENCODING"',
    'else:raise AssertionError("invalid opcode accepted")',
    'print("direct-call gates passed")',
  ].join('\n');
  assert.match(pythonSnippet(source), /direct-call gates passed/);
});

test('caller pairing requires unique full-body signatures AND root-call offsets', () => {
  const source = [
    'import importlib.util',
    'from pathlib import Path',
    'p=Path(r"' + SCRIPT + '")',
    'spec=importlib.util.spec_from_file_location("f",p)',
    'm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)',
    'a={"start":0x100,"normalizedSha256":"a"*64,"functionBytes":20,"instructions":4,"sites":((4,0x49a020),)}',
    'b={**a,"start":0x200}',
    'key=("a"*64,20,4,((4,0x49a020),))',
    'good=m.compare_caller_catalogs({key:[a]},{key:[b]})',
    'assert good["pairedCallerFunctions"]==1 and good["pairedRootCalls"]==1',
    'ambiguous=m.compare_caller_catalogs({key:[a,b]},{key:[b]})',
    'assert ambiguous["pairedCallerFunctions"]==0 and ambiguous["ambiguousCallerFunctions"]==1',
    'different=(key[0],key[1],key[2],((5,0x49a020),))',
    'mismatch=m.compare_caller_catalogs({key:[a]},{different:[b]})',
    'assert mismatch["pairedCallerFunctions"]==0 and mismatch["pairedRootCalls"]==0',
    'print("uniqueness gates passed")',
  ].join('\n');
  assert.match(pythonSnippet(source), /uniqueness gates passed/);
});

test('bad full-body RIP evidence is excluded and counted, never promoted to a pair', () => {
  const source = [
    'import importlib.util',
    'from pathlib import Path',
    'p=Path(r"' + SCRIPT + '")',
    'spec=importlib.util.spec_from_file_location("f",p)',
    'm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)',
    'class FakeError(Exception):pass',
    'class M:',
    '  MAX_FUNCTION_BYTES=8192',
    '  FunctionError=FakeError',
    '  @staticmethod',
    '  def scan_function(image,pe,ranges,capstone,start):',
    '    if start==0x100:raise FakeError("M6E_RIP_TARGET_UNVERIFIED")',
    '    return {"hash":"a"*64,"size":128,"instructions":[0,1],"calls":[{"offset":4,"target":0x49a020}]}',
    'starts=[0x100,0x200,0x300,0x400]',
    'bundle={"ranges":{s:s+128 for s in starts},"sites":{s:[(4,0x49a020,s+4)] for s in starts}}',
    'catalog,skipped=m.candidate_catalog(None,None,None,M,bundle)',
    'assert skipped["counts"]=={"M6E_RIP_TARGET_UNVERIFIED":1}',
    'assert skipped["sampleRvas"]["M6E_RIP_TARGET_UNVERIFIED"]==["0x100"]',
    'assert sum(len(v) for v in catalog.values())==3',
    'print("conservative exclusion gate passed")',
  ].join('\n');
  assert.match(pythonSnippet(source), /conservative exclusion gate passed/);
});
