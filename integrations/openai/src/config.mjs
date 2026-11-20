import { isAbsolute, relative, resolve, sep } from 'node:path';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
export const MODELS = Object.freeze(['gpt-6.2-sol', 'gpt-6.2-astra']);
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
export const MAX_INPUT_BYTES = 16384;
export const MAX_OUTPUT_TOKENS = 2048;

export class CompanionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CompanionError';
    this.code = code;
  }
}

export function parseArgs(argv) {
  const [command, ...tokens] = argv;
  if (!['doctor', 'plan', 'run'].includes(command)) {
    throw new CompanionError('INVALID_COMMAND', 'Choose doctor, plan or run.');
  }

  const opts = {
    command,
    model: 'gpt-6.2-sol',
    effort: 'medium',
    maxOutputTokens: 800,
    inputFile: null,
    live: false,
  };
  const flags = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const flag = tokens[i];
    if (!['--model', '--effort', '--max-output-tokens', '--input-file', '--live'].includes(flag)) {
      throw new CompanionError('UNKNOWN_OPTION', 'Unrecognized command option.');
    }
    if (flags.has(flag)) {
      throw new CompanionError('DUPLICATE_OPTION', 'An option was supplied twice.');
    }
    flags.add(flag);
    if (flag === '--live') {
      opts.live = true;
      continue;
    }
    const value = tokens[++i];
    if (!value || value.startsWith('--')) {
      throw new CompanionError('MISSING_OPTION_VALUE', 'A command option needs a value.');
    }
    switch (flag) {
      case '--model':
        opts.model = value;
        break;
      case '--effort':
        opts.effort = value;
        break;
      case '--max-output-tokens':
        if (!/^[0-9]+$/.test(value)) {
          throw new CompanionError('INVALID_OUTPUT_LIMIT', 'Output limit must be an integer.');
        }
        opts.maxOutputTokens = Number(value);
        break;
      case '--input-file':
        opts.inputFile = value;
        break;
    }
  }
  if (!MODELS.includes(opts.model)) {
    throw new CompanionError('INVALID_MODEL', 'Choose a supported GPT-6.2 model.');
  }
  if (!EFFORTS.includes(opts.effort)) {
    throw new CompanionError('INVALID_EFFORT', 'Unsupported reasoning effort.');
  }
  if (
    !Number.isSafeInteger(opts.maxOutputTokens) ||
    opts.maxOutputTokens < 128 ||
    opts.maxOutputTokens > MAX_OUTPUT_TOKENS
  ) {
    throw new CompanionError('INVALID_OUTPUT_LIMIT', 'Output limit must be 128–2048 tokens.');
  }
  if (command !== 'run' && (opts.live || opts.inputFile)) {
    throw new CompanionError('INVALID_MODE', 'Only run supports input files and --live.');
  }
  if (command === 'run' && !opts.inputFile) {
    throw new CompanionError('MISSING_INPUT_FILE', 'run requires --input-file pointing to a text file.');
  }
  return opts;
}

export function createResponseRequest(options, input) {
  if (!MODELS.includes(options.model) || !EFFORTS.includes(options.effort)) {
    throw new CompanionError('INVALID_CONFIGURATION', 'Model and reasoning must be supported.');
  }
  if (
    !Number.isSafeInteger(options.maxOutputTokens) ||
    options.maxOutputTokens < 128 ||
    options.maxOutputTokens > MAX_OUTPUT_TOKENS
  ) {
    throw new CompanionError('INVALID_OUTPUT_LIMIT', 'Output token cap out of range.');
  }
  if (typeof input !== 'string' || !input.trim()) {
    throw new CompanionError('EMPTY_INPUT', 'The input file must contain a nonempty prompt.');
  }
  if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) {
    throw new CompanionError('INPUT_TOO_LARGE', 'Input is larger than 16 KiB.');
  }
  return {
    model: options.model,
    reasoning: { effort: options.effort },
    input,
    store: false,
    max_output_tokens: options.maxOutputTokens,
  };
}

function isInside(base, candidate) {
  const rel = relative(base, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

export async function readInputFile(inputFile, root = REPOSITORY_ROOT) {
  const allowedRoot = await realpath(root);
  const candidate = resolve(inputFile);
  if (!isInside(allowedRoot, candidate)) {
    throw new CompanionError('INPUT_OUTSIDE_ROOT', 'Input file must be inside the Workbridge repository.');
  }
  const metadata = await lstat(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_INPUT_BYTES) {
    throw new CompanionError('INVALID_INPUT_FILE', 'Input must be a regular text file of at most 16 KiB.');
  }
  const actual = await realpath(candidate);
  if (!isInside(allowedRoot, actual)) {
    throw new CompanionError('INPUT_OUTSIDE_ROOT', 'Input resolves outside the repository.');
  }
  const bytes = await readFile(actual);
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new CompanionError('INPUT_TOO_LARGE', 'Input is larger than 16 KiB.');
  }
  return bytes.toString('utf8');
}
