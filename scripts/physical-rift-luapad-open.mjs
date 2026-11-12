#!/usr/bin/env node
// A single, explicit physical-RIFT /lp open/reopen attempt.
// This does not close LuaPad, type editor code, reload UI, or restart RIFT.
// Its one-shot intent is separate from the completed /reloadui singleton.
import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, readFile, readdir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { withDesktopAdmission } from './desktop-turn-admission.mjs';
import { runWinapp } from './desktop-ui.mjs';
import {
  inspectPhysicalRift,
  readVerifiedChatEvidence,
  assertPhysicalRiftWindow,
  getWindowsProcessIdentity,
} from './physical-rift-reloadui.mjs';

const ROOT = path.join(fileURLToPath(new URL('..', import.meta.url)), '.tools', 'desktop-evidence');
const SINGLETON = 'physical-rift-luapad-open-singleton.intent.json';
const ACTION = Object.freeze(['Enter', '/lp', 'Enter']);
const CONFIRM = 'one-physical-rift-luapad-open';

export class LuaPadOpenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LuaPadOpenError';
    this.code = code;
  }
}
function refuse(code, message) {
  throw new LuaPadOpenError(code, message);
}
function decimal(value, name) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? '')))
    refuse('INVALID_TARGET', name + ' must be positive decimal');
  const n = Number(value);
  if (!Number.isSafeInteger(n)) refuse('INVALID_TARGET', name + ' out of range');
  return n;
}
function parseJson(s, label) {
  try {
    return JSON.parse(s);
  } catch {
    refuse('INVALID_PROVIDER_JSON', label + ' not valid JSON');
  }
}
function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function ageOk(evidence, now) {
  const age = now() - Date.parse(evidence?.capturedUtc ?? '');
  return Number.isFinite(age) && age >= -1000 && age <= 30000;
}

export function parseRequest(argv) {
  const seen = new Set();
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const name = token.split('=')[0];
    if (seen.has(name)) refuse('INVALID_ARGUMENTS', 'Repeated option');
    seen.add(name);
  }
  let v;
  try {
    ({ values: v } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        pid: { type: 'string' },
        hwnd: { type: 'string' },
        'started-utc': { type: 'string' },
        'request-id': { type: 'string' },
        confirm: { type: 'string' },
        'preflight-only': { type: 'boolean' },
        'execute-once': { type: 'boolean' },
        'screenshot-request-id': { type: 'string' },
        'chat-visual-attestation': { type: 'string' },
        'editor-visual-attestation': { type: 'string' },
      },
    }));
  } catch {
    refuse('INVALID_ARGUMENTS', 'Unknown or invalid options');
  }
  const pid = decimal(v.pid, 'pid'),
    hwnd = decimal(v.hwnd, 'hwnd');
  if (pid > 0x7fffffff) refuse('INVALID_TARGET', 'PID out of range');
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/.test(v['started-utc'] ?? '') ||
    !Number.isFinite(Date.parse(v['started-utc']))
  )
    refuse('INVALID_PROCESS_START', 'Exact UTC process start required');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(v['request-id'] ?? ''))
    refuse('INVALID_REQUEST_ID', 'Bounded request ID required');
  if (v.confirm !== CONFIRM) refuse('CONFIRMATION_REQUIRED', 'Exact LuaPad open confirmation required');
  const executeOnce = v['execute-once'] === true,
    preflightOnly = v['preflight-only'] === true;
  if (Number(executeOnce) + Number(preflightOnly) !== 1) refuse('MODE_REQUIRED', 'Select exactly one mode');
  if (
    executeOnce &&
    (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(v['screenshot-request-id'] ?? '') ||
      v['chat-visual-attestation'] !== 'chat-closed-empty' ||
      v['editor-visual-attestation'] !== 'luapad-closed')
  ) {
    refuse('CHAT_STATE_GATE_REQUIRED', 'Fresh capture and closed-empty chat attestation required');
  }
  if (
    preflightOnly &&
    (v['screenshot-request-id'] || v['chat-visual-attestation'] || v['editor-visual-attestation'])
  ) {
    refuse('INVALID_ARGUMENTS', 'Preflight does not accept capture attestation');
  }
  return Object.freeze({
    pid,
    hwnd,
    startedUtc: v['started-utc'],
    requestId: v['request-id'],
    executeOnce,
    preflightOnly,
    screenshotRequestId: v['screenshot-request-id'] ?? null,
    chatVisualAttestation: v['chat-visual-attestation'] ?? null,
    editorVisualAttestation: v['editor-visual-attestation'] ?? null,
  });
}

