import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

if (process.platform === 'win32') {
  const windows = process.env.SystemRoot ?? 'C:\\Windows';
  const compiler = ['Framework64', 'Framework']
    .map((arch) => path.join(windows, 'Microsoft.NET', arch, 'v4.0.30319', 'csc.exe'))
    .find(existsSync);
  if (!compiler)
    throw new Error('Windows .NET Framework C# compiler is required to build the command Job Object host.');
  execFileSync(
    compiler,
    [
      '/nologo',
      '/target:exe',
      '/optimize+',
      `/out:${path.resolve('dist/command-host.exe')}`,
      path.resolve('scripts/Tunnel-ProcessLifetime.cs'),
      path.resolve('scripts/Command-Host.cs'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
}
