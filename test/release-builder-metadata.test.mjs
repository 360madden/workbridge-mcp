import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const sha = 'a'.repeat(64);
const manifest = (size = '123', schema = '1') =>
  '{"schemaVersion":' +
  schema +
  ',"files":[{"name":"desktop-ui.mjs","sizeBytes":' +
  size +
  ',"sha256":"' +
  sha +
  '"}]}';
const cases = [
  { label: 'positive Int32', json: manifest('123'), accept: true },
  { label: 'minimum size', json: manifest('1'), accept: true },
  { label: 'maximum size', json: manifest('1048576'), accept: true },
  { label: 'string size', json: manifest('"123"'), accept: false },
  { label: 'boolean size', json: manifest('true'), accept: false },
  { label: 'fractional size', json: manifest('123.5'), accept: false },
  { label: 'exponent size', json: manifest('1e2'), accept: false },
  { label: 'null size', json: manifest('null'), accept: false },
  { label: 'zero size', json: manifest('0'), accept: false },
  { label: 'negative size', json: manifest('-1'), accept: false },
  { label: 'oversize', json: manifest('1048577'), accept: false },
  { label: 'string schema', json: manifest('123', '"1"'), accept: false },
  { label: 'object files', json: '{"schemaVersion":1,"files":{}}', accept: false },
  { label: 'null files', json: '{"schemaVersion":1,"files":null}', accept: false },
  {
    label: 'nonstring name',
    json: '{"schemaVersion":1,"files":[{"name":42,"sizeBytes":123,"sha256":"' + sha + '"}]}',
    accept: false,
  },
  {
    label: 'nonstring hash',
    json: '{"schemaVersion":1,"files":[{"name":"desktop-ui.mjs","sizeBytes":123,"sha256":42}]}',
    accept: false,
  },
  {
    label: 'uppercase hash',
    json: manifest().replace(sha, sha.toUpperCase().replaceAll('A', 'B')),
    accept: false,
  },
  { label: 'missing row', json: '{"schemaVersion":1,"files":[]}', accept: false },
];

test(
  'release builder uses strict PowerShell 5.1 desktop runtime manifest metadata types',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    // Parse the existing function definition without executing the release builder.
    // Synthetic manifests are passed on stdin; no release files or services change.
    const ps = [
      "$ErrorActionPreference='Stop'",
      '$tokens=$null; $errors=$null',
      "$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/New-WorkbridgeRelease.ps1'),[ref]$tokens,[ref]$errors)",
      "if ($errors.Count -gt 0) { throw 'Builder PowerShell syntax failed' }",
      "$nodes=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-WBDesktopManifestMetadata'},$true))",
      "if ($nodes.Count -ne 1) { throw 'Expected one metadata validator function' }",
      '. ([scriptblock]::Create($nodes[0].Extent.Text))',
      '$cases=@((ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())))',
      'foreach ($row in $cases) {',
      '  $data=ConvertFrom-Json -InputObject $row.json',
      '  $accepted=$true',
      "  try { Assert-WBDesktopManifestMetadata -Manifest $data -ExpectedNames @('desktop-ui.mjs') } catch { $accepted=$false }",
      "  if ($accepted -ne [bool]$row.accept) { throw ('Unexpected metadata decision for ' + $row.label) }",
      '}',
      "Write-Output ('PASS ' + $cases.Count + ' synthetic cases')",
    ].join('\n');
    const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      cwd: repo,
      input: JSON.stringify(cases),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 16 * 1024,
    });
    assert.equal(child.error, undefined, String(child.error));
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.match(child.stdout, /PASS 18 synthetic cases/);
  },
);
