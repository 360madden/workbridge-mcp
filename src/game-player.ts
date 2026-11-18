import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/client/stdio';
import { stripVTControlCharacters } from 'node:util';
import { BridgeError } from './core.js';

const installation = 'C:\\work\\game-player-mcp';
const wireBytes = 128 * 1024;
const displayChars = 16_384;

export interface GamePlayerWindowList {
  source: 'game-player-mcp';
  tool: 'list_windows';
  scope: 'host-desktop';
  format: 'display-text';
  includesWindowIds: false;
  text: string;
  truncated: boolean;
}

const messages = {
  GAME_PLAYER_BUSY: 'A window discovery is already running or its cleanup is pending.',
  GAME_PLAYER_UNAVAILABLE: 'The fixed game-player MCP installation could not be opened.',
  GAME_PLAYER_TIMEOUT: 'Game-player window discovery exceeded its deadline.',
  GAME_PLAYER_RESPONSE: 'Game-player did not return the expected window display text.',
  GAME_PLAYER_UPSTREAM: 'Game-player window discovery did not complete.',
  GAME_PLAYER_CLEANUP: 'Game-player session cleanup could not be confirmed within its deadline.',
} as const;

class Failure extends BridgeError {
  constructor(code: keyof typeof messages) {
    super(code, messages[code]);
  }
}

interface WindowSession {
  connect(signal: AbortSignal): Promise<void>;
  listWindows(signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export function createGamePlayerWindowSession(
  makeClient: () => Pick<Client, 'connect' | 'getServerVersion' | 'callTool' | 'close'> = () =>
    new Client({ name: 'workbridge-game-player-discovery', version: '1.0.0' }),
  makeTransport: (params: StdioServerParameters) => StdioClientTransport = (params) =>
    new StdioClientTransport(params),
): WindowSession {
  // Not the caller's cwd/PATH/PYTHONPATH. The SDK only inherits its short default OS allowlist.
  // Discard stderr (may contain titles or diagnostic data); stdout is exclusively bounded MCP frames.
  const transport = makeTransport({
    command: installation + '\\.venv\\Scripts\\python.exe',
    args: ['-X', 'utf8', '-m', 'game_player_mcp'],
    cwd: installation,
    env: { PYTHONNOUSERSITE: '1', PYTHONSAFEPATH: '1', PYTHONDONTWRITEBYTECODE: '1' },
    stderr: 'ignore',
    maxBufferSize: wireBytes,
  });
  const client = makeClient();
  return {
    async connect(signal) {
      await client.connect(transport, { signal });
      if (client.getServerVersion()?.name !== 'game-player') throw new Failure('GAME_PLAYER_UNAVAILABLE');
    },
    listWindows(signal) {
      return client.callTool(
        { name: 'list_windows', arguments: {} },
        { signal, toolDefinition: { name: 'list_windows', inputSchema: { type: 'object' } } },
      );
    },
    async close() {
      try {
        await client.close();
      } finally {
        // Also close a transport that failed before becoming attached to the client.
        await transport.close();
      }
    },
  };
}

function inventory(reply: unknown): GamePlayerWindowList {
  if (!reply || typeof reply !== 'object') throw new Failure('GAME_PLAYER_RESPONSE');
  if ('isError' in reply && reply.isError !== false) throw new Failure('GAME_PLAYER_UPSTREAM');
  if (!('content' in reply) || !Array.isArray(reply.content) || reply.content.length !== 1) {
    throw new Failure('GAME_PLAYER_RESPONSE');
  }
  const block: unknown = reply.content[0];
  if (
    !block ||
    typeof block !== 'object' ||
    !('type' in block) ||
    block.type !== 'text' ||
    !('text' in block) ||
    typeof block.text !== 'string' ||
    Buffer.byteLength(block.text) > wireBytes
  ) {
    throw new Failure('GAME_PLAYER_RESPONSE');
  }
  // Retain line breaks and fixed-width layout. Titles are untrusted data and can contain terminal/bidi controls.
  const clean = stripVTControlCharacters(block.text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  if (!clean.trim()) throw new Failure('GAME_PLAYER_RESPONSE');
  const truncated = clean.length > displayChars;
  const text = truncated ? clean.slice(0, displayChars).replace(/[\ud800-\udbff]$/, '') : clean;
  return {
    source: 'game-player-mcp',
    tool: 'list_windows',
    scope: 'host-desktop',
    format: 'display-text',
    includesWindowIds: false,
    text,
    truncated,
  };
}

// The factory/short test deadlines are internal injection points, never exposed as MCP arguments.
export function createGamePlayerDiscovery(
  makeSession: () => WindowSession = createGamePlayerWindowSession,
  timeoutMs = 20_000,
  closeMs = 5_000,
) {
  let busy = false;
  return async (): Promise<GamePlayerWindowList> => {
    if (busy) throw new Failure('GAME_PLAYER_BUSY');
    busy = true;
    let session: WindowSession;
    try {
      session = makeSession();
    } catch {
      busy = false;
      throw new Failure('GAME_PLAYER_UNAVAILABLE');
    }
    const controller = new AbortController();
    let connected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Failure('GAME_PLAYER_TIMEOUT'));
          controller.abort();
        }, timeoutMs);
      });
      const run = async () => {
        await session.connect(controller.signal);
        controller.signal.throwIfAborted();
        connected = true;
        return inventory(await session.listWindows(controller.signal));
      };
      return await Promise.race([deadline, run()]);
    } catch (error) {
      if (error instanceof Failure) throw error;
      throw new Failure(connected ? 'GAME_PLAYER_UPSTREAM' : 'GAME_PLAYER_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      // Keep the single slot occupied past the close deadline if shutdown hasn't actually finished.
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      const close = Promise.resolve()
        .then(() => session.close())
        .then(() => {
          busy = false;
        });
      try {
        await Promise.race([
          close,
          new Promise<never>((_, reject) => {
            closeTimer = setTimeout(() => reject(new Failure('GAME_PLAYER_CLEANUP')), closeMs);
          }),
        ]);
      } catch {
        throw new Failure('GAME_PLAYER_CLEANUP');
      } finally {
        clearTimeout(closeTimer);
      }
    }
  };
}

export const gamePlayerListWindows = createGamePlayerDiscovery();
