#!/usr/bin/env node
// Read-only desktop status probe. Never starts a second Workbridge owner.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { connectService } from '../dist/local-service.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const state = path.join(repo, '.local');
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 12000);
const client = new Client({ name: 'workbridge-desktop-probe', version: '1.0.0' });
try {
  const { transport, endpoint } = await connectService(state, { signal: controller.signal });
  await client.connect(transport, { signal: controller.signal, timeout: 10000 });
  const response = await client.callTool(
    { name: 'diagnostics', arguments: {} },
    { signal: controller.signal, timeout: 10000 },
  );
  if (response.isError) throw new Error('Diagnostics tool returned an error');
  const result =
    response.structuredContent ?? JSON.parse(response.content?.find((x) => x.type === 'text')?.text ?? '{}');
  const capacity = result.jobs?.capacity ?? {};
  const jobs = Array.isArray(capacity.jobs) ? capacity.jobs : [];
  process.stdout.write(
    JSON.stringify({
      ok: true,
      version: result.version ?? endpoint.version,
      tunnelReady: result.tunnel?.ready === true,
      controlPlane: result.tunnel?.controlPlane ?? 'unknown',
      capacity: {
        limit: capacity.limit ?? null,
        occupied: capacity.occupied ?? null,
        available: capacity.available ?? null,
        retainedResults: capacity.retainedResults ?? null,
      },
      runningJobs: result.jobs?.runningJobs ?? null,
      inventoryComplete: result.jobs?.inventory?.complete === true,
      jobs: jobs.slice(0, 36).map((job) => ({
        id: job.jobId,
        project: job.project,
        status: job.status,
        kind: job.kind,
        nextAction: job.nextAction,
      })),
      sampledUtc: new Date().toISOString(),
    }) + '\n',
  );
} catch {
  process.stdout.write(JSON.stringify({ ok: false, error: 'Workbridge status unavailable' }) + '\n');
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await client.close().catch(() => {});
}
