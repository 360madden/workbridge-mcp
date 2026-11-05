import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, lstat, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorDetails, BridgeError } from './workspace.js';
import { desktopWindows, desktopInspect } from './desktop-windows.js';
import { desktopCaptureWindow } from './desktop-capture-tool.js';
import { desktopCaptureVmware } from './desktop-vmware-tool.js';
import { loadDesktopImage } from './desktop-image.js';

// GUI-006: narrow adapters to existing, independently tested WinApp and VMware scripts.
// This module does not start a new command service, grant UI input, or touch a guest receiver.
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const capture = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const pid = z.number().int().min(1).max(0x7fffffff);
const hwnd = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const requestId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/);
const processName = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/);
const windowTitle = z.string().min(1).max(200);
const className = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const desktopTurnPath = fileURLToPath(
  new URL('../.tools/desktop-evidence/desktop-input-turn.lock', import.meta.url),
);

// Share the existing host-capture GUI turn rather than racing its WinApp focus fallback.
// A foreign or uncertain lock is never unlinked merely because a new call wants a screenshot.
export interface DesktopCaptureTurnOwner {
  requestId: string;
  pid: number;
  hwnd: number;
  process: string;
}

export async function withDesktopCaptureTurn<T>(
  action: () => Promise<T>,
  lockPath: string = desktopTurnPath,
  owner?: DesktopCaptureTurnOwner,
): Promise<T> {
  // The sealed runtime stages this helper beside compiled dist, not from mutable source.
  const helperUrl: string = new URL('./desktop-turn-admission.mjs', import.meta.url).href;
  const { withDesktopAdmission } = (await import(helperUrl)) as {
    withDesktopAdmission: (
      guiLockPath: string,
      owner: { producer: string; requestId: string | null },
      action: () => Promise<T>,
    ) => Promise<T>;
  };
  try {
    return await withDesktopAdmission(
      lockPath,
      { producer: 'desktop-capture-window', requestId: owner?.requestId ?? null },
      () => withDesktopCaptureTurnOwned(action, lockPath, owner),
    );
  } catch (error) {
    if ((error as { name?: unknown })?.name === 'DesktopAdmissionError') {
      throw new BridgeError((error as { code: string }).code, (error as Error).message);
    }
    throw error;
  }
}

async function withDesktopCaptureTurnOwned<T>(
  action: () => Promise<T>,
  lockPath: string = desktopTurnPath,
  owner?: DesktopCaptureTurnOwner,
): Promise<T> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new BridgeError('UI_TURN_BUSY', 'Another desktop operation owns the shared GUI turn.');
    }
    throw error;
  }
  const original = await handle.stat();
  const leaseId = randomUUID();
  // The owner stamp is immutable, bounded, and durable before WinApp may be invoked.
  // Missing owner metadata is explicit for synthetic callers, never inferred from a window.
  const stamp = {
    schemaVersion: 1,
    kind: 'workbridge.gui-turn',
    leaseId,
    producer: 'desktop-capture-window',
    requestId: owner?.requestId ?? null,
    owner: { pid: process.pid, processStartUtc: null, sessionId: null },
    target: {
      kind: 'window',
      pid: owner?.pid ?? null,
      hwnd: owner?.hwnd ?? null,
      process: owner?.process ?? null,
    },
    acquiredUtc: new Date().toISOString(),
  };
  const stampBytes = Buffer.from(JSON.stringify(stamp) + '\n', 'utf8');
  const stampHash = createHash('sha256').update(stampBytes).digest('hex');
  let treeUnsettled = true;
  let stampWritten = false;
  try {
    if (stampBytes.length > 4096) {
      throw new BridgeError('UI_TURN_RECOVERY_REQUIRED', 'Desktop turn owner stamp exceeds 4 KiB.');
    }
    await handle.writeFile(stampBytes);
    await handle.sync();
    stampWritten = true;
    // A quarantine sidecar is an independent veto, even if its original lock is missing.
    // Only the already-owned turn is released; the sidecar needs manual reconciliation.
    const entries = await readdir(path.dirname(lockPath));
    if (entries.some((name) => name.startsWith('desktop-turn-quarantine-') && name.endsWith('.json'))) {
      throw new BridgeError(
        'UI_TURN_RECOVERY_REQUIRED',
        'Desktop quarantine sidecar requires manual reconciliation.',
      );
    }
    const result = await action();
    treeUnsettled = false;
    return result;
  } catch (error) {
    // If the process tree cannot be proved settled, retain the lock and link
    // an immutable quarantine record. Never retry a possibly issued GUI action.
    treeUnsettled = !stampWritten || (error as { code?: unknown })?.code === 'DESKTOP_TREE_UNSETTLED';
    if (treeUnsettled && stampWritten) {
      const quarantinePath = path.join(
        path.dirname(lockPath),
        'desktop-turn-quarantine-' + leaseId + '.json',
      );
      const quarantine = {
        schemaVersion: 1,
        kind: 'workbridge.gui-turn-quarantine',
        leaseId,
        requestId: stamp.requestId,
        ownerStampSha256: stampHash,
        intentSha256: null,
        reasonCode: 'DESKTOP_TREE_UNSETTLED',
        processTreeSettlement: 'unknown',
        automaticRetryAllowed: false,
        createdUtc: new Date().toISOString(),
      };
      let sidecar;
      try {
        sidecar = await open(quarantinePath, 'wx');
        await sidecar.writeFile(JSON.stringify(quarantine) + '\n', 'utf8');
        await sidecar.sync();
      } finally {
        await sidecar?.close();
      }
    }
    throw error;
  } finally {
    await handle.close();
    let current;
    let content;
    try {
      current = await lstat(lockPath);
      content = await readFile(lockPath);
    } catch {
      throw new BridgeError(
        'UI_TURN_RECOVERY_REQUIRED',
        'Desktop turn is missing or unreadable; manual review required.',
      );
    }
    if (
      current.dev !== original.dev ||
      current.ino !== original.ino ||
      current.isSymbolicLink() ||
      createHash('sha256').update(content).digest('hex') !== stampHash
    ) {
      throw new BridgeError(
        'UI_TURN_RECOVERY_REQUIRED',
        'Desktop turn owner changed unexpectedly; manual review required.',
      );
    }
    if (!treeUnsettled) await unlink(lockPath);
  }
}

