import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Metadata only: no direct file-content reads, staging commands, service imports or writes.
// Git itself computes line counts; the planner receives no diff hunks or file contents.
// node scripts/plan-scoped-git-checkpoints.mjs [--repo PATH]
//   [--milestone-path ID=repo/relative/path] (repeatable, exact path matching)
// Exit 0: review plan, 1: incomplete/failed inventory, 2: invalid CLI arguments.
export const plannerLimits = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxEntries: 20_000,
  maxPathBytes: 4096,
  timeoutMs: 10_000,
});

// Explicit historical associations from interactive-desktop-vm-roadmap.md.
// These identify review overlap, never proof of ownership, safety or current deployment.
export const previousMilestones = Object.freeze(
  [
    ['GUI-001', 'scripts/Inspect-DesktopVm.ps1'],
    ['GUI-001', 'test/desktop-vm-inventory.test.mjs'],
    ['GUI-002', 'scripts/desktop-ui.mjs'],
    ['GUI-002', 'test/desktop-ui.test.mjs'],
    ['GUI-003', 'scripts/desktop-capture.mjs'],
    ['GUI-003', 'test/desktop-capture.test.mjs'],
    ['GUI-004', 'scripts/desktop-probe-act.mjs'],
    ['GUI-004', 'scripts/Check-DesktopWindowHandle.ps1'],
    ['GUI-005', 'scripts/vmware-host-capture.mjs'],
    ['GUI-005', 'test/vmware-host-capture.test.mjs'],
    ['GUI-006', 'docs/gui006-desktop-vmware-2026-10-26.md'],
    ['GUI-001..006', 'docs/interactive-desktop-vm-roadmap.md'],
  ].map((entry) => Object.freeze(entry)),
);

const failure = (code) => Object.assign(new Error(code), { code });
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const protectedPath = (p) =>
  p.split('/').some((s) => ['.local', '.tools', '.git', 'node_modules'].includes(s.toLowerCase()));
const suspiciousPath = (p) =>
  /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\\]/u.test(p) ||
  p.normalize('NFC') !== p ||
  p.split('/').some((s) => s.startsWith('-'));

function validPath(p) {
  if (
    typeof p !== 'string' ||
    !p ||
    Buffer.byteLength(p) > plannerLimits.maxPathBytes ||
    p.includes('\0') ||
    p.startsWith('/') ||
    /^[A-Za-z]:/.test(p) ||
    p.split('/').some((s) => !s || s === '.' || s === '..')
  )
    throw failure('INVALID_GIT_PATH');
  return p;
}

function fields(bytes) {
  if (!(typeof bytes === 'string' || Buffer.isBuffer(bytes))) throw failure('INVALID_GIT_OUTPUT');
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length > plannerLimits.maxBytes) throw failure('GIT_OUTPUT_LIMIT');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw failure('INVALID_UTF8');
  }
  if (!text) return [];
  if (!text.endsWith('\0')) throw failure('INCOMPLETE_GIT_OUTPUT');
  return text.slice(0, -1).split('\0');
}

export function parseStatus(bytes) {
  const tokens = fields(bytes),
    entries = [],
    seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const record = tokens[i],
      status = record.slice(0, 2);
    if (
      record[2] !== ' ' ||
      !/^[ MADRCUT?!]{2}$/.test(status) ||
      status === '  ' ||
      status === '!!' ||
      (status.includes('?') && status !== '??')
    )
      throw failure('INVALID_STATUS');
    const entry = { status, path: validPath(record.slice(3)) };
    if (/[RC]/.test(status)) entry.originalPath = validPath(tokens[++i]);
    if (seen.has(entry.path)) throw failure('DUPLICATE_STATUS_PATH');
    seen.add(entry.path);
    entries.push(entry);
    if (entries.length > plannerLimits.maxEntries) throw failure('GIT_ENTRY_LIMIT');
  }
  return entries;
}

export function parseNumstat(bytes) {
  const tokens = fields(bytes),
    entries = [],
    seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(tokens[i]);
    if (!match || (match[1] === '-') !== (match[2] === '-')) throw failure('INVALID_NUMSTAT');
    const binary = match[1] === '-';
    const entry = {
      added: binary ? null : Number(match[1]),
      deleted: binary ? null : Number(match[2]),
      binary,
    };
    if (!binary && (!Number.isSafeInteger(entry.added) || !Number.isSafeInteger(entry.deleted)))
      throw failure('INVALID_NUMSTAT');
    if (match[3]) entry.path = validPath(match[3]);
    else {
      entry.originalPath = validPath(tokens[++i]);
      entry.path = validPath(tokens[++i]);
    }
    if (seen.has(entry.path)) throw failure('DUPLICATE_NUMSTAT_PATH');
    seen.add(entry.path);
    entries.push(entry);
    if (entries.length > plannerLimits.maxEntries) throw failure('GIT_ENTRY_LIMIT');
  }
  return entries;
}

