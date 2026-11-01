import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, type McpServerFactory } from '@modelcontextprotocol/server';
import { MAX_CONCURRENT_JOBS } from './jobs.js';

const descriptorSchemaVersion = 1;
const maxDescriptorBytes = 64 * 1024;
const maxErrorBytes = 8 * 1024;
const requestBodyLimit = 32 * 1024 * 1024;
// Each MCP client may hold multiple HTTP keep-alive connections (ready, init, tool calls).
// Scale the socket budget with worker capacity and one coordinator.
export const MAX_LOCAL_MCP_CONNECTIONS = Math.max(64, (MAX_CONCURRENT_JOBS + 1) * 4);
const helper = fileURLToPath(new URL('./Local-Service-Descriptor.ps1', import.meta.url));

export type LocalServiceEndpoint = {
  schemaVersion: 1;
  url: string;
  readyUrl: string;
  root: string;
  state: string;
  version: string;
  instanceId: string;
  pid: number;
  startedUtc: string;
};

type PrivateEndpoint = LocalServiceEndpoint & { authorization: string };

export type LocalService = {
  status: LocalServiceEndpoint;
  stopAccepting(): Promise<void>;
  close(): Promise<void>;
};

function powershell() {
  return process.env.WINDIR
    ? path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function helperEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(CONTROL_PLANE_API_KEY|OPENAI_API_KEY|WORKBRIDGE_.*|GIT_.*)$/i.test(key),
    ),
  );
}

type HelperAction = 'Own' | 'CheckOwned' | 'Protect' | 'Unprotect' | 'ReadOwned';

function helperArguments(action: HelperAction, directory?: string) {
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'RemoteSigned',
    '-File',
    helper,
    '-Action',
    action,
  ];
  if (directory) args.push('-Directory', directory);
  return args;
}

function appendBounded(current: string, chunk: Buffer, limit: number) {
  if (current.length >= limit) return current;
  return (current + chunk.toString('utf8')).slice(0, limit);
}

async function transformDescriptor(action: 'Protect' | 'Unprotect', input: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const child = spawn(powershell(), helperArguments(action), {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: helperEnvironment(),
  });
  let stdout = '';
  let stderr = '';
  child.on('error', (error) => (stderr = appendBounded(stderr, Buffer.from(error.message), maxErrorBytes)));
  child.stdin.on('error', () => undefined);
  child.stdout.on('data', (chunk: Buffer) => (stdout = appendBounded(stdout, chunk, maxDescriptorBytes)));
  child.stderr.on('data', (chunk: Buffer) => (stderr = appendBounded(stderr, chunk, maxErrorBytes)));
  const abort = () => child.kill();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => child.kill(), 10_000);
  try {
    child.stdin.end(input, 'utf8');
    const [code] = (await once(child, 'close')) as [number | null];
    if (signal?.aborted) throw signal.reason ?? new Error('Descriptor operation aborted.');
    if (code !== 0)
      throw new Error(
        `Local-service descriptor ${action.toLowerCase()} failed${stderr ? `: ${stderr.trim()}` : '.'}`,
      );
    if (!stdout || stdout.length >= maxDescriptorBytes)
      throw new Error(`Local-service descriptor ${action.toLowerCase()} returned invalid output.`);
    return stdout.trim();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function readOwnedDescriptor(directory: string, input: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const child = spawn(powershell(), helperArguments('ReadOwned', directory), {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: helperEnvironment(),
  });
  let stdout = '';
  let stderr = '';
  child.on('error', (error) => (stderr = appendBounded(stderr, Buffer.from(error.message), maxErrorBytes)));
  child.stdin.on('error', () => undefined);
  child.stdout.on('data', (chunk: Buffer) => (stdout = appendBounded(stdout, chunk, maxDescriptorBytes)));
  child.stderr.on('data', (chunk: Buffer) => (stderr = appendBounded(stderr, chunk, maxErrorBytes)));
  const abort = () => child.kill();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => child.kill(), 10_000);
  try {
    child.stdin.end(input, 'utf8');
    const [code] = (await once(child, 'close')) as [number | null];
    if (signal?.aborted) throw signal.reason ?? new Error('Descriptor operation aborted.');
    if (code !== 0)
      throw new Error(`The local Workbridge owner lock is not held${stderr ? `: ${stderr.trim()}` : '.'}`);
    if (!stdout || stdout.length >= maxDescriptorBytes)
      throw new Error('The local-service descriptor returned invalid output.');
    return stdout.trim();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function acquireOwner(directory: string) {
  const child = spawn(powershell(), helperArguments('Own', directory), {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: helperEnvironment(),
  });
  const childClosed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  let stdout = '';
  let stderr = '';
  child.on('error', (error) => (stderr = appendBounded(stderr, Buffer.from(error.message), maxErrorBytes)));
  child.stdin.on('error', () => undefined);
  child.stdout.on('data', (chunk: Buffer) => (stdout = appendBounded(stdout, chunk, 1024)));
  child.stderr.on('data', (chunk: Buffer) => (stderr = appendBounded(stderr, chunk, maxErrorBytes)));
  await new Promise<void>((resolve) => {
    const finish = () => {
      child.stdout.removeListener('data', check);
      child.removeListener('close', finish);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (stdout.includes('\n')) finish();
    };
    const timer = setTimeout(finish, 10_000);
    child.stdout.on('data', check);
    child.once('close', finish);
    check();
  });
  if (stdout.trim() !== 'READY') {
    child.kill();
    await childClosed;
    throw new Error(
      `Cannot acquire the local-service owner lock${stderr ? `: ${stderr.trim()}` : '; another owner may be running.'}`,
    );
  }
  let released = false;
  return {
    child,
    async release() {
      if (released) return;
      released = true;
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5000);
      try {
        await childClosed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function digest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function rawHeaderCount(request: IncomingMessage, name: string) {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index]?.toLowerCase() === name) count++;
  return count;
}

function authorized(request: IncomingMessage, authorization: string) {
  if (rawHeaderCount(request, 'authorization') !== 1 || typeof request.headers.authorization !== 'string')
    return false;
  return timingSafeEqual(digest(request.headers.authorization), digest(authorization));
}

function answer(response: ServerResponse, status: number, body: Record<string, unknown>) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text).toString(),
    'cache-control': 'no-store',
  });
  response.end(text);
}

