import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
// Optional diagnostic for disposable tests only. Never load in the installed service.
// Example: node --import ./test/native-rename-diagnostic.preload.mjs --test test/patch-recovery.test.mjs
// Propagate to test-spawned Node subprocesses, including isolated MCP server fixtures.
// This only changes the environment of this test process and its descendants.
const importOption = `--import=${import.meta.url}`;
const options = process.env.NODE_OPTIONS ?? '';
if (!options.split(' ').includes(importOption))
  process.env.NODE_OPTIONS = [options, importOption].filter(Boolean).join(' ');

const original = fs.rename;
const failedAttempts = new Map();
fs.rename = async function (...args) {
  try {
    return await original.apply(this, args);
  } catch (error) {
    if (
      process.platform === 'win32' &&
      error?.syscall === 'rename' &&
      ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)
    ) {
      const destination = path.resolve(String(args[1]));
      const attempts = (failedAttempts.get(destination) ?? 0) + 1;
      failedAttempts.set(destination, attempts);
      // Avoid printing absolute fixture paths or unrelated private contents.
      process.stderr.write(
        '[WB_RENAME_DIAGNOSTIC] ' +
          JSON.stringify({
            code: error.code,
            syscall: error.syscall,
            leaf: path.basename(destination),
            parent: path.basename(path.dirname(destination)),
            failedAttempts: attempts,
          }) +
          '\n',
      );
    }
    throw error;
  }
};
syncBuiltinESMExports();
