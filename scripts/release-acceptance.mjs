import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const expectedIndex = process.argv.indexOf('--expected-version');
const expectedVersion = process.argv.includes('--observe-version')
  ? null
  : expectedIndex >= 0
    ? process.argv[expectedIndex + 1]
    : pkg.version;
if (expectedIndex >= 0) assert.ok(expectedVersion, 'Expected version argument is required');
const client = new Client({ name: 'workbridge-release-probe', version: '1' });
const env = getDefaultEnvironment();
for (const name of ['WORKBRIDGE_ROOT', 'WORKBRIDGE_STATE_DIR']) {
  if (process.env[name]) env[name] = process.env[name];
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve('dist/server.js')],
  env,
  stderr: 'pipe',
});
const deadline = setTimeout(() => {
  if (transport.pid) {
    try {
      process.kill(transport.pid);
    } catch {
      // The failed probe may already have exited.
    }
  }
  console.error('Release probe exceeded its 20-second deadline.');
  process.exit(1);
}, 20_000);
try {
  await client.connect(transport);
  const runtimeVersion = client.getServerVersion().version;
  assert.ok(runtimeVersion);
  if (expectedVersion) assert.equal(runtimeVersion, expectedVersion);
  const { tools } = await client.listTools();
  const expectedTools = runtimeVersion === '0.3.0' ? 32 : 33;
  assert.equal(tools.length, expectedTools);
  const result = await client.callTool({ name: 'workspace_info', arguments: {} });
  assert.ok(!result.isError);
  const info = JSON.parse(result.content[0].text);
  assert.equal(info.version, runtimeVersion);
  assert.deepEqual(info, result.structuredContent);
  const report = {
    version: info.version,
    packageVersion: pkg.version,
    toolCount: tools.length,
    transport: 'local stdio',
    hostedVerified: false,
  };
  if (process.env.WORKBRIDGE_STATE_DIR) {
    await mkdir(process.env.WORKBRIDGE_STATE_DIR, { recursive: true });
    await writeFile(
      path.join(process.env.WORKBRIDGE_STATE_DIR, 'release-probe.json'),
      JSON.stringify(report, null, 2),
    );
  }
  console.log(JSON.stringify(report));
} finally {
  await client.close();
  clearTimeout(deadline);
}
