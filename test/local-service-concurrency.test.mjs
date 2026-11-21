import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { MAX_CONCURRENT_JOBS } from '../dist/jobs.js';
import { startLocalService, MAX_LOCAL_MCP_CONNECTIONS } from '../dist/local-service.js';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/workbridge-cli.mjs', import.meta.url));
const prefix = path.join(os.tmpdir(), 'wb-mcp-concurrent-clients-');

function clientFailure(error, round, client) {
  // Public CI logs should identify the failure mechanism without printing
  // raw CLI stdout/stderr, request arguments or tokens.
  const rows = String(error.stdout ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 3);
  const codes = [];
  for (const line of rows) {
    try {
      const item = JSON.parse(line);
      const code = item?.result?.error?.code ?? item?.error?.code;
      if (typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)) codes.push(code);
    } catch {
      // A malformed output line is counted but never echoed to CI.
    }
  }
  return JSON.stringify({
    round,
    client,
    exitCode: typeof error.code === 'number' || typeof error.code === 'string' ? error.code : null,
    signal: typeof error.signal === 'string' ? error.signal : null,
    killed: Boolean(error.killed),
    stdoutLines: rows.length,
    stderrPresent: Boolean(error.stderr?.length),
    reportedCodes: codes,
  });
}

test('stress-client failure details never expose raw CLI output', () => {
  const record = clientFailure(
    {
      code: 1,
      stdout: '{"result":{"error":{"code":"CONNECTION_CLOSED","message":"private-token"}}}\n',
      stderr: 'private-secret',
    },
    1,
    4,
  );
  assert.match(record, /CONNECTION_CLOSED/);
  assert.doesNotMatch(record, /private-token|private-secret/);
});

function createPingServer() {
  const server = new McpServer({ name: 'workbridge-concurrent-client-test', version: '0.16.5-dev' });
  server.registerTool(
    'ping',
    { description: 'Synthetic read-only MCP connectivity test.', inputSchema: z.object({}) },
    async () => ({ content: [{ type: 'text', text: 'pong' }], structuredContent: { pong: true } }),
  );
  return server;
}

test(
  'thirty-six independent concurrent MCP CLI clients survive initialization and tool calls',
  { timeout: 70_000, skip: process.platform !== 'win32' },
  async () => {
    assert.ok(
      MAX_LOCAL_MCP_CONNECTIONS >= (MAX_CONCURRENT_JOBS + 1) * 4,
      'HTTP connection budget must allow multiple sockets per worker and coordinator',
    );
    const directory = await mkdtemp(prefix);
    const root = path.join(directory, 'Workspace');
    const state = path.join(directory, 'State');
    const input = path.join(directory, 'ping.json');
    let owner;
    try {
      await mkdir(root);
      await mkdir(state);
      await writeFile(input, JSON.stringify([{ tool: 'ping', arguments: {} }]));
      owner = await startLocalService({
        state,
        root,
        version: '0.16.5-dev',
        createServer: createPingServer,
      });

      async function invoke(round, client) {
        const args = [
          cli,
          '--service-state',
          state,
          '--root',
          root,
          '--input',
          input,
          '--json',
          '--timeout',
          '30',
        ];
        let stdout;
        try {
          ({ stdout } = await execute(process.execPath, args, {
            cwd: path.dirname(cli),
            timeout: 40_000,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
          }));
        } catch (error) {
          throw new Error(clientFailure(error, round, client));
        }
        const rows = stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
        assert.equal(rows.length, 1, 'round=' + round + ' client=' + client);
        assert.equal(rows[0].ok, true, JSON.stringify({ round, client, row: rows[0] }));
        assert.equal(rows[0].result.pong, true, JSON.stringify(rows[0]));
      }

      for (let round = 1; round <= 2; round++) {
        const results = await Promise.allSettled(
          Array.from({ length: MAX_CONCURRENT_JOBS }, (_, i) => invoke(round, i + 1)),
        );
        assert.deepEqual(
          results.flatMap((r, i) =>
            r.status === 'rejected' ? [{ client: i + 1, error: String(r.reason?.message ?? r.reason) }] : [],
          ),
          [],
          'all concurrent clients must succeed in round ' + round,
        );
      }
    } finally {
      await owner?.close();
      assert.ok(directory.startsWith(prefix));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
