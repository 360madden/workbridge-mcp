#!/usr/bin/env node
// Long-lived, read-only monitoring client. Owns no Workbridge service or jobs.
// Each output line is bounded JSON. Never writes endpoint credentials to stdout.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { connectService } from '../dist/local-service.js';
import { formatStatus, serializeStatus } from './desktop-monitor-format.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const state = path.join(repo, '.local');
const lifecycle = new AbortController();
const intervalMs = 5000;
let client = null;

// A stalled client.close() or an uncooperative transport can otherwise keep
// a monitor alive after its parent disappears. The deadline is intentionally
// reserved for shutdown; normal status calls are never cut short by it.
let shutdownRequested = false;
function requestShutdown() {
  if (shutdownRequested) return;
  shutdownRequested = true;
  lifecycle.abort();
  const forcedExit = setTimeout(() => process.exit(0), 2000);
  forcedExit.unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, requestShutdown);
}

// The WPF parent keeps an inherited stdin pipe open. If it crashes, EOF
// shuts down the monitor even when its MCP transport refuses to close.
if (process.env.WORKBRIDGE_DESKTOP_PARENT_PIPE === '1') {
  process.stdin.resume();
  process.stdin.once('end', requestShutdown);
  process.stdin.once('error', requestShutdown);
}

const emit = (data) => process.stdout.write(serializeStatus(data));

async function closeClient() {
  const current = client;
  client = null;
  if (current) await current.close().catch(() => {});
}

async function waitInterval() {
  try {
    await delay(intervalMs, undefined, { signal: lifecycle.signal });
  } catch {
    // Shutdown interrupted the wait.
  }
}

try {
  while (!lifecycle.signal.aborted) {
    let endpoint;
    try {
      const connected = await connectService(state, { signal: lifecycle.signal });
      endpoint = connected.endpoint;
      client = new Client({ name: 'workbridge-desktop-monitor', version: '1.0.0' });
      await client.connect(connected.transport, { signal: lifecycle.signal, timeout: 8000 });
      while (!lifecycle.signal.aborted) {
        const response = await client.callTool(
          { name: 'diagnostics', arguments: {} },
          { signal: lifecycle.signal, timeout: 8000 },
        );
        if (response.isError) throw new Error('Diagnostics unavailable');
        const result =
          response.structuredContent ??
          JSON.parse(response.content?.find((item) => item.type === 'text')?.text ?? '{}');
        emit(formatStatus(result, endpoint));
        await waitInterval();
      }
    } catch {
      if (!lifecycle.signal.aborted) {
        emit({ ok: false, error: 'Workbridge status unavailable', sampledUtc: new Date().toISOString() });
      }
    } finally {
      await closeClient();
    }
    if (!lifecycle.signal.aborted) await waitInterval();
  }
} finally {
  await closeClient();
}
