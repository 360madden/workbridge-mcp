#!/usr/bin/env node
// Read-only coordination-assignment query for a single authorized Git repository.
// Workbridge assignments are metadata, NOT independent AI reasoning agents.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { connectService } from '../dist/local-service.js';

const project = process.argv[2] ?? 'workbridge-mcp';
if (
  typeof project !== 'string' ||
  project.length === 0 ||
  project.length > 4096 ||
  /[\x00-\x1f\x7f]/.test(project)
) {
  process.stdout.write(JSON.stringify({ ok: false, error: 'Invalid project path' }) + '\n');
  process.exitCode = 2;
} else {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const client = new Client({ name: 'workbridge-desktop-assignments', version: '1.0.0' });
  try {
    const { transport } = await connectService(path.join(repo, '.local'), { signal: controller.signal });
    await client.connect(transport, { signal: controller.signal, timeout: 10000 });
    const response = await client.callTool(
      { name: 'agent_list', arguments: { project } },
      { signal: controller.signal, timeout: 10000 },
    );
    if (response.isError) throw new Error('Assignment lookup unsuccessful');
    const result =
      response.structuredContent ??
      JSON.parse(response.content?.find((item) => item.type === 'text')?.text ?? '{}');
    const tasks = Array.isArray(result.tasks) ? result.tasks : [];
    process.stdout.write(
      JSON.stringify({
        ok: true,
        project,
        revision: result.revision ?? null,
        maxWorkers: result.maxWorkers ?? null,
        running: result.running ?? null,
        available: result.available ?? null,
        coordinatorSlots: result.coordinatorSlots ?? null,
        recorded: tasks.length,
        truncated: tasks.length > 36,
        assignments: tasks.slice(0, 36).map((task) => ({
          taskId: task.taskId ?? '',
          workerId: task.workerId ?? '',
          state: task.state ?? '',
          jobId: task.jobId ?? null,
        })),
        sampledUtc: new Date().toISOString(),
      }) + '\n',
    );
  } catch {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: 'Coordination assignments unavailable',
      }) + '\n',
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => {});
  }
}
