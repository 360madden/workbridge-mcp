import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { lstat, mkdir, open } from 'node:fs/promises';
import { windowsMetadata } from './preview-storage-retention.mjs';
import { loadBoundedJson } from './storage-retention-references.mjs';

const fail = (code) => Object.assign(new Error(code), { code });
const id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const canonical = (value) =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
    : JSON.stringify(value);

function checkedContext(ctx) {
  if (
    !ctx ||
    !path.isAbsolute(ctx.installRoot) ||
    !id.test(ctx.operationId) ||
    !id.test(ctx.plan?.updaterOperationId) ||
    !['candidate', 'displaced'].includes(ctx.plan?.kind)
  )
    throw fail('INVALID_MAINTENANCE_CONTEXT');
  const { plan } = ctx;
  if (plan.kind === 'displaced' && !/^[a-f0-9]{32}$/i.test(plan.displacedId ?? ''))
    throw fail('INVALID_MAINTENANCE_CONTEXT');
  const operationDir = path.join(ctx.installRoot, '.local', 'storage-quarantine', ctx.operationId);
  if (ctx.operationDir && ctx.operationDir !== operationDir) throw fail('INVALID_MAINTENANCE_CONTEXT');
  return operationDir;
}

async function ordinaryChain(directory, allowMissing) {
  const metadata = windowsMetadata();
  try {
    const parsed = path.parse(directory);
    let current = parsed.root;
    await metadata.check(current);
    for (const part of directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if (allowMissing && error.code === 'ENOENT') return;
        throw error;
      }
      if (!info.isDirectory() || info.isSymbolicLink()) throw fail('UNSAFE_JOURNAL_ANCESTRY');
      await metadata.check(current);
    }
  } finally {
    metadata.close();
  }
}

