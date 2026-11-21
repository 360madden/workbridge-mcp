import assert from 'node:assert/strict';
import test from 'node:test';
import { RESEARCH_TOOL_NAMES, checkResearchToolCatalog } from '../scripts/research-tool-catalog.mjs';

function tools() {
  return RESEARCH_TOOL_NAMES.map((name) => ({
    name,
    annotations: {
      readOnlyHint: name === 'research_status',
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: { type: 'object', properties: { requestId: { type: 'string' } } },
  }));
}

test('legacy releases with no research tools remain eligible for rollback checks', () => {
  for (const version of ['0.16.4-dev', '0.16.5-dev', '0.12.0-dev']) {
    assert.deepEqual(checkResearchToolCatalog([], version), { count: 0, sealedRuntimeRequired: false });
  }
});

test('four research tools with exact annotations require sealed runtime closure', () => {
  assert.deepEqual(checkResearchToolCatalog(tools(), '0.16.5-dev'), {
    count: 4,
    sealedRuntimeRequired: true,
  });
});

test('partial or duplicate research catalogs cannot pass release acceptance', () => {
  for (const broken of [tools().slice(0, 2), [...tools(), tools()[0]], [tools()[0]]]) {
    assert.throws(() => checkResearchToolCatalog(broken, '0.16.5-dev'), /partial|repeated/);
  }
});

test('a new research catalog cannot accidentally be applied as an older version', () => {
  assert.throws(() => checkResearchToolCatalog(tools(), '0.16.4-dev'), /unsupported/);
});

test('research tools cannot omit input schemas or advertise broader effects', () => {
  for (const changed of [
    (list) => {
      list[0].inputSchema = undefined;
    },
    (list) => {
      list[1].annotations.openWorldHint = true;
    },
    (list) => {
      list[2].annotations.readOnlyHint = false;
    },
    (list) => {
      list[3].annotations.destructiveHint = true;
    },
  ]) {
    const list = tools();
    changed(list);
    assert.throws(() => checkResearchToolCatalog(list, '0.16.5-dev'));
  }
});
