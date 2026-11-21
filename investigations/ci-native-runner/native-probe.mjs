#!/usr/bin/env node
// One-off Windows CI diagnosis. Only disposable copies are instrumented.
// Never opens Workbridge .local, uses Git credentials, or touches a game process.
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const root = mkdtempSync(path.join(os.tmpdir(), 'wb-native-runner-probe-'));
const errorCode = (text, prefix) =>
  [
    ...new Set(
      [...text.matchAll(new RegExp('\\b' + prefix + '[A-Za-z0-9_]+_L[0-9]+\\b', 'g'))].map((m) => m[0]),
    ),
  ].slice(0, 16);
const source = (name) => readFileSync(path.join(repo, 'scripts', name), 'utf8');
const replaceExactlyOnce = (text, original, replacement, code) => {
  if (text.indexOf(original) < 0 || text.indexOf(original) !== text.lastIndexOf(original))
    throw new Error(code);
  return text.replace(original, replacement);
};

function gitAuditProbe() {
  const scripts = path.join(root, 'git', 'scripts');
  const tests = path.join(root, 'git', 'test');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tests);
  const original = "if ($code -notin $safeCodes) { $code = 'AUDIT_FAILED' }";
  const diagnostic =
    "if ($code -notin $safeCodes) { $code = ('AUDIT_DIAG_' + $_.Exception.GetType().Name + '_L' + $_.InvocationInfo.ScriptLineNumber) }";
  const audit = replaceExactlyOnce(
    source('Audit-WorkbridgeGit.ps1'),
    original,
    diagnostic,
    'AUDIT_SOURCE_CHANGED',
  );
  writeFileSync(path.join(scripts, 'Audit-WorkbridgeGit.ps1'), audit);
  copyFileSync(
    path.join(repo, 'scripts', 'plan-scoped-git-checkpoints.mjs'),
    path.join(scripts, 'plan-scoped-git-checkpoints.mjs'),
  );
  copyFileSync(
    path.join(repo, 'test', 'git-baseline-audit.test.mjs'),
    path.join(tests, 'git-baseline-audit.test.mjs'),
  );
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', path.join(tests, 'git-baseline-audit.test.mjs')],
    {
      cwd: repo,
      env: process.env,
      timeout: 60000,
      maxBuffer: 3 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  const output = (result.stdout || '') + '\n' + (result.stderr || '');
  return {
    passed: result.status === 0,
    exitCode: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    tests: Number(output.match(/(?:ℹ|#)\s+tests\s+(\d+)/)?.[1] ?? 0),
    failed: Number(output.match(/(?:ℹ|#)\s+fail\s+(\d+)/)?.[1] ?? 0),
    diagnostics: errorCode(output, 'AUDIT_DIAG_'),
  };
}

async function archivePrivateHelperProbe(attemptOwnerRepair = false, fixtureRoot = root) {
  const directory = path.join(fixtureRoot, attemptOwnerRepair ? 'archive-private-repair' : 'archive-private');
  const input = source('Job-Archive-Private.ps1');
  const original = "} catch { [Console]::Error.WriteLine('PRIVATE_DIRECTORY_FAILED');exit 1 }";
  const diagnostic =
    "} catch { $known=@('PRIVATE_OWNER_INVALID','PRIVATE_ACL_INVALID','PRIVATE_DIRECTORY_PIN_FAILED','INVALID_PRIVATE_ITEM');$label=if($_.Exception.Message -in $known){$_.Exception.Message}else{$_.Exception.GetType().Name};[Console]::Error.WriteLine('PRIVATE_DIRECTORY_DIAG_' + $label + '_L' + $_.InvocationInfo.ScriptLineNumber);exit 1 }";
  const helperPath = path.join(
    fixtureRoot,
    attemptOwnerRepair ? 'Job-Archive-Private.repair.ps1' : 'Job-Archive-Private.probe.ps1',
  );
  let helper = replaceExactlyOnce(input, original, diagnostic, 'PRIVATE_SOURCE_CHANGED');
  if (attemptOwnerRepair) {
    const before =
      "if($Mode -eq 'Create') { [ArchivePrivateDirectory]::Create($Directory,$acl.GetSecurityDescriptorBinaryForm()) }";
    const after =
      before +
      "\n  if($Mode -eq 'Create') { $ownerAcl=[IO.Directory]::GetAccessControl($Directory);if($ownerAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){$ownerAcl.SetOwner($sid);[IO.Directory]::SetAccessControl($Directory,$ownerAcl)} }";
    helper = replaceExactlyOnce(helper, before, after, 'OWNER_REPAIR_MARKER_MISSING');
  }
  writeFileSync(helperPath, helper);
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const child = spawn(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'RemoteSigned',
      '-File',
      helperPath,
      '-Directory',
      directory,
    ],
    { cwd: fixtureRoot, env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let ready = false;
  let verified = 0;
  let unexpectedOutput = 0;
  let stderr = '';
  let stdinFailure = false;
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-2048);
  });
  child.stdin.on('error', () => {
    stdinFailure = true;
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (line === 'READY' && !ready) {
      ready = true;
      try {
        writeFileSync(path.join(directory, 'original.json.gz'), Buffer.from('synthetic-archive-test'));
        writeFileSync(path.join(directory, 'proposal.json'), Buffer.from('{}'));
        child.stdin.write('VERIFY original.json.gz\nVERIFY proposal.json\n');
      } catch {
        stdinFailure = true;
        child.stdin.end();
      }
    } else if (line === 'VERIFIED') {
      verified++;
      if (verified === 2) child.stdin.end();
    } else {
      unexpectedOutput++;
    }
  });
  const outcome = await new Promise((resolve) => {
    let finished = false;
    const complete = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      complete({ exitCode: null, timedOut: true });
    }, 20000);
    child.once('error', () => complete({ exitCode: null, spawnError: true }));
    child.once('close', (exitCode) => complete({ exitCode }));
  });
  lines.close();
  return {
    attemptOwnerRepair,
    ready,
    verified,
    unexpectedOutput,
    stdinFailure,
    ...outcome,
    diagnostics: errorCode(stderr, 'PRIVATE_DIRECTORY_DIAG_'),
    helperFailureMarker: stderr.includes('PRIVATE_DIRECTORY_FAILED'),
  };
}

async function main() {
  try {
    if (process.platform !== 'win32') {
      console.log(JSON.stringify({ schema: 1, supportedHost: false, reason: 'WINDOWS_ONLY' }));
      return;
    }
    const result = {
      schema: 1,
      diagnosticOnly: true,
      productionScriptsChanged: false,
      nodeVersion: process.versions.node,
      githubActions: process.env.GITHUB_ACTIONS === 'true',
      canonicalTemp:
        path.resolve(os.tmpdir()).toLowerCase() === realpathSync.native(os.tmpdir()).toLowerCase(),
      git: gitAuditProbe(),
      archive: await archivePrivateHelperProbe(),
      archiveOwnerRepair: await archivePrivateHelperProbe(true),
      profileVolumeArchive: { available: false },
    };
    let profileRoot = null;
    try {
      const appData = process.env.LOCALAPPDATA;
      if (appData && path.isAbsolute(appData)) {
        const canonical = realpathSync.native(path.join(appData, 'Temp'));
        profileRoot = mkdtempSync(path.join(canonical, 'wb-native-profile-probe-'));
        result.profileVolumeArchive = {
          available: true,
          ...(await archivePrivateHelperProbe(false, profileRoot)),
        };
      }
    } catch (error) {
      result.profileVolumeArchive = {
        available: false,
        errorCode: typeof error.code === 'string' ? error.code : 'PROFILE_VOLUME_UNAVAILABLE',
      };
    } finally {
      if (profileRoot) {
        try {
          rmSync(profileRoot, { recursive: true, force: true });
        } catch {
          result.profileVolumeArchive.cleanupFailed = true;
        }
      }
    }
    console.log(JSON.stringify(result));
  } finally {
    // The tool creates only its own fresh, random disposable directory.
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(JSON.stringify({ schema: 1, diagnosticOnly: true, errorCode: error.message }));
  process.exitCode = 1;
});
