import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = 'C:\\work';
const PYTHON = join(ROOT, 'rre', '.venv', 'Scripts', 'python.exe');
const SCRIPT = join(ROOT, 'workbridge-mcp', 'integrations', 'rift', 'tools', 'telemetry-locator-context.py');
const BEFORE = '1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8';
const AFTER = 'df954b798331e18359be62a31cc74b49fc3f50b87385ebb080a5448256322c01';
const REPORT = join(ROOT, 'workbridge-mcp', '.tools', 'wb-rift001-m6c-xref-audit-20261121-final.json');
const REPORT_SHA = '2c0b5cdf287b321377e1abd2a7bc373ab949932d22489c1fccc5e735292fd977';
const XREF_SHA = 'c212bbd8892cd39b0468db27a65ede731fa9b187b7e8499d414de6777419e22a';

const OPTIONS = [
  '--expect-host',
  'AMD-DESKTOP',
  '--workspace-root',
  ROOT,
  '--report',
  REPORT,
  '--expected-report-sha',
  REPORT_SHA,
  '--expected-xref-tool-sha',
  XREF_SHA,
  '--before',
  join(ROOT, 'RIFT-Build-Baselines', BEFORE, 'rift_x64.exe'),
  '--after',
  join(ROOT, 'RIFT-Build-Baselines', AFTER, 'rift_x64.exe'),
  '--reader',
  join(ROOT, 'Telemetry', 'src', 'Telemetry.Cli', 'Sources', 'LiveTargetSource.cs'),
];

function execute(changes = {}, extra = []) {
  const args = [...OPTIONS];
  for (const [flag, value] of Object.entries(changes)) {
    const index = args.indexOf(flag);
    assert.ok(index >= 0, 'Unexpected change flag ' + flag);
    args[index + 1] = value;
  }
  const run = spawnSync(PYTHON, ['-B', SCRIPT, ...args, ...extra], {
    cwd: join(ROOT, 'workbridge-mcp'),
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 512 * 1024,
  });
  assert.ifError(run.error);
  assert.equal(run.signal, null);
  assert.ok(run.status === 0 || run.status === 2, run.stderr);
  return { code: run.status, result: JSON.parse(run.status === 0 ? run.stdout : run.stderr) };
}

