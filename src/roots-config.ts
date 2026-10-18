import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BridgeError } from './core.js';

export const rootsFile = (state: string) => path.join(state, 'workspace-roots.json');
export const rootsLock = (state: string) => path.join(state, 'workspace-config.lock');
export const rootsDigest = (raw: string | null) =>
  createHash('sha256')
    .update(raw ?? '<absent>')
    .digest('hex');
export async function readRoots(state: string) {
  let raw: string | null = null;
  try {
    if ((await stat(rootsFile(state))).size > 16 * 1024) throw new Error('size');
    raw = await readFile(rootsFile(state), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new BridgeError('INVALID_CONFIG', 'Cannot read workspace-roots.json (maximum 16 KiB).');
  }
  try {
    const config =
      raw === null
        ? { additionalRoots: [] as string[] }
        : z
            .object({
              additionalRoots: z.array(z.string().min(1).max(4096)).max(16),
            })
            .strict()
            .parse(JSON.parse(raw.replace(/^\uFEFF/, '')));
    return { ...config, raw, fingerprint: rootsDigest(raw) };
  } catch {
    throw new BridgeError(
      'INVALID_CONFIG',
      'Invalid workspace-roots.json; expected {"additionalRoots":["C:/projects"]} with up to 16 absolute existing directories.',
    );
  }
}
