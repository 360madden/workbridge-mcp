import { z } from 'zod';
import { MAX_CONCURRENT_JOBS, jobStatuses } from './jobs.js';
import { workflowStates } from './workflows.js';
import { taskContextResultSchema } from './context.js';

const nullableHash = z.string().nullable();
const patchEntry = z.object({
  path: z.string(),
  action: z.enum(['create', 'update', 'delete']),
  beforeHash: nullableHash,
  afterHash: nullableHash,
  beforeBytes: z.number(),
  afterBytes: z.number(),
  progress: z.enum(['pending', 'applying', 'applied', 'undoing', 'undone']),
});
const patchSummary = z.object({
  schemaVersion: z.literal(1),
  operationId: z.string(),
  state: z.enum(['prepared', 'applying', 'applied', 'undoing', 'undone', 'blocked']),
  direction: z.enum(['apply', 'undo']),
  createdAt: z.string(),
  updatedAt: z.string(),
  files: z.array(patchEntry),
  diffComplete: z.boolean(),
  error: z.object({ code: z.string(), fileIndex: z.number().optional() }).optional(),
});
const patchPreview = z.object({
  schemaVersion: z.literal(1),
  applicable: z.literal(true),
  files: z.array(patchEntry),
  diff: z.string(),
  diffComplete: z.boolean(),
  diffTruncated: z.boolean(),
  snapshotBytes: z.number(),
});
export const fileRead = z
  .object({
    path: z.string(),
    startLine: z.number(),
    totalLines: z.number().nullable(),
    text: z.string(),
    truncated: z.boolean(),
    nextLine: z.number().nullable(),
    outputLimitReached: z.boolean(),
    cursor: z.string().nullable(),
    sha256: nullableHash,
    size: z.number(),
    encoding: z.string(),
    version: z.string(),
    scannedBytes: z.number(),
  })
  .catchall(z.unknown());
const change = z
  .object({
    operationId: z.string(),
    type: z.string(),
    path: z.string(),
    destination: z.string().optional(),
    state: z.string(),
    beforeHash: nullableHash,
    afterHash: nullableHash,
    time: z.string(),
    error: z.string().optional(),
  })
  .catchall(z.unknown());
