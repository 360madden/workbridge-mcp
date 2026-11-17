#!/usr/bin/env node
// Offline, read-only RIFT game/addon inventory and patch-change comparison.
// Only writes timestamped evidence under the ignored .tools/rift-update folder.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'workbridge.rift-update.v1';
const REPO = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = path.join(REPO, '.tools', 'rift-update');
const MAX_FILES = 80000;
const MAX_SCANNED = 250000;
const MAX_DEPTH = 20;
const MAX_FILE_HASH = 256 * 1024 * 1024;
const MAX_TOTAL_HASH = 1024 * 1024 * 1024;
const CODE_EXT = new Set(['.exe', '.dll', '.ocx', '.toc', '.lua', '.xml', '.cfg', '.ini', '.json']);
const ADDON_SKIP_DIRS = new Set(['.git', '.local', '.tools', 'node_modules', '__pycache__', 'build', 'dist']);

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex');
}

function fail(message) {
  throw new Error(message);
}

async function fileHash(filename) {
  const sha = createHash('sha256');
  for await (const part of createReadStream(filename)) sha.update(part);
  return sha.digest('hex');
}

function stableEntry(entry) {
  return entry.scope + ':' + entry.relative.toLowerCase();
}

export async function captureSnapshot(phase, requestedRoots) {
  if (phase !== 'before' && phase !== 'after') fail('Phase must be before or after');
  if (!Array.isArray(requestedRoots) || !requestedRoots.length) fail('At least one root required');
  const roots = [];
  const files = [];
  const errors = [];
  let skippedLinks = 0;
  let skippedDirectories = 0;
  let skippedNonCode = 0;
  let scannedEntries = 0;
  let hashBudget = MAX_TOTAL_HASH;
  for (const item of requestedRoots) {
    if (!/^[a-z][a-z0-9-]*$/.test(item.scope ?? '')) fail('Invalid scope name');
    const resolved = await realpath(path.resolve(item.path));
    if (!(await lstat(resolved)).isDirectory()) fail('Not a directory: ' + resolved);
    if (roots.some((root) => root.scope === item.scope || root.path === resolved)) {
      fail('Duplicate root or scope');
    }
    roots.push({ scope: item.scope, path: resolved });
    const visit = async (dir, relative, depth) => {
      if (depth > MAX_DEPTH) fail('Directory depth limit exceeded: ' + dir);
      let contents;
      try {
        contents = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        errors.push(relative + ': ' + error.code);
        return;
      }
      contents.sort((a, b) => a.name.localeCompare(b.name));
      for (const item of contents) {
        if (++scannedEntries > MAX_SCANNED) fail('Scan limit exceeded (' + MAX_SCANNED + ')');
        const subpath = relative ? relative + '/' + item.name : item.name;
        const filename = path.join(dir, item.name);
        try {
          const info = await lstat(filename);
          if (info.isSymbolicLink()) {
            skippedLinks++;
            continue;
          }
          if (info.isDirectory()) {
            if (
              roots[roots.length - 1].scope === 'addons' &&
              (ADDON_SKIP_DIRS.has(item.name.toLowerCase()) ||
                (depth === 0 &&
                  (item.name.toLowerCase() === 'rift_api_docs' || /\.disabled$/i.test(item.name))))
            ) {
              skippedDirectories++;
              continue;
            }
            await visit(filename, subpath, depth + 1);
            continue;
          }
          if (!info.isFile()) continue;
          const ext = path.extname(item.name).toLowerCase();
          if (roots[roots.length - 1].scope === 'addons' && !CODE_EXT.has(ext)) {
            skippedNonCode++;
            continue;
          }
          if (files.length >= MAX_FILES) fail('File limit exceeded (' + MAX_FILES + ')');
          const record = {
            scope: roots[roots.length - 1].scope,
            relative: subpath.replaceAll('\\', '/'),
            size: info.size,
            mtimeMs: Math.trunc(info.mtimeMs),
          };
          if (CODE_EXT.has(ext) && info.size <= MAX_FILE_HASH && info.size <= hashBudget) {
            record.sha256 = await fileHash(filename);
            const after = await lstat(filename);
            if (
              !after.isFile() ||
              after.size !== info.size ||
              Math.trunc(after.mtimeMs) !== Math.trunc(info.mtimeMs)
            ) {
              fail('File changed during capture: ' + filename);
            }
            hashBudget -= info.size;
          }
          files.push(record);
        } catch (error) {
          if (
            error.message?.startsWith('File limit exceeded') ||
            error.message?.startsWith('Directory depth limit') ||
            error.message?.startsWith('Scan limit exceeded')
          )
            throw error;
          errors.push(subpath + ': ' + (error.code ?? error.message));
        }
      }
    };
    await visit(resolved, '', 0);
  }
  files.sort((a, b) => stableEntry(a).localeCompare(stableEntry(b)));
  for (let i = 1; i < files.length; i++) {
    if (stableEntry(files[i - 1]) === stableEntry(files[i])) {
      fail('Case-insensitive file collision in inventory: ' + stableEntry(files[i]));
    }
  }
  return {
    schema: SCHEMA,
    phase,
    createdUtc: new Date().toISOString(),
    hostname: os.hostname().toUpperCase(),
    roots,
    complete: errors.length === 0,
    errors,
    skippedLinks,
    skippedDirectories,
    skippedNonCode,
    scannedEntries,
    hashedFiles: files.filter((f) => f.sha256).length,
    files,
  };
}

