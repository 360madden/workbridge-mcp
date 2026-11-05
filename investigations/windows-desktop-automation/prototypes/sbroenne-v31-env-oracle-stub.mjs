// M3-P8 synthetic-only MCP stdio child. Never touches desktop/GUI/UIA.
// The only varying protocol metadata is TWENTY 0/1 environment key PRESENCE bits;
// no variable values, paths, usernames, tokens, commands or files are emitted.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

// First six MUST be present; remaining fourteen are every other Windows
// getDefaultEnvironment() key in installed MCP SDK v2.3.1 and MUST be absent.
const keys = [
  'PATH', 'SYSTEMROOT', 'TEMP', 'WINDIR',
  'DOTNET_BUNDLE_EXTRACT_BASE_DIR', 'MCP_WINDOWS_TIMEOUT_MS',
  'APPDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA',
  'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'PROGRAMDATA', 'PROGRAMFILES',
  'PROGRAMFILES(X86)', 'PROGRAMW6432', 'SYSTEMDRIVE', 'USERNAME', 'USERPROFILE'
];
const present = new Set(Object.keys(process.env).map(key => key.toUpperCase()));
const mask = keys.map(key => present.has(key) ? '1' : '0').join('');
if (!/^[01]{20}$/.test(mask)) process.exit(71);

serveStdio(() => {
  const server = new McpServer(
    { name: 'workbridge-synthetic-env-presence', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.registerTool('envmask_' + mask, {
    title: 'Synthetic Boolean-Key Presence Only',
    description: 'Fixture metadata only. No tool invocation is permitted.'
  }, async () => {
    // The trusted runner NEVER calls tools/call. If another client does,
    // return a fixed error without accessing any sensitive environment.
    throw new Error('SYNTHETIC_TOOL_CALL_DISABLED');
  });
  return server;
}, { legacy: 'serve' });
