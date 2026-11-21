#!/usr/bin/env node
import { validatePlan, describePlan, PlanError } from './plan.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readPlanFile } from './plan-file.mjs';
import { runResearch, verifyResearchRun } from './run.mjs';

const HELP = [
  'WB-RIFT-001 — versioned offline research coordinator (read-only saved inputs).',
  'node src/cli.mjs validate --plan FILE.json',
  'node src/cli.mjs plan --plan FILE.json',
  'node src/cli.mjs run --plan FILE.json --out NEW_DIRECTORY',
  'node src/cli.mjs verify --bundle COMPLETE_RUN_DIRECTORY',
  'Unknown tool actions, plan fields, source paths, and dependency cycles fail closed.',
].join('\n');

function parseArgs(args) {
  const [command, ...rest] = args;
  if (command === 'help' && rest.length === 0) return { command };
  if (
    command === 'run' &&
    rest.length === 4 &&
    rest[0] === '--plan' &&
    rest[2] === '--out' &&
    rest[1] &&
    rest[3] &&
    !rest[1].startsWith('--') &&
    !rest[3].startsWith('--')
  ) {
    return { command, file: rest[1], outputDir: rest[3] };
  }
  if (
    command === 'verify' &&
    rest.length === 2 &&
    rest[0] === '--bundle' &&
    rest[1] &&
    !rest[1].startsWith('--')
  ) {
    return { command, outputDir: rest[1] };
  }
  if (
    !['validate', 'plan'].includes(command) ||
    rest.length !== 2 ||
    rest[0] !== '--plan' ||
    typeof rest[1] !== 'string' ||
    rest[1].startsWith('--')
  ) {
    throw new PlanError('CLI_ARGUMENTS', 'Expected validate|plan --plan FILE.json, or help.');
  }
  return { command, file: rest[1] };
}

export async function main(args = process.argv.slice(2)) {
  const { command, file, outputDir } = parseArgs(args);
  if (command === 'help') return HELP;
  if (command === 'run')
    return JSON.stringify({ ok: true, ...(await runResearch({ planFile: file, outputDir })) });
  if (command === 'verify') return JSON.stringify({ ok: true, ...(await verifyResearchRun(outputDir)) });
  const source = await readPlanFile(file);
  const plan = validatePlan(source.plan);
  const preview = describePlan(plan);
  return JSON.stringify({
    ok: true,
    command,
    planSha256: source.sha256,
    ...preview,
    ...(command === 'validate' ? { valid: true } : {}),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .then((result) => process.stdout.write(result + '\n'))
    .catch((error) => {
      process.stderr.write(
        JSON.stringify({
          ok: false,
          code: error instanceof PlanError ? error.code : 'PLAN_IO_FAILURE',
          message: error.message,
          ...(error.directory ? { outputDirectory: error.directory } : {}),
        }) + '\n',
      );
      process.exitCode = 2;
    });
}
