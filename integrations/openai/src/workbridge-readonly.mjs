import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CompanionError, REPOSITORY_ROOT } from './config.mjs';

const execFileAsync = promisify(execFile);
const CLI_PATH = join(REPOSITORY_ROOT, 'scripts', 'workbridge-cli.mjs');
const STATE_PATH = join(REPOSITORY_ROOT, '.local');
const WORKSPACE_ROOT = dirname(REPOSITORY_ROOT);
const MAX_ARGUMENT_BYTES = 8192;
const MAX_RESULT_BYTES = 120000;
export const READ_ONLY_TOOLS = Object.freeze([
  'workspace_info',
  'project_overview',
  'read_file',
  'search_text',
  'git_status',
  'command_status',
  'command_output',
]);

export function validateReadOnlyCall(tool, args) {
  if (!READ_ONLY_TOOLS.includes(tool)) {
    throw new CompanionError(
      'BRIDGE_TOOL_NOT_ALLOWED',
      'Only the named read-only Workbridge tools are permitted.',
    );
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new CompanionError('INVALID_BRIDGE_ARGUMENTS', 'Bridge arguments must be an object.');
  }
  const encoded = JSON.stringify(args);
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > MAX_ARGUMENT_BYTES) {
    throw new CompanionError('BRIDGE_ARGUMENTS_TOO_LARGE', 'Bridge arguments exceeded the 8 KiB cap.');
  }
}

export function parseReadOnlyCliOutput(stdout, tool) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > MAX_RESULT_BYTES) {
    throw new CompanionError('BRIDGE_OUTPUT_INVALID', 'Workbridge CLI output was too large or invalid.');
  }
  const lines = stdout.split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) {
    throw new CompanionError('BRIDGE_OUTPUT_INVALID', 'Expected exactly one Workbridge CLI result row.');
  }
  let row;
  try {
    row = JSON.parse(lines[0]);
  } catch {
    throw new CompanionError('BRIDGE_OUTPUT_INVALID', 'Workbridge CLI did not return JSON.');
  }
  if (
    row.schemaVersion !== 1 ||
    row.tool !== tool ||
    row.ok !== true ||
    row.result === null ||
    typeof row.result !== 'object' ||
    Array.isArray(row.result)
  ) {
    throw new CompanionError(
      'BRIDGE_TOOL_FAILED',
      'Workbridge read-only tool did not return a successful object.',
    );
  }
  return row.result;
}

export async function invokeReadOnlyCli(tool, args = {}) {
  validateReadOnlyCall(tool, args);
  const tempRoot = join(REPOSITORY_ROOT, 'temp');
  await mkdir(tempRoot, { recursive: true });
  const ownedTempDirectory = await mkdtemp(join(tempRoot, 'wboai-'));
  try {
    const inputFile = join(ownedTempDirectory, 'request.json');
    await writeFile(inputFile, JSON.stringify([{ tool, arguments: args }]), { flag: 'wx', mode: 0o600 });
    const safeEnvironment = { ...process.env };
    delete safeEnvironment.OPENAI_API_KEY;
    delete safeEnvironment.OPENAI_ORG_ID;
    delete safeEnvironment.OPENAI_PROJECT_ID;
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        CLI_PATH,
        '--service-state',
        STATE_PATH,
        '--root',
        WORKSPACE_ROOT,
        '--input',
        inputFile,
        '--timeout',
        '30',
        '--json',
      ],
      {
        cwd: REPOSITORY_ROOT,
        timeout: 35_000,
        windowsHide: true,
        maxBuffer: MAX_RESULT_BYTES,
        encoding: 'utf8',
        env: safeEnvironment,
      },
    );
    return parseReadOnlyCliOutput(stdout, tool);
  } catch (error) {
    if (error instanceof CompanionError) throw error;
    // The raw CLI error could include sensitive process metadata. Never surface it.
    throw new CompanionError(
      'BRIDGE_CONNECTION_FAILED',
      'The authenticated local Workbridge CLI request failed.',
    );
  } finally {
    await rm(ownedTempDirectory, { recursive: true, force: true });
  }
}

export async function createReadOnlyBridge({
  expectedHostname = 'AMD-DESKTOP',
  invoke = invokeReadOnlyCli,
} = {}) {
  const expected = expectedHostname.trim().toUpperCase();
  if (os.hostname().trim().toUpperCase() !== expected) {
    throw new CompanionError(
      'BRIDGE_LOCAL_HOST_MISMATCH',
      'The executing Windows hostname did not match the requested Workbridge host.',
    );
  }
  const info = await invoke('workspace_info', {});
  if (
    info?.computerName?.trim().toUpperCase() !== expected ||
    info?.root?.toLowerCase() !== resolve(WORKSPACE_ROOT).toLowerCase() ||
    typeof info?.version !== 'string' ||
    info.version.length === 0 ||
    info?.localCli?.enabled !== true
  ) {
    throw new CompanionError(
      'BRIDGE_IDENTITY_MISMATCH',
      'The local Workbridge owner identity did not pass preflight.',
    );
  }
  return Object.freeze({
    identity: Object.freeze({
      computerName: info.computerName,
      root: info.root,
      version: info.version,
      commandJobSlots: info.limits?.commandJobs ?? null,
      agentAssignmentSlots: info.limits?.coordinatedWorkers ?? null,
    }),
    async callTool(tool, args = {}) {
      validateReadOnlyCall(tool, args);
      return invoke(tool, args);
    },
  });
}
