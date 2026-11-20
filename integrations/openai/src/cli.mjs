#!/usr/bin/env node
import os from 'node:os';
import { argv, env, exitCode, stdout, stderr, version } from 'node:process';
import { randomUUID } from 'node:crypto';
import {
  CompanionError,
  createResponseRequest,
  parseArgs,
  readInputFile,
  REPOSITORY_ROOT,
  MAX_INPUT_BYTES,
} from './config.mjs';
import { createOpenAIClient, executeSingleResponse } from './responses.mjs';

function emit(value) {
  stdout.write(JSON.stringify(value) + '\n');
}
function fail(code, message, status = null) {
  stderr.write(JSON.stringify({ ok: false, code, message, ...(status === null ? {} : { status }) }) + '\n');
  process.exitCode = 1;
}

async function main() {
  const options = parseArgs(argv.slice(2));
  if (options.command === 'doctor') {
    const nodeMajor = Number(version.slice(1).split('.')[0]);
    let sdkInstalled = false;
    try {
      import.meta.resolve('openai');
      sdkInstalled = true;
    } catch {
      // Installation is optional for offline planning.
    }
    emit({
      ok: nodeMajor >= 24,
      command: 'doctor',
      hostname: os.hostname(),
      repositoryRoot: REPOSITORY_ROOT,
      node: version,
      sdkInstalled,
      apiKeyConfigured: Boolean(env.OPENAI_API_KEY),
      apiCallsMade: 0,
      serviceChanged: false,
    });
    if (nodeMajor < 24) process.exitCode = 1;
    return;
  }
  if (options.command === 'plan') {
    emit({
      ok: true,
      command: 'plan',
      hostname: os.hostname(),
      model: options.model,
      effort: options.effort,
      maxOutputTokens: options.maxOutputTokens,
      inputCapBytes: MAX_INPUT_BYTES,
      liveApiCall: false,
      multiAgent: false,
      desktopInput: false,
      serviceChanged: false,
    });
    return;
  }
  if (!options.live) {
    throw new CompanionError(
      'LIVE_OPT_IN_REQUIRED',
      'run is offline by default; --live is required to contact the API.',
    );
  }
  if (!env.OPENAI_API_KEY) {
    throw new CompanionError(
      'MISSING_API_KEY',
      'Set OPENAI_API_KEY outside the repository before a live request.',
    );
  }
  const input = await readInputFile(options.inputFile);
  const request = createResponseRequest(options, input);
  const client = await createOpenAIClient(env.OPENAI_API_KEY);
  const result = await executeSingleResponse({ client, request });
  emit({ ok: true, command: 'run', operationId: randomUUID(), ...result });
}

main().catch((error) => {
  if (error instanceof CompanionError) {
    fail(error.code, error.message, error.status ?? null);
  } else if (error?.code === 'ENOENT') {
    fail('FILE_NOT_FOUND', 'The input text file was not found.');
  } else {
    fail('UNEXPECTED_FAILURE', 'The operation failed; no automatic retry was attempted.');
  }
});
