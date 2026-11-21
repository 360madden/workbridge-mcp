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
  'telemetry-function-relations.py',
);
const BEFORE = '1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8';
const AFTER = 'df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01';
const REPORT = join(ROOT, 'workbridge-mcp', '.tools', 'wb-m6d-context-20261121-final.json');
const REPORT_SHA = 'e90b0e4f3d05cbf640cf6f302c60d3c25b1af6fed39067a67ffcc587503200d8';
const M6D_SHA = '9908f7b07decb027bc55b4b88486a19583632bf420ed1fbf09327af43fd62533';
const ARGS = [
  '--expect-host',
  'AMD-DESKTOP',
  '--workspace-root',
  ROOT,
  '--report',
  REPORT,
  '--expected-report-sha',
  REPORT_SHA,
  '--expected-m6d-tool-sha',
  M6D_SHA,
  '--before',
  join(ROOT, 'RIFT-Build-Baselines', BEFORE, 'rift_x64.exe'),
  '--after',
  join(ROOT, 'RIFT-Build-Baselines', AFTER, 'rift_x64.exe'),
  '--reader',
  join(ROOT, 'Telemetry', 'src', 'Telemetry.Cli', 'Sources', 'LiveTargetSource.cs'),
];

function execute(modifications = {}, extra = []) {
  const args = [...ARGS];
  for (const [name, value] of Object.entries(modifications)) {
    const offset = args.indexOf(name);
    assert.ok(offset >= 0, 'Unexpected argument ' + name);
    args[offset + 1] = value;
  }
  const run = spawnSync(PYTHON, ['-B', SCRIPT, ...args, ...extra], {
    cwd: join(ROOT, 'workbridge-mcp'),
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 512 * 1024,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ifError(run.error);
  assert.equal(run.signal, null, 'Unexpected signal');
  assert.ok(run.status === 0 || run.status === 2, run.stderr);
  return { code: run.status, data: JSON.parse(run.status === 0 ? run.stdout : run.stderr) };
}

async function withAlteredReport(t, alter) {
  const dir = await mkdtemp(join(tmpdir(), 'wb-m6e-report-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const payload = JSON.parse(await readFile(REPORT, 'utf8'));
  alter(payload);
  const raw = Buffer.from(JSON.stringify(payload) + '\n');
  const path = join(dir, 'report.json');
  await writeFile(path, raw);
  return {
    '--report': path,
    '--expected-report-sha': createHash('sha256').update(raw).digest('hex'),
  };
}

test('pinned function bodies agree on 716 instructions with mapped cross-root call edge', async () => {
  const { code, data } = execute();
  assert.equal(code, 0);
  assert.equal(data.schema, 'workbridge.telemetry-function-relations.v1');
  assert.equal(data.sources.m6dReportSha256, REPORT_SHA);
  assert.equal(data.sources.m6dToolSha256, M6D_SHA);
  assert.equal(data.summary.rootLocatorKinds, 3);
  assert.equal(data.summary.uniqueFunctionPairs, 7);
  assert.equal(data.summary.oldInstructions, 716);
  assert.equal(data.summary.newInstructions, 716);
  assert.equal(data.summary.identicalNormalizedFunctionBodies, 7);
  assert.equal(data.summary.differingFunctionBodies, 0);
  assert.equal(data.summary.instructionDifferences, 0);
  assert.equal(data.summary.oldDecoderMetadataWarnings, 1);
  assert.equal(data.summary.newDecoderMetadataWarnings, 1);
  assert.equal(data.summary.knownMappedDirectCallEdges, 1);
  assert.equal(data.summary.nativeLocatorsQualified, 0);
  assert.equal(data.summary.liveTelemetryVerified, false);
  assert.equal(data.method.runtimeMemoryRead, false);
  assert.ok(
    data.functions.every(
      (f) => f.nativeRuntimeQualified === false && f.oldNormalizedSha256 === f.newNormalizedSha256,
    ),
  );
  const caller = data.functions.find((f) => f.oldFunctionRva === '0x4E3520');
  assert.equal(caller.newFunctionRva, '0x4E3B50');
  assert.deepEqual(caller.knownMappedCalleeEdges, [
    {
      callOffset: 70,
      oldCalleeRva: '0x49A020',
      newCalleeRva: '0x49A690',
      matchesMappedCallee: true,
    },
  ]);
  const unusual = data.functions.find((f) => f.oldFunctionRva === '0x4E66EF');
  assert.equal(unusual.newFunctionRva, '0x4E6D1F');
  assert.equal(unusual.oldDecoderMetadataWarnings[0].capstoneDeclaredDispSize, 2);
  assert.equal(unusual.oldDecoderMetadataWarnings[0].independentlyVerifiedDispSize, 4);
  assert.equal(
    data.sources.m6eToolSha256,
    createHash('sha256')
      .update(await readFile(SCRIPT))
      .digest('hex'),
  );
});

test('machine identity is mandatory', () => {
  const r = execute({ '--expect-host': 'LEGION' });
  assert.equal(r.code, 2);
  assert.equal(r.data.code, 'M6E_WRONG_HOST');
  assert.equal(r.data.nativeLocatorsQualified, 0);
});

test('M6d evidence hash and exact M6d source pin must match', () => {
  const a = execute({ '--expected-report-sha': '0'.repeat(64) });
  const b = execute({ '--expected-m6d-tool-sha': '0'.repeat(64) });
  assert.equal(a.code, 2);
  assert.equal(a.data.code, 'M6E_SOURCE_HASH');
  assert.equal(b.code, 2);
  assert.equal(b.data.code, 'M6E_M6D_TOOL_PIN');
});

test('wrong pinned game or Telemetry source is rejected before disassembly', () => {
  const wrongExe = execute({ '--before': join(ROOT, 'RIFT-Build-Baselines', AFTER, 'rift_x64.exe') });
  const wrongReader = execute({ '--reader': join(ROOT, 'workbridge-mcp', 'package.json') });
  assert.equal(wrongExe.code, 2);
  assert.equal(wrongExe.data.code, 'M6E_SOURCE_HASH');
  assert.equal(wrongReader.code, 2);
  assert.equal(wrongReader.data.code, 'M6E_SOURCE_HASH');
});

test('existing destination stays byte-identical when the operation is refused', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'wb-m6e-no-overwrite-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, 'report.json');
  const sentinel = Buffer.from('existing report\n');
  await writeFile(target, sentinel);
  const x = execute({}, ['--output', target]);
  assert.equal(x.code, 2);
  assert.equal(x.data.code, 'M6E_OUTPUT_EXISTS');
  assert.deepEqual(await readFile(target), sentinel);
});

test('rehashed report cannot promote a root into native qualified status', async (t) => {
  const changes = await withAlteredReport(t, (r) => {
    r.summary.nativeLocatorsQualified = 1;
  });
  const x = execute(changes);
  assert.equal(x.code, 2);
  assert.equal(x.data.code, 'M6E_REPORT_SCHEMA');
});

test('rehashed report cannot promote ambiguous function pairs', async (t) => {
  const changes = await withAlteredReport(t, (r) => {
    r.locators.find((x) => x.name === 'ManagerRva').pairs[0].uniquelyPairedInSample = false;
  });
  const x = execute(changes);
  assert.equal(x.code, 2);
  assert.equal(x.data.code, 'M6E_PAIR_AMBIGUOUS');
});

test('rehashed report cannot assign two old functions to one relocated start', async (t) => {
  const changes = await withAlteredReport(t, (r) => {
    r.locators.find((x) => x.name === 'PlayerSystemRva').pairs[0].newFunctionRva = '0x4A4DC0';
  });
  const x = execute(changes);
  assert.equal(x.code, 2);
  assert.equal(x.data.code, 'M6E_PAIR_CONFLICT');
});

test('Capstone prefixed RIP metadata anomaly is independently checked against raw disp32', () => {
  const source = [
    'import importlib.util, capstone',
    'from pathlib import Path',
    'p=Path(r"' + SCRIPT + '")',
    's=importlib.util.spec_from_file_location("m6e",p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
    'md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True',
    'a=list(md.disasm(bytes.fromhex("660f6f0d21c81b02"),0x4e6b37))[0]',
    'b=list(md.disasm(bytes.fromhex("660f6f0df1a71c02"),0x4e7167))[0]',
    'old,w1,_=m.verified_mask(a,capstone)',
    'new,w2,_=m.verified_mask(b,capstone)',
    'assert old==new and len(w1)==len(w2)==1',
    'assert w1[0]["capstoneDeclaredDispSize"]==2',
    'assert w2[0]["independentlyVerifiedDispSize"]==4',
    'print("RIP anomaly independently verified")',
  ].join('\n');
  const x = spawnSync(PYTHON, ['-B', '-c', source], {
    cwd: join(ROOT, 'workbridge-mcp'),
    windowsHide: true,
    timeout: 10_000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ifError(x.error);
  assert.equal(x.status, 0, x.stderr);
  assert.match(x.stdout, /RIP anomaly independently verified/);
});
