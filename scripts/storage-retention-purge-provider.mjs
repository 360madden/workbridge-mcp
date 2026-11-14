import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';

const fail = (code) => Object.assign(new Error(code), { code });
const id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const sha = /^[a-f0-9]{64}$/;
const replyLimit = 16 * 1024 * 1024;
const totalLimit = 32 * 1024 * 1024;
// The bootstrap holds a no-write/no-delete-share handle while executing the exact
// hash-verified bytes. All variable values are environment data, never shell code.
const bootstrap = String.raw`
$ErrorActionPreference='Stop'
$pin=$null
try {
  $pin=[IO.File]::Open($env:WB_PURGE_HELPER,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  if($pin.Length -gt 1048576 -or $pin.Length -le 0) { throw 'PURGE_HELPER_SIZE' }
  $bytes=[byte[]]::new([int]$pin.Length); $offset=0
  while($offset -lt $bytes.Length) { $n=$pin.Read($bytes,$offset,$bytes.Length-$offset); if($n -eq 0){throw 'PURGE_HELPER_CHANGED'}; $offset+=$n }
  $hash=[Security.Cryptography.SHA256]::Create()
  try { $actual=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
  if($actual -cne $env:WB_PURGE_HELPER_SHA) { throw 'PURGE_HELPER_HASH_MISMATCH' }
  $source=([Text.UTF8Encoding]::new($false,$true)).GetString($bytes)
  $parameters=@{InstallRoot=$env:WB_PURGE_ROOT;OperationId=$env:WB_PURGE_ID;UpdaterOperationId=$env:WB_PURGE_UPDATER;Kind=$env:WB_PURGE_KIND;ExpectedPurgeSha256=$env:WB_PURGE_APPROVAL;ExpectedManifestSha256=$env:WB_PURGE_MANIFEST;ConfirmPermanentlyDelete=$env:WB_PURGE_ID;MaintenanceConfirmed=$true;TimeoutSeconds=120}
  if($env:WB_PURGE_KIND -ceq 'displaced') { $parameters.DisplacedId=$env:WB_PURGE_DISPLACED }
  & ([ScriptBlock]::Create($source)) @parameters
} catch { [Console]::Error.WriteLine('PURGE_HELPER_BOOTSTRAP_FAILED'); exit 1 }
finally { if($null -ne $pin){$pin.Dispose()} }
`;
const encodedBootstrap = Buffer.from(bootstrap, 'utf16le').toString('base64');

function validate(ctx) {
  if (
    !ctx ||
    !path.isAbsolute(ctx.installRoot ?? '') ||
    !id.test(ctx.operationId ?? '') ||
    !id.test(ctx.plan?.updaterOperationId ?? '') ||
    !['candidate', 'displaced'].includes(ctx.plan?.kind) ||
    (ctx.plan.kind === 'displaced' && !/^[a-f0-9]{32}$/.test(ctx.plan.displacedId ?? '')) ||
    ctx.maintenanceConfirmed !== true ||
    ctx.confirmPermanentlyDelete !== ctx.operationId ||
    !sha.test(ctx.expectedPurgeSha256 ?? '') ||
    !sha.test(ctx.expectedManifestSha256 ?? '') ||
    !sha.test(ctx.expectedHelperSha256 ?? '')
  )
    throw fail('PURGE_PROVIDER_CONTEXT_INVALID');
}

