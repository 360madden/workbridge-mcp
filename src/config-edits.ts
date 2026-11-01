import { open } from 'node:fs/promises';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import {
  applyEdits,
  createScanner,
  modify,
  parseTree,
  printParseErrorCode,
  SyntaxKind,
  type Node,
  type ParseError,
} from 'jsonc-parser';
import { digest, encodeText } from './changes.js';
import { BridgeError, errorDetails } from './core.js';
import { decodeText, fingerprint } from './text.js';
import { Patches, patchLimits, type PatchFile } from './patches.js';
import type { Workspace } from './workspace.js';

export const configLimits = {
  fileBytes: 1024 * 1024,
  inputBytes: 1024 * 1024,
  operations: 100,
  totalOperations: 200,
  depth: 64,
  tokens: 100_000,
  ms: 20_000,
};
const pointer = z.string().max(2048);
const operation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: pointer, value: z.unknown() }).strict(),
  z.object({ op: z.literal('replace'), path: pointer, value: z.unknown() }).strict(),
  z.object({ op: z.literal('test'), path: pointer, value: z.unknown() }).strict(),
  z.object({ op: z.literal('remove'), path: pointer }).strict(),
]);
export const configFilesSchema = z
  .array(
    z
      .object({
        path: z.string().min(1).max(4096),
        expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
        format: z.enum(['json', 'jsonc']).default('json'),
        operations: z.array(operation).min(1).max(configLimits.operations),
      })
      .strict(),
  )
  .min(1)
  .max(patchLimits.files);
type ConfigFile = z.infer<typeof configFilesSchema>[number];

