import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import os from 'node:os';
import {
  createResponseRequest,
  parseArgs,
  CompanionError,
  MAX_INPUT_BYTES,
  REPOSITORY_ROOT,
} from '../src/config.mjs';
import { createOpenAIClient, executeSingleResponse } from '../src/responses.mjs';
import {
  createReadOnlyBridge,
  parseReadOnlyCliOutput,
  validateReadOnlyCall,
} from '../src/workbridge-readonly.mjs';

const cli = join(import.meta.dirname, '..', 'src', 'cli.mjs');

test('defaults are a non-live Sol/medium plan', () => {
  const parsed = parseArgs(['plan']);
  assert.equal(parsed.model, 'gpt-6.2-sol');
  assert.equal(parsed.effort, 'medium');
  assert.equal(parsed.live, false);
});

test('explicit Astra/xhigh is supported without enabling a call', () => {
  const opts = parseArgs(['plan', '--model', 'gpt-6.2-astra', '--effort', 'xhigh']);
  assert.equal(opts.model, 'gpt-6.2-astra');
  assert.equal(opts.live, false);
});

test('invalid models and efforts fail closed', () => {
  assert.throws(() => parseArgs(['plan', '--model', 'gpt-7']), { code: 'INVALID_MODEL' });
  assert.throws(() => parseArgs(['plan', '--effort', 'none']), { code: 'INVALID_EFFORT' });
  assert.throws(() => parseArgs(['plan', '--max-output-tokens', '900000']), { code: 'INVALID_OUTPUT_LIMIT' });
  assert.throws(() => parseArgs(['plan', '--model', 'gpt-6.2-sol', '--model', 'gpt-6.2-astra']), {
    code: 'DUPLICATE_OPTION',
  });
});

test('response request is bounded, nonstored, and matches the public API shape', () => {
  const opts = parseArgs(['run', '--input-file', 'fixture.txt', '--live']);
  assert.deepEqual(createResponseRequest(opts, 'Inspect repository tests.'), {
    model: 'gpt-6.2-sol',
    reasoning: { effort: 'medium' },
    input: 'Inspect repository tests.',
    store: false,
    max_output_tokens: 800,
  });
  assert.throws(() => createResponseRequest(opts, 'x'.repeat(MAX_INPUT_BYTES + 1)), {
    code: 'INPUT_TOO_LARGE',
  });
  assert.throws(() => createResponseRequest(opts, ''), { code: 'EMPTY_INPUT' });
});

test('fake provider produces a bounded receipt with token usage', async () => {
  let submitted;
  const fake = {
    responses: {
      create: async (request) => {
        submitted = request;
        return {
          id: 'resp_fake',
          model: 'gpt-6.2-sol',
          status: 'completed',
          output_text: 'Reviewed tests.',
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        };
      },
    },
  };
  const request = createResponseRequest(parseArgs(['run', '--input-file', 'dummy', '--live']), 'Tests');
  const result = await executeSingleResponse({ client: fake, request, clock: () => 100 });
  assert.equal(result.responseId, 'resp_fake');
  assert.equal(result.output, 'Reviewed tests.');
  assert.equal(result.usage.totalTokens, 30);
  assert.equal(submitted.store, false);
});

test('provider errors are sanitized and do not expose request or key content', async () => {
  const fake = {
    responses: {
      create: async () => {
        throw Object.assign(new Error('PRIVATE KEY AND PROMPT'), { status: 429 });
      },
    },
  };
  const request = { model: 'gpt-6.2-sol' };
  await assert.rejects(executeSingleResponse({ client: fake, request }), (error) => {
    assert.equal(error.code, 'OPENAI_REQUEST_FAILED');
    assert.equal(error.status, 429);
    assert.ok(!error.message.includes('PRIVATE'));
    return true;
  });
});

test('missing key is rejected before client creation', async () => {
  await assert.rejects(createOpenAIClient(''), { code: 'MISSING_API_KEY' });
});

test('offline CLI doctor and plan make no API calls', () => {
  for (const command of ['doctor', 'plan']) {
    const result = spawnSync(process.execPath, [cli, command], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, OPENAI_API_KEY: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.command, command);
    if (command === 'doctor') assert.equal(json.apiCallsMade, 0);
    else assert.equal(json.liveApiCall, false);
  }
});

