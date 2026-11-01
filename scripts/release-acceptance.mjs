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
  const agentToolNames = [
    'agent_list',
    'agent_status',
    'agent_owner_of',
    'agent_assign',
    'agent_dispatch',
    'agent_dispatch_next',
    'agent_finish',
    'agent_verify',
  ];
  const agentToolCount = tools.filter((tool) => agentToolNames.includes(tool.name)).length;
  const expectedTools =
    runtimeVersion === '0.16.4-dev'
      ? agentToolCount === 0
        ? 56
        : 64
      : [
            '0.15.0-dev',
            '0.15.1-dev',
            '0.15.2-dev',
            '0.16.0-dev',
            '0.16.1-dev',
            '0.16.2-dev',
            '0.16.3-dev',
          ].includes(runtimeVersion)
        ? 52
        : ['0.11.0-dev', '0.12.0-dev', '0.12.1-dev', '0.12.2-dev', '0.13.0-dev', '0.14.0-dev'].includes(
              runtimeVersion,
            )
          ? 51
          : runtimeVersion === '0.10.0-dev'
            ? 49
            : runtimeVersion === '0.9.0-dev'
              ? 48
              : runtimeVersion === '0.8.0-dev'
                ? 42
                : runtimeVersion === '0.3.0'
                  ? 32
                  : ['0.6.3-dev', '0.7.0-dev'].includes(runtimeVersion)
                    ? 35
                    : runtimeVersion === '0.6.2-dev'
                      ? 34
                      : 33;
  assert.equal(tools.length, expectedTools);
  if (runtimeVersion === '0.16.4-dev' && agentToolCount !== 0) {
    assert.equal(agentToolCount, agentToolNames.length, 'Incomplete coordination tool catalog');
    for (const name of agentToolNames)
      assert.ok(
        tools.some((tool) => tool.name === name),
        `Missing coordination tool: ${name}`,
      );
  }
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