function validateSnapshot(snapshot) {
  if (
    snapshot?.schema !== SCHEMA ||
    !['before', 'after'].includes(snapshot.phase) ||
    typeof snapshot.hostname !== 'string' ||
    !Array.isArray(snapshot.roots) ||
    !Array.isArray(snapshot.files) ||
    snapshot.complete !== true
  )
    fail('Invalid or incomplete snapshot');
  const keys = new Set();
  for (const file of snapshot.files) {
    if (
      typeof file.scope !== 'string' ||
      typeof file.relative !== 'string' ||
      file.relative.startsWith('/') ||
      file.relative.split('/').includes('..') ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !Number.isSafeInteger(file.mtimeMs)
    )
      fail('Invalid snapshot file entry');
    const key = stableEntry(file);
    if (keys.has(key)) fail('Duplicate snapshot file entry');
    keys.add(key);
  }
}

export function compareSnapshots(before, after) {
  validateSnapshot(before);
  validateSnapshot(after);
  if (before.phase !== 'before' || after.phase !== 'after') fail('Snapshot phases differ');
  if (before.hostname !== after.hostname) fail('Machine identity mismatch');
  const sameRoots = (a, b) => JSON.stringify(a.roots) === JSON.stringify(b.roots);
  if (!sameRoots(before, after)) fail('Root paths or scope changed; comparison refused');
  const oldMap = new Map(before.files.map((file) => [stableEntry(file), file]));
  const newMap = new Map(after.files.map((file) => [stableEntry(file), file]));
  const keys = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
  const counts = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  const changes = [];
  for (const key of keys) {
    const old = oldMap.get(key);
    const current = newMap.get(key);
    let kind;
    let evidence;
    if (!old) kind = 'added';
    else if (!current) kind = 'removed';
    else if (old.sha256 && current.sha256) {
      kind = old.sha256 === current.sha256 ? 'unchanged' : 'modified';
      evidence = 'SHA-256';
    } else {
      kind = old.size === current.size && old.mtimeMs === current.mtimeMs ? 'unchanged' : 'modified';
      evidence = 'size/mtime only';
    }
    counts[kind]++;
    if (kind !== 'unchanged') {
      changes.push({
        kind,
        scope: (current ?? old).scope,
        path: (current ?? old).relative,
        evidence,
        beforeSize: old?.size ?? null,
        afterSize: current?.size ?? null,
        beforeSha256: old?.sha256 ?? null,
        afterSha256: current?.sha256 ?? null,
      });
    }
  }
  return {
    schema: SCHEMA,
    comparedUtc: new Date().toISOString(),
    hostname: before.hostname,
    beforeUtc: before.createdUtc,
    afterUtc: after.createdUtc,
    roots: before.roots,
    counts,
    changes,
  };
}

export function markdownReport(report) {
  const lines = [
    '# RIFT patch-change report',
    '',
    'Machine: ' + report.hostname,
    '',
    'Before: ' + report.beforeUtc,
    '',
    'After: ' + report.afterUtc,
    '',
    '| Added | Removed | Modified | Unchanged |',
    '| ---: | ---: | ---: | ---: |',
    '| ' +
      report.counts.added +
      ' | ' +
      report.counts.removed +
      ' | ' +
      report.counts.modified +
      ' | ' +
      report.counts.unchanged +
      ' |',
    '',
    'Metadata-only comparisons (size/mtime) do not prove content changes.',
    'No gameplay, process memory or addon contents were modified.',
    '',
    '| Change | Scope | File | Evidence |',
    '| --- | --- | --- | --- |',
  ];
  for (const change of report.changes.slice(0, 300)) {
    const escapeCell = (value) =>
      String(value ?? '')
        .replaceAll('|', '\\|')
        .replaceAll('\n', ' ');
    lines.push(
      '| ' +
        [change.kind, change.scope, change.path, change.evidence ?? '-'].map(escapeCell).join(' | ') +
        ' |',
    );
  }
  if (report.changes.length > 300) lines.push('', 'Report shows first 300 changes; full list is in JSON.');
  return lines.join('\n') + '\n';
}