async function readBoundedJson(filename) {
  let bytes;
  try {
    bytes = await readFile(filename);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (bytes.length < 1 || bytes.length > 4096) refuse('ACTION_RECOVERY_REQUIRED', 'Journal size invalid');
  return parseJson(bytes.toString('utf8'), 'Journal');
}
async function writeExclusiveJson(filename, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > 4096) refuse('JOURNAL_TOO_LARGE', 'Bounded journal exceeded');
  let handle;
  try {
    handle = await open(filename, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') refuse('ACTION_RECOVERY_REQUIRED', 'One-shot record already exists');
    throw error;
  }
  const original = await handle.stat();
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { filename, original, bytes, digest: sha(bytes) };
}
async function releaseOwned(journal) {
  const before = await lstat(journal.filename);
  const bytes = await readFile(journal.filename);
  const after = await lstat(journal.filename);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.dev !== journal.original.dev ||
    before.ino !== journal.original.ino ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    before.size !== journal.bytes.length ||
    after.size !== before.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    sha(bytes) !== journal.digest
  )
    refuse('UI_TURN_RECOVERY_REQUIRED', 'Desktop lock changed; retained');
  await unlink(journal.filename);
}
async function quarantineVeto(root) {
  const names = await readdir(root);
  if (names.some((n) => n.startsWith('desktop-turn-quarantine-') && n.endsWith('.json'))) {
    refuse('UI_TURN_RECOVERY_REQUIRED', 'Desktop input quarantine remains active');
  }
}
function evidenceMatches(evidence, request, observed, now) {
  return (
    evidence?.confirmed === true &&
    evidence.state === 'chat-closed-empty' &&
    evidence.pid === request.pid &&
    evidence.hwnd === request.hwnd &&
    evidence.startedUtc === request.startedUtc &&
    evidence.sessionId === observed.sessionId &&
    /^[a-f0-9]{64}$/i.test(evidence.imageSha256 ?? '') &&
    ageOk(evidence, now)
  );
}

