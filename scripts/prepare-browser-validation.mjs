import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const root = process.env.WORKBRIDGE_ROOT ?? 'C:\\work';
const directory = await mkdtemp(path.join(root, 'workbridge-validation-'));
const project = path.relative(root, directory).split(path.sep).join('/');
const git = (...args) =>
  execFileSync('git', args, { cwd: directory, windowsHide: true, encoding: 'utf8' }).trim();
await writeFile(
  path.join(directory, 'README.md'),
  '# Disposable Workbridge validation project\nSynthetic fixture only. Fix add.mjs using the test, then inspect the selected-file commit.\n',
);
await writeFile(path.join(directory, '.gitattributes'), '* text eol=lf\n');
await writeFile(path.join(directory, '.gitignore'), 'large.log\n');
await writeFile(path.join(directory, 'add.mjs'), 'export const add = (a, b) => a - b;\n');
await writeFile(
  path.join(directory, 'add.test.mjs'),
  'import {test} from "node:test";\nimport assert from "node:assert/strict";\nimport {add} from "./add.mjs";\ntest("adds numbers", () => assert.equal(add(2,3),5));\n',
);
await writeFile(path.join(directory, 'unrelated.txt'), 'baseline unrelated content\n');
git('init', '--initial-branch=main');
git('config', 'user.name', 'Workbridge Validation Fixture');
git('config', 'user.email', 'fixture@example.invalid');
git('config', 'commit.gpgsign', 'false');
git('add', '.');
git('commit', '-m', 'Synthetic acceptance baseline');
const expectedHead = git('rev-parse', 'HEAD');
await writeFile(path.join(directory, 'unrelated.txt'), 'unrelated staged change must be preserved\n');
git('add', 'unrelated.txt');
await writeFile(
  path.join(directory, 'large.log'),
  'A large ordinary text log fixture for paging.\r\n'.repeat(80000),
);
const state = path.join(repo, '.local');
await mkdir(state, { recursive: true });
const configPath = path.join(state, 'commands.json');
let config;
try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  config = { projects: {} };
}
config.projects[project] = {
  test: { executable: process.execPath, args: ['--test', 'add.test.mjs'], timeoutSeconds: 30 },
};
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
const evidence = {
  project,
  directory,
  expectedHead,
  synthetic: true,
  purpose: 'Hosted MCP coding workflow validation; no RiftReader writes.',
};
await writeFile(path.join(state, 'browser-validation.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
