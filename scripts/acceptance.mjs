import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repo = fileURLToPath(new URL('..', import.meta.url));
const project = process.argv[2] ?? 'RiftReader';
const query = process.argv[3] ?? 'def resolve_pointer_chain(';
const client = new Client({ name: 'workbridge-acceptance', version: '0.3.0' });
const call = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, `${name}: ${JSON.stringify(response.content)}`);
  return JSON.parse(response.content[0].text);
};
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repo, 'dist/server.js')],
      stderr: 'inherit',
    }),
  );
  const { tools } = await client.listTools();
  const info = await call('workspace_info');
  const projects = await call('discover_projects');
  assert.ok(
    projects.projects.some((p) => p.path.toLowerCase() === project.toLowerCase()),
    `Project ${project} not discovered`,
  );
  const listing = await call('list_directory', { directory: project });
  const sourceDirs = listing.entries.filter(
    (e) => e.type === 'directory' && /\/(src|scripts|reader|tools)$/i.test(e.path),
  );
  let search;
  for (const directory of [...sourceDirs.map((e) => e.path), project]) {
    search = await call('search_text', { directory, query, limit: 20 });
    if (search.matches.length) break;
  }
  assert.ok(search.matches.length, 'Expected to locate resolver source through MCP');
  const hit = search.matches[0];
  const source = await call('read_file', {
    path: hit.path,
    startLine: Math.max(1, hit.line - 3),
    lineCount: 90,
  });
  assert.ok(source.text.includes(query), 'Source read must contain the searched resolver');
  const status = await call('git_status', { project });
  const diff = await call('git_diff', { project });
  const history = await call('git_history', { project, limit: 3 });
  assert.ok(history.output.length, 'Expected real commit history');
  const evidence = {
    testedAt: new Date().toISOString(),
    transport: 'local stdio MCP (not browser/tunnel)',
    root: info.root,
    project,
    toolCount: tools.length,
    resolver: { path: hit.path, line: hit.line },
    search: { filesSearched: search.filesSearched, truncated: search.truncated },
    source,
    git: { status, diff, history },
  };
  await mkdir(path.join(repo, '.local'), { recursive: true });
  await writeFile(path.join(repo, '.local', 'acceptance.json'), JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        project,
        resolver: evidence.resolver,
        toolCount: tools.length,
        evidence: path.join(repo, '.local', 'acceptance.json'),
        browserVerified: false,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
