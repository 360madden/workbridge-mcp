import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { executeReadOnly } from '../scripts/desktop-ui.mjs';

// Test current source without building or writing to the shared/deployed dist.
const source = new URL('../src/desktop-action-policy.ts', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === source && specifier === './desktop-action-guard.js') {
      return { url: new URL('../src/desktop-action-guard.ts', import.meta.url).href, shortCircuit: true };
    }
    if (context.parentURL === source && specifier === './desktop-session-policy.js') {
      return { url: new URL('../src/desktop-session-policy.ts', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
let planDesktopProbeAction, verifyDesktopProbeActionAuthorization, DesktopActionPolicyError;
try {
  ({ planDesktopProbeAction, verifyDesktopProbeActionAuthorization, DesktopActionPolicyError } = await import(
    source
  ));
} finally {
  hook.deregister();
}

const NOW = Date.parse('2026-10-26T12:00:00.000Z');
const target = {
  pid: 9911,
  hwnd: 224466,
  process: 'DesktopProbe',
  title: 'Workbridge GUI-004 Native Input Probe',
  className: 'WinFormsTest',
  processStartedAt: '2026-10-26T11:59:00.000Z',
  sessionId: 2,
};
const references = {
  ownerId: 'owner_0001',
  contextId: 'context_0001',
  approvalId: 'approval_0001',
  leaseId: 'lease_0001',
};
const request = () => ({
  requestId: 'wb26six_action_001',
  action: 'invoke',
  target: { ...target },
  expectedCount: 0,
});
const clone = (value) => structuredClone(value);

function fixture() {
  const f = { wall: NOW, mono: 1000, commands: [], calls: [], contextCalls: 0 };
  const bounds = { x: 500, y: 300, width: 720, height: 460 };
  f.desktop = {
    session: {
      id: 2,
      ownerSessionId: 2,
      interactive: true,
      connectionState: 'active',
      loggingOff: false,
      locked: false,
      secureDesktop: false,
      windowStation: 'WinSta0',
      inputDesktop: 'Default',
    },
    window: { ...target, bounds, isForeground: true, isVisible: true, isMinimized: false },
    foreground: { pid: target.pid, hwnd: target.hwnd, sessionId: target.sessionId },
    monitors: [{ x: 0, y: 0, width: 1920, height: 1080 }],
  };
  f.button = {
    selector: 'IncrementButton',
    type: 'Button',
    isEnabled: true,
    isOffscreen: false,
    isInvokable: true,
    x: 550,
    y: 500,
    width: 170,
    height: 58,
  };
  f.tree = {
    windows: [
      {
        hwnd: target.hwnd,
        elements: [{ type: 'Window', ...bounds, isOffscreen: false, children: [f.button] }],
      },
    ],
  };
  f.counter = {
    schemaVersion: 1,
    pid: target.pid,
    hwnd: target.hwnd,
    sessionId: 2,
    processStartedAt: target.processStartedAt,
    stage: 'shown',
    counter: 0,
    eventAtMs: NOW - 1000,
    observedAtMs: NOW,
  };
  f.context = {
    contextId: references.contextId,
    ownerId: references.ownerId,
    revision: 7,
    hostSessionId: 2,
    active: true,
    observedAtMs: NOW,
  };
  f.approval = {
    approvalId: references.approvalId,
    contextId: references.contextId,
    ownerId: references.ownerId,
    contextRevision: 7,
    decision: 'approved',
    issuedAtMs: NOW - 1000,
    expiresAtMs: NOW + 10_000,
    observedAtMs: NOW,
  };
  f.lease = {
    leaseId: references.leaseId,
    contextId: references.contextId,
    ownerId: references.ownerId,
    contextRevision: 7,
    resource: 'desktop-input',
    hostSessionId: 2,
    held: true,
    exclusive: true,
    generation: 19,
    issuedAtMs: NOW - 1000,
    expiresAtMs: NOW + 5000,
    observedAtMs: NOW,
  };
  f.runner = async (args) => {
    f.commands.push([...args]);
    if (args[0] === '--version') return '0.7.1';
    if (args[1] === 'list-windows')
      return JSON.stringify([
        {
          hwnd: target.hwnd,
          processId: target.pid,
          processName: target.process,
          title: target.title,
          className: target.className,
          width: bounds.width,
          height: bounds.height,
          isForeground: true,
        },
      ]);
    if (args[1] === 'inspect') return JSON.stringify(f.tree);
    assert.fail('Policy attempted a non-read-only command');
  };
  f.deps = {
    now: () => f.wall,
    nowMonotonicMs: () => f.mono,
    executeReadOnly: (input) => executeReadOnly(input, f.runner),
    observeDesktop: async () => ({
      ...clone(f.desktop),
      observedAtMs: f.wall,
      observedAtMonotonicMs: f.mono,
    }),
    readNativeCounter: async (input) => {
      f.calls.push('counter');
      f.counterRequest = input;
      return clone(f.counter);
    },
    inspectContext: async (query) => {
      f.calls.push('context');
      f.contextCalls++;
      f.query = query;
      return clone(f.context);
    },
    inspectApproval: async (query) => {
      f.calls.push('approval');
      return { requestHash: query.requestHash, ...clone(f.approval) };
    },
    inspectLease: async (query) => {
      f.calls.push('lease');
      return { requestHash: query.requestHash, ...clone(f.lease) };
    },
  };
  f.plan = (input = request()) => planDesktopProbeAction(input, f.deps);
  f.verify = (input = request(), refs = references) =>
    verifyDesktopProbeActionAuthorization(input, refs, f.deps);
  return f;
}
function errorCode(code) {
  return (error) => {
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message + JSON.stringify(error), /private-secret/);
    return true;
  };
}

test('dry run uses existing pinned inspection, exact counter and fixed UIA policy without authority or input', async () => {
  const f = fixture();
  const plan = await f.plan();
  assert.equal(plan.readOnly, true);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.executable, false);
  assert.equal(plan.requiresFreshExecutionValidation, true);
  assert.equal(plan.policy.method, 'uia');
  assert.equal(plan.policy.selector, 'IncrementButton');
  assert.equal(plan.preview.plan.mechanism, 'UIAutomation.InvokePattern');
  assert.match(plan.requestHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.calls, ['counter']);
  assert.deepEqual(
    f.commands.map((args) => args[1] ?? args[0]),
    ['--version', 'list-windows', 'inspect'],
  );
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.preview.plan.control.bounds), true);
  assert.equal(Object.isFrozen(f.counterRequest.target), true);
});