function association(p) {
  let match = /^(src|scripts)\/(.+)\.(?:[cm]?[jt]sx?|ps1|cs)$/.exec(p);
  if (match) return { area: match[1] === 'src' ? 'source' : 'script', key: match[2] };
  match = /^test\/(.+)\.test\.(?:[cm]?[jt]sx?|ps1)$/.exec(p);
  if (match) return { area: 'test', key: match[1] };
  match = /^docs\/(.+)\.md$/.exec(p);
  if (match) return { area: 'documentation', key: match[1] };
  return null;
}

const sharedPaths = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  '.gitattributes',
  '.gitignore',
  'src/server.ts',
  'src/core.ts',
  'src/schemas.ts',
  'src/workspace.ts',
  'docs/roadmap.md',
  'docs/interactive-desktop-vm-roadmap.md',
  'docs/updates.md',
  'docs/validation.md',
  'README.md',
  'AGENTS.md',
]);

export function buildCheckpointPlan({
  status,
  unstaged = '',
  staged = '',
  knownMilestones = previousMilestones,
}) {
  const raw = parseStatus(status),
    workStats = parseNumstat(unstaged),
    indexStats = parseNumstat(staged);
  const indexStatsByPath = (stats) => {
    const result = new Map();
    for (const stat of stats) {
      const list = result.get(stat.path) ?? [];
      list.push(stat);
      result.set(stat.path, list);
    }
    return result;
  };
  const workByPath = indexStatsByPath(workStats),
    indexByPath = indexStatsByPath(indexStats);
  const statsFor = (map, paths) => [...new Set(paths.flatMap((p) => map.get(p) ?? []))];
  if (!Array.isArray(knownMilestones) || knownMilestones.length > plannerLimits.maxEntries)
    throw failure('INVALID_MILESTONES');
  const milestoneMap = new Map();
  for (const pair of knownMilestones) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      !/^[A-Za-z0-9._-]{1,100}$/.test(pair[0])
    )
      throw failure('INVALID_MILESTONES');
    validPath(pair[1]);
    const ids = milestoneMap.get(pair[1]) ?? [];
    if (!ids.includes(pair[0])) ids.push(pair[0]);
    milestoneMap.set(pair[1], ids);
  }
  const warnings = [
    {
      code: 'HUMAN_REVIEW_REQUIRED',
      message:
        'Candidates are filename associations only; code safety, ownership and dependencies remain unverified. No staging or commit commands are generated.',
    },
    {
      code: 'DEPENDENCIES_NOT_ANALYZED',
      message:
        'No contents/imports were read. Cross-cutting files require review before every candidate; other dependencies may be missing.',
    },
    {
      code: 'SNAPSHOT_NOT_ATOMIC',
      message:
        'Matching status snapshots cannot detect edits that keep the same status. Revalidate content and index before any later checkpoint.',
    },
    {
      code: 'SUBMODULE_CONTENTS_NOT_INSPECTED',
      message: 'Git submodule internals are deliberately excluded.',
    },
    {
      code: 'MILESTONE_CATALOG_PARTIAL',
      message:
        'Historical associations are explicit and incomplete; supply additional exact milestone paths when known.',
    },
    {
      code: 'PROTECTED_PATHS_EXCLUDED',
      message:
        'Protected paths receive status metadata only and are excluded from numstat. Ignored files are not inventoried.',
    },
  ];
  const entries = raw.map((entry) => {
    const paths = [entry.path, ...(entry.originalPath ? [entry.originalPath] : [])];
    const priorMilestones = [...new Set(paths.flatMap((p) => milestoneMap.get(p) ?? []))].sort(compare);
    const result = {
      ...entry,
      indexStatus: entry.status[0],
      worktreeStatus: entry.status[1],
      staged: entry.status[0] !== ' ' && entry.status[0] !== '?',
      untracked: entry.status === '??',
      areas: [...new Set(paths.map((p) => association(p)?.area ?? 'other'))],
      priorMilestones,
      // These are metadata only. Untracked files have no line-count evidence.
      unstagedNumstat: statsFor(workByPath, paths),
      stagedNumstat: statsFor(indexByPath, paths),
      reasons: [],
    };
    if (paths.some(protectedPath)) result.reasons.push('protected_path');
    if (paths.some(suspiciousPath)) result.reasons.push('suspicious_path_requires_exact_review');
    if (result.staged) result.reasons.push('existing_index_changes_preserved');
    if (/[RCDUT]/.test(entry.status) || ['AA', 'DD'].includes(entry.status))
      result.reasons.push('rename_copy_delete_type_or_conflict_requires_review');
    if (priorMilestones.length) {
      result.reasons.push('previous_milestone_overlap');
      warnings.push({
        code: 'PREVIOUS_MILESTONE_OVERLAP',
        path: entry.path,
        ...(entry.originalPath ? { originalPath: entry.originalPath } : {}),
        milestones: priorMilestones,
        status: entry.status,
      });
    }
    if (paths.some((p) => sharedPaths.has(p))) result.reasons.push('shared_integration_dependency');
    return result;
  });
  const statusPaths = new Set(raw.flatMap((e) => [e.path, e.originalPath].filter(Boolean)));
  if (
    [...workStats, ...indexStats].some(
      (s) => !statusPaths.has(s.path) || (s.originalPath && !statusPaths.has(s.originalPath)),
    )
  )
    throw failure('NUMSTAT_STATUS_MISMATCH');
  const excludedFiles = [],
    unreviewedFiles = [],
    buckets = new Map();
  for (const entry of entries) {
    if (entry.reasons.includes('protected_path')) {
      excludedFiles.push(entry);
      continue;
    }
    const area = association(entry.path);
    if (entry.reasons.length || !area) {
      if (!area) entry.reasons.push('unmapped_area');
      unreviewedFiles.push(entry);
      continue;
    }
    const bucket = buckets.get(area.key) ?? [];
    bucket.push(entry);
    buckets.set(area.key, bucket);
  }
  const candidateGroups = [];
  for (const [key, files] of [...buckets].sort(([a], [b]) => compare(a, b))) {
    const areas = new Set(files.flatMap((f) => f.areas));
    const paired = areas.has('test') && (areas.has('source') || areas.has('script'));
    if (paired || [...areas].every((area) => area === 'documentation')) {
      candidateGroups.push({
        id: `review-${candidateGroups.length + 1}`,
        topic: key,
        basis: paired ? 'exact_source_script_test_stem' : 'documentation_area',
        requiresHumanReview: true,
        readyToCommit: false,
        areas: [...areas].sort(compare),
        files: files.sort((a, b) => compare(a.path, b.path)),
        dependsOnReviewOf: [],
      });
    } else {
      for (const file of files) {
        file.reasons.push('no_matching_dirty_source_or_test');
        unreviewedFiles.push(file);
      }
    }
  }
  const dependencies = unreviewedFiles
    .filter((f) => f.reasons.includes('shared_integration_dependency'))
    .map((f) => f.path)
    .sort(compare);
  const withheldByTopic = new Map();
  for (const file of [...unreviewedFiles, ...excludedFiles]) {
    for (const p of [file.path, file.originalPath].filter(Boolean)) {
      const topic = association(p)?.key;
      if (!topic) continue;
      const related = withheldByTopic.get(topic) ?? new Set();
      related.add(file.path);
      withheldByTopic.set(topic, related);
    }
  }
  for (const group of candidateGroups)
    group.dependsOnReviewOf = [
      ...new Set([...dependencies, ...(withheldByTopic.get(group.topic) ?? [])]),
    ].sort(compare);
  if (entries.some((e) => e.staged))
    warnings.push({
      code: 'EXISTING_STAGING_PRESERVED',
      message:
        'Staged and partially staged entries are withheld from candidate groups. The planner never refreshes or writes the index.',
    });
  const sortPaths = (files) => files.sort((a, b) => compare(a.path, b.path));
  return {
    schemaVersion: 1,
    mode: 'read-only-checkpoint-plan',
    readOnly: true,
    complete: true,
    indexWrites: false,
    directContentReads: false,
    fileContentReturned: false,
    actionableGroups: 0,
    counts: {
      statusEntries: entries.length,
      uniquePaths: new Set(raw.flatMap((e) => [e.path, e.originalPath].filter(Boolean))).size,
      stagedEntries: entries.filter((e) => e.staged).length,
      untrackedEntries: entries.filter((e) => e.untracked).length,
      candidateGroups: candidateGroups.length,
      candidateEntries: candidateGroups.reduce((n, g) => n + g.files.length, 0),
      unreviewedEntries: unreviewedFiles.length,
      excludedEntries: excludedFiles.length,
    },
    candidateGroups,
    unreviewedFiles: sortPaths(unreviewedFiles),
    excludedFiles: sortPaths(excludedFiles),
    warnings,
  };
}

