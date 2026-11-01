#!/usr/bin/env node
// One batch or discovery request against either a fresh isolated owner or the deployed service.
import { readFile, mkdir, realpath, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';

const repo = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
const help = `Workbridge CLI ${pkg.version}
Usage:
  node scripts/workbridge-cli.mjs --root PATH --state-dir NEW_PATH --input FILE [--timeout SECONDS] [--json]
  node scripts/workbridge-cli.mjs --service-state PATH [--root PATH] --input FILE [--timeout SECONDS] [--json]
  node scripts/workbridge-cli.mjs (--root PATH --state-dir NEW_PATH | --service-state PATH) --list-tools [--tool NAME] [--timeout SECONDS] [--json]

Runs a JSON array of requests through one Workbridge connection:
  [{"tool":"workspace_info","arguments":{}},
   {"tool":"command_list","arguments":{"status":"running"}}]
To wait for a launched job, add {"waitForJob":"your-request-id"}.
To advance a saved workflow through validation, add {"runWorkflow":"your-workflow-id"}.
This reuses workflow_resume, waits for existing jobs, and stops at ready_for_review
or a failure. It never retries failed checks automatically. Inspect workflow_status,
then explicitly workflow_resume with retryJobId to authorize one retry.
Patch sets use patch_preview, patch_apply, patch_status, patch_diff, patch_list,
patch_resume, and patch_undo. After uncertainty, inspect the SAME operation ID;
resume or undo explicitly. See docs/multi-file-patches.md for the request format.
Use a request file for large inputs; no shell interpolation or interactive prompts.
Read-only task_context gathers scoped instructions, source hashes, searches and
workflow IDs. Continue the same selection with nextOffset and expectedPlanHash;
section followUp requests independently continue long files/searches.
Structured config_preview/config_apply accept existing JSON or explicit JSONC files,
SHA256 hashes, and JSON Pointer add/replace/remove/test operations. They use the
patch journal: inspect/recover with patch_status/diff/list/resume/undo. Same ID
and request replay without duplicating edits. See docs/structured-config-edits.md.

--root        Existing workspace directory (absolute).
--state-dir   New private state directory (absolute, parent must exist).
              Existing directories are refused; never use live bridge state.
--service-state
              Existing deployed-service state path (absolute). Connects to the
              running service and never creates state or starts a server.
--input       UTF-8 JSON array, at most 100 steps / 4 MiB.
              Finish writing the file before invocation. Observed changes during
              the bounded read are rejected before any connection or batch step.
--list-tools  Discover the connected server's tools without invoking them.
--tool        Return one exact tool definition; requires --list-tools.
--timeout     Overall deadline, 1-600 seconds (default 120).
--json        JSON Lines output (also the default). Diagnostics use stderr.
--help        Show this help.
--version     Show version.

Each JSON output line has schemaVersion, index, tool, ok, and result.
Stops on first tool error or unsuccessful waited job. Exit: 0 success,
1 operation failure, 2 invalid input/setup/runtime mismatch, 124 deadline, 130 interruption.
In isolated mode, all remaining session jobs are terminated when the CLI exits;
state is retained. In connected mode, exit closes only the CLI connection and
never terminates the service owner or its jobs.
Transport/deadline/interruption errors during a batch include error.requestContext:
zero-based step index, tool, supported bounded IDs, and read-only inspection guidance.
This describes the caller request, not proof of service acceptance or execution.
Payloads, paths and command arguments are omitted; no retries or guessed IDs are added.
`;
const step = z.union([
  z.object({ tool: z.string().min(1), arguments: z.record(z.string(), z.unknown()).default({}) }).strict(),
  z.object({ waitForJob: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }).strict(),
  z.object({ runWorkflow: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }).strict(),
]);
// Describe a caller request, not proof that the service accepted or executed it.
// Never copy payloads, paths, executable arguments, contents, or guessed identifiers.
function describeRequest(index, request) {
  const tool = request.tool ?? ('runWorkflow' in request ? 'runWorkflow' : 'waitForJob');
  const context = { index, tool: tool.slice(0, 100), ...(tool.length > 100 && { toolTruncated: true }) };
  const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
  const arguments_ = request.arguments ?? {};
  const bindings = {
    terminal_run: ['requestId', 'command_status', 'jobId'],
    command_run: ['requestId', 'command_status', 'jobId'],
    command_status: ['jobId', 'command_status', 'jobId'],
    command_output: ['jobId', 'command_status', 'jobId'],
    command_cancel: ['jobId', 'command_status', 'jobId'],
    command_retry_save: ['jobId', 'command_status', 'jobId'],
    workflow_create: ['workflowId', 'workflow_status', 'workflowId'],
    workflow_resume: ['workflowId', 'workflow_status', 'workflowId'],
    workflow_status: ['workflowId', 'workflow_status', 'workflowId'],
    workflow_review: ['workflowId', 'workflow_status', 'workflowId'],
    workflow_cancel: ['workflowId', 'workflow_status', 'workflowId'],
    patch_apply: ['operationId', 'patch_status', 'operationId'],
    patch_resume: ['operationId', 'patch_status', 'operationId'],
    patch_undo: ['operationId', 'patch_status', 'operationId'],
    patch_status: ['operationId', 'patch_status', 'operationId'],
    patch_diff: ['operationId', 'patch_status', 'operationId'],
    config_apply: ['operationId', 'patch_status', 'operationId'],
    write_file: ['operationId', 'change_status', 'operationId'],
    edit_file: ['operationId', 'change_status', 'operationId'],
    delete_file: ['operationId', 'change_status', 'operationId'],
    undo_change: ['operationId', 'change_status', 'operationId'],
    change_status: ['operationId', 'change_status', 'operationId'],
  };
  let binding = Object.hasOwn(bindings, tool) ? bindings[tool] : undefined;
  let value = binding ? arguments_[binding[0]] : undefined;
  if ('waitForJob' in request) {
    binding = ['jobId', 'command_status', 'jobId'];
    value = request.waitForJob;
  } else if ('runWorkflow' in request) {
    binding = ['workflowId', 'workflow_status', 'workflowId'];
    value = request.runWorkflow;
  }
  if (binding && validId(value)) {
    context[binding[0]] = value;
    context.inspection = { tool: binding[1], arguments: { [binding[2]]: value } };
  }
  if (tool === 'workflow_resume' && validId(arguments_.retryJobId))
    context.retryJobId = arguments_.retryJobId;
  return context;
}
async function emit(value) {
  if (!process.stdout.write(JSON.stringify(value) + '\n')) await once(process.stdout, 'drain');
}
async function main() {
  let options, steps;
  try {
    options = parseArgs({
      options: {
        help: { type: 'boolean' },
        version: { type: 'boolean' },
        json: { type: 'boolean' },
        root: { type: 'string' },
        'state-dir': { type: 'string' },
        'service-state': { type: 'string' },
        input: { type: 'string' },
        'list-tools': { type: 'boolean' },
        tool: { type: 'string' },
        timeout: { type: 'string', default: '120' },
      },
      allowPositionals: false,
    }).values;
    if (options.help) {
      process.stdout.write(help);
      return;
    }
    if (options.version) {
      process.stdout.write(pkg.version + '\n');
      return;
    }
    const connected = options['service-state'] !== undefined;
    if (connected && !path.isAbsolute(options['service-state']))
      throw new Error('--service-state must be an absolute path.');
    if (connected && options['state-dir'])
      throw new Error('--service-state and --state-dir are mutually exclusive.');
    if (!connected && (!options.root || !path.isAbsolute(options.root)))
      throw new Error('Isolated mode requires absolute --root.');
    if (!connected && (!options['state-dir'] || !path.isAbsolute(options['state-dir'])))
      throw new Error('Isolated mode requires absolute --state-dir.');
    if (options.root && !path.isAbsolute(options.root)) throw new Error('--root must be an absolute path.');
    if (Boolean(options.input) === Boolean(options['list-tools']))
      throw new Error('Choose exactly one of --input or --list-tools.');
    if (options.tool && !options['list-tools']) throw new Error('--tool requires --list-tools.');
    if (options.tool !== undefined && options.tool.length === 0) throw new Error('--tool cannot be empty.');
    const seconds = Number(options.timeout);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600)
      throw new Error('--timeout must be an integer from 1 to 600.');
    if (options.input) {
      const handle = await open(options.input, 'r');
      try {
        const info = await handle.stat({ bigint: true });
        if (!info.isFile() || info.size > 4n * 1024n * 1024n)
          throw new Error('Input must be a file <= 4 MiB.');
        const bytes = Buffer.alloc(Number(info.size));
        let read = 0;
        while (read < bytes.length) {
          const part = await handle.read(bytes, read, bytes.length - read, read);
          if (!part.bytesRead) throw new Error('Input changed while reading.');
          read += part.bytesRead;
        }
        // Never execute a valid prefix while ignoring bytes appended after the initial stat.
        const extra = await handle.read(Buffer.alloc(1), 0, 1, bytes.length);
        if (extra.bytesRead) throw new Error('Input changed while reading.');
        const unchanged = (current) =>
          current.isFile() &&
          ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every((key) => current[key] === info[key]);
        // Check both the opened file and the current pathname, including replacement/removal.
        // These observations are not an atomic snapshot or a lock against other writers.
        if (
          !unchanged(await handle.stat({ bigint: true })) ||
          !unchanged(await stat(options.input, { bigint: true }))
        )
          throw new Error('Input changed while reading.');
        steps = z
          .array(step)
          .min(1)
          .max(100)
          .parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')));
      } finally {
        await handle.close();
      }
    }
    if (options.root) options.root = await realpath(options.root);
    if (connected) {
      options['service-state'] = await realpath(options['service-state']);
    } else {
      // Exclusive creation is the ownership boundary, including for simultaneous CLI invocations.
      await mkdir(options['state-dir']);
    }
  } catch (error) {
    await emit({ schemaVersion: 1, ok: false, error: { code: 'INVALID_INPUT', message: error.message } });
    process.exitCode = 2;
    return;
  }
  const client = new Client({ name: 'workbridge-cli', version: pkg.version }, { listMaxPages: 100 });
  const controller = new AbortController();
  let failureExit = 124;
  const interrupt = () => {
    failureExit = 130;
    controller.abort();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const timer = setTimeout(() => controller.abort(), Number(options.timeout) * 1000);
  const requestOptions = { signal: controller.signal, timeout: Number(options.timeout) * 1000 };
  let transport;
  let endpoint;
  let clientConnected = false;
  let operationStarted = false;
  let activeWorkflow;
  let activeRequestContext;
  const call = async (tool, args) => {
    const response = await client.callTool({ name: tool, arguments: args }, requestOptions);
    const result =
      response.structuredContent ??
      (() => {
        const text = response.content?.find((item) => item.type === 'text')?.text ?? '';
        try {
          return JSON.parse(text);
        } catch {
          return { message: text };
        }
      })();
    return { ok: !response.isError, result };
  };
  try {
    if (options['service-state']) {
      const { connectService } = await import('../dist/local-service.js');
      ({ transport, endpoint } = await connectService(options['service-state'], {
        signal: controller.signal,
      }));
      if (options.root) {
        const serviceRoot = await realpath(endpoint.root);
        const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
        if (normalize(serviceRoot) !== normalize(options.root)) {
          const error = new Error('Connected service root does not match --root.');
          error.code = 'ROOT_MISMATCH';
          error.expectedRoot = options.root;
          error.actualRoot = serviceRoot;
          throw error;
        }
      }
    } else {
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(repo, 'dist/server.js')],
        cwd: repo,
        env: {
          ...getDefaultEnvironment(),
          WORKBRIDGE_ROOT: options.root,
          WORKBRIDGE_STATE_DIR: path.resolve(options['state-dir']),
          WORKBRIDGE_LOCAL_CLI: '0',
        },
        stderr: 'pipe',
      });
      transport.stderr?.pipe(process.stderr);
    }
    await client.connect(transport, requestOptions);
    clientConnected = true;
    const runtimeVersion = client.getServerVersion()?.version;
    if (runtimeVersion !== pkg.version) {
      process.exitCode = 2;
      await emit({
        schemaVersion: 1,
        ok: false,
        error: {
          code: 'RUNTIME_MISMATCH',
          message:
            'Source and compiled runtime versions differ. Use a matching built isolated checkout or prepared release.',
          expectedVersion: pkg.version,
          runtimeVersion: runtimeVersion ?? null,
        },
      });
      return;
    }
    if (options['list-tools']) {
      const catalog = await client.listTools(undefined, requestOptions);
      if (catalog.tools.length > 1000) throw new Error('Tool discovery exceeded the 1000-tool limit.');
      const tools = options.tool ? catalog.tools.filter((item) => item.name === options.tool) : catalog.tools;
      if (options.tool && tools.length === 0) {
        process.exitCode = 1;
        await emit({
          schemaVersion: 1,
          ok: false,
          discovery: 'tools',
          serverVersion: runtimeVersion,
          error: { code: 'TOOL_NOT_FOUND', message: `Tool not found: ${options.tool}` },
        });
        return;
      }
      await emit({ schemaVersion: 1, ok: true, discovery: 'tools', serverVersion: runtimeVersion, tools });
      return;
    }
    for (const [index, request] of steps.entries()) {
      operationStarted = true;
      activeRequestContext = describeRequest(index, request);
      let answer;
      if ('runWorkflow' in request) {
        activeWorkflow = request.runWorkflow;
        do {
          answer = await call('workflow_resume', { workflowId: activeWorkflow });
          if (!answer.ok || !['pending', 'validating'].includes(answer.result.state)) break;
          const running = answer.result.steps.find(
            (step) => step.job?.status === 'running' || step.job?.completionPending === true,
          );
          if (running) {
            do {
              const job = await call('command_status', { jobId: running.job.id });
              if (!job.ok) {
                answer = job;
                break;
              }
              if (job.result.status !== 'running' && job.result.completionPending !== true) break;
              await delay(100, undefined, { signal: controller.signal });
            } while (true);
            if (!answer.ok) break;
          }
        } while (true);
        answer.ok = answer.ok && answer.result.state === 'ready_for_review';
        activeWorkflow = undefined;
      } else if ('waitForJob' in request) {
        do {
          answer = await call('command_status', { jobId: request.waitForJob });
          if (!answer.ok || (answer.result.status !== 'running' && answer.result.completionPending !== true))
            break;
          await delay(100, undefined, { signal: controller.signal });
        } while (true);
        answer.ok = answer.ok && answer.result.status === 'passed' && answer.result.exitCode === 0;
      } else {
        answer = await call(request.tool, request.arguments);
      }
      await emit({
        schemaVersion: 1,
        index,
        tool: request.tool ?? ('runWorkflow' in request ? 'runWorkflow' : 'waitForJob'),
        ...answer,
      });
      activeRequestContext = undefined;
      if (!answer.ok) {
        process.exitCode = 1;
        break;
      }
    }
  } catch (error) {
    process.exitCode = controller.signal.aborted ? failureExit : error.code === 'ROOT_MISMATCH' ? 2 : 1;
    const connected = Boolean(options['service-state']);
    const timedOut = controller.signal.aborted && failureExit !== 130;
    const uncertainConnectedOperation = connected && operationStarted;
    await emit({
      schemaVersion: 1,
      ok: false,
      error: {
        code:
          (error.code === 'ROOT_MISMATCH' ? error.code : undefined) ??
          (controller.signal.aborted ? (failureExit === 130 ? 'INTERRUPTED' : 'DEADLINE') : 'MCP_ERROR'),
        message: error.message,
        ...(activeWorkflow && { workflowId: activeWorkflow }),
        ...(activeRequestContext && { requestContext: activeRequestContext }),
        ...(error.expectedRoot && { expectedRoot: error.expectedRoot }),
        ...(error.actualRoot && { actualRoot: error.actualRoot }),
        ...((connected && timedOut) || uncertainConnectedOperation
          ? {
              nextAction:
                'Inspect returned operation or job IDs and the connected service state before deciding whether to retry.',
              retryAttempted: false,
            }
          : {}),
      },
    });
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (clientConnected) await client.close();
    else await transport?.close();
  }
}
await main();