test('only the disposable probe and documented request fields are accepted before observation', async () => {
  const variants = [
    null,
    [],
    {},
    ...['keyboard', 'mouse', 'click', 'focus'].map((action) => ({ ...request(), action })),
    ...['keys', 'selector', 'x', 'y', 'method', 'root', 'vmx', 'runner', 'approved'].map((key) => ({
      ...request(),
      [key]: 'private-secret',
    })),
    ...['DesktopProbe.exe', 'vmware', 'chrome', 'notepad'].map((process) => ({
      ...request(),
      target: { ...target, process },
    })),
    { ...request(), target: { ...target, title: 'Other Window' } },
    { ...request(), target: { ...target, sessionId: 0 } },
    { ...request(), target: { ...target, pid: '9911' } },
    { ...request(), target: { ...target, pid: 0x80000000 } },
    { ...request(), target: { ...target, hwnd: 1.5 } },
    { ...request(), target: { ...target, className: '\nprivate-secret' } },
    { ...request(), target: { ...target, processStartedAt: '2026-02-30T00:00:00.000Z' } },
    { ...request(), target: { ...target, path: 'private-secret' } },
    ...[-1, 100, '0', NaN, 0.1].map((expectedCount) => ({ ...request(), expectedCount })),
    ...['short', '../escape', 'x'.repeat(65)].map((requestId) => ({ ...request(), requestId })),
  ];
  for (const input of variants) {
    const f = fixture();
    await assert.rejects(f.plan(input), errorCode('INVALID_POLICY_REQUEST'));
    assert.equal(f.commands.length, 0);
    assert.deepEqual(f.calls, []);
  }
});