export async function openLuaPadOnce(
  request,
  {
    root = ROOT,
    runner = runWinapp,
    getProcess = getWindowsProcessIdentity,
    evidence,
    now = () => Date.now(),
    settle = delay,
  } = {},
) {
  if (
    request?.executeOnce !== true ||
    request.chatVisualAttestation !== 'chat-closed-empty' ||
    request.editorVisualAttestation !== 'luapad-closed'
  ) {
    refuse('INVALID_OPERATION', 'Explicit, attested execute-once required');
  }
  if (!evidence) refuse('CHAT_STATE_GATE_REQUIRED', 'Verified capture proof required');
  await mkdir(root, { recursive: true });
  const turnPath = path.join(root, 'desktop-input-turn.lock');
  return await withDesktopAdmission(
    turnPath,
    {
      producer: 'physical-rift-luapad-open',
      requestId: request.requestId,
    },
    async () => {
      await quarantineVeto(root);
      const markerPath = path.join(root, SINGLETON);
      const old = await readBoundedJson(markerPath);
      if (old) {
        const receipt = await readBoundedJson(
          path.join(root, 'physical-rift-luapad-open-' + request.requestId + '.receipt.json'),
        );
        if (
          old.requestId === request.requestId &&
          receipt?.submitted === true &&
          receipt.requestId === request.requestId
        ) {
          return {
            ok: true,
            replayed: true,
            submitted: true,
            verified: false,
            status: 'PREVIOUS_SUBMISSION_DO_NOT_RESEND',
          };
        }
        refuse('ACTION_RECOVERY_REQUIRED', 'LuaPad open one-shot already attempted; no replay or second ID');
      }
      const observed = await inspectPhysicalRift(request, { runner, getProcess, requireForeground: false });
      if (!evidenceMatches(evidence, request, observed, now))
        refuse('CHAT_STATE_UNVERIFIED', 'Initial visual evidence stale or mismatched');
      const leaseId = randomUUID();
      const turn = await writeExclusiveJson(turnPath, {
        schemaVersion: 1,
        kind: 'workbridge.gui-turn',
        leaseId,
        producer: 'physical-rift-luapad-open',
        requestId: request.requestId,
        owner: { pid: process.pid, sessionId: observed.sessionId },
        target: { kind: 'window', pid: request.pid, hwnd: request.hwnd, process: 'rift_x64' },
        acquiredUtc: new Date().toISOString(),
      });
      let intent = null;
      try {
        await quarantineVeto(root);
        const fresh = await inspectPhysicalRift(request, { runner, getProcess, requireForeground: false });
        if (
          fresh.sessionId !== observed.sessionId ||
          fresh.rootSelector !== observed.rootSelector ||
          !/^[A-Za-z0-9_-]{3,96}$/.test(fresh.rootSelector ?? '') ||
          !evidenceMatches(evidence, request, fresh, now)
        ) {
          refuse('STALE_TARGET', 'RIFT root/session or screenshot freshness changed');
        }
        intent = await writeExclusiveJson(markerPath, {
          schemaVersion: 1,
          kind: 'workbridge.physical-rift-luapad-open-intent',
          requestId: request.requestId,
          leaseId,
          action: '/lp',
          sequence: ACTION,
          target: {
            pid: request.pid,
            hwnd: request.hwnd,
            startedUtc: request.startedUtc,
            sessionId: fresh.sessionId,
            rootSelector: fresh.rootSelector,
          },
          startedUtc: new Date().toISOString(),
        });
        let started = null;
        for (let phase = 0; phase < ACTION.length; phase++) {
          if (started !== null && (now() < started || now() - started > 60000)) {
            refuse('INPUT_TURN_EXPIRED', 'Bounded input turn expired');
          }
          const current = await inspectPhysicalRift(request, {
            runner,
            getProcess,
            requireForeground: phase > 0,
          });
          if (current.sessionId !== observed.sessionId || current.rootSelector !== observed.rootSelector) {
            refuse('STALE_TARGET', 'RIFT identity changed before key');
          }
          if (phase === 0) {
            if (!evidenceMatches(evidence, request, current, now)) {
              refuse('CHAT_STATE_UNVERIFIED', 'Capture expired before first key');
            }
            const focus = parseJson(
              await runner(['ui', 'focus', current.rootSelector, '-w', String(request.hwnd), '--json']),
              'RIFT focus',
            );
            if (
              focus?.ok === false ||
              focus?.success === false ||
              focus?.error ||
              (focus?.hwnd !== undefined && Number(focus.hwnd) !== request.hwnd)
            ) {
              refuse('ACTION_RECOVERY_REQUIRED', 'Native focus was not attributable');
            }
          }
          const windows = parseJson(
            await runner(['ui', 'list-windows', '-a', String(request.pid), '--json']),
            'Immediate window list',
          );
          assertPhysicalRiftWindow({ windows: windows.windows ?? windows }, request);
          const before = await getProcess(request.pid);
          if (
            Number(before?.pid) !== request.pid ||
            before.sessionId !== observed.sessionId ||
            Math.abs(Date.parse(before.startedUtc) - Date.parse(request.startedUtc)) > 1
          ) {
            refuse('TARGET_CHANGED_BEFORE_KEY', 'Process start/session changed');
          }
          const literal = phase === 1;
          const keys = literal ? '/lp' : 'enter';
          const args = ['ui', 'send-keys', keys, '-w', String(request.hwnd), '--via', 'send-input'];
          if (literal) args.push('--verbatim');
          args.push('--json');
          if (started === null) started = now();
          const reply = parseJson(await runner(args), 'Native send-input');
          if (
            reply?.via !== 'send-input' ||
            reply.keys !== keys ||
            Number(reply.hwnd) !== request.hwnd ||
            reply.actionCount !== 1 ||
            !Array.isArray(reply.warnings) ||
            reply.warnings.length !== 0 ||
            (reply.target !== undefined &&
              reply.target !== null &&
              !['', 'RIFT', 'Window', current.rootSelector].includes(reply.target))
          ) {
            refuse('ACTION_RECOVERY_REQUIRED', 'Input delivery result is uncertain');
          }
          if (phase === 1) await settle(500);
        }
        await writeExclusiveJson(
          path.join(root, 'physical-rift-luapad-open-' + request.requestId + '.receipt.json'),
          {
            schemaVersion: 1,
            kind: 'workbridge.physical-rift-luapad-open-receipt',
            requestId: request.requestId,
            pid: request.pid,
            hwnd: request.hwnd,
            submitted: true,
            verified: false,
            submittedUtc: new Date().toISOString(),
          },
        );
        await releaseOwned(turn);
        return {
          ok: true,
          replayed: false,
          submitted: true,
          verified: false,
          status: 'SUBMITTED_PENDING_INDEPENDENT_SCREENSHOT',
        };
      } catch (error) {
        if (intent) {
          try {
            await writeExclusiveJson(path.join(root, 'desktop-turn-quarantine-' + leaseId + '.json'), {
              schemaVersion: 1,
              kind: 'workbridge.gui-turn-quarantine',
              leaseId,
              requestId: request.requestId,
              ownerStampSha256: turn.digest,
              intentSha256: intent.digest,
              reasonCode: 'ACTION_RECOVERY_REQUIRED',
              processTreeSettlement: 'unknown',
              automaticRetryAllowed: false,
              createdUtc: new Date().toISOString(),
            });
          } catch {
            refuse('ACTION_RECOVERY_REQUIRED', 'Could not seal quarantine; lock retained');
          }
        } else {
          await releaseOwned(turn);
        }
        throw error;
      }
    },
  );
}

async function main() {
  let liveStarted = false;
  try {
    const request = parseRequest(process.argv.slice(2));
    if (request.preflightOnly) {
      const result = await inspectPhysicalRift(request, { requireForeground: false });
      console.log(JSON.stringify({ ok: true, readOnly: true, target: result, inputSubmitted: false }));
      return;
    }
    const evidence = await readVerifiedChatEvidence(request);
    liveStarted = true;
    console.log(JSON.stringify(await openLuaPadOnce(request, { evidence })));
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        code: error?.code ?? 'LUA_OPEN_FAILED',
        message: error?.message ?? 'Unknown error',
        inputSubmitted: liveStarted ? 'UNKNOWN_REVIEW_JOURNAL' : false,
      }),
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
