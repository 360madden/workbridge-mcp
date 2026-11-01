import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Workspace } from '../dist/workspace.js';
import { Serial, digest, encodeText } from '../dist/changes.js';
import { Patches } from '../dist/patches.js';
import { ConfigEdits, configLimits } from '../dist/config-edits.js';
import { decodeText } from '../dist/text.js';
import { parse, parseTree } from 'jsonc-parser';
const execute = promisify(execFile),
  repo = path.resolve('.');
let directory,
  sequence = 0;
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'wb-config-'));
});
after(async () => {
  assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(directory, { recursive: true, force: true });
});
async function fixture(files = { 'a.json': '{"a":1,"items":[1,2],"keep":true}\n' }) {
  const root = path.join(directory, String(sequence++));
  await mkdir(root);
  const state = path.join(root, 'state');
  await mkdir(state);
  const workspace = await Workspace.create(root);
  workspace.protect(state);
  const serial = new Serial(),
    journal = path.join(state, 'patches'),
    patches = new Patches(workspace, journal, serial),
    editor = new ConfigEdits(workspace, patches);
  for (const [name, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), value);
  }
  return { root, state, workspace, serial, journal, patches, editor };
}
const bytes = (f, p = 'a.json') => readFile(path.join(f.root, p));
const read = async (f, p = 'a.json') => (await bytes(f, p)).toString('utf8');
const request = async (f, operations, p = 'a.json', format = 'json') => ({
  path: p,
  expectedHash: digest(await bytes(f, p)),
  format,
  operations,
});
const replace = (p, v) => ({ op: 'replace', path: p, value: v });
async function issue(action, code, index = 0) {
  await assert.rejects(action, (e) => e.code === 'CONFIG_PREFLIGHT' && e.details.issues[index].code === code);
}