test('independent desktop/session/selector guards reject unsafe or stale targets without reading counter', async () => {
  const variants = [
    [
      (f) => {
        f.desktop.session.locked = true;
      },
      'DESKTOP_OBSERVATION_FAILED',
    ],
    [
      (f) => {
        f.desktop.session.secureDesktop = true;
      },
      'DESKTOP_OBSERVATION_FAILED',
    ],
    [
      (f) => {
        f.desktop.window.processStartedAt = '2026-10-26T11:59:01.000Z';
      },
      'DESKTOP_OBSERVATION_FAILED',
    ],
    [
      (f) => {
        f.desktop.window.isForeground = false;
      },
      'DESKTOP_OBSERVATION_FAILED',
    ],
    [
      (f) => {
        f.desktop.window.isMinimized = true;
      },
      'DESKTOP_OBSERVATION_FAILED',
    ],
    [
      (f) => {
        f.button.isEnabled = false;
      },
      'CONTROL_NOT_READY',
    ],
    [
      (f) => {
        f.button.x = -32000;
      },
      'TARGET_NOT_VISIBLE',
    ],
    [
      (f) => {
        f.tree.windows[0].elements[0].children.push(clone(f.button));
      },
      'SELECTOR_NOT_UNIQUE',
    ],
  ];
  for (const [change, code] of variants) {
    const f = fixture();
    change(f);
    await assert.rejects(f.plan(), errorCode(code));
    assert.deepEqual(f.calls, []);
  }
});

