#!/usr/bin/env node
import { doctor, session, verifyBundle, DEFAULT_PYTHON } from './bundle.mjs';
import { ResearchError } from './identity.mjs';

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
]);

function parse(argv) {
  const [command, ...rest] = argv;
  if (!['doctor', 'session', 'verify', 'help'].includes(command)) {
    throw new ResearchError('COMMAND', 'Expected doctor, session, verify or help.');
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