test('live API requires both explicit opt-in and key', () => {
  const offline = spawnSync(process.execPath, [cli, 'run', '--input-file', 'dummy'], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, OPENAI_API_KEY: '' },
  });
  assert.equal(offline.status, 1);
  assert.equal(JSON.parse(offline.stderr).code, 'LIVE_OPT_IN_REQUIRED');
  const noKey = spawnSync(process.execPath, [cli, 'run', '--input-file', 'dummy', '--live'], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, OPENAI_API_KEY: '' },
  });
  assert.equal(noKey.status, 1);
  assert.equal(JSON.parse(noKey.stderr).code, 'MISSING_API_KEY');
});

test('bridge-doctor accepts no paid API or input flags', () => {
  assert.equal(parseArgs(['bridge-doctor']).command, 'bridge-doctor');
  assert.throws(() => parseArgs(['bridge-doctor', '--live']), { code: 'INVALID_MODE' });
});

test('bridge tool allowlist rejects command execution and malformed arguments', () => {
  validateReadOnlyCall('workspace_info', {});
  assert.throws(() => validateReadOnlyCall('terminal_run', {}), { code: 'BRIDGE_TOOL_NOT_ALLOWED' });
  assert.throws(() => validateReadOnlyCall('read_file', []), { code: 'INVALID_BRIDGE_ARGUMENTS' });
  assert.throws(() => validateReadOnlyCall('read_file', { path: 'x'.repeat(9000) }), {
    code: 'BRIDGE_ARGUMENTS_TOO_LARGE',
  });
});

test('read-only CLI result parsing rejects wrong tool, failures and multiple rows', () => {
  const row = {
    schemaVersion: 1,
    tool: 'workspace_info',
    index: 0,
    ok: true,
    result: { computerName: 'AMD-DESKTOP' },
  };
  assert.equal(
    parseReadOnlyCliOutput(JSON.stringify(row) + '\n', 'workspace_info').computerName,
    'AMD-DESKTOP',
  );
  assert.throws(() => parseReadOnlyCliOutput(JSON.stringify(row), 'terminal_run'), {
    code: 'BRIDGE_TOOL_FAILED',
  });
  assert.throws(
    () => parseReadOnlyCliOutput(JSON.stringify(row) + '\n' + JSON.stringify(row), 'workspace_info'),
    {
      code: 'BRIDGE_OUTPUT_INVALID',
    },
  );
});

test('bridge identity preflight and read-only tool relay use one verified owner', async () => {
  const fakeHost = os.hostname();
  const fakeRoot = dirname(REPOSITORY_ROOT);
  const calls = [];
  const bridge = await createReadOnlyBridge({
    expectedHostname: fakeHost,
    invoke: async (tool, args) => {
      calls.push({ tool, args });
      if (tool === 'workspace_info') {
        return {
          computerName: fakeHost,
          root: fakeRoot,
          version: '0.16.5-dev',
          localCli: { enabled: true },
          limits: { commandJobs: 36, coordinatedWorkers: 36 },
        };
      }
      return { path: args.path, content: 'read-only fixture' };
    },
  });
  assert.equal(bridge.identity.commandJobSlots, 36);
  assert.equal(
    (await bridge.callTool('read_file', { path: 'workbridge-mcp/README.md' })).content,
    'read-only fixture',
  );
  assert.deepEqual(
    calls.map((c) => c.tool),
    ['workspace_info', 'read_file'],
  );
  await assert.rejects(bridge.callTool('command_run', {}), { code: 'BRIDGE_TOOL_NOT_ALLOWED' });
});

test('bridge identity mismatch rejects before any project tool invocation', async () => {
  await assert.rejects(
    createReadOnlyBridge({
      expectedHostname: os.hostname(),
      invoke: async () => ({
        computerName: 'WRONG-PC',
        root: dirname(REPOSITORY_ROOT),
        version: '0.16.5-dev',
        localCli: { enabled: true },
      }),
    }),
    { code: 'BRIDGE_IDENTITY_MISMATCH' },
  );
});