function failure(error: unknown) {
  const raw = (error as { code?: unknown })?.code;
  const safeCode =
    typeof raw === 'string' &&
    /^(DESKTOP_|STALE_|INVALID_|CAPTURE_|VM_|UI_|REQUEST_ID_|TARGET_)[A-Z0-9_]{0,70}$/.test(raw)
      ? raw
      : undefined;
  const details = safeCode
    ? {
        code: safeCode,
        message:
          'Desktop or VMware request did not complete; inspect current target and saved evidence before retrying.',
      }
    : errorDetails(error);
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: details }) }],
  };
}

async function metadata(run: () => Promise<Record<string, unknown>>) {
  try {
    const result = await run();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    return failure(error);
  }
}

// Pure MCP response composition is separately testable with synthetic verified image bytes.
export async function composeDesktopScreenshot(
  receipt: Record<string, unknown>,
  loader: typeof loadDesktopImage = loadDesktopImage,
) {
  // File, bytes, dimensions and digest are checked independently of the
  // child tool's success flag before any image reaches the MCP client.
  const image = await loader(receipt);
  const result = {
    ...receipt,
    mimeType: image.mimeType,
    imageBytesVerified: image.sizeBytes,
    imageSha256Verified: image.sha256,
    imageDimensionsVerified: { width: image.width, height: image.height },
  };
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(result) },
      { type: 'image' as const, mimeType: image.mimeType, data: image.data },
    ],
    structuredContent: result,
  };
}

async function screenshot(run: () => Promise<Record<string, unknown>>) {
  try {
    return await composeDesktopScreenshot(await run());
  } catch (error) {
    return failure(error);
  }
}

export function registerDesktopTools(server: McpServer) {
  server.registerTool(
    'desktop_windows',
    {
      description:
        'List at most 50 Windows desktop window identities via installed Microsoft WinApp CLI 0.7.1. Read-only metadata; titles may be sensitive. Use fresh PID/HWND before inspection or screenshots. No keyboard, mouse, focus or VM guest input.',
      inputSchema: z.object({ app: z.string().min(1).max(100).optional() }),
      annotations: readOnly,
    },
    async ({ app }) => metadata(() => desktopWindows(app)),
  );

  server.registerTool(
    'desktop_inspect',
    {
      description:
        'Inspect the current Windows UI Automation tree for an exact fresh PID/HWND/process identity, optionally pinning title. Read-only; rejected stale/missing identities do not trigger UI actions. Depth 1-4.',
      inputSchema: z.object({
        pid,
        hwnd,
        process: processName,
        title: windowTitle.optional(),
        depth: z.number().int().min(1).max(4).default(2),
      }),
      annotations: readOnly,
    },
    async ({ pid, hwnd, process, title, depth }) =>
      metadata(() => desktopInspect({ pid, hwnd, process, title, depth })),
  );

  server.registerTool(
    'desktop_capture_window',
    {
      description:
        'Capture one exactly identified, visible Windows window using existing WinApp screenshot adapter. Returns verified PNG image plus SHA-256 metadata. Requires new durable request ID and matching PID/HWND/process. Capture may affect foreground; never use for unattended game actions.',
      inputSchema: z.object({
        pid,
        hwnd,
        process: processName,
        requestId,
        title: windowTitle.optional(),
        className: className.optional(),
      }),
      annotations: capture,
    },
    async ({ pid, hwnd, process, requestId, title, className }) => {
      try {
        // Let an unsettled process-tree error reach the turn owner before MCP sanitization.
        return await withDesktopCaptureTurn(
          async () =>
            composeDesktopScreenshot(
              await desktopCaptureWindow({ pid, hwnd, process, requestId, title, className }),
            ),
          desktopTurnPath,
          { requestId, pid, hwnd, process },
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'desktop_capture_vmware_host',
    {
      description:
        'Capture the exact running RIFT-Lab-1 VMware Workstation HOST window. Reuses vmrun inventory, exact HWND identity, exclusive desktop turn, bounded WinApp screenshot, durable replay and restore/minimize. Returns a verified PNG; this does NOT prove guest receiver readiness or authorize game input.',
      inputSchema: z.object({ pid, hwnd, requestId }),
      annotations: capture,
    },
    async ({ pid, hwnd, requestId }) => screenshot(() => desktopCaptureVmware({ pid, hwnd, requestId })),
  );
}
