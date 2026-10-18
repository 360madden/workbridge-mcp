import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

if (process.platform === 'win32') {
  const windows = process.env.SystemRoot ?? 'C:\\Windows';
  const compiler = ['Framework64', 'Framework']
    .map((arch) => path.join(windows, 'Microsoft.NET', arch, 'v4.0.30319', 'csc.exe'))
    .find(existsSync);
  if (!compiler)
    throw new Error('Windows .NET Framework C# compiler is required to build the command Job Object host.');
  const sources = ['scripts/Tunnel-ProcessLifetime.cs', 'scripts/Command-Host.cs'];
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const inputs = hash(Buffer.concat([readFileSync(compiler), ...sources.map((file) => readFileSync(file))]));
  const output = path.resolve('dist/command-host.exe');
  const receipt = path.resolve('dist/command-host-build.json');
  try {
    const previous = JSON.parse(readFileSync(receipt, 'utf8'));
    if (previous.inputs === inputs && previous.output === hash(readFileSync(output))) {
      console.log('Windows command host is up to date (compiler, sources, and executable verified).');
      process.exit(0);
    }
  } catch {
    /* A missing/invalid build receipt requires a real compilation. */
  }
  execFileSync(
    compiler,
    [
      '/nologo',
      '/target:exe',
      '/optimize+',
      `/out:${output}`,
      path.resolve('scripts/Tunnel-ProcessLifetime.cs'),
      path.resolve('scripts/Command-Host.cs'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  writeFileSync(receipt, JSON.stringify({ inputs, output: hash(readFileSync(output)) }) + '\n');
}
