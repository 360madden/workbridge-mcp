// Isolated integration test of the real desktop-monitor.mjs lifecycle.
// Imports are redirected to disposable stubs to avoid live Workbridge.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const fixture = await mkdtemp(path.join(repo, 'temp', 'wbdesktop-eof-'));
let child;
try {
  const original = await readFile(path.join(repo, 'scripts', 'desktop-monitor.mjs'), 'utf8');
  const adapted = original
    .replace("from '@modelcontextprotocol/client'", "from './fake-client.mjs'")
    .replace("from '../dist/local-service.js'", "from './fake-service.mjs'");
  assert.notEqual(adapted, original, 'stub imports must be replaced');
  assert.ok(adapted.includes("from './fake-client.mjs'"));
  assert.ok(adapted.includes("from './fake-service.mjs'"));
  await Promise.all([
    writeFile(path.join(fixture, 'monitor.mjs'), adapted),
    writeFile(path.join(fixture, 'fake-service.mjs'),
      "export async function connectService(){ return {endpoint:{version:'FIXTURE'},transport:{}}; }\n"),
    writeFile(path.join(fixture, 'fake-client.mjs'), [
      'export class Client {',
      '  async connect() {}',
      '  async callTool() {',
      "    process.stderr.write('DIAGNOSTICS_STARTED\\n');",
      '    setInterval(() => {}, 1000);',
      '    return await new Promise(() => {});',
      '  }',
      '  async close() { return await new Promise(() => {}); }',
      '}'
    ].join('\n'))
  ]);

  child = spawn(process.execPath, [path.join(fixture, 'monitor.mjs')], {
    cwd: fixture,
    env: { ...process.env, WORKBRIDGE_DESKTOP_PARENT_PIPE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  let err = '';
  const ready = new Promise((resolve, reject) => {
    child.stderr.on('data', part => {
      err += part.toString('utf8');
      if (err.includes('DIAGNOSTICS_STARTED')) resolve();
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      reject(new Error('Monitor exited before ready: ' + code + '/' + signal + '; ' + err)));
  });
  await Promise.race([
    ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Fixture did not start diagnostics')), 5000))
  ]);
  const started = Date.now();
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  child.stdin.end();
  const completed = await Promise.race([
    exit,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Orphaned monitor survived parent EOF')), 5500))
  ]);
  const elapsedMs = Date.now() - started;
  assert.equal(completed.code, 0, 'parent-loss cleanup should exit cleanly');
  assert.ok(elapsedMs < 5000, 'monitor must exit within shutdown deadline');
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    test: 'desktop-monitor parent EOF with stalled MCP transport',
    actualParentPipeClosed: true,
    diagnosticsWasStalled: true,
    exitedCleanly: true,
    elapsedMs
  }) + '\n');
} finally {
  if (child?.exitCode === null && !child.killed) child.kill();
  await rm(fixture, { recursive: true, force: true });
}
