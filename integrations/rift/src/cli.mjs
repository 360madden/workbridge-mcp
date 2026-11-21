#!/usr/bin/env node
import { doctor, session, verifyBundle, DEFAULT_PYTHON } from './bundle.mjs';
import { ResearchError } from './identity.mjs';
import { comparePatch, verifyPatch } from './patch-drift.mjs';
import { physicalRiftIdentity } from './physical-epoch.mjs';
import { savePhysicalReceipt, verifyPhysicalReceipt } from './physical-receipt.mjs';

const allowed = new Set([
  '--client',
  '--telemetry',
  '--track',
  '--out',
  '--expect-host',
  '--expect-sha',
  '--python',
  '--bundle',
  '--rr2',
  '--rre',
  '--rre-binding',
  '--before',
  '--after',
  '--expected-before-sha',
  '--expected-after-sha',
  '--anchors',
  '--pid',
]);

function parse(argv) {
  const [command, ...rest] = argv;
  if (
    !['doctor', 'session', 'verify', 'patch', 'verify-patch', 'physical', 'verify-physical', 'help'].includes(
      command,
    )
  ) {
    throw new ResearchError(
      'COMMAND',
      'Expected doctor, session, verify, patch, verify-patch, physical, verify-physical or help.',
    );
  }
  if (command === 'help') return { command, options: {} };
  const options = {};
  if (rest.length % 2 !== 0) {
    throw new ResearchError('ARGUMENTS', 'All command options require values.');
  }
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!allowed.has(key) || options[key] !== undefined || !value || value.startsWith('--')) {
      throw new ResearchError('ARGUMENTS', 'Invalid or repeated option: ' + key);
    }
    options[key] = value;
  }
  const relevant = {
    doctor: ['--client', '--expect-host', '--expect-sha'],
    session: [
      '--client',
      '--expect-host',
      '--expect-sha',
      '--telemetry',
      '--track',
      '--out',
      '--python',
      '--rr2',
      '--rre',
      '--rre-binding',
    ],
    verify: ['--bundle'],
    patch: [
      '--before',
      '--after',
      '--out',
      '--expect-host',
      '--expected-before-sha',
      '--expected-after-sha',
      '--python',
      '--anchors',
    ],
    'verify-patch': ['--bundle'],
    physical: ['--expect-host', '--expect-sha', '--pid', '--out'],
    'verify-physical': ['--bundle'],
  };
  if (Object.keys(options).some((key) => !relevant[command].includes(key))) {
    throw new ResearchError('ARGUMENTS', 'An option does not belong to this command.');
  }
  return { command, options };
}

const HELP = [
  'Standalone RIFT research companion (offline only; does not contact the game).',
  'node src/cli.mjs doctor --client EXE --expect-host AMD-DESKTOP [--expect-sha SHA256]',
  'node src/cli.mjs session --client EXE --expect-host AMD-DESKTOP --telemetry JSON_OR_JSONL --track RPT_JSONL --out NEW_DIR [--python PYTHON_EXE] [--expect-sha SHA256]',
  'Optional session archives: --rr2 RR2_NATIVE_JSON --rre RRE_PUBLICATION_JSON --rre-binding RRE_BINDING_JSON (RRE pair required)',
  'node src/cli.mjs verify --bundle SAVED_DIR',
  'node src/cli.mjs patch --before OLD_EXE --after NEW_EXE --out NEW_DIR --expect-host HOST --expected-before-sha SHA256 [--expected-after-sha SHA256] [--anchors RRE_JSON]',
  'node src/cli.mjs verify-patch --bundle SAVED_PATCH_DIR',
  'node src/cli.mjs physical --expect-host AMD-DESKTOP [--pid EXACT_RIFT_PID] [--expect-sha SHA256] [--out NEW_DIR]',
  'node src/cli.mjs verify-physical --bundle SAVED_IDENTITY_DIR',
  'Output bundles include originals, analyzer source, SHA256SUMS.txt, normalized evidence and the session manifest.',
].join('\n');

async function main() {
  const { command, options: opts } = parse(process.argv.slice(2));
  if (command === 'help') {
    process.stdout.write(HELP + '\n');
    return;
  }
  let result;
  if (command === 'doctor') {
    result = await doctor({
      clientFile: opts['--client'],
      expectedHost: opts['--expect-host'],
      expectedSha256: opts['--expect-sha'] ?? null,
    });
  } else if (command === 'session') {
    result = await session({
      clientFile: opts['--client'],
      expectedHost: opts['--expect-host'],
      expectedSha256: opts['--expect-sha'] ?? null,
      telemetryFile: opts['--telemetry'],
      trackFile: opts['--track'],
      outputDir: opts['--out'],
      python: opts['--python'] ?? DEFAULT_PYTHON,
      rr2File: opts['--rr2'] ?? null,
      rreFile: opts['--rre'] ?? null,
      rreBindingFile: opts['--rre-binding'] ?? null,
    });
  } else if (command === 'patch') {
    result = await comparePatch({
      beforeFile: opts['--before'],
      afterFile: opts['--after'],
      outputDir: opts['--out'],
      expectedHost: opts['--expect-host'],
      expectedBeforeSha256: opts['--expected-before-sha'],
      expectedAfterSha256: opts['--expected-after-sha'] ?? null,
      anchorsFile: opts['--anchors'] ?? null,
      python: opts['--python'] ?? DEFAULT_PYTHON,
    });
  } else if (command === 'physical') {
    const rawPid = opts['--pid'];
    if (rawPid !== undefined && !/^[1-9][0-9]*$/.test(rawPid)) {
      throw new ResearchError('INVALID_PID', 'PID must be a positive decimal integer without leading zeros.');
    }
    result = await physicalRiftIdentity({
      expectedHost: opts['--expect-host'],
      expectedSha256: opts['--expect-sha'] ?? null,
      pid: rawPid === undefined ? null : Number(rawPid),
    });
    if (opts['--out']) result = { ...result, receipt: await savePhysicalReceipt(result, opts['--out']) };
  } else if (command === 'verify-physical') {
    if (!opts['--bundle'])
      throw new ResearchError('MISSING_ARGUMENT', 'Physical verification requires --bundle.');
    result = await verifyPhysicalReceipt(opts['--bundle']);
  } else if (command === 'verify-patch') {
    if (!opts['--bundle'])
      throw new ResearchError('MISSING_ARGUMENT', 'Patch verification requires --bundle.');
    result = await verifyPatch(opts['--bundle']);
  } else {
    if (!opts['--bundle']) throw new ResearchError('MISSING_ARGUMENT', 'Verify requires --bundle.');
    result = await verifyBundle(opts['--bundle']);
  }
  process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n');
}

main().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      code: error instanceof ResearchError ? error.code : 'UNEXPECTED',
      message: error.message,
    }) + '\n',
  );
  process.exitCode = 2;
});