function publicEndpoint(endpoint: PrivateEndpoint): LocalServiceEndpoint {
  const { authorization: _authorization, ...result } = endpoint;
  return result;
}

function parseEndpoint(value: unknown, expectedState: string): PrivateEndpoint {
  if (!value || typeof value !== 'object') throw new Error('Invalid local-service descriptor.');
  const item = value as Record<string, unknown>;
  for (const key of [
    'url',
    'readyUrl',
    'root',
    'state',
    'version',
    'instanceId',
    'startedUtc',
    'authorization',
  ])
    if (typeof item[key] !== 'string' || !(item[key] as string).length || (item[key] as string).length > 8192)
      throw new Error('Invalid local-service descriptor.');
  if (
    item.schemaVersion !== descriptorSchemaVersion ||
    item.state !== expectedState ||
    !Number.isSafeInteger(item.pid) ||
    (item.pid as number) <= 0
  )
    throw new Error('Invalid local-service descriptor.');
  const url = new URL(item.url as string);
  const ready = new URL(item.readyUrl as string);
  if (
    url.protocol !== 'http:' ||
    ready.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    ready.hostname !== '127.0.0.1' ||
    !url.port ||
    !ready.port ||
    url.port !== ready.port ||
    url.username ||
    url.password ||
    ready.username ||
    ready.password ||
    url.pathname !== '/mcp' ||
    ready.pathname !== '/readyz' ||
    url.search ||
    ready.search ||
    url.hash ||
    ready.hash ||
    !/^Bearer [A-Za-z0-9_-]{43}$/.test(item.authorization as string)
  )
    throw new Error('Invalid local-service descriptor.');
  return item as PrivateEndpoint;
}