// Shell-free and bounded; stderr is deliberately not echoed (it may contain secrets).
function runReadOnlyGit(args, { cwd, env, timeout, maxBuffer }) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, env, timeout, maxBuffer, encoding: 'buffer', windowsHide: true, shell: false },
      (error, stdout) => {
        if (error)
          reject(
            failure(
              error.code === 'ENOBUFS' || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                ? 'GIT_OUTPUT_LIMIT'
                : 'GIT_READ_FAILED',
            ),
          );
        else resolve(stdout);
      },
    );
  });
}

export async function planScopedGitCheckpoints({
  repo = process.cwd(),
  knownMilestones = previousMilestones,
  runGit = runReadOnlyGit,
} = {}) {
  if (typeof repo !== 'string' || !repo || repo.includes('\0')) throw failure('INVALID_REPO');
  const options = {
    cwd: path.resolve(repo),
    timeout: plannerLimits.timeoutMs,
    maxBuffer: plannerLimits.maxBytes,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_NO_LAZY_FETCH: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
    },
  };
  // Disable optional external fsmonitor hooks and untracked-cache updates per call.
  // -c overrides are process-local; no Git configuration is written.
  const prefix = [
    '--no-optional-locks',
    '--no-pager',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
  ];
  const statusArgs = [...prefix, 'status', '--porcelain=v1', '-uall', '-z', '--ignore-submodules=all'];
  const diffArgs = [
    ...prefix,
    'diff',
    '--numstat',
    '-z',
    '--no-ext-diff',
    '--no-textconv',
    '--no-relative',
    '--ignore-submodules=all',
  ];
  const status = await runGit(statusArgs, options);
  parseStatus(status); // Fail closed before more processes if the inventory is malformed/oversized.
  const diffPaths = [
    '--',
    ':(top,glob)**',
    ...['.local', '.tools', '.git', 'node_modules'].flatMap((name) => [
      `:(top,glob,icase,exclude)**/${name}`,
      `:(top,glob,icase,exclude)**/${name}/**`,
    ]),
  ];
  const unstaged = await runGit([...diffArgs, ...diffPaths], options);
  parseNumstat(unstaged);
  const staged = await runGit([...diffArgs, '--cached', ...diffPaths], options);
  parseNumstat(staged);
  const after = await runGit(statusArgs, options);
  parseStatus(after);
  if (!Buffer.from(status).equals(Buffer.from(after))) throw failure('STATUS_CHANGED_DURING_PLAN');
  return buildCheckpointPlan({ status, unstaged, staged, knownMilestones });
}

