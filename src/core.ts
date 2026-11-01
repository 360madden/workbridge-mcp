export const limits = {
  editBytes: 16 * 1024 * 1024,
  outputChars: 60_000,
  readFiles: 20,
  scanEntries: 20_000,
  scanMs: 20_000,
};
export const excludedDirectories = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'bin',
  'obj',
  '.vs',
  '.idea',
  '.venv',
  'venv',
  '.next',
  'coverage',
  '.tools',
  '.local',
];

export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export function errorDetails(error: unknown) {
  if (error instanceof BridgeError)
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT')
    return { code, message: 'Path does not exist. Discover/list directories to check the path.' };
  if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY')
    return {
      code,
      message:
        'Windows denied access or the file is locked. Preserve the original and retry after the lock is released.',
    };
  if (code === 'EEXIST' || code === 'ENOTEMPTY')
    return {
      code: 'CONFLICT',
      message: 'Destination exists or directory is not empty; no overwrite was requested.',
    };
  return {
    code: 'IO_ERROR',
    message: 'Operation failed. Check local stderr logs and retry with a narrower path.',
  };
}