async function atomicWrite(file: string, text: string) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function startLocalService(options: {
  state: string;
  root: string;
  version: string;
  createServer: McpServerFactory;
  onFatal?: () => void;
}): Promise<LocalService> {
  const state = await realpath(options.state);
  const root = await realpath(options.root);
  if (!options.version || options.version.length > 200) throw new Error('Invalid local-service version.');
  const directory = path.join(state, 'ipc');
  const descriptorFile = path.join(directory, 'endpoint.dpapi');
  let descriptorCiphertext: string | undefined;
  let released = false;
  let stopPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let intentionalOwnerRelease = false;
  const startupAbort = new AbortController();
  const handler = createMcpHandler(options.createServer, {
    legacy: 'stateless',
    maxRequestBodySize: requestBodyLimit,
  });
  const nodeHandler = toNodeHandler(handler, {
    onerror: () => console.error(JSON.stringify({ event: 'local_service_request_failed' })),
  });
  const authorization = `Bearer ${randomBytes(32).toString('base64url')}`;
  const startedUtc = new Date().toISOString();
  const instanceId = randomUUID();
  let endpoint: PrivateEndpoint | undefined;
  const server = createHttpServer((request, response) => {
    void (async () => {
      if (request.socket.remoteAddress !== '127.0.0.1') return answer(response, 403, { error: 'forbidden' });
      if (!endpoint) return answer(response, 503, { error: 'not_ready' });
      const expectedHost = `127.0.0.1:${new URL(endpoint.url).port}`;
      const hostCount = rawHeaderCount(request, 'host');
      const originCount = rawHeaderCount(request, 'origin');
      if (hostCount !== 1 || request.headers.host !== expectedHost || originCount !== 0)
        return answer(response, 403, { error: 'forbidden' });
      if (!authorized(request, authorization)) return answer(response, 401, { error: 'unauthorized' });
      const requestUrl = new URL(request.url ?? '/', `http://${expectedHost}`);
      if (requestUrl.origin !== `http://${expectedHost}`)
        return answer(response, 403, { error: 'forbidden' });
      if (requestUrl.pathname === '/readyz' && request.method === 'GET')
        return answer(response, 200, publicEndpoint(endpoint));
      if (requestUrl.pathname !== '/mcp' || requestUrl.search || requestUrl.hash)
        return answer(response, 404, { error: 'not_found' });
      const declared = Number(request.headers['content-length']);
      if (Number.isFinite(declared) && declared > requestBodyLimit)
        return answer(response, 413, { error: 'request_too_large' });
      await nodeHandler(request, response);
    })().catch(() => {
      console.error(JSON.stringify({ event: 'local_service_request_failed' }));
      if (!response.headersSent) answer(response, 500, { error: 'internal_error' });
      else response.destroy();
    });
  });
  server.maxConnections = MAX_LOCAL_MCP_CONNECTIONS;
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  const owner = await acquireOwner(directory);

  const removePublishedDescriptor = async () => {
    if (!descriptorCiphertext) return;
    const current = await readFile(descriptorFile, 'utf8').catch(() => '');
    if (current === descriptorCiphertext) await unlink(descriptorFile).catch(() => undefined);
  };

  const stopAccepting = () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      await removePublishedDescriptor();
      const serverStopped = server.listening
        ? new Promise<void>((resolve) => server.close(() => resolve()))
        : Promise.resolve();
      await handler.close().catch(() => undefined);
      server.closeAllConnections();
      await serverStopped;
    })();
    return stopPromise;
  };

  const close = () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      await stopAccepting();
      if (!released) {
        released = true;
        intentionalOwnerRelease = true;
        await owner.release();
      }
    })();
    return closePromise;
  };

  let guardianFailureHandled = false;
  const guardianFailed = () => {
    if (guardianFailureHandled) return;
    guardianFailureHandled = true;
    if (intentionalOwnerRelease) return;
    const error = new Error('The local-service owner guardian exited unexpectedly.');
    startupAbort.abort(error);
    try {
      options.onFatal?.();
    } catch {
      console.error(JSON.stringify({ event: 'local_service_fatal_callback_failed' }));
    }
    void stopAccepting();
  };
  owner.child.once('close', guardianFailed);
  if (owner.child.exitCode !== null || owner.child.signalCode !== null) queueMicrotask(guardianFailed);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    startupAbort.signal.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1')
      throw new Error('Local service did not bind to IPv4 loopback.');
    endpoint = {
      schemaVersion: descriptorSchemaVersion,
      url: `http://127.0.0.1:${address.port}/mcp`,
      readyUrl: `http://127.0.0.1:${address.port}/readyz`,
      root,
      state,
      version: options.version,
      instanceId,
      pid: process.pid,
      startedUtc,
      authorization,
    };
    descriptorCiphertext = await transformDescriptor(
      'Protect',
      JSON.stringify(endpoint),
      startupAbort.signal,
    );
    startupAbort.signal.throwIfAborted();
    await atomicWrite(descriptorFile, descriptorCiphertext);
    if (startupAbort.signal.aborted) {
      await removePublishedDescriptor();
      startupAbort.signal.throwIfAborted();
    }
    return { status: publicEndpoint(endpoint), stopAccepting, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function connectService(
  requestedState: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ transport: StreamableHTTPClientTransport; endpoint: LocalServiceEndpoint }> {
  const state = await realpath(requestedState);
  const descriptorFile = path.join(state, 'ipc', 'endpoint.dpapi');
  const info = await lstat(descriptorFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maxDescriptorBytes)
    throw new Error('Invalid local-service descriptor file.');
  const ciphertext = await readFile(descriptorFile, 'utf8');
  const plaintext = await readOwnedDescriptor(path.dirname(descriptorFile), ciphertext, options.signal);
  const endpoint = parseEndpoint(JSON.parse(plaintext), state);
  try {
    process.kill(endpoint.pid, 0);
  } catch {
    throw new Error('The local Workbridge owner process is not running.');
  }
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)])
    : AbortSignal.timeout(5000);
  const readyResponse = await fetch(endpoint.readyUrl, {
    headers: { authorization: endpoint.authorization },
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  const readyText = await readyResponse.text();
  if (!readyResponse.ok || readyText.length > 16 * 1024)
    throw new Error('The local Workbridge owner is not ready.');
  const ready = parseEndpoint({ ...JSON.parse(readyText), authorization: endpoint.authorization }, state);
  for (const key of [
    'url',
    'readyUrl',
    'root',
    'state',
    'version',
    'instanceId',
    'pid',
    'startedUtc',
  ] as const)
    if (ready[key] !== endpoint[key]) throw new Error('The local Workbridge owner changed during discovery.');
  if ((await readFile(descriptorFile, 'utf8')) !== ciphertext)
    throw new Error('The local Workbridge owner changed during discovery.');
  return {
    transport: new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { authorization: endpoint.authorization }, redirect: 'error' },
    }),
    endpoint: publicEndpoint(endpoint),
  };
}
