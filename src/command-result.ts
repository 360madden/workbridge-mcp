import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BridgeError } from './core.js';

// Internal worker evidence, not the durable job journal. Identity correlates an
// invocation; it does not authenticate files against arbitrary same-user code.
export const commandResultBytes = 4096;
export const commandIdentity = z.object({
  jobId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  invocationId: z.uuid(),
});
export type CommandIdentity = z.infer<typeof commandIdentity>;
const resultSchema = commandIdentity
  .extend({
    schemaVersion: z.literal(1),
    exitCode: z.number().int().nullable(),
    errorCode: z.string().min(1).max(200).optional(),
    timedOut: z.boolean(),
  })
  .strict()
  .refine(
    (r) =>
      r.timedOut
        ? r.exitCode === null && r.errorCode === undefined
        : r.errorCode !== undefined
          ? r.exitCode === null
          : r.exitCode !== null,
    'Contradictory command result.',
  );
export type CommandResult = z.infer<typeof resultSchema>;

export function serializeCommandResult(
  identity: CommandIdentity,
  exitCode: number | null,
  errorCode?: string,
  timedOut = false,
) {
  const result = resultSchema.parse({ ...identity, schemaVersion: 1, exitCode, errorCode, timedOut });
  const text = JSON.stringify(result);
  if (Buffer.byteLength(text, 'utf8') > commandResultBytes) throw new Error('Command result exceeds limit.');
  return text;
}

export function invalidCommandResult() {
  return new BridgeError(
    'COMMAND_RESULT_INVALID',
    'Command result evidence is invalid, mismatched, changed, linked, oversized, or inconsistent with the host. The child exit is unknown; inspect command_output before deciding whether to run new work. No command was rerun.',
  );
}

/** Read one small regular result without following an observed link or reading unbounded bytes. */
export async function readCommandResult(file: string, identity: CommandIdentity): Promise<CommandResult> {
  let handle;
  const directory = path.dirname(file);
  const regularDirectory = async () => {
    const s = await lstat(directory);
    if (!s.isDirectory() || s.isSymbolicLink()) throw invalidCommandResult();
    return s;
  };
  const stamp = (s: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }) =>
    `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  const regularFile = (s: Awaited<ReturnType<typeof lstat>>) =>
    s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.size > 0 && s.size <= commandResultBytes;
  try {
    const parent = await regularDirectory();
    let entry;
    try {
      entry = await lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BridgeError(
          'COMMAND_RESULT_MISSING',
          'The command host ended without readable result evidence. The child exit is unknown; inspect command_output. No command was rerun.',
        );
      }
      throw error;
    }
    if (!regularFile(entry)) throw invalidCommandResult();
    handle = await open(file, 'r');
    const before = await handle.stat();
    if (!regularFile(before) || stamp(entry) !== stamp(before)) throw invalidCommandResult();
    // One extra byte detects growth, while the allocation remains <= 4097 bytes.
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat(),
      current = await lstat(file),
      currentParent = await regularDirectory();
    if (
      length !== before.size ||
      !regularFile(after) ||
      !regularFile(current) ||
      stamp(before) !== stamp(after) ||
      stamp(before) !== stamp(current) ||
      parent.dev !== currentParent.dev ||
      parent.ino !== currentParent.ino
    )
      throw invalidCommandResult();
    const result = resultSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))),
    );
    if (result.jobId !== identity.jobId || result.invocationId !== identity.invocationId)
      throw invalidCommandResult();
    return result;
  } catch (error) {
    if (error instanceof BridgeError && error.code === 'COMMAND_RESULT_MISSING') throw error;
    throw invalidCommandResult();
  } finally {
    await handle?.close().catch(() => {});
  }
}