async function start(ctx, options) {
  validate(ctx);
  if (process.platform !== 'win32' && !options.spawn) throw fail('WINDOWS_PURGE_REQUIRED');
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const helper = fileURLToPath(new URL('./Storage-RetentionPurge.ps1', import.meta.url));
  const env = {
    ...process.env,
    WB_PURGE_HELPER: helper,
    WB_PURGE_HELPER_SHA: ctx.expectedHelperSha256,
    WB_PURGE_ROOT: ctx.installRoot,
    WB_PURGE_ID: ctx.operationId,
    WB_PURGE_UPDATER: ctx.plan.updaterOperationId,
    WB_PURGE_KIND: ctx.plan.kind,
    WB_PURGE_DISPLACED: ctx.plan.displacedId ?? '',
    WB_PURGE_APPROVAL: ctx.expectedPurgeSha256,
    WB_PURGE_MANIFEST: ctx.expectedManifestSha256,
  };
  const child = (options.spawn ?? spawn)(
    executable,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedBootstrap],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env },
  );
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decoded = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        callback(null, decoder.decode(chunk, { stream: true }));
      } catch {
        callback(fail('PURGE_HELPER_UTF8_INVALID'));
      }
    },
    flush(callback) {
      try {
        callback(null, decoder.decode());
      } catch {
        callback(fail('PURGE_HELPER_UTF8_INVALID'));
      }
    },
  });
  const lines = createInterface({ input: decoded, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  let error = null,
    notifyError,
    total = 0,
    stderr = 0,
    busy = false;
  const failed = new Promise((resolve) => {
    notifyError = resolve;
  });
  const reject = (code) => {
    if (!error) {
      error = code;
      notifyError(code);
    }
  };
  child.stdout.on('data', (chunk) => {
    total += chunk.length;
    if (total > totalLimit) {
      reject('PURGE_HELPER_OUTPUT_LIMIT');
      child.kill();
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.length;
    if (stderr > 8192) {
      reject('PURGE_HELPER_OUTPUT_LIMIT');
      child.kill();
    }
  });
  child.on('error', () => reject('PURGE_HELPER_FAILED'));
  child.stdin.on('error', () => reject('PURGE_HELPER_FAILED'));
  decoded.on('error', () => {
    reject('PURGE_HELPER_UTF8_INVALID');
    child.kill();
  });
  child.stdout.pipe(decoded);
  const exited = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  const wall = setTimeout(() => {
    reject('PURGE_HELPER_DEADLINE');
    child.kill();
  }, options.wallMs ?? 1800000);
  async function read() {
    let timer;
    try {
      if (error) throw fail(error);
      const item = await Promise.race([
        iterator.next(),
        failed.then((code) => {
          throw fail(code);
        }),
        new Promise((_, rejectTimeout) => {
          timer = setTimeout(
            () => rejectTimeout(fail('PURGE_HELPER_REPLY_TIMEOUT')),
            options.replyMs ?? 130000,
          );
        }),
      ]);
      if (error) throw fail(error);
      if (item.done || Buffer.byteLength(item.value, 'utf8') > replyLimit)
        throw fail('PURGE_HELPER_REPLY_INVALID');
      let result;
      try {
        result = JSON.parse(item.value);
      } catch {
        throw fail('PURGE_HELPER_REPLY_INVALID');
      }
      if (result?.status === 'error') throw fail('PURGE_HELPER_REFUSED');
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw fail('PURGE_HELPER_REPLY_INVALID');
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
  async function close() {
    clearTimeout(wall);
    child.stdin.end();
    const wait = async (ms) => {
      let timer;
      try {
        return await Promise.race([
          exited.then(() => true),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), ms);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      if (!(await wait(options.closeMs ?? 5000))) {
        child.kill();
        if (!(await wait(options.killMs ?? 2000))) throw fail('PURGE_HELPER_CLEANUP_UNVERIFIED');
      }
      if ((await exited) !== 0) throw fail('PURGE_HELPER_EXIT_FAILED');
    } finally {
      lines.close();
    }
  }
  try {
    const ready = await read();
    if (
      ready.status !== 'ready' ||
      ready.operationId !== ctx.operationId ||
      ready.manifestSha256 !== ctx.expectedManifestSha256 ||
      !Number.isSafeInteger(ready.entryCount) ||
      ready.entryCount < 1 ||
      ready.entryCount > 20000
    )
      throw fail('PURGE_HELPER_READY_MISMATCH');
    return {
      close,
      async command(command) {
        if (busy) throw fail('PURGE_HELPER_CONCURRENT');
        busy = true;
        try {
          const line = JSON.stringify(command) + '\n';
          if (Buffer.byteLength(line) > 8192) throw fail('PURGE_HELPER_COMMAND_LIMIT');
          if (error) throw fail(error);
          child.stdin.write(line);
          const result = await read();
          if (result.status !== 'ok') throw fail('PURGE_HELPER_REPLY_INVALID');
          return result;
        } finally {
          busy = false;
        }
      },
    };
  } catch (e) {
    await close();
    throw e;
  }
}

export function createPurgeProvider({ revalidateSafety, testDependencies = {} } = {}) {
  return {
    revalidateSafety,
    async withPurgeLease(ctx, callback) {
      if (typeof callback !== 'function') throw fail('PURGE_PROVIDER_CONTEXT_INVALID');
      const helper = await start(ctx, testDependencies);
      try {
        return await callback({
          async readJournals() {
            const result = await helper.command({ command: 'readJournals' });
            if (
              !result.files ||
              typeof result.files !== 'object' ||
              Array.isArray(result.files) ||
              Object.keys(result.files).length > 1264
            )
              throw fail('PURGE_HELPER_REPLY_INVALID');
            const files = Object.create(null);
            for (const [name, value] of Object.entries(result.files)) {
              if (
                typeof value !== 'string' ||
                !value.isWellFormed() ||
                Buffer.byteLength(value, 'utf8') > (name === 'purge-manifest.json' ? 8 * 1024 * 1024 : 65536)
              )
                throw fail('PURGE_HELPER_REPLY_INVALID');
              files[name] = Buffer.from(value, 'utf8');
            }
            return files;
          },
          inspectRemaining: ({ committedPrefix, inflightEnd }) =>
            helper.command({ command: 'inspectRemaining', committedPrefix, inflightEnd }),
          deleteBatch: ({ start, end }) => helper.command({ command: 'deleteBatch', start, end }),
          async publish(kind, record) {
            if (!['purging', 'intent', 'done', 'purged'].includes(kind)) throw fail('PURGE_PUBLISH_INVALID');
            await helper.command({ command: 'publish', kind, record });
          },
        });
      } finally {
        await helper.close();
      }
    },
  };
}
