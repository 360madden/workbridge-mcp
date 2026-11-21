import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { desktopUiHelperUrl, riftProjectsRoot } from '../src/workspace-path.mjs';

const casePath = (text) => text.toLowerCase().replaceAll('/', '\\');

test('read-only WinApp helper resolves to core source for checkout and sealed file for runtime', () => {
  const fromSource = pathToFileURL('C:\\work\\workbridge-mcp\\integrations\\rift\\src\\physical-epoch.mjs');
  const fromSealed = pathToFileURL(
    'C:\\work\\workbridge-mcp\\dist\\research-runtime\\rift\\src\\physical-epoch.mjs',
  );
  assert.equal(
    casePath(fileURLToPath(desktopUiHelperUrl(fromSource))),
    'c:\\work\\workbridge-mcp\\scripts\\desktop-ui.mjs',
  );
  assert.equal(
    casePath(fileURLToPath(desktopUiHelperUrl(fromSealed))),
    'c:\\work\\workbridge-mcp\\dist\\research-runtime\\support\\desktop-ui.mjs',
  );
});

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
