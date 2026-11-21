import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { riftProjectsRoot } from '../src/workspace-path.mjs';

const casePath = (text) => text.toLowerCase().replaceAll('/', '\\');

test('source checkout discovers sibling C:\\work RIFT repositories', () => {
  const url = pathToFileURL('C:\\work\\workbridge-mcp\\integrations\\rift\\src\\bundle.mjs');
  assert.equal(casePath(riftProjectsRoot(url, '')), 'c:\\work');
});

test('installed dist/research-runtime resolves the same sibling research root', () => {
  const url = pathToFileURL('C:\\work\\workbridge-mcp\\dist\\research-runtime\\rift\\src\\bundle.mjs');
  assert.equal(casePath(riftProjectsRoot(url, '')), 'c:\\work');
});

test('release candidate honors the declared workspace root during offline validation', () => {
  const url = pathToFileURL(
    'C:\\work\\workbridge-mcp\\.local\\releases\\candidate\\payload\\dist\\research-runtime\\rift\\src\\bundle.mjs',
  );
  assert.equal(casePath(riftProjectsRoot(url, 'C:\\work')), 'c:\\work');
});