export async function prepareOperation(ctx, intent, maintenanceConfirmed = false) {
  if (maintenanceConfirmed !== true) throw fail('MAINTENANCE_REQUIRED');
  const operationDir = checkedContext(ctx);
  const parent = path.dirname(operationDir);
  await ordinaryChain(ctx.installRoot, false);
  await ordinaryChain(parent, true);
  try {
    await mkdir(parent);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await ordinaryChain(parent, false);
  let created = false;
  try {
    await mkdir(operationDir);
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await ordinaryChain(operationDir, false);
  const file = path.join(operationDir, 'intent.json');
  if (created) {
    const handle = await open(file, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(intent)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  const existing = await loadBoundedJson(file, { installRoot: ctx.installRoot, maxBytes: 65536 });
  if (canonical(existing.value) !== canonical(intent)) throw fail('OPERATION_ID_REUSE');
  await ordinaryChain(operationDir, false);
}

async function startHelper(ctx, mode, testDependencies = {}) {
  checkedContext(ctx);
  if (process.platform !== 'win32' && !testDependencies.spawn) throw fail('WINDOWS_MAINTENANCE_REQUIRED');
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = fileURLToPath(new URL('./Storage-RetentionMaintenance.ps1', import.meta.url));
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'RemoteSigned',
    '-File',
    script,
    '-Mode',
    mode,
    '-InstallRoot',
    ctx.installRoot,
    '-OperationId',
    ctx.operationId,
    '-UpdaterOperationId',
    ctx.plan.updaterOperationId,
    '-Kind',
    ctx.plan.kind,
    '-TimeoutSeconds',
    '120',
  ];
  if (ctx.plan.kind === 'displaced') args.push('-DisplacedId', ctx.plan.displacedId);
  if (mode === 'Lease') args.push('-MaintenanceConfirmed');
  const child = (testDependencies.spawn ?? spawn)(executable, args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const replies = lines[Symbol.asyncIterator]();
  let failure = null,
    stderrBytes = 0,
    stdoutBytes = 0;
  let signalFailure;
  const failed = new Promise((resolve) => {
    signalFailure = resolve;
  });
  const rejectHelper = (code) => {
    if (!failure) {
      failure = code;
      signalFailure(code);
    }
  };
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > 65536) {
      rejectHelper('HELPER_OUTPUT_LIMIT');
      child.kill();
    }
  });
  child.on('error', () => {
    rejectHelper('MAINTENANCE_HELPER_FAILED');
  });
  child.stdin.on('error', () => {
    rejectHelper('MAINTENANCE_HELPER_FAILED');
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > 8192) {
      rejectHelper('HELPER_OUTPUT_LIMIT');
      child.kill();
    }
  });
  const exited = new Promise((resolve) => {
    child.once('close', resolve);
  });
  const wall = setTimeout(() => {
    rejectHelper('MAINTENANCE_DEADLINE');
    child.kill();
  }, 240000);
  let busy = false;
  const read = async () => {
    let timer;
    try {
      if (failure) throw fail(failure);
      const item = await Promise.race([
        replies.next(),
        failed.then((code) => {
          throw fail(code);
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(fail('MAINTENANCE_REPLY_TIMEOUT')), 15000);
        }),
      ]);
      if (failure) throw fail(failure);
      if (item.done || item.value.length > 8192) throw fail('MAINTENANCE_REPLY_INVALID');
      const result = JSON.parse(item.value);
      if (result.status === 'error') throw fail(String(result.code ?? 'MAINTENANCE_REFUSED').slice(0, 300));
      if (
        !['ready', 'ok'].includes(result.status) ||
        result.sameVolume !== true ||
        typeof result.source?.exists !== 'boolean' ||
        typeof result.destination?.exists !== 'boolean'
      )
        throw fail('MAINTENANCE_REPLY_INVALID');
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
  const close = async () => {
    clearTimeout(wall);
    child.stdin.end();
    const waitForExit = async (milliseconds) => {
      let timer;
      try {
        return await Promise.race([
          exited.then(() => true),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), milliseconds);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      if (!(await waitForExit(testDependencies.closeWaitMs ?? 5000))) {
        child.kill();
        if (!(await waitForExit(testDependencies.killWaitMs ?? 2000)))
          throw fail('MAINTENANCE_CLEANUP_UNVERIFIED');
      }
    } finally {
      lines.close();
    }
  };
  try {
    const ready = await read();
    return {
      ready,
      close,
      async command(command) {
        if (busy) throw fail('CONCURRENT_MAINTENANCE_COMMAND');
        busy = true;
        try {
          child.stdin.write(`${JSON.stringify(command)}\n`);
          return await read();
        } finally {
          busy = false;
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export function createMaintenanceAdapter({
  verifyPayload,
  revalidatePlan,
  maintenanceConfirmed = false,
  testDependencies = {},
} = {}) {
  return {
    prepareOperation: (ctx, intent) => prepareOperation(ctx, intent, maintenanceConfirmed),
    revalidatePlan,
    async inspectLocations(ctx) {
      const helper = await startHelper(ctx, 'Inspect', testDependencies);
      try {
        return helper.ready;
      } finally {
        await helper.close();
      }
    },
    async withMaintenance(ctx, callback) {
      if (maintenanceConfirmed !== true) throw fail('MAINTENANCE_REQUIRED');
      const helper = await startHelper(ctx, 'Lease', testDependencies);
      try {
        return await callback({
          inspect: () => helper.command({ command: 'inspect' }),
          moveNoReplace: ({ from, expectedIdentity }) =>
            helper.command({ command: 'move', from, expectedIdentity }),
          publishPhase: ({ phase, planSha256 }) => helper.command({ command: 'phase', phase, planSha256 }),
          verifyPayload: (location, plan) => {
            if (typeof verifyPayload !== 'function') throw fail('PAYLOAD_VERIFIER_REQUIRED');
            return verifyPayload(plan, location === 'source' ? ctx.source : ctx.destination);
          },
        });
      } finally {
        await helper.close();
      }
    },
  };
}
