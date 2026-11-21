#!/usr/bin/env node
import { validatePlan, describePlan, PlanError } from './plan.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readPlanFile } from './plan-file.mjs';

const HELP = [
  'WB-RIFT-001 — versioned offline research-run planner (no research actions executed).',
  'node src/cli.mjs validate --plan FILE.json',
  'node src/cli.mjs plan --plan FILE.json',
  'Unknown tool actions, plan fields, source paths, and dependency cycles fail closed.',
].join('\n');

function parseArgs(args) {
  const [command, ...rest] = args;
  if (command === 'help' && rest.length === 0) return { command };
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
  const { command, file } = parseArgs(args);
  if (command === 'help') return HELP;
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
        }) + '\n',
      );
      process.exitCode = 2;
    });
}