test('session policy requires active owner session, explicit logoff state and independently matching foreground', async () => {
  for (const change of [
    (f) => {
      f.desktop.session.ownerSessionId = 3;
    },
    (f) => {
      f.desktop.session.connectionState = 'disconnected';
    },
    (f) => {
      f.desktop.session.loggingOff = true;
    },
    (f) => {
      delete f.desktop.session.loggingOff;
    },
    (f) => {
      f.desktop.foreground.hwnd++;
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.plan(), errorCode('DESKTOP_OBSERVATION_FAILED'));
    assert.deepEqual(f.calls, []);
    assert.equal(f.commands.length, 0);
  }
});

test('counter requires exact process lifetime, window, session and observed expected state', async () => {
  for (const [change, code] of [
    [{ pid: target.pid + 1 }, 'COUNTER_IDENTITY_MISMATCH'],
    [{ hwnd: target.hwnd + 1 }, 'COUNTER_IDENTITY_MISMATCH'],
    [{ sessionId: 3 }, 'COUNTER_IDENTITY_MISMATCH'],
    [{ processStartedAt: '2026-10-26T11:58:00.000Z' }, 'COUNTER_IDENTITY_MISMATCH'],
    [{ eventAtMs: NOW - 61_000 }, 'COUNTER_IDENTITY_MISMATCH'],
    [{ eventAtMs: NOW + 1 }, 'COUNTER_IDENTITY_MISMATCH'],
    [{ counter: 1 }, 'EXPECTED_STATE_MISMATCH'],
    [{ observedAtMs: NOW - 1 }, 'STALE_POLICY_EVIDENCE'],
    [{ observedAtMs: NOW + 1 }, 'STALE_POLICY_EVIDENCE'],
    [{ stage: 'starting' }, 'INVALID_COUNTER_EVIDENCE'],
    [{ counter: '0' }, 'INVALID_COUNTER_EVIDENCE'],
    [{ privateLog: 'private-secret' }, 'INVALID_COUNTER_EVIDENCE'],
  ]) {
    const f = fixture();
    Object.assign(f.counter, change);
    await assert.rejects(f.plan(), errorCode(code));
  }
  const f = fixture();
  f.counter.counter = 99;
  assert.equal((await f.plan({ ...request(), expectedCount: 99 })).counter.counter, 99);
});

test('request hash binds durable ID, count and full target identity, independent of property order', async () => {
  const f = fixture();
  const first = await f.plan();
  const input = request();
  const reordered = {
    expectedCount: input.expectedCount,
    target: Object.fromEntries(Object.entries(input.target).reverse()),
    action: input.action,
    requestId: input.requestId,
  };
  assert.equal((await f.plan(reordered)).requestHash, first.requestHash);
  assert.notEqual(
    (await f.plan({ ...request(), requestId: 'wb26six_action_002' })).requestHash,
    first.requestHash,
  );
  f.counter.counter = 1;
  assert.notEqual((await f.plan({ ...request(), expectedCount: 1 })).requestHash, first.requestHash);
});

test('caller mutation cannot redirect an outstanding read-only plan', async () => {
  const f = fixture(),
    input = request();
  const observer = f.deps.observeDesktop;
  f.deps.observeDesktop = async (...args) => {
    input.target.pid++;
    input.requestId = 'changed_request';
    return observer(...args);
  };
  const plan = await f.plan(input);
  assert.equal(plan.request.target.pid, target.pid);
  assert.equal(plan.request.requestId, request().requestId);
});

test('verification reads authoritative records, binds hash/revision and remains nonexecuting', async () => {
  const f = fixture();
  const result = await f.verify();
  assert.equal(result.authorizationVerified, true);
  assert.equal(result.executable, false);
  assert.equal(result.executed, false);
  assert.deepEqual(result.authority, {
    ownerId: references.ownerId,
    contextId: references.contextId,
    contextRevision: 7,
    approvalId: references.approvalId,
    leaseId: references.leaseId,
    leaseGeneration: 19,
    expiresAtMs: NOW + 5000,
  });
  assert.deepEqual(f.calls, ['counter', 'context', 'approval', 'lease', 'context']);
  assert.equal(f.query.requestHash, result.requestHash);
  assert.equal(Object.isFrozen(f.query), true);
  assert.equal(Object.isFrozen(result.authority), true);
});

test('authority references accept IDs only and missing providers fail closed', async () => {
  for (const refs of [null, {}, { ...references, approved: true }, { ...references, leaseId: '' }]) {
    const f = fixture();
    await assert.rejects(f.verify(request(), refs), errorCode('INVALID_AUTHORITY_REFERENCES'));
    assert.deepEqual(f.calls, []);
  }
  for (const key of ['inspectContext', 'inspectApproval', 'inspectLease']) {
    const f = fixture();
    delete f.deps[key];
    await assert.rejects(f.verify(), errorCode('MISSING_AUTHORITY_OBSERVER'));
    assert.equal(f.commands.length, 0);
  }
});

test('context must be active, fresh, session-bound and unchanged through verification', async () => {
  for (const [change, code] of [
    [{ active: false }, 'CONTEXT_NOT_READY'],
    [{ hostSessionId: 3 }, 'CONTEXT_MISMATCH'],
    [{ ownerId: 'other_owner' }, 'CONTEXT_MISMATCH'],
    [{ contextId: 'other_context' }, 'CONTEXT_MISMATCH'],
    [{ observedAtMs: NOW - 1 }, 'STALE_POLICY_EVIDENCE'],
  ]) {
    const f = fixture();
    Object.assign(f.context, change);
    await assert.rejects(f.verify(), errorCode(code));
    assert.equal(f.calls.includes('approval'), false);
  }
  const f = fixture();
  const readLease = f.deps.inspectLease;
  f.deps.inspectLease = async (query) => {
    f.context.revision++;
    return readLease(query);
  };
  await assert.rejects(f.verify(), errorCode('CONTEXT_MISMATCH'));
});

test('approval and lease reject wrong operation, owner, context, revision, reference and session', async () => {
  for (const record of ['approval', 'lease']) {
    for (const change of [
      { requestHash: '0'.repeat(64) },
      { ownerId: 'other_owner' },
      { contextId: 'other_context' },
      { contextRevision: 8 },
      { [record === 'approval' ? 'approvalId' : 'leaseId']: 'another_reference' },
      ...(record === 'lease' ? [{ hostSessionId: 3 }] : []),
    ]) {
      const f = fixture();
      Object.assign(f[record], change);
      await assert.rejects(f.verify(), errorCode('AUTHORITY_BINDING_MISMATCH'));
    }
  }
});

test('approval must explicitly approve and the lease must be held, exclusive and fenced for desktop input', async () => {
  for (const [record, changes, code] of [
    ['approval', [{ decision: 'denied' }, { decision: 'pending' }], 'APPROVAL_NOT_READY'],
    [
      'lease',
      [{ held: false }, { exclusive: false }, { resource: 'vmware' }, { generation: 0 }],
      'LEASE_NOT_READY',
    ],
  ]) {
    for (const change of changes) {
      const f = fixture();
      Object.assign(f[record], change);
      await assert.rejects(f.verify(), errorCode(code));
    }
  }
});

test('expired, future-issued and unbounded approvals or leases cannot verify', async () => {
  for (const record of ['approval', 'lease']) {
    for (const change of [
      { expiresAtMs: NOW },
      { issuedAtMs: NOW + 1 },
      { expiresAtMs: NOW + 61_000 },
      { expiresAtMs: NOW - 2000 },
    ]) {
      const f = fixture();
      Object.assign(f[record], change);
      await assert.rejects(f.verify(), errorCode('AUTHORITY_EXPIRED'));
    }
  }
});

test('slow authority reads invalidate earlier evidence and recheck expiry at the final observation', async () => {
  const stale = fixture();
  const inspectLease = stale.deps.inspectLease;
  stale.deps.inspectLease = async (query) => {
    stale.wall += 2001;
    stale.mono += 2001;
    stale.lease.observedAtMs = stale.wall;
    stale.context.observedAtMs = stale.wall;
    return inspectLease(query);
  };
  await assert.rejects(stale.verify(), errorCode('STALE_POLICY_EVIDENCE'));
  const expired = fixture();
  expired.approval.expiresAtMs = NOW + 10;
  const context = expired.deps.inspectContext;
  expired.deps.inspectContext = async (query) => {
    if (expired.contextCalls === 1) {
      expired.wall += 10;
      expired.mono += 10;
      expired.context.observedAtMs = expired.wall;
    }
    return context(query);
  };
  await assert.rejects(expired.verify(), errorCode('AUTHORITY_EXPIRED'));
});

test('no cached readiness or authority: identical IDs always reobserve and can be revoked', async () => {
  const f = fixture();
  await f.verify();
  f.lease.held = false;
  await assert.rejects(f.verify(), errorCode('LEASE_NOT_READY'));
  assert.equal(f.calls.filter((entry) => entry === 'counter').length, 2);
  assert.equal(f.commands.filter((args) => args[1] === 'inspect').length, 2);
});

test('observer errors and malformed evidence cannot leak private content or imply dispatch', async () => {
  for (const [provider, code] of [
    ['readNativeCounter', 'INVALID_COUNTER_EVIDENCE'],
    ['inspectContext', 'CONTEXT_NOT_READY'],
    ['inspectApproval', 'APPROVAL_NOT_READY'],
    ['inspectLease', 'LEASE_NOT_READY'],
  ]) {
    for (const malformed of [false, true]) {
      const f = fixture();
      f.deps[provider] = async () => {
        if (malformed) return { privateLog: 'private-secret' };
        throw new Error('private-secret');
      };
      await assert.rejects(f.verify(), (error) => {
        assert.ok(error instanceof DesktopActionPolicyError);
        assert.match(error.message, /no action was dispatched/);
        return errorCode(code)(error);
      });
    }
  }
});

test('missing counter and invalid or regressed clocks fail closed, including monotonic-only expiry', async () => {
  const noCounter = fixture();
  delete noCounter.deps.readNativeCounter;
  await assert.rejects(noCounter.plan(), errorCode('MISSING_COUNTER_OBSERVER'));
  for (const key of ['now', 'nowMonotonicMs']) {
    for (const value of [
      undefined,
      () => NaN,
      () => -1,
      () => {
        throw new Error('private-secret');
      },
    ]) {
      const f = fixture();
      f.deps[key] = value;
      await assert.rejects(f.plan(), errorCode('INVALID_CLOCK'));
    }
  }
  for (const [key, amount, code] of [
    ['wall', -1, 'INVALID_CLOCK'],
    ['mono', -1, 'INVALID_CLOCK'],
    ['mono', 5001, 'PREPARATION_EXPIRED'],
  ]) {
    const f = fixture();
    f.deps.readNativeCounter = async () => {
      f[key] += amount;
      return clone(f.counter);
    };
    await assert.rejects(f.plan(), errorCode(code));
  }
});

test('hung read-only providers are bounded without an action runner or retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let reads = 0;
  f.deps.observeDesktop = async () => {
    reads++;
    return new Promise(() => {});
  };
  const pending = assert.rejects(f.plan(), errorCode('PREPARATION_EXPIRED'));
  await setImmediate();
  t.mock.timers.tick(5000);
  await pending;
  assert.equal(reads, 1);
  assert.deepEqual(f.calls, []);
  assert.equal(f.commands.length, 0);
});