// ASCII JSON prevents terminal control/bidi characters from disguising exact paths.
// JSON.parse restores the original Unicode, whitespace and metacharacters losslessly.
export const serializePlan = (plan) =>
  JSON.stringify(plan, null, 2).replace(
    /[^\x20-\x7e\n\r]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );

export async function main(argv = process.argv.slice(2)) {
  let repo,
    knownMilestones = [...previousMilestones];
  try {
    for (let i = 0; i < argv.length; i++) {
      const flag = argv[i],
        value = argv[++i];
      if (typeof value !== 'string' || !value) throw failure('INVALID_ARGUMENTS');
      if (flag === '--repo' && repo === undefined) repo = value;
      else if (flag === '--milestone-path') {
        const separator = value.indexOf('=');
        if (separator < 1) throw failure('INVALID_ARGUMENTS');
        knownMilestones.push([value.slice(0, separator), value.slice(separator + 1)]);
      } else throw failure('INVALID_ARGUMENTS');
    }
    // Validate caller-supplied associations before running Git.
    buildCheckpointPlan({ status: '', knownMilestones });
  } catch {
    process.stdout.write(
      serializePlan({ readOnly: true, complete: false, error: 'INVALID_ARGUMENTS' }) + '\n',
    );
    return 2;
  }
  try {
    process.stdout.write(serializePlan(await planScopedGitCheckpoints({ repo, knownMilestones })) + '\n');
    return 0;
  } catch (error) {
    const safeCodes = new Set([
      'GIT_OUTPUT_LIMIT',
      'GIT_READ_FAILED',
      'GIT_ENTRY_LIMIT',
      'INVALID_GIT_PATH',
      'INVALID_GIT_OUTPUT',
      'INVALID_UTF8',
      'INCOMPLETE_GIT_OUTPUT',
      'INVALID_STATUS',
      'DUPLICATE_STATUS_PATH',
      'INVALID_NUMSTAT',
      'DUPLICATE_NUMSTAT_PATH',
      'NUMSTAT_STATUS_MISMATCH',
      'STATUS_CHANGED_DURING_PLAN',
      'INVALID_REPO',
    ]);
    process.stdout.write(
      serializePlan({
        readOnly: true,
        complete: false,
        actionableGroups: 0,
        error: safeCodes.has(error.code) ? error.code : 'PLAN_FAILED',
      }) + '\n',
    );
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main();
