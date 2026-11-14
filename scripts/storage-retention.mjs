import path from 'node:path';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadBoundedJson } from './storage-retention-references.mjs';
import {
  createRetentionPlan,
  revalidateRetentionPlan,
  verifyRetentionPayload,
} from './storage-retention-plan.mjs';
import {
  canonicalPlanSha256,
  quarantine,
  retentionStatus,
  restore,
} from './storage-retention-quarantine.mjs';
import { createMaintenanceAdapter } from './storage-retention-maintenance.mjs';
import { inspectPurgeGrace } from './storage-retention-purge.mjs';

const fail = (code) => Object.assign(new Error(code), { code });
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function parseArgs(args) {
  const action = args[0];
  const allowed = {
    plan: ['--install-root', '--updater-operation', '--kind', '--output'],
    quarantine: ['--plan', '--expect-plan-sha256', '--operation-id', '--maintenance-confirmed'],
    status: ['--install-root', '--operation-id'],
    'purge-check': ['--install-root', '--operation-id'],
    restore: ['--install-root', '--operation-id', '--expect-plan-sha256', '--maintenance-confirmed'],
  };
  if (!Object.hasOwn(allowed, action)) throw fail('INVALID_ACTION');
  const result = { action };
  for (let index = 1; index < args.length; index++) {
    const flag = args[index];
    if (!allowed[action].includes(flag) || Object.hasOwn(result, flag)) throw fail('INVALID_ARGUMENTS');
    if (flag === '--maintenance-confirmed') result[flag] = true;
    else {
      if (++index >= args.length || args[index].startsWith('--')) throw fail('MISSING_ARGUMENT');
      result[flag] = args[index];
    }
  }
  const required = allowed[action].filter((name) => name !== '--output');
  if (required.some((name) => result[name] === undefined)) throw fail('MISSING_ARGUMENT');
  for (const name of ['--install-root', '--plan', '--output'])
    if (result[name] && !path.isAbsolute(result[name])) throw fail('ABSOLUTE_PATH_REQUIRED');
  for (const name of ['--operation-id', '--updater-operation'])
    if (result[name] && !identifier.test(result[name])) throw fail('INVALID_OPERATION_ID');
  if (result['--kind'] && !['candidate', 'displaced'].includes(result['--kind'])) throw fail('INVALID_KIND');
  if (result['--expect-plan-sha256'] && !/^[a-f0-9]{64}$/.test(result['--expect-plan-sha256']))
    throw fail('INVALID_PLAN_HASH');
  return result;
}

export async function runRetention(options) {
  let adapter;
  const planning = () => ({ inspectLocations: (context) => adapter.inspectLocations(context) });
  adapter = createMaintenanceAdapter({
    maintenanceConfirmed: options['--maintenance-confirmed'] === true,
    revalidatePlan: (plan) => revalidateRetentionPlan(plan, planning()),
    verifyPayload: (plan, location) => verifyRetentionPayload(plan, location),
  });
  const root = options['--install-root'] ? path.resolve(options['--install-root']) : null;
  if (options.action === 'plan') {
    const plan = await createRetentionPlan(
      { installRoot: root, updaterOperationId: options['--updater-operation'], kind: options['--kind'] },
      planning(),
    );
    if (plan.status === 'refused') return plan;
    const receipt = {
      status: 'planned',
      mutationPerformed: false,
      plan,
      planSha256: canonicalPlanSha256(plan),
    };
    if (options['--output']) {
      const handle = await open(options['--output'], 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    return receipt;
  }
  if (options.action === 'quarantine') {
    const receipt = await loadBoundedJson(options['--plan'], { maxBytes: 65536 });
    if (
      receipt.value.status !== 'planned' ||
      !receipt.value.plan ||
      receipt.value.planSha256 !== options['--expect-plan-sha256']
    )
      throw fail('PLAN_HASH_MISMATCH');
    return quarantine(
      {
        installRoot: receipt.value.plan.installRoot,
        operationId: options['--operation-id'],
        plan: receipt.value.plan,
        expectedPlanSha256: options['--expect-plan-sha256'],
        maintenanceConfirmed: options['--maintenance-confirmed'] === true,
      },
      adapter,
    );
  }
  if (options.action === 'status')
    return retentionStatus({ installRoot: root, operationId: options['--operation-id'] }, adapter);
  if (options.action === 'purge-check')
    return inspectPurgeGrace({ installRoot: root, operationId: options['--operation-id'] }, adapter);
  return restore(
    {
      installRoot: root,
      operationId: options['--operation-id'],
      expectedPlanSha256: options['--expect-plan-sha256'],
      maintenanceConfirmed: options['--maintenance-confirmed'] === true,
    },
    adapter,
  );
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'Workbridge retention (no purge mutation):\n  plan --install-root PATH --updater-operation ID --kind candidate|displaced [--output ABSOLUTE_FILE]\n  quarantine --plan ABSOLUTE_FILE --expect-plan-sha256 SHA --operation-id GCID --maintenance-confirmed\n  status --install-root PATH --operation-id GCID\n  restore --install-root PATH --operation-id GCID --expect-plan-sha256 SHA --maintenance-confirmed\n  purge-check --install-root PATH --operation-id GCID\nPurge-check is read-only grace/location evidence, not deletion authority.\nMaintenance confirmation attests coordinated quiet clients/builders; the updater lock alone is insufficient.\nExit: 0 planned/settled/check passed, 1 refused/conflict/check incomplete, 2 invalid arguments. Quarantine reclaims zero bytes.\n',
    );
    return 0;
  }
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ status: 'refused', code: error.code ?? 'INVALID_ARGUMENTS' })}\n`,
    );
    return 2;
  }
  try {
    const result = await runRetention(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'refused' || result.state === 'conflict' || result.eligible === false ? 1 : 0;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ status: 'refused', code: error.code ?? 'RETENTION_FAILED' })}\n`,
    );
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main(process.argv.slice(2));
