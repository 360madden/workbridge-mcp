import { spawn } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Workspace } from './workspace.js';
import { BridgeError, excludedDirectories, limits } from './core.js';

export type SearchOptions = {
  directory: string;
  query: string;
  caseSensitive?: boolean;
  limit?: number;
  includeGenerated?: boolean;
  glob?: string[];
  regex?: boolean;
  includeIgnored?: boolean;
  offset?: number;
};
export async function search(workspace: Workspace, options: SearchOptions) {
  const root = await workspace.directory(options.directory),
    offset = options.offset ?? 0,
    limit = options.limit ?? 100;
  const args = [
    '--no-config',
    '--json',
    '--hidden',
    '--sort',
    'path',
    '--engine',
    'default',
    '--regex-size-limit',
    '1M',
  ];
  if (!options.regex) args.push('--fixed-strings');
  if (!options.caseSensitive) args.push('--ignore-case');
  if (options.includeIgnored) args.push('--no-ignore');
  // Ripgrep resolves overlapping globs in argument order. Caller inclusions must
  // never override protected metadata or the generated-folder policy.
  for (const glob of options.glob ?? []) args.push('--glob', glob);
  args.push('--glob', '!**/.git/**', '--glob', '!**/.workbridge-*.tmp');
  if (!options.includeGenerated)
    for (const directory of excludedDirectories.filter((x) => x !== '.git'))
      args.push('--glob', `!**/${directory}/**`);
  args.push('--', options.query, '.');
  const child = spawn(rgPath, args, {
    cwd: root,
    windowsHide: true,
    shell: false,
    env: { ...process.env, CONTROL_PLANE_API_KEY: undefined, RIPGREP_CONFIG_PATH: undefined },
  });
  const ended = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, error }));
    child.once('close', (code) => resolve({ code }));
  });
  let pending = '',
    bytes = 0,
    seen = 0,
    filesSearched = 0,
    skippedEntries = 0,
    limited = false,
    reason: string | null = null,
    stderr = '';
  const matches: { path: string; line: number; text: string }[] = [];
  const decoder = new StringDecoder('utf8');
  let totalSearches: number | null = null;
  const stop = (why: string) => {
    limited = true;
    reason ??= why;
    child.kill();
  };
  const timer = setTimeout(() => stop('time'), limits.scanMs);
  timer.unref();
  child.stderr.on('data', (data) => {
    stderr = (stderr + String(data)).slice(0, 2000);
  });
  try {
    for await (const chunk of child.stdout) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        stop('output');
        break;
      }
      pending += decoder.write(chunk);
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const raw = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!raw) continue;
        const event = JSON.parse(raw) as {
          type: string;
          data: {
            path?: { text?: string; bytes?: string };
            lines?: { text?: string; bytes?: string };
            line_number?: number;
            submatches?: { start: number }[];
          };
        };
        if (event.type === 'summary')
          totalSearches = (JSON.parse(raw) as { data: { stats: { searches: number } } }).data.stats.searches;
        if (event.type === 'begin') filesSearched++;
        if (event.type !== 'match') continue;
        const filename =
          event.data.path?.text ?? Buffer.from(event.data.path?.bytes ?? '', 'base64').toString('utf8');
        const target = path.resolve(root, filename);
        try {
          await workspace.resolve(target);
        } catch {
          skippedEntries++;
          continue;
        }
        if (seen++ < offset) continue;
        if (matches.length >= limit) {
          stop('results');
          break;
        }
        const text =
          event.data.lines?.text ?? Buffer.from(event.data.lines?.bytes ?? '', 'base64').toString('utf8');
        const at = event.data.submatches?.[0]?.start ?? 0,
          begin = Math.max(0, at - 120);
        matches.push({
          path: workspace.relative(target),
          line: event.data.line_number ?? 1,
          text: text.slice(begin, begin + 500).replace(/[\r\n]+$/, ''),
        });
      }
      if (limited) break;
    }
  } catch (e) {
    if (!limited) throw e;
  } finally {
    clearTimeout(timer);
    if (limited) child.kill();
  }
  const result = await ended;
  if (result.error)
    throw new BridgeError(
      'SEARCH_UNAVAILABLE',
      'Bundled ripgrep could not start. Run npm ci, including optional platform packages.',
    );
  if (!limited && result.code !== 0 && result.code !== 1)
    throw new BridgeError('SEARCH_ERROR', stderr || 'Search failed; check the query/glob.');
  return {
    directory: workspace.relative(root),
    query: options.query,
    matches,
    filesSearched: totalSearches,
    filesWithMatches: filesSearched,
    skippedFiles: null,
    skippedEntries,
    truncated: limited,
    resultLimitReached: reason === 'results',
    scanLimitReached: reason === 'time' || reason === 'output',
    nextOffset: reason === 'results' ? offset + matches.length : null,
    limitReason: reason,
    note: 'Sorted live results, not a filesystem snapshot. Git ignore rules apply unless includeIgnored=true or an explicit positive glob overrides them (ripgrep semantics). Generated-folder exclusions remain enforced unless includeGenerated=true. Binary files, links and .git are excluded. A budget-limited search is incomplete; narrow it.',
  };
}
