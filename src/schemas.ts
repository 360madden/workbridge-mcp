import { z } from 'zod';

const nullableHash = z.string().nullable();
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
const job = z
  .object({
    id: z.string(),
    project: z.string(),
    command: z.string(),
    status: z.string(),
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

// Explicit important fields keep hosted clients from having to infer result
// shapes; text JSON remains available alongside structuredContent.
export const resultSchemas: Record<string, z.ZodObject> = {
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
  workspace_info: z.object({
    root: z.string(),
    roots: z.array(z.string()),
    version: z.string(),
    readOnly: z.boolean(),
    limits: z.record(z.string(), z.number()),
    excludedDirectories: z.array(z.string()),
    pathRules: z.string(),
    text: z.string(),
    search: z.string(),
    changes: z.string(),
    commands: z.string(),
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
  edit_file: mutation,
  create_directory: mutation,
  move_file: mutation,
  delete_file: mutation,
  undo_change: mutation,
  change_list: z.object({ changes: z.array(change), nextOffset: z.number().nullable() }),
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
  command_cancel: job,
  command_output: job.extend({
    offset: z.number(),
    text: z.string(),
    nextOffset: z.number().nullable(),
    stream: z.enum(['combined', 'stdout', 'stderr']),
    streamLength: z.number(),
  }),
  git_commit: z.object({
    operationId: z.string(),
    commit: z.string(),
    output: z.string().optional(),
    replayed: z.boolean(),
  }),
};