async function changedReport(t, update) {
  const dir = await mkdtemp(join(tmpdir(), 'wb-m6d-report-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const report = JSON.parse(await readFile(REPORT, 'utf8'));
  update(report);
  const raw = Buffer.from(JSON.stringify(report) + '\n');
  const path = join(dir, 'altered.json');
  await writeFile(path, raw);
  const sha = createHash('sha256').update(raw).digest('hex');
  return { '--report': path, '--expected-report-sha': sha };
}

test('pinned real two-build sample shapes match without qualifying native addresses', async () => {
  const { code, result } = execute();
  assert.equal(code, 0);
  assert.equal(result.schema, 'workbridge.telemetry-xref-context.v1');
  assert.equal(result.sources.m6cReportSha256, REPORT_SHA);
  assert.equal(result.sources.m6cToolSha256, XREF_SHA);
  assert.equal(result.sources.capstoneVersion, '5.0.7');
  assert.equal(result.summary.locators, 9);
  assert.equal(result.summary.matchedSampleShapes, 26);
  assert.equal(result.summary.uniqueSamplePairs, 26);
  assert.equal(result.summary.unmatchedOldShapes, 0);
  assert.equal(result.summary.unmatchedNewShapes, 0);
  assert.equal(result.summary.nativeLocatorsQualified, 0);
  assert.equal(result.summary.runtimeOwnershipVerified, false);
  assert.equal(result.summary.livePlayerTelemetryVerified, false);
  assert.equal(result.method.runtimeMemoryRead, false);
  assert.equal(result.locators.length, 9);
  assert.ok(
    result.locators.every(
      (row) =>
        row.runtimeQualified === false &&
        row.matchedSampleShapes === row.oldSamples &&
        row.matchedSampleShapes === row.newSamples,
    ),
  );
  assert.equal(
    result.sources.m6dToolSha256,
    createHash('sha256')
      .update(await readFile(SCRIPT))
      .digest('hex'),
  );
});

test('wrong machine refuses before reading game sources', () => {
  const { code, result } = execute({ '--expect-host': 'LEGION' });
  assert.equal(code, 2);
  assert.equal(result.code, 'M6D_WRONG_HOST');
  assert.equal(result.nativeLocatorsQualified, 0);
});

test('wrong report and imported analysis helper SHA pins fail closed', () => {
  const report = execute({ '--expected-report-sha': '0'.repeat(64) });
  const tool = execute({ '--expected-xref-tool-sha': '0'.repeat(64) });
  assert.equal(report.code, 2);
  assert.equal(tool.code, 2);
  assert.equal(report.result.code, 'M6D_SOURCE_HASH');
  assert.equal(tool.result.code, 'M6D_TOOL_PIN');
});

test('existing output is never overwritten', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'wb-m6d-no-clobber-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'report.json');
  const saved = Buffer.from('important prior result\n');
  await writeFile(output, saved);
  const run = execute({}, ['--output', output]);
  assert.equal(run.code, 2);
  assert.equal(run.result.code, 'M6D_OUTPUT_EXISTS');
  assert.deepEqual(await readFile(output), saved);
});

test('rehashing a modified report cannot change a claimed locator target', async (t) => {
  const changes = await changedReport(t, (r) => {
    r.locators[0].newSamples[0].referencedRva = '0x111111';
  });
  const run = execute(changes);
  assert.equal(run.code, 2);
  assert.equal(run.result.code, 'M6D_REPORT_TARGET_MISMATCH');
});

test('rehashing a modified report cannot turn a witness into invented bytes', async (t) => {
  const changes = await changedReport(t, (r) => {
    const sample = r.locators[0].historicalSamples[0];
    sample.instructionBytes =
      (sample.instructionBytes.startsWith('00') ? '01' : '00') + sample.instructionBytes.slice(2);
  });
  const run = execute(changes);
  assert.equal(run.code, 2);
  assert.equal(run.result.code, 'M6D_WITNESS_BYTES');
});

test('rehashing a modified report cannot elevate it to a qualified native reader', async (t) => {
  const changes = await changedReport(t, (r) => {
    r.summary.qualifiedNativeLocators = 1;
  });
  const run = execute(changes);
  assert.equal(run.code, 2);
  assert.equal(run.result.code, 'M6D_REPORT_SCHEMA');
});

test('wrong preserved function membership fails against actual pdata', async (t) => {
  const changes = await changedReport(t, (r) => {
    r.locators[0].historicalSamples[0].functionRva = '0x1';
  });
  const run = execute(changes);
  assert.equal(run.code, 2);
  assert.equal(run.result.code, 'M6D_WITNESS_RANGE');
});

test('pairing uses exact structure and reports duplicate ambiguity', () => {
  const python = [
    'import importlib.util',
    'spec=importlib.util.spec_from_file_location("m6d",r"' + SCRIPT + '")',
    'm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)',
    'row={"functionOffset":4,"instructionLength":7,"mnemonic":"mov","maskedInstructionSha256":"a"*64,"functionRva":"0x10"}',
    'old=[row,dict(row,functionRva="0x20")]',
    'one=[dict(row,functionRva="0x30")]',
    'r=m.pair_samples(old,one)',
    'assert r["matchedSampleShapes"]==1',
    'assert r["uniquelyPairedSampleShapes"]==0',
    'assert r["unmatchedOldShapes"]==1',
    'assert r["unmatchedNewShapes"]==0',
    'other=dict(row,functionOffset=99)',
    'none=m.pair_samples(old,[other])',
    'assert none["matchedSampleShapes"]==0',
    'print("pairing checks passed")',
  ].join('\n');
  const run = spawnSync(PYTHON, ['-B', '-c', python], {
    cwd: join(ROOT, 'workbridge-mcp'),
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /pairing checks passed/);
});
