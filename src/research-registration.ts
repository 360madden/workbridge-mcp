import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Workspace } from './workspace.js';
import type { Jobs } from './jobs.js';
import { BridgeError, errorDetails } from './workspace.js';

const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const runId = z.string().regex(/^[a-z][a-z0-9_-]{7,63}$/);
const planPath = z.string().min(1).max(4096);
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const jobStart = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

type ResearchFacadeDeps = {
  workspace: Pick<Workspace, 'root' | 'directory' | 'resolve' | 'relative'>;
  jobs: Pick<Jobs, 'terminal' | 'status'>;
  companionRoot?: string;
  isClosing?: () => boolean;
};

function ensureId(id: string) {
  if (!runId.safeParse(id).success) throw new BridgeError('RESEARCH_RUN_ID', 'Invalid research run ID.');
  return id;
}

/**
 * Research tools are a narrow facade over Workbridge's EXISTING 36-slot Jobs
 * engine. No separate listener, subprocess pool, model or file writer exists.
 * The only executable is this owner's pinned Node path, and the only target
 * script is the fixed research coordinator CLI shipped in the checkout.
 */
export function createResearchFacade({
  workspace,
  jobs,
  companionRoot = path.join(workspace.root, 'workbridge-mcp', 'integrations', 'research'),
  isClosing = () => false,
}: ResearchFacadeDeps) {
  const evidenceBase = path.join(workspace.root, 'workbridge-mcp', '.tools', 'research-runs');
  const script = path.join(companionRoot, 'src', 'cli.mjs');

  async function preflight() {
    if (isClosing()) throw new BridgeError('SERVER_CLOSING', 'The current Workbridge owner is stopping.');
    const cwd = await workspace.directory(companionRoot);
    // Do not follow symlinks/redirected paths to the mutable coordinator.
    await workspace.resolve(script);
    return cwd;
  }

  async function savedPlan(input: string) {
    return workspace.resolve(input);
  }

  async function evidenceDir(id: string, createParent = false) {
    const name = ensureId(id);
    const baseParent = await workspace.directory(path.dirname(evidenceBase));
    if (createParent) await mkdir(path.join(baseParent, 'research-runs'), { recursive: true });
    await workspace.directory(evidenceBase);
    return path.join(evidenceBase, name);
  }

  async function plan(input: { planPath: string; requestId: string }) {
    const cwd = await preflight();
    const selected = await savedPlan(input.planPath);
    return jobs.terminal(cwd, process.execPath, [script, 'plan', '--plan', selected], 40, input.requestId);
  }

  async function run(input: { planPath: string; runId: string; requestId: string }) {
    const cwd = await preflight();
    const selected = await savedPlan(input.planPath);
    const out = await evidenceDir(input.runId, true);
    // Exclusive output creation and crash recovery are owned by the coordinator.
    // Jobs.terminal owns request ID replay protection and the shared job slots.
    return jobs.terminal(
      cwd,
      process.execPath,
      [script, 'run', '--plan', selected, '--out', out],
      600,
      input.requestId,
    );
  }

  async function verify(input: { runId: string; requestId: string }) {
    const cwd = await preflight();
    const bundle = await evidenceDir(input.runId);
    return jobs.terminal(cwd, process.execPath, [script, 'verify', '--bundle', bundle], 90, input.requestId);
  }

  async function status(input: { jobId: string }) {
    const cwd = await preflight();
    const job = await jobs.status(input.jobId);
    const relative = workspace.relative(cwd);
    if (job.project !== cwd && job.project !== relative) {
      throw new BridgeError(
        'RESEARCH_JOB_SCOPE',
        'The requested job does not belong to the research companion.',
      );
    }
    return {
      ...job,
      researchScopeVerified: true,
      note: 'Workbridge job metadata only; inspect command_output and saved evidence for final research results.',
    };
  }

  return { plan, run, verify, status };
}

function response(action: () => Promise<unknown>) {
  return action()
    .then((data) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(data) }],
      structuredContent: data as Record<string, unknown>,
    }))
    .catch((error) => ({
      isError: true as const,
      content: [{ type: 'text' as const, text: JSON.stringify({ error: errorDetails(error) }) }],
    }));
}

export function registerResearchTools(server: McpServer, deps: ResearchFacadeDeps) {
  const facade = createResearchFacade(deps);
  server.registerTool(
    'research_plan',
    {
      description:
        'Start a bounded Workbridge job to validate and preview a reviewed research plan; no game action.',
      inputSchema: z.object({ planPath, requestId }),
      annotations: jobStart,
    },
    (args) => response(() => facade.plan(args)),
  );
  server.registerTool(
    'research_run',
    {
      description:
        'Start a unique offline research run through existing bounded Workbridge jobs. Never overwrites a run directory or runs an arbitrary command from a plan.',
      inputSchema: z.object({ planPath, runId, requestId }),
      annotations: jobStart,
    },
    (args) => response(() => facade.run(args)),
  );
  server.registerTool(
    'research_status',
    {
      description:
        'Inspect exact research job metadata. Poll command_output for the result; this does not retry an action.',
      inputSchema: z.object({ jobId: requestId }),
      annotations: readOnly,
    },
    (args) => response(() => facade.status(args)),
  );
  server.registerTool(
    'research_verify',
    {
      description:
        'Start an existing Workbridge job to verify one saved research-run evidence package. Does not rerun research steps.',
      inputSchema: z.object({ runId, requestId }),
      annotations: jobStart,
    },
    (args) => response(() => facade.verify(args)),
  );
}