test('JSON Pointer add/replace/remove/test preserve untouched values and ordered array semantics', async () => {
  const f = await fixture();
  const original = await bytes(f);
  const files = [
    await request(f, [
      { op: 'test', path: '/a', value: 1 },
      replace('/a', 2),
      { op: 'add', path: '/items/1', value: 5 },
      { op: 'add', path: '/items/-', value: null },
      { op: 'remove', path: '/items/0' },
      { op: 'add', path: '/a~1b', value: { '~key': false } },
      replace('/a~1b/~0key', true),
    ]),
  ];
  const preview = await f.editor.preview(files);
  assert.equal(preview.applicable, true);
  assert.equal(preview.files[0].beforeHash, digest(original));
  assert.equal(await read(f), original.toString());
  assert.deepEqual(await readdir(f.state), []);
  const applied = await f.editor.apply('ordered', files);
  assert.equal(applied.state, 'applied');
  assert.deepEqual(JSON.parse(await read(f)), {
    a: 2,
    items: [5, 2, null],
    keep: true,
    'a/b': { '~key': true },
  });
  assert.equal((await f.patches.diff('ordered', 0, 60000)).diff, preview.diff);
  await f.patches.undo('ordered');
  assert.deepEqual(await bytes(f), original);
});
test('existing member add replaces, empty object names and root replacement/test are supported', async () => {
  const f = await fixture({ 'a.json': '{"": 1,"a":2}\n' });
  const files = [
    await request(f, [
      { op: 'test', path: '', value: { a: 2, '': 1 } },
      { op: 'add', path: '/', value: null },
      replace('', [1, 2]),
      { op: 'add', path: '/-', value: 3 },
    ]),
  ];
  await f.editor.apply('root', files);
  assert.deepEqual(JSON.parse(await read(f)), [1, 2, 3]);
});
test('null differs from absent value and prototypes are ordinary literal JSON keys', async () => {
  const f = await fixture({ 'a.json': '{"__proto__":{"x":1},"constructor":2}\n' });
  const value = JSON.parse('{"__proto__":{"safe":true},"prototype":null}');
  await f.editor.apply('keys', [
    await request(f, [
      { op: 'test', path: '/__proto__/x', value: 1 },
      replace('/__proto__', value),
      { op: 'add', path: '/toString', value: null },
    ]),
  ]);
  assert.equal(JSON.parse(await read(f)).__proto__.__proto__.safe, true);
  assert.equal({}.safe, undefined);
  const invalid = await request(f, [{ op: 'add', path: '/x' }]);
  assert.throws(
    () => f.editor.preview([invalid]),
    (e) => e.code === 'INVALID_CONFIG_EDIT',
  );
});
test('JSONC local edits preserve unrelated comments, ordering, CRLF, tabs and UTF-8 BOM', async () => {
  const original = Buffer.concat([
    Buffer.from([239, 187, 191]),
    Buffer.from('// heading\r\n{\r\n\t"a": 1, // keep inline\r\n\t// keep other\r\n\t"keep": "x",\r\n}\r\n'),
  ]);
  const f = await fixture({ 'a.json': original });
  await f.editor.apply('jsonc', [await request(f, [replace('/a', 7)], 'a.json', 'jsonc')]);
  const actual = await bytes(f);
  assert.deepEqual(actual, Buffer.from(original.toString().replace('"a": 1', '"a": 7')));
  await f.patches.undo('jsonc');
  assert.deepEqual(await bytes(f), original);
});
test('JSONC structural additions/removals remain valid with trailing commas', async () => {
  for (const text of ['{"a":[1,2,],"keep":true,}\n', '{\n // comment\n "a":[1,2,],\n "keep":true,\n}\n']) {
    const f = await fixture({ 'a.json': text });
    await f.editor.apply('arrays', [
      await request(
        f,
        [
          { op: 'remove', path: '/a/1' },
          { op: 'add', path: '/a/-', value: 9 },
          { op: 'add', path: '/new', value: false },
          { op: 'remove', path: '/keep' },
        ],
        'a.json',
        'jsonc',
      ),
    ]);
    const errors = [];
    assert.deepEqual(parse(await read(f), errors, { allowTrailingComma: true }), { a: [1, 9], new: false });
    assert.deepEqual(errors, []);
  }
});
test('JSONC refuses ambiguous adjacent-comment removal but permits explicitly replacing a commented value', async () => {
  const text = '{\n  "a": 1,\n  // keep this guidance\n  "b": 2\n}\n',
    f = await fixture({ 'a.json': text });
  await issue(
    async () =>
      f.editor.apply('comment', [await request(f, [{ op: 'remove', path: '/b' }], 'a.json', 'jsonc')]),
    'CONFIG_COMMENT_CONFLICT',
  );
  assert.equal(await read(f), text);
  assert.deepEqual(await readdir(f.state), []);
  const nested = await fixture({ 'a.json': '// header\n{"a": {/* owned comment */"b": 1}, "keep": 2}\n' });
  await nested.editor.apply('replace-value', [
    await request(nested, [replace('/a', null)], 'a.json', 'jsonc'),
  ]);
  assert.ok((await read(nested)).startsWith('// header\n'));
  assert.ok(!(await read(nested)).includes('owned comment'));
});
test('UTF-16 LE/BE encoding, BOM and final newline are preserved and undone exactly', async () => {
  for (const big of [false, true]) {
    let content = Buffer.from('{\r\n  "a": 1\r\n}\r\n', 'utf16le');
    if (big) content = content.swap16();
    const original = Buffer.concat([Buffer.from(big ? [254, 255] : [255, 254]), content]);
    const f = await fixture({ 'a.json': original });
    await f.editor.apply('encoding', [await request(f, [replace('/a', 2)])]);
    assert.deepEqual(await bytes(f), encodeText('{\n  "a": 2\n}\n', original));
    await f.patches.undo('encoding');
    assert.deepEqual(await bytes(f), original);
  }
});
test('strict JSON rejects comments/trailing commas and malformed or duplicate-key inputs', async () => {
  for (const [text, code] of [
    ['// c\n{"a":1}', 'CONFIG_PARSE'],
    ['{"a":1,}', 'CONFIG_PARSE'],
    ['{"a":1', 'CONFIG_PARSE'],
    ['{"a":1,"a":2}', 'CONFIG_DUPLICATE_KEY'],
    ['{"a":1,"nested":{"x":1,"\\u0078":2}}', 'CONFIG_DUPLICATE_KEY'],
  ]) {
    const f = await fixture({ 'a.json': text });
    await issue(
      () =>
        f.editor.apply('invalid', [
          { path: 'a.json', expectedHash: digest(text), operations: [replace('/a', 2)] },
        ]),
      code,
    );
    assert.equal(await read(f), text);
    assert.deepEqual(await readdir(f.state), []);
  }
});
test('failed later test reports the exact operation without disclosing compared values or writing files', async () => {
  const f = await fixture();
  const original = await read(f);
  const files = [
    await request(f, [replace('/a', 2), { op: 'test', path: '/keep', value: 'private-test-value' }]),
  ];
  await assert.rejects(f.editor.apply('fail', files), (e) => {
    assert.equal(e.details.issues[0].code, 'CONFIG_TEST_FAILED');
    assert.equal(e.details.issues[0].details.operationIndex, 1);
    assert.equal(e.details.issues[0].details.pointer, '/keep');
    assert.ok(!JSON.stringify(e.details).includes('private-test-value'));
    return true;
  });
  assert.equal(await read(f), original);
  assert.deepEqual(await readdir(f.state), []);
});
test('missing parents, missing values, scalar parents, array index rules and root deletion fail closed', async () => {
  for (const [op, code] of [
    [{ op: 'add', path: '/missing/child', value: 1 }, 'CONFIG_PATH_MISSING'],
    [replace('/missing', 1), 'CONFIG_PATH_MISSING'],
    [{ op: 'remove', path: '/missing' }, 'CONFIG_PATH_MISSING'],
    [replace('/a/value', 2), 'CONFIG_PATH_TYPE'],
    [{ op: 'add', path: '/items/01', value: 1 }, 'CONFIG_ARRAY_INDEX'],
    [{ op: 'add', path: '/items/3', value: 1 }, 'CONFIG_ARRAY_INDEX'],
    [replace('/items/-', 1), 'CONFIG_ARRAY_INDEX'],
    [{ op: 'remove', path: '' }, 'CONFIG_ROOT_REMOVE'],
  ]) {
    const f = await fixture();
    await issue(
      () =>
        f.editor.apply('path', [
          { path: 'a.json', expectedHash: digest('{"a":1,"items":[1,2],"keep":true}\n'), operations: [op] },
        ]),
      code,
    );
    assert.deepEqual(await readdir(f.state), []);
  }
  const f = await fixture();
  for (const p of ['bad', '#/a', '/a~2'])
    assert.throws(
      () => f.editor.preview([{ path: 'a.json', expectedHash: '0'.repeat(64), operations: [replace(p, 1)] }]),
      (e) => e.code === 'CONFIG_POINTER',
    );
});
test('untouched high-precision numbers keep their raw digits and test comparison never rounds them', async () => {
  const text = '{"big":9007199254740993,"tiny":1e-400,"decimal":0.10000000000000001,"a":1}\n',
    f = await fixture({ 'a.json': text });
  await f.editor.apply('precision', [await request(f, [replace('/a', 2)])]);
  assert.equal(await read(f), text.replace('"a":1', '"a":2'));
  for (const [p, v] of [
    ['/big', 9007199254740992],
    ['/tiny', 0],
    ['/decimal', 0.1],
  ]) {
    const files = [await request(f, [{ op: 'test', path: p, value: v }, replace('/a', 3)])];
    if (p === '/big')
      assert.throws(
        () => f.editor.preview(files),
        (e) => e.code === 'CONFIG_NUMBER_PRECISION',
      );
    else await issue(() => f.editor.preview(files), 'CONFIG_TEST_FAILED');
  }
  const equal = await fixture({ 'a.json': '{"number":1.00e2,"a":1}\n' });
  await equal.editor.apply('equivalent', [
    await request(equal, [{ op: 'test', path: '/number', value: 100 }, replace('/a', 2)]),
  ]);
});
test('whole-set conflict and canonical duplicate paths refuse every file before publication', async () => {
  const f = await fixture({ 'a.json': '{"a":1}\n', 'b.json': '{"b":1}\n' });
  const a = await request(f, [replace('/a', 2)]),
    b = await request(f, [replace('/b', 2)], 'b.json');
  await writeFile(path.join(f.root, 'b.json'), '{"b":99}\n');
  await issue(() => f.editor.apply('set', [a, b]), 'CONFLICT');
  assert.equal(await read(f), '{"a":1}\n');
  assert.deepEqual(await readdir(f.state), []);
  await issue(() => f.editor.preview([a, { ...a, path: path.join(f.root, 'a.json') }]), 'DUPLICATE_PATH');
});
test('same request replays across reconstructed owners, changed requests and raw patch ID collisions are refused', async () => {
  const f = await fixture();
  const files = [await request(f, [replace('/a', 2)])];
  await f.editor.apply('replay', files);
  const patches = new Patches(f.workspace, f.journal, new Serial()),
    editor = new ConfigEdits(f.workspace, patches);
  assert.equal((await editor.apply('replay', files)).replayed, true);
  await assert.rejects(
    editor.apply('replay', [{ ...files[0], operations: [replace('/a', 3)] }]),
    (e) => e.code === 'ID_REUSE',
  );
  await assert.rejects(
    patches.apply('replay', [{ path: 'a.json', expectedHash: files[0].expectedHash, patch: 'not a patch' }]),
    (e) => e.code === 'ID_REUSE',
  );
  await patches.undo('replay');
  assert.equal((await editor.apply('replay', files)).state, 'undone');
  assert.equal(JSON.parse(await read(f)).a, 1);
});
test('guarded undo preserves a later edit across the entire set and resumes after explicit repair', async () => {
  const f = await fixture({ 'a.json': '{"a":1}\n', 'b.json': '{"b":1}\n' });
  const files = [await request(f, [replace('/a', 2)]), await request(f, [replace('/b', 2)], 'b.json')];
  await f.editor.apply('guard', files);
  const after = await bytes(f);
  await writeFile(path.join(f.root, 'a.json'), '{"a":77}\n');
  await assert.rejects(
    f.patches.undo('guard'),
    (e) => e.code === 'PATCH_BLOCKED' && e.details.cause.code === 'PATCH_CONFLICT',
  );
  assert.equal(await read(f, 'b.json'), '{"b":2}\n');
  await writeFile(path.join(f.root, 'a.json'), after);
  await f.patches.undo('guard');
  assert.equal(await read(f), '{"a":1}\n');
  assert.equal(await read(f, 'b.json'), '{"b":1}\n');
});
test('simultaneous configuration operations share serialization and stale hashes cannot overwrite the winner', async () => {
  const f = await fixture();
  const a = await request(f, [replace('/a', 2)]),
    b = { ...a, operations: [replace('/a', 3)] };
  const results = await Promise.allSettled([f.editor.apply('one', [a]), f.editor.apply('two', [b])]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].reason.details.issues[0].code, 'CONFLICT');
  assert.equal(JSON.parse(await read(f)).a, 2);
});
test('protected, outside-root, binary, missing, mixed-EOL and no-change requests publish no journals', async () => {
  const f = await fixture({
    'a.json': '{"a":1}\n',
    'state/private.json': '{"a":1}',
    'binary.json': Buffer.from([0, 1]),
    'mixed.json': '{\r\n"a":1\n}',
  });
  for (const [name, expected, code] of [
    ['state/private.json', digest('{"a":1}'), 'PROTECTED_PATH'],
    ['missing.json', '0'.repeat(64), 'ENOENT'],
    ['binary.json', digest(Buffer.from([0, 1])), 'NOT_TEXT'],
    ['mixed.json', digest('{\r\n"a":1\n}'), 'MIXED_EOL'],
    ['../outside.json', '0'.repeat(64), 'OUTSIDE_ROOT'],
  ]) {
    await assert.rejects(
      f.editor.apply('boundary', [{ path: name, expectedHash: expected, operations: [replace('/a', 2)] }]),
      (e) => {
        assert.equal(e.code, 'CONFIG_PREFLIGHT');
        assert.ok(
          [code, 'PROTECTED_STATE', 'OUTSIDE_WORKSPACE'].includes(e.details.issues[0].code),
          JSON.stringify(e.details),
        );
        return true;
      },
    );
  }
  await issue(async () => f.editor.apply('noop', [await request(f, [replace('/a', 1)])]), 'NO_CHANGE');
  assert.deepEqual(await readdir(f.state), ['private.json']);
});
test('configured additional roots work and junctions cannot redirect edits', async () => {
  const f = await fixture(),
    other = path.join(directory, 'additional');
  await mkdir(other);
  await writeFile(path.join(other, 'a.json'), '{"a":1}');
  const workspace = await Workspace.create(f.root, [other]),
    patches = new Patches(workspace, f.journal, new Serial()),
    editor = new ConfigEdits(workspace, patches);
  await editor.apply('additional', [
    { path: path.join(other, 'a.json'), expectedHash: digest('{"a":1}'), operations: [replace('/a', 2)] },
  ]);
  assert.equal(await readFile(path.join(other, 'a.json'), 'utf8'), '{"a":2}');
  await patches.undo('additional');
  await symlink(other, path.join(f.root, 'linked'), 'junction');
  await issue(
    () =>
      editor.preview([
        { path: 'linked/a.json', expectedHash: digest('{"a":1}'), operations: [replace('/a', 3)] },
      ]),
    'LINK_NOT_ALLOWED',
  );
});
test('depth, file size, request size, operation count, numeric values and soft deadline are bounded', async () => {
  const f = await fixture({
    'a.json': '{"a":1}',
    'deep.json': '['.repeat(65) + '0' + ']'.repeat(65),
    'large.json': ' '.repeat(configLimits.fileBytes) + '{}',
  });
  await issue(
    () =>
      f.editor.preview([
        {
          path: 'deep.json',
          expectedHash: digest('['.repeat(65) + '0' + ']'.repeat(65)),
          operations: [replace('', 1)],
        },
      ]),
    'CONFIG_LIMIT',
  );
  await issue(
    () =>
      f.editor.preview([{ path: 'large.json', expectedHash: '0'.repeat(64), operations: [replace('', 1)] }]),
    'CONFIG_LIMIT',
  );
  const base = await request(f, [replace('/a', 2)]);
  assert.throws(
    () => f.editor.preview([{ ...base, operations: [replace('/a', 'x'.repeat(configLimits.inputBytes))] }]),
    (e) => e.code === 'CONFIG_LIMIT',
  );
  assert.throws(
    () =>
      f.editor.preview(
        Array.from({ length: 3 }, () => ({
          ...base,
          operations: Array.from({ length: 100 }, () => replace('/a', 2)),
        })),
      ),
    (e) => e.code === 'CONFIG_LIMIT',
  );
  for (const value of [NaN, Infinity, 9007199254740992, undefined])
    assert.throws(
      () => f.editor.preview([{ ...base, operations: [replace('/a', value)] }]),
      (e) => ['CONFIG_NUMBER_PRECISION', 'CONFIG_VALUE'].includes(e.code),
    );
  const now = Date.now;
  let t = now();
  Date.now = () => (t += configLimits.ms + 1);
  try {
    await issue(() => f.editor.preview([base]), 'CONFIG_LIMIT');
  } finally {
    Date.now = now;
  }
});
test('crash after first write recovers through ordinary patch status/resume/undo without regeneration', async () => {
  const f = await fixture({ 'a.json': '{"a":1}\n', 'b.json': '{"b":1}\n' }),
    files = [await request(f, [replace('/a', 2)]), await request(f, [replace('/b', 2)], 'b.json')];
  const script = path.join(f.state, 'crash.mjs');
  await writeFile(
    script,
    `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';const original=fs.rename;fs.rename=async(...args)=>{const result=await original(...args);if(args[1]===${JSON.stringify(path.join(f.root, 'a.json'))})process.exit(73);return result;};syncBuiltinESMExports();const {Workspace}=await import(${JSON.stringify(pathToFileURL(path.join(repo, 'dist/workspace.js')).href)});const {Serial}=await import(${JSON.stringify(pathToFileURL(path.join(repo, 'dist/changes.js')).href)});const {Patches}=await import(${JSON.stringify(pathToFileURL(path.join(repo, 'dist/patches.js')).href)});const {ConfigEdits}=await import(${JSON.stringify(pathToFileURL(path.join(repo, 'dist/config-edits.js')).href)});const workspace=await Workspace.create(${JSON.stringify(f.root)});const patches=new Patches(workspace,${JSON.stringify(f.journal)},new Serial());await new ConfigEdits(workspace,patches).apply('crash',${JSON.stringify(files)});`,
  );
  await assert.rejects(execute(process.execPath, [script], { windowsHide: true }), (e) => e.code === 73);
  assert.equal((await f.patches.status('crash')).state, 'applying');
  await assert.rejects(f.editor.apply('crash', files), (e) => e.code === 'OPERATION_UNCERTAIN');
  assert.equal((await f.patches.resume('crash')).state, 'applied');
  assert.equal(JSON.parse(await read(f, 'b.json')).b, 2);
  await f.patches.undo('crash');
  assert.equal(await read(f), '{"a":1}\n');
  assert.equal(await read(f, 'b.json'), '{"b":1}\n');
});
test('output size is bounded in the original UTF-16 encoding before any snapshots are published', async () => {
  const original = Buffer.concat([Buffer.from([255, 254]), Buffer.from('{"a":1}', 'utf16le')]),
    f = await fixture({ 'a.json': original });
  await issue(
    async () => f.editor.apply('output-limit', [await request(f, [replace('/a', 'x'.repeat(600000))])]),
    'CONFIG_LIMIT',
  );
  assert.deepEqual(await bytes(f), original);
  assert.deepEqual(await readdir(f.state), []);
});
