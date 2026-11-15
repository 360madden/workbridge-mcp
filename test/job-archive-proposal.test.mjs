import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, link, symlink, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobArchiveProposal, parseArgs } from '../scripts/job-archive-proposal.mjs';
const exec = promisify(execFile),
  script = fileURLToPath(new URL('../scripts/job-archive-proposal.mjs', import.meta.url));
const digest = (b) => createHash('sha256').update(b).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-job-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const jobsDirectory = path.join(root, 'jobs'),
    outputDirectory = path.join(root, 'proposal');
  await mkdir(jobsDirectory);
  const bytes = Buffer.from(
    JSON.stringify({
      id: 'job1',
      status: 'passed',
      output: 'sensitive-test-sentinel 😀',
      stdout: 'x',
      stderr: '',
      request: 'test-only',
      other: { keep: true },
    }),
  );
  await writeFile(path.join(jobsDirectory, 'job1.json'), bytes);
  return { root, jobsDirectory, outputDirectory, jobId: 'job1', bytes };
}
test(
  'private one-job gzip is lossless, byte-bound, and leaves original intact',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const result = await createJobArchiveProposal(f);
    const compressed = await readFile(path.join(f.outputDirectory, 'original.json.gz')),
      manifestBytes = await readFile(path.join(f.outputDirectory, 'proposal.json'));
    assert.deepEqual(gunzipSync(compressed), f.bytes);
    assert.deepEqual(await readFile(path.join(f.jobsDirectory, 'job1.json')), f.bytes);
    assert.equal(result.sourceSha256, digest(f.bytes));
    assert.equal(result.gzipSha256, digest(compressed));
    assert.equal(result.proposalBytes, manifestBytes.length);
    assert.equal(
      result.hypotheticalLogicalBytesSaved,
      f.bytes.length - compressed.length - manifestBytes.length,
    );
    assert.equal(result.stdoutLength, 1);
    assert.equal(result.stderrLength, 0);
    assert.equal(result.outputLength, 'sensitive-test-sentinel 😀'.length);
    assert.equal(result.losslessVerified, true);
    assert.equal(result.compactionAuthorized, false);
    assert.equal(result.sourceMutationPerformed, false);
    assert.equal(manifestBytes.includes(Buffer.from('sensitive-test-sentinel')), false);
    if (process.platform !== 'win32') assert.equal((await stat(f.outputDirectory)).mode & 0o077, 0);
    else {
      const powershell = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      const check = `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$acl=[IO.Directory]::GetAccessControl($env:WB_ARCHIVE_TEST_DIR);$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));$bad=@($rules|Where-Object {$_.IdentityReference.Value -notin @($sid,'S-1-5-18') -or $_.IsInherited}).Count;$ok=$acl.AreAccessRulesProtected -and $rules.Count -eq 2 -and $bad -eq 0;foreach($name in @('original.json.gz','proposal.json')){$a=[IO.File]::GetAccessControl([IO.Path]::Combine($env:WB_ARCHIVE_TEST_DIR,$name));$r=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));$badFile=@($r|Where-Object {$_.IdentityReference.Value -notin @($sid,'S-1-5-18')}).Count;if($r.Count -ne 2 -or $badFile -ne 0){$ok=$false}};[Console]::Out.WriteLine($ok)`;
      const verified = await exec(
        powershell,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', check],
        {
          env: { ...process.env, WB_ARCHIVE_TEST_DIR: f.outputDirectory },
        },
      );
      assert.equal(verified.stdout.trim(), 'True');
    }
  },
);
test(
  'CLI emits only metadata and refuses overwrite of existing proposal directory',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const args = [
      script,
      '--jobs-dir',
      f.jobsDirectory,
      '--job-id',
      f.jobId,
      '--output-dir',
      f.outputDirectory,
    ];
    const result = await exec(process.execPath, args);
    assert.equal(result.stdout.includes('sensitive-test-sentinel'), false);
    assert.equal(JSON.parse(result.stdout).jobId, 'job1');
    const archiveBefore = await readFile(path.join(f.outputDirectory, 'original.json.gz'));
    const proposalBefore = await readFile(path.join(f.outputDirectory, 'proposal.json'));
    await assert.rejects(exec(process.execPath, args));
    assert.deepEqual(await readFile(path.join(f.jobsDirectory, 'job1.json')), f.bytes);
    assert.deepEqual(await readFile(path.join(f.outputDirectory, 'original.json.gz')), archiveBefore);
    assert.deepEqual(await readFile(path.join(f.outputDirectory, 'proposal.json')), proposalBefore);
  },
);
test('rejects unsafe IDs, paths, malformed records, and oversized files before creating output', async (t) => {
  const f = await fixture(t);
  for (const jobId of ['../x', 'NUL', 'a/b', 'other.json'])
    await assert.rejects(createJobArchiveProposal({ ...f, jobId }), /INVALID_JOB_ARCHIVE_ARGUMENTS/);
  await assert.rejects(
    createJobArchiveProposal({ ...f, outputDirectory: path.join(f.jobsDirectory, 'nested') }),
    /OUTPUT_OVERLAPS_JOBS/,
  );
  await writeFile(path.join(f.jobsDirectory, 'job1.json'), '{');
  await assert.rejects(createJobArchiveProposal(f), /INVALID_JOB_RECORD/);
  await writeFile(path.join(f.jobsDirectory, 'job1.json'), Buffer.alloc(16 * 1024 * 1024 + 1));
  await assert.rejects(createJobArchiveProposal(f), /UNSAFE_JOB_RECORD/);
  await assert.rejects(stat(f.outputDirectory), { code: 'ENOENT' });
});
test('rejects hardlinked or linked job records and leaves source alone', async (t) => {
  const f = await fixture(t);
  await link(path.join(f.jobsDirectory, 'job1.json'), path.join(f.root, 'alias'));
  await assert.rejects(createJobArchiveProposal(f), /UNSAFE_JOB_RECORD/);
  await rm(path.join(f.root, 'alias'));
  const alias = path.join(f.root, 'jobs-link');
  await symlink(f.jobsDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createJobArchiveProposal({ ...f, jobsDirectory: alias }));
  await assert.rejects(stat(f.outputDirectory), { code: 'ENOENT' });
});
test('changed source refuses to publish a completed proposal', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const changed = Buffer.from(JSON.stringify({ id: 'job1', status: 'passed', output: 'new' }));
  await assert.rejects(
    createJobArchiveProposal(f, {
      afterFirstRead: () => writeFile(path.join(f.jobsDirectory, 'job1.json'), changed),
    }),
    /JOB_RECORD_CHANGED/,
  );
  assert.deepEqual(await readFile(path.join(f.jobsDirectory, 'job1.json')), changed);
  await assert.rejects(stat(path.join(f.outputDirectory, 'proposal.json')), { code: 'ENOENT' });
});
test('parser rejects duplicate, missing, or extra flags', () => {
  assert.throws(() => parseArgs(['--job-id', 'a', '--job-id', 'b']));
  assert.throws(() => parseArgs(['--job-id', 'a']));
  assert.throws(() => parseArgs(['--jobs-dir', 'x', '--job-id', 'a', '--output-dir', 'y', '--extra', 'z']));
});
