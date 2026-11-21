import { createHash } from 'node:crypto';
import { open, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PlanError } from './plan.mjs';

const MAX_FILE_BYTES = 32 * 1024;
function consistent(a, b) {
  return (
    a.isFile() &&
    b.isFile() &&
    a.size === b.size &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

/** Read the exact plan bytes once, then independently confirm file stability. */
export async function readPlanFile(file) {
  if (typeof file !== 'string' || file.length < 1) {
    throw new PlanError('PLAN_PATH_REQUIRED', 'Supply --plan with a readable JSON file.');
  }
  const path = resolve(file);
  const initial = await lstat(path);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size < 16 || initial.size > MAX_FILE_BYTES) {
    throw new PlanError('PLAN_SOURCE_INVALID', 'Plan must be an ordinary JSON file no larger than 32 KiB.');
  }
  const handle = await open(path, 'r');
  try {
    const opened = await handle.stat();
    if (!consistent(initial, opened)) {
      throw new PlanError('PLAN_SOURCE_CHANGED', 'Plan changed before inspection.');
    }
    const bytes = await handle.readFile();
    if (
      bytes.length !== initial.size ||
      !consistent(opened, await handle.stat()) ||
      !consistent(initial, await lstat(path))
    ) {
      throw new PlanError('PLAN_SOURCE_CHANGED', 'Plan changed during inspection.');
    }
    let plan;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      plan = JSON.parse(text);
    } catch {
      throw new PlanError('PLAN_JSON_INVALID', 'Plan must contain valid UTF-8 JSON.');
    }
    return {
      path,
      plan,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    await handle.close();
  }
}