async function saveUnique(directory, prefix, ext, content) {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, prefix + '-' + stamp() + '.' + ext);
  await writeFile(filename, content, { flag: 'wx' });
  return filename;
}

function parseArgs(args) {
  const [command, ...rest] = args;
  if (!['before', 'after', 'compare'].includes(command)) fail('Choose before, after or compare');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (
      !['--game-dir', '--addons-dir', '--no-addons', '--before', '--after'].includes(key) ||
      Object.hasOwn(options, key)
    )
      fail('Unknown or duplicate option: ' + key);
    if (key === '--no-addons') {
      options[key] = true;
      i--;
      continue;
    }
    if (!rest[i + 1] || rest[i + 1].startsWith('--')) fail('Missing value for ' + key);
    options[key] = rest[i + 1];
  }
  return { command, options };
}

async function rootsFromOptions(options) {
  const fallbackGame = path.join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Glyph',
    'Games',
    'RIFT',
    'Live',
  );
  const gameRoot = options['--game-dir'] ?? fallbackGame;
  const roots = [{ scope: 'game', path: gameRoot }];
  if (!options['--no-addons']) {
    const base = process.env.OneDrive ?? path.join(os.homedir(), 'OneDrive');
    const addonsRoot = options['--addons-dir'] ?? path.join(base, 'Documents', 'RIFT', 'Interface', 'AddOns');
    roots.push({ scope: 'addons', path: addonsRoot });
  }
  return roots;
}

async function latestMatchingBefore(directory, after) {
  const names = (await readdir(directory))
    .filter((name) => /^before-\d{4}-.*\.json$/.test(name))
    .sort()
    .reverse();
  for (const name of names) {
    try {
      const item = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
      if (
        item.schema === SCHEMA &&
        item.complete === true &&
        item.hostname === after.hostname &&
        JSON.stringify(item.roots) === JSON.stringify(after.roots)
      ) {
        return { filename: path.join(directory, name), snapshot: item };
      }
    } catch {
      // A malformed/partial older artifact is never selected.
    }
  }
  return null;
}

export async function runCli(argv, directory = DATA_DIR) {
  const { command, options } = parseArgs(argv);
  if (command === 'compare') {
    if (!options['--before'] || !options['--after']) fail('compare requires --before and --after');
    const before = JSON.parse(await readFile(options['--before'], 'utf8'));
    const after = JSON.parse(await readFile(options['--after'], 'utf8'));
    const report = compareSnapshots(before, after);
    const json = await saveUnique(directory, 'comparison', 'json', JSON.stringify(report, null, 2) + '\n');
    const markdown = await saveUnique(directory, 'comparison', 'md', markdownReport(report));
    return { status: 'compared', json, markdown, counts: report.counts };
  }
  if (options['--before'] || options['--after']) fail('Before/after paths are for compare only');
  const snapshot = await captureSnapshot(command, await rootsFromOptions(options));
  const filename = await saveUnique(directory, command, 'json', JSON.stringify(snapshot, null, 2) + '\n');
  const result = {
    status: snapshot.complete ? 'captured' : 'incomplete',
    phase: command,
    filename,
    files: snapshot.files.length,
    hashedFiles: snapshot.hashedFiles,
    skippedLinks: snapshot.skippedLinks,
    skippedDirectories: snapshot.skippedDirectories,
    skippedNonCode: snapshot.skippedNonCode,
    scannedEntries: snapshot.scannedEntries,
    errors: snapshot.errors.slice(0, 12),
  };
  if (command === 'after' && snapshot.complete) {
    const previous = await latestMatchingBefore(directory, snapshot);
    if (previous) {
      const report = compareSnapshots(previous.snapshot, snapshot);
      result.baseline = previous.filename;
      result.comparison = await saveUnique(
        directory,
        'comparison',
        'json',
        JSON.stringify(report, null, 2) + '\n',
      );
      result.markdown = await saveUnique(directory, 'comparison', 'md', markdownReport(report));
      result.counts = report.counts;
    } else {
      result.note = 'No complete matching before snapshot; no comparison generated';
    }
  }
  return result;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  runCli(process.argv.slice(2)).then(
    (result) => {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (result.status === 'incomplete') process.exitCode = 2;
    },
    (error) => {
      process.stderr.write('RIFT_UPDATE_HELPER_ERROR: ' + error.message + '\n');
      process.exitCode = 1;
    },
  );
}