const mutation = change.extend({
  replayed: z.boolean(),
  diff: z.string().optional(),
  diffTruncated: z.boolean().optional(),
});
const historyPage = {
  schemaVersion: z.literal(1),
  issues: z.array(z.record(z.string(), z.unknown())),
  nextOffset: z.number().nullable(),
  scanned: z.number(),
  catalogTruncated: z.boolean(),
  scanLimitReached: z.boolean(),
  outputLimitReached: z.boolean(),
  timeLimitReached: z.boolean(),
  hasErrors: z.boolean(),
  complete: z.boolean(),
  order: z.literal('operationId ascending'),
  stateFreshness: z.string(),
};
const job = z
  .object({
    id: z.string(),
    project: z.string(),
    command: z.string(),
    status: z.string(),
    completionPending: z.boolean(),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    exitCode: z.number().nullable(),
    outputTruncated: z.boolean(),
    outputLength: z.number(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
    mode: z.enum(['profile', 'terminal']).optional(),
    executable: z.string().optional(),
    timeoutSeconds: z.number().optional(),
    stdoutLength: z.number().nullable().optional(),
    stderrLength: z.number().nullable().optional(),
  })
  .catchall(z.unknown());

const jobCapacity = z.object({
  schemaVersion: z.literal(1),
  limit: z.literal(MAX_CONCURRENT_JOBS),
  occupied: z.number().int().min(0).max(MAX_CONCURRENT_JOBS),
  available: z.number().int().min(0).max(MAX_CONCURRENT_JOBS),
  inProgress: z.number().int().min(0).max(MAX_CONCURRENT_JOBS),
  retainedResults: z.number().int().min(0).max(MAX_CONCURRENT_JOBS),
  closing: z.boolean(),
  jobs: z
    .array(
      z.object({
        jobId: z.string(),
        project: z.string(),
        status: z.enum(jobStatuses),
        kind: z.enum(['in_progress', 'retained_result']),
        nextAction: z.enum(['command_status', 'command_retry_save']),
      }),
    )
    .max(MAX_CONCURRENT_JOBS),
});
const jobOutput = job.extend({
  offset: z.number(),
  text: z.string(),
  nextOffset: z.number().nullable(),
  stream: z.enum(['combined', 'stdout', 'stderr']),
  streamLength: z.number(),
});
const workflow = z.object({
  schemaVersion: z.literal(1),
  workflowId: z.string(),
  title: z.string(),
  project: z.string(),
  patchOperationId: z.string(),
  planHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  state: z.enum(workflowStates),
  recordedState: z.enum(workflowStates),
  patchState: z.string(),
  patchDirection: z.enum(['apply', 'undo']),
  inputs: z.array(
    z.object({
      path: z.string(),
      expectedHash: nullableHash,
      actualHash: nullableHash,
      matches: z.boolean(),
    }),
  ),
  steps: z.array(
    z.object({
      index: z.number(),
      name: z.string(),
      kind: z.enum(['profile', 'terminal']),
      command: z.string().optional(),
      definition: z.object({ executable: z.string(), args: z.array(z.string()), timeoutSeconds: z.number() }),
      attempts: z.array(
        z.object({
          jobId: z.string(),
          inputVersion: z.string(),
          invalidated: z.boolean().optional(),
          state: z.string(),
          createdAt: z.string(),
          checkedAt: z.string().optional(),
          exitCode: z.number().nullable().optional(),
        }),
      ),
      job: job.nullable(),
    }),
  ),
  issues: z.array(
    z
      .object({
        code: z.string(),
        message: z.string(),
        path: z.string().optional(),
        check: z.string().optional(),
      })
      .catchall(z.unknown()),
  ),
  validationScope: z.string(),
  nextAction: z.string(),
});

const agentTaskResult = z
  .object({
    taskId: z.string(),
    workerId: z.string(),
    state: z.string(),
    jobId: z.string().nullable(),
  })
  .catchall(z.unknown());
const agentLedgerResult = z.object({
  schemaVersion: z.literal(1),
  workspaceRoot: z.string(),
  revision: z.number(),
  tasks: z.array(agentTaskResult),
  maxWorkers: z.number(),
  running: z.number(),
  available: z.number(),
  coordinatorSlots: z.number(),
});

// Explicit important fields keep hosted clients from having to infer result
// shapes; text JSON remains available alongside structuredContent.
export const resultSchemas: Record<string, z.ZodObject> = {
  diagnostics: z.object({
    version: z.string(),
    root: z.string(),
    localCli: z.object({ enabled: z.boolean() }).catchall(z.unknown()),
    uptimeSeconds: z.number().nonnegative(),
    jobs: z.object({
      storedJobs: z.number().int().nonnegative().nullable(),
      runningJobs: z.number().int().min(0).max(MAX_CONCURRENT_JOBS),
      capacity: jobCapacity,
      inventory: z.object({
        complete: z.boolean(),
        scannedEntries: z.number().int().nonnegative(),
        limitReached: z.boolean(),
        timeLimitReached: z.boolean(),
        errorCode: z.string().nullable(),
      }),
    }),
    tunnel: z.object({
      available: z.boolean(),
      ready: z.boolean().optional(),
      controlPlane: z.string().optional(),
    }),
  }),
  task_context: taskContextResultSchema,
  workflow_create: workflow.extend({ replayed: z.boolean() }),
  workflow_status: workflow,
  workflow_resume: workflow,
  workflow_cancel: workflow,
  workflow_review: workflow.extend({
    diff: z.object({
      schemaVersion: z.literal(1),
      operationId: z.string(),
      diff: z.string(),
      offset: z.number(),
      nextOffset: z.number().nullable(),
      totalChars: z.number(),
      diffComplete: z.boolean(),
      diffTruncated: z.boolean(),
    }),
    outputs: z.array(jobOutput),
  }),
  workflow_list: z.object({
    schemaVersion: z.literal(1),
    workflows: z.array(
      z.object({
        workflowId: z.string(),
        title: z.string(),
        project: z.string(),
        patchOperationId: z.string(),
        recordedState: z.enum(workflowStates),
        createdAt: z.string(),
        updatedAt: z.string(),
        checkCount: z.number(),
      }),
    ),
    issues: z.array(
      z.object({ workflowId: z.string(), code: z.string(), message: z.string() }).catchall(z.unknown()),
    ),
    scanned: z.number(),
    nextOffset: z.number().nullable(),
    catalogTruncated: z.boolean(),
    scanLimitReached: z.boolean(),
    outputLimitReached: z.boolean(),
    timeLimitReached: z.boolean(),
    hasErrors: z.boolean(),
    complete: z.boolean(),
    order: z.literal('workflowId ascending'),
    stateFreshness: z.string(),
  }),
  read_file: fileRead,
  read_files: z.object({
    results: z.array(
      z.union([
        z.object({ index: z.number(), path: z.string(), ok: z.literal(true), result: fileRead }),
        z.object({
          index: z.number(),
          path: z.string(),
          ok: z.literal(false),
          error: z.object({
            code: z.string(),
            message: z.string(),
            details: z.record(z.string(), z.unknown()).optional(),
          }),
        }),
      ]),
    ),
    nextOffset: z.number().nullable(),
    hasErrors: z.boolean(),
    outputLimitReached: z.boolean(),
    timeLimitReached: z.boolean(),
  }),
  snapshot_cache: z.object({
    status: z.string(),
    path: z.string().optional(),
    version: z.string().optional(),
    compressed: z.boolean().optional(),
    sourceBytes: z.number().optional(),
    bytes: z.number().nullable().optional(),
    sha256: nullableHash.optional(),
    error: z.string().nullable().optional(),
    cacheBudgetBytes: z.number(),
  }),
  snapshot_read: z.object({
    path: z.string(),
    version: z.string(),
    size: z.number(),
    offset: z.string(),
    address: z.string().nullable(),
    length: z.number(),
    hex: z.string(),
    ascii: z.string(),
    type: z.string(),
    endian: z.string(),
    values: z.array(z.union([z.string(), z.number()])),
    valuesTruncated: z.boolean(),
    trailingBytes: z.number(),
    nextOffset: z.string().nullable(),
    sha256: nullableHash,
  }),
  snapshot_search: z.object({
    path: z.string(),
    version: z.string(),
    size: z.number(),
    pattern: z.string(),
    matches: z.array(z.object({ offset: z.string(), address: z.string().nullable() })),
    scannedBytes: z.number(),
    complete: z.boolean(),
    reason: z.string(),
    nextOffset: z.string().nullable(),
  }),
  snapshot_manifest: z.object({
    path: z.string(),
    version: z.string(),
    mode: z.string().nullable(),
    poses: z.array(
      z.object({
        index: z.number(),
        label: z.string(),
        role: z.string().nullable(),
        segmentCount: z.number(),
      }),
    ),
    segments: z.array(
      z.object({
        path: z.string(),
        pose: z.number(),
        id: z.string().nullable(),
        baseAddress: z.string(),
        endAddress: z.string(),
        size: z.number(),
        compression: z.string(),
        sha256: nullableHash,
      }),
    ),
    totalSegments: z.number(),
    nextOffset: z.number().nullable(),
    mapping: z
      .object({
        path: z.string(),
        pose: z.number(),
        id: z.string().nullable(),
        baseAddress: z.string(),
        endAddress: z.string(),
        size: z.number(),
        compression: z.string(),
        sha256: nullableHash,
        offset: z.string(),
        availableBytes: z.number(),
        length: z.number(),
      })
      .nullable(),
    boundary: z.string().nullable(),
  }),
  agent_list: agentLedgerResult,
  agent_status: agentLedgerResult.extend({ workers: z.array(z.unknown()), owners: z.array(z.unknown()) }),
  agent_owner_of: z.object({ revision: z.number(), path: z.string(), owner: z.unknown().nullable() }),
  agent_assign: agentTaskResult,
  agent_dispatch: agentTaskResult,
  agent_dispatch_next: z.object({ task: agentTaskResult.nullable() }),
  agent_finish: agentTaskResult,
  agent_verify: agentTaskResult,
  workspace_info: z.object({
    root: z.string(),
    roots: z.array(z.string()),
    version: z.string(),
    localCli: z.discriminatedUnion('enabled', [
      z.object({ enabled: z.literal(false) }),
      z.object({
        enabled: z.literal(true),
        schemaVersion: z.literal(1),
        url: z.string(),
        readyUrl: z.string(),
        root: z.string(),
        state: z.string(),
        version: z.string(),
        instanceId: z.string(),
        pid: z.number(),
        startedUtc: z.string(),
      }),
    ]),
    readOnly: z.boolean(),
    limits: z.record(z.string(), z.number()),
    excludedDirectories: z.array(z.string()),
    pathRules: z.string(),
    text: z.string(),
    search: z.string(),
    changes: z.string(),
    commands: z.string(),
    agents: z.string(),
    workflows: z.string(),
    context: z.string(),
    snapshots: z.string(),
  }),
  file_info: z.object({
    path: z.string(),
    type: z.string(),
    size: z.number(),
    modifiedAt: z.string(),
    sha256: nullableHash,
  }),
  write_file: mutation,
  patch_preview: patchPreview,
  config_preview: patchPreview,
  config_apply: patchSummary.extend({ replayed: z.boolean() }),
  patch_apply: patchSummary.extend({ replayed: z.boolean() }),
  patch_resume: patchSummary.extend({ replayed: z.boolean() }),
  patch_undo: patchSummary.extend({ replayed: z.boolean() }),
  patch_status: patchSummary.extend({
    nextAction: z.string(),
    current: z.array(
      z.object({
        path: z.string(),
        sha256: nullableHash,
        matches: z.string(),
        error: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  }),
  patch_diff: z.object({
    schemaVersion: z.literal(1),
    operationId: z.string(),
    diff: z.string(),
    offset: z.number(),
    nextOffset: z.number().nullable(),
    totalChars: z.number(),
    diffComplete: z.boolean(),
    diffTruncated: z.boolean(),
  }),
  patch_list: z.object({
    ...historyPage,
    patches: z.array(patchSummary.omit({ files: true }).extend({ fileCount: z.number() })),
  }),
  edit_file: mutation,
  create_directory: mutation,
  move_file: mutation,
  delete_file: mutation,
  undo_change: mutation,
  change_list: z.object({ ...historyPage, changes: z.array(change) }),
  change_status: change.extend({
    current: z.record(z.string(), z.object({ exists: z.boolean(), sha256: nullableHash })),
  }),
  commands_list: z.object({
    project: z.string(),
    commands: z.array(
      z.object({
        name: z.string(),
        executable: z.string(),
        args: z.array(z.string()),
        timeoutSeconds: z.number(),
      }),
    ),
  }),
  command_run: job,
  terminal_run: job,
  command_status: job,
  command_list: z.object({
    schemaVersion: z.literal(1),
    jobs: z.array(job),
    runningJobs: z.array(
      z.object({
        id: z.string(),
        project: z.string(),
        status: z.literal('running'),
        startedAt: z.string(),
      }),
    ),
    nextOffset: z.number().nullable(),
    scanned: z.number(),
    catalogTruncated: z.boolean(),
    scanLimitReached: z.boolean(),
    outputLimitReached: z.boolean(),
    timeLimitReached: z.boolean(),
    hasErrors: z.boolean(),
    issues: z.array(z.object({ jobId: z.string(), code: z.string() })),
    complete: z.boolean(),
    order: z.literal('id-ascending'),
  }),
  command_retry_save: z.object({
    schemaVersion: z.literal(1),
    publication: z.enum(['saved', 'already_saved']),
    commandRerun: z.literal(false),
    job,
  }),
  command_cancel: job,
  command_output: jobOutput,
  git_commit: z.object({
    operationId: z.string(),
    commit: z.string(),
    output: z.string().optional(),
    replayed: z.boolean(),
  }),
};