function tokens(value: string) {
  if (value === '') return [];
  if (!value.startsWith('/') || /~(?![01])/u.test(value))
    throw new BridgeError(
      'CONFIG_POINTER',
      'Use a JSON Pointer: empty for the root, or /segments with ~0 for tilde and ~1 for slash.',
    );
  const parts = value
    .slice(1)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.length > configLimits.depth)
    throw new BridgeError('CONFIG_LIMIT', 'Pointer exceeds 64 segments.');
  return parts;
}
function validValue(value: unknown, depth = 0): void {
  if (depth > configLimits.depth) throw new BridgeError('CONFIG_LIMIT', 'Value exceeds 64 levels.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new BridgeError(
        'CONFIG_NUMBER_PRECISION',
        'Values must use finite JSON numbers and safe integers. Encode large identifiers as strings.',
      );
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) validValue(child, depth + 1);
    return;
  }
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const child of Object.values(value)) validValue(child, depth + 1);
    return;
  }
  throw new BridgeError(
    'CONFIG_VALUE',
    'add, replace and test require an explicit JSON value, including null.',
  );
}
function tree(text: string, format: ConfigFile['format'], deadline: number): Node {
  if (Buffer.byteLength(text) > configLimits.fileBytes || Date.now() > deadline)
    throw new BridgeError(
      'CONFIG_LIMIT',
      'Configuration size or preparation time limit exceeded. Narrow the edit.',
    );
  const scanner = createScanner(text, true);
  let count = 0,
    depth = 0;
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) depth++;
    if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) depth--;
    if (++count > configLimits.tokens || depth > configLimits.depth)
      throw new BridgeError('CONFIG_LIMIT', 'Configuration exceeds 100000 tokens or 64 levels.');
  }
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, {
    disallowComments: format === 'json',
    allowTrailingComma: format === 'jsonc',
  });
  if (!root || errors.length)
    throw new BridgeError(
      'CONFIG_PARSE',
      'Configuration is invalid for the selected format; no repair was attempted.',
      {
        format,
        errors: errors
          .slice(0, 5)
          .map((e) => ({ code: printParseErrorCode(e.error), offset: e.offset, length: e.length })),
      },
    );
  const walk = (node: Node) => {
    if (node.type === 'object') {
      const names = new Set<string>();
      for (const property of node.children ?? []) {
        const name = property.children![0]!.value as string;
        if (names.has(name))
          throw new BridgeError(
            'CONFIG_DUPLICATE_KEY',
            'Duplicate object members are ambiguous; resolve them explicitly before structured editing.',
            { offset: property.offset },
          );
        names.add(name);
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return root;
}
function child(node: Node, part: string, add = false) {
  if (node.type === 'object')
    return { segment: part, node: node.children?.find((p) => p.children![0]!.value === part)?.children?.[1] };
  if (node.type !== 'array')
    throw new BridgeError('CONFIG_PATH_TYPE', 'Pointer parent must be an object or array.');
  const length = node.children?.length ?? 0;
  if (part === '-' && add) return { segment: length, node: undefined };
  if (!/^(0|[1-9][0-9]*)$/.test(part) || !Number.isSafeInteger(Number(part)))
    throw new BridgeError(
      'CONFIG_ARRAY_INDEX',
      'Array indices must be canonical nonnegative integers; use - only to append with add.',
    );
  const index = Number(part);
  if (index > length || (!add && index === length))
    throw new BridgeError('CONFIG_ARRAY_INDEX', 'Array index is outside the current array.');
  return { segment: index, node: node.children?.[index] };
}
function locate(root: Node, parts: string[], add: boolean) {
  let node: Node | undefined = root;
  const path: (string | number)[] = [];
  for (const [index, part] of parts.entries()) {
    if (!node)
      throw new BridgeError(
        'CONFIG_PATH_MISSING',
        'Pointer parent does not exist. Add parents explicitly before children.',
      );
    const found = child(node, part, add && index === parts.length - 1);
    path.push(found.segment);
    node = found.node;
  }
  return { path, node };
}
// Compare numeric spelling without converting an observed high-precision value to a rounded Number.
function decimal(raw: string) {
  const [mantissa, exponent = '0'] = raw.toLowerCase().split('e');
  const negative = mantissa!.startsWith('-');
  const [integer, fraction = ''] = (negative ? mantissa!.slice(1) : mantissa!).split('.');
  let coefficient = (integer! + fraction).replace(/^0+/, '');
  if (!coefficient) return '0';
  const trimmed = coefficient.replace(/0+$/, '');
  if (exponent.length > 8)
    throw new BridgeError(
      'CONFIG_NUMBER_PRECISION',
      'Observed number exceeds supported comparison precision.',
    );
  const scale = BigInt(exponent) - BigInt(fraction.length) + BigInt(coefficient.length - trimmed.length);
  return `${negative ? '-' : ''}${trimmed}e${scale}`;
}
function equals(node: Node, value: unknown, text: string): boolean {
  if (node.type === 'number')
    return (
      typeof value === 'number' &&
      decimal(text.slice(node.offset, node.offset + node.length)) === decimal(JSON.stringify(value))
    );
  if (node.type === 'array')
    return (
      Array.isArray(value) &&
      value.length === node.children!.length &&
      node.children!.every((n, i) => equals(n, value[i], text))
    );
  if (node.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    return (
      Object.keys(object).length === node.children!.length &&
      node.children!.every(
        (p) =>
          Object.hasOwn(object, p.children![0]!.value) &&
          equals(p.children![1]!, object[p.children![0]!.value], text),
      )
    );
  }
  return node.value === value;
}
function comments(text: string, excluded?: Node) {
  const scanner = createScanner(text),
    found: string[] = [];
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    const offset = scanner.getTokenOffset();
    if (
      (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) &&
      !(excluded && offset >= excluded.offset && offset < excluded.offset + excluded.length)
    )
      found.push(text.slice(offset, offset + scanner.getTokenLength()));
  }
  return found;
}
function edit(text: string, file: ConfigFile, deadline: number) {
  let root = tree(text, file.format, deadline);
  const indentation = /(?:^|\n)([\t ]+)"/u.exec(text)?.[1];
  const formattingOptions = {
    insertSpaces: !indentation?.includes('\t'),
    tabSize: Math.min(8, indentation?.length ?? 2),
    eol: '\n',
  };
  for (const [operationIndex, op] of file.operations.entries()) {
    try {
      if (Date.now() > deadline)
        throw new BridgeError('CONFIG_LIMIT', 'Configuration preparation time limit exceeded.');
      const parts = tokens(op.path);
      const target = locate(root, parts, op.op === 'add');
      if (op.op !== 'add' && !target.node)
        throw new BridgeError('CONFIG_PATH_MISSING', 'The selected value does not exist.');
      if (op.op === 'test') {
        if (!equals(target.node!, op.value, text))
          throw new BridgeError(
            'CONFIG_TEST_FAILED',
            'The selected value did not match; no project files were changed.',
          );
        continue;
      }
      if (op.op === 'remove' && parts.length === 0)
        throw new BridgeError(
          'CONFIG_ROOT_REMOVE',
          'A configuration must retain a JSON root. Use a recoverable file deletion to delete the file.',
        );
      const after = applyEdits(
        text,
        modify(text, target.path, op.op === 'remove' ? undefined : op.value, {
          formattingOptions,
          isArrayInsertion: op.op === 'add',
        }),
      );
      if (file.format === 'jsonc') {
        // Array add inserts before the selected node, so that node's comments are not replaced.
        const replaced = op.op === 'add' && typeof target.path.at(-1) === 'number' ? undefined : target.node;
        if (JSON.stringify(comments(text, replaced)) !== JSON.stringify(comments(after)))
          throw new BridgeError(
            'CONFIG_COMMENT_CONFLICT',
            'The structural edit would remove or change comments outside the selected value. Use an explicit text patch after reviewing their scope.',
          );
      }
      root = tree(after, file.format, deadline);
      text = after;
    } catch (error) {
      const details = errorDetails(error);
      throw new BridgeError(details.code, details.message, {
        ...details.details,
        operationIndex,
        pointer: op.path,
      });
    }
  }
  return text;
}

/** Structured edits produce ordinary patch snapshots; no new recovery journal or transport. */
export class ConfigEdits {
  constructor(
    private workspace: Workspace,
    private patches: Patches,
  ) {}
  private checked(input: ConfigFile[]) {
    const result = configFilesSchema.safeParse(input);
    if (!result.success)
      throw new BridgeError(
        'INVALID_CONFIG_EDIT',
        'Expected existing files, SHA256 hashes, json/jsonc format, and add/replace/remove/test operations.',
      );
    const files = result.data;
    if (
      files.reduce((n, f) => n + f.operations.length, 0) > configLimits.totalOperations ||
      files.reduce((n, f) => n + f.path.length, 0) > 8000
    )
      throw new BridgeError('CONFIG_LIMIT', 'Request exceeds 200 operations or 8000 path characters.');
    for (const [fileIndex, file] of files.entries())
      for (const [operationIndex, op] of file.operations.entries()) {
        try {
          tokens(op.path);
          if ('value' in op) validValue(op.value);
          else if (op.op !== 'remove')
            throw new BridgeError('CONFIG_VALUE', 'An explicit JSON value is required.');
        } catch (error) {
          const d = errorDetails(error);
          throw new BridgeError(d.code, d.message, {
            ...d.details,
            fileIndex,
            operationIndex,
            pointer: op.path,
          });
        }
      }
    if (Buffer.byteLength(JSON.stringify(files)) > configLimits.inputBytes)
      throw new BridgeError('CONFIG_LIMIT', 'Structured request exceeds 1 MiB.');
    return files;
  }
  private async generate(files: ConfigFile[]) {
    const deadline = Date.now() + configLimits.ms,
      generated: PatchFile[] = [],
      issues: Record<string, unknown>[] = [],
      seen = new Set<string>();
    let inputBytes = 0;
    for (const [fileIndex, file] of files.entries()) {
      try {
        const target = await this.workspace.resolve(file.path),
          canonical = this.workspace.relative(target);
        const key = process.platform === 'win32' ? target.toLowerCase() : target;
        if (seen.has(key))
          throw new BridgeError('DUPLICATE_PATH', 'Each canonical file may occur only once.');
        seen.add(key);
        const handle = await open(target, 'r');
        let bytes: Buffer;
        try {
          const info = await handle.stat();
          if (!info.isFile())
            throw new BridgeError('NOT_FILE', 'Structured edits require existing regular files.');
          if (info.size > configLimits.fileBytes)
            throw new BridgeError('CONFIG_LIMIT', 'Structured files are limited to 1 MiB.');
          const buffer = Buffer.alloc(info.size + 1);
          let total = 0;
          while (total < buffer.length) {
            const r = await handle.read(buffer, total, buffer.length - total, total);
            if (!r.bytesRead) break;
            total += r.bytesRead;
          }
          if (total !== info.size || fingerprint(info) !== fingerprint(await handle.stat()))
            throw new BridgeError('CONFLICT', 'Configuration changed during its read.');
          bytes = buffer.subarray(0, total);
        } finally {
          await handle.close();
        }
        const actualHash = digest(bytes);
        if (actualHash !== file.expectedHash)
          throw new BridgeError(
            'CONFLICT',
            'Expected configuration hash differs. Reread before changing the request.',
            { expectedHash: file.expectedHash, actualHash },
          );
        const before = decodeText(bytes).text;
        if (new Set(before.match(/\r\n|\r|\n/g) ?? []).size > 1)
          throw new BridgeError(
            'MIXED_EOL',
            'Normalize mixed line endings explicitly before structured editing.',
          );
        const normalized = before.replace(/\r\n|\r/g, '\n'),
          after = edit(normalized, file, deadline);
        if (encodeText(after, bytes).length > configLimits.fileBytes)
          throw new BridgeError(
            'CONFIG_LIMIT',
            'Edited configuration exceeds 1 MiB in its original encoding.',
          );
        if (after === normalized)
          throw new BridgeError(
            'NO_CHANGE',
            'Operations leave this file unchanged; use read tools for test-only inspection.',
          );
        const patch = createTwoFilesPatch(`a/${canonical}`, `b/${canonical}`, normalized, after, '', '', {
          context: 3,
          timeout: 250,
          maxEditLength: 10000,
        });
        if (patch === undefined)
          throw new BridgeError(
            'CONFIG_LIMIT',
            'Generated patch exceeded its diff budget. Narrow the change.',
          );
        const entry = { path: canonical, expectedHash: actualHash, patch };
        inputBytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
        if (inputBytes + 2 > patchLimits.inputBytes)
          throw new BridgeError('CONFIG_LIMIT', 'Generated patches exceed 2 MiB. Narrow the change.');
        generated.push(entry);
      } catch (error) {
        issues.push({ fileIndex, path: file.path, ...errorDetails(error) });
      }
    }
    if (issues.length)
      throw new BridgeError(
        'CONFIG_PREFLIGHT',
        'Configuration preflight failed; no project files or patch journals were changed.',
        { issues, nextAction: 'inspect_issues_and_reread' },
      );
    return generated;
  }
  preview(input: ConfigFile[]) {
    const files = this.checked(input);
    return this.patches.previewGenerated(() => this.generate(files));
  }
  apply(operationId: string, input: ConfigFile[]) {
    const files = this.checked(input);
    return this.patches.applyGenerated(
      operationId,
      digest(JSON.stringify({ kind: 'config_edit_v1', files })),
      () => this.generate(files),
    );
  }
}
