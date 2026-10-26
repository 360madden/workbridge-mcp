import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCommandPolicy } from '../src/command-policy.ts';

function policy(overrides = {}) {
  return {
    version: 1,
    permissions: ['read', 'write', 'execute', 'delete', 'network', 'admin'],
    maxRisk: 'medium',
    tools: [{ tool: 'fixture_tool', permissions: ['read', 'write', 'execute'], risk: 'low' }],
    paths: [
      { path: 'C:\\work\\fixture', match: 'subtree', caseSensitive: false, permissions: ['read', 'write'] },
    ],
    resources: [{ resource: 'project:fixture', permissions: ['read'] }],
    ...overrides,
  };
}
function request(overrides = {}) {
  return {
    tool: 'fixture_tool',
    permissions: ['read'],
    paths: [{ path: 'C:\\work\\fixture\\file.txt', permissions: ['read'] }],
    resources: [{ resource: 'project:fixture', permissions: ['read'] }],
    ...overrides,
  };
}
function denied(p, r, reasonCode, risk) {
  const result = evaluateCommandPolicy(p, r);
  assert.equal(result.allowed, false);
  assert.equal(result.previewOnly, true);
  assert.equal(result.reasonCode, reasonCode);
  if (risk) assert.equal(result.risk, risk);
}
function pathRequest(path, permissions = ['read']) {
  return request({ paths: [{ path, permissions }], resources: [], permissions });
}

test('complete scoped read returns a frozen preview with no input or resource content', () => {
  assert.deepEqual(evaluateCommandPolicy(policy(), request()), {
    allowed: true,
    previewOnly: true,
    risk: 'low',
    reasonCode: 'ALLOWED',
  });
  const result = evaluateCommandPolicy(policy(), request());
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(Object.keys(result).sort(), ['allowed', 'previewOnly', 'reasonCode', 'risk']);
});

test('every tool, global permission and tool permission must be explicitly granted', () => {
  denied(policy({ tools: [] }), request(), 'TOOL_NOT_ALLOWED', 'unknown');
  for (const tool of ['Fixture_tool', 'fixture_tool_other', 'terminal_run'])
    denied(policy(), request({ tool }), 'TOOL_NOT_ALLOWED');
  for (const permissions of [[], ['write']])
    denied(policy({ permissions }), request(), 'PERMISSION_NOT_ALLOWED', 'low');
  denied(
    policy({ tools: [{ tool: 'fixture_tool', permissions: ['write'], risk: 'low' }] }),
    request(),
    'TOOL_PERMISSION_NOT_ALLOWED',
  );
  denied(policy(), request({ permissions: ['read', 'admin'] }), 'TOOL_PERMISSION_NOT_ALLOWED', 'high');
});

test('permission classification raises risk and a tool floor cannot lower it', () => {
  for (const [permission, risk] of [
    ['read', 'low'],
    ['write', 'medium'],
    ['execute', 'medium'],
    ['delete', 'high'],
    ['network', 'high'],
    ['admin', 'high'],
  ]) {
    const p = policy({
      tools: [{ tool: 'fixture_tool', permissions: [permission], risk: 'low' }],
      maxRisk: 'high',
    });
    const r = request({ permissions: [permission], paths: [], resources: [] });
    assert.deepEqual(evaluateCommandPolicy(p, r), {
      allowed: true,
      previewOnly: true,
      risk,
      reasonCode: 'ALLOWED',
    });
    if (risk !== 'low') denied({ ...p, maxRisk: 'low' }, r, 'RISK_LIMIT_EXCEEDED', risk);
  }
  for (const risk of ['medium', 'high', 'unknown']) {
    const p = policy({ tools: [{ tool: 'fixture_tool', permissions: ['read'], risk }] });
    if (risk === 'medium') assert.equal(evaluateCommandPolicy(p, request()).risk, risk);
    else denied(p, request(), risk === 'unknown' ? 'UNKNOWN_RISK' : 'RISK_LIMIT_EXCEEDED', risk);
  }
  denied(
    policy({ maxRisk: 'high', tools: [{ tool: 'fixture_tool', permissions: ['read'], risk: 'unknown' }] }),
    request(),
    'UNKNOWN_RISK',
    'unknown',
  );
});

test('all declared paths must match complete grants; no prefix sibling or traversal escape', () => {
  for (const target of [
    'C:\\work\\fixture-other\\file.txt',
    'C:\\work\\fixture\\..\\other\\file.txt',
    'C:\\work\\fixture\\child\\..\\..\\secret.txt',
    'D:\\work\\fixture\\file.txt',
    '/work/fixture/file.txt',
  ])
    denied(policy(), pathRequest(target), 'PATH_NOT_ALLOWED');
  denied(policy({ paths: [] }), request(), 'PATH_NOT_ALLOWED');
  denied(
    policy(),
    request({ paths: [...request().paths, { path: 'C:\\private.txt', permissions: ['read'] }] }),
    'PATH_NOT_ALLOWED',
  );
  for (const target of ['C:\\work\\fixture', 'c:/WORK/fixture/sub/../file.txt', 'C:\\work\\fixture\\child\\'])
    assert.equal(evaluateCommandPolicy(policy(), pathRequest(target)).allowed, true);
});

test('exact paths never grant children and a root subtree respects drive/share boundaries', () => {
  const p = policy({
    paths: [{ path: 'C:\\work\\fixture\\file.txt', match: 'exact', permissions: ['read'] }],
  });
  assert.equal(evaluateCommandPolicy(p, pathRequest('C:/work/fixture/file.txt')).allowed, true);
  denied(p, pathRequest('C:\\work\\fixture\\file.txt\\child'), 'PATH_NOT_ALLOWED');
  for (const root of ['C:\\', '\\\\server\\share\\', '/']) {
    const q = policy({ paths: [{ path: root, match: 'subtree', permissions: ['read'] }] });
    assert.equal(evaluateCommandPolicy(q, pathRequest(root + 'child')).allowed, true);
  }
  const unc = policy({
    paths: [{ path: '\\\\server\\share', match: 'subtree', caseSensitive: false, permissions: ['read'] }],
  });
  assert.equal(evaluateCommandPolicy(unc, pathRequest('//SERVER/share/dir/../file')).allowed, true);
  for (const target of ['\\\\server\\share-other\\file', '\\\\other\\share\\file'])
    denied(unc, pathRequest(target), 'PATH_NOT_ALLOWED');
  // Do not accept traversal that path.win32.normalize() would clip at a UNC or drive root.
  for (const target of ['\\\\server\\share\\..\\..\\file', 'C:\\..\\private.txt'])
    denied(unc, pathRequest(target), 'INVALID_REQUEST');
});

test('Windows is case-sensitive by default; case folding is explicit and POSIX remains sensitive', () => {
  for (const caseSensitive of [undefined, true, false]) {
    const grant = { path: 'C:\\work\\Fixture', match: 'subtree', permissions: ['read'] };
    if (caseSensitive !== undefined) grant.caseSensitive = caseSensitive;
    const p = policy({ paths: [grant] });
    assert.equal(evaluateCommandPolicy(p, pathRequest('C:/work/Fixture/file')).allowed, true);
    assert.equal(
      evaluateCommandPolicy(p, pathRequest('c:/WORK/fixture/file')).allowed,
      caseSensitive === false,
    );
  }
  const p = policy({ paths: [{ path: '/work/Fixture', match: 'subtree', permissions: ['read'] }] });
  assert.equal(evaluateCommandPolicy(p, pathRequest('/work/Fixture/sub/../file')).allowed, true);
  for (const target of ['/work/fixture/file', '/work/Fixture2/file', '/work/Fixture/../../private'])
    denied(p, pathRequest(target), 'PATH_NOT_ALLOWED');
  denied(policy({ paths: [{ ...p.paths[0], caseSensitive: false }] }), request(), 'INVALID_POLICY');
});

test('path grants do not combine permissions or shadow a broader allow grant', () => {
  const r = pathRequest('C:\\work\\fixture\\file.txt', ['read', 'write']);
  const grant = { path: 'C:\\work\\fixture', match: 'subtree', permissions: ['read'] };
  denied(
    policy({ paths: [grant, { ...grant, permissions: ['write'] }] }),
    r,
    'PATH_PERMISSION_NOT_ALLOWED',
    'medium',
  );
  const p = policy({
    paths: [
      { ...grant, permissions: ['read', 'write'] },
      { ...grant, path: r.paths[0].path, match: 'exact' },
    ],
  });
  assert.equal(evaluateCommandPolicy(p, r).allowed, true);
  denied(policy(), pathRequest(r.paths[0].path, ['execute']), 'PATH_PERMISSION_NOT_ALLOWED', 'medium');
});

test('resources use exact case-sensitive opaque IDs and independent permissions', () => {
  for (const resource of [
    'project:Fixture',
    'project:fixture/child',
    'project:fixture-other',
    'project:%66ixture',
  ])
    denied(policy(), request({ resources: [{ resource, permissions: ['read'] }] }), 'RESOURCE_NOT_ALLOWED');
  denied(policy({ resources: [] }), request(), 'RESOURCE_NOT_ALLOWED');
  denied(
    policy(),
    request({
      permissions: ['read', 'write'],
      resources: [{ resource: 'project:fixture', permissions: ['write'] }],
    }),
    'RESOURCE_PERMISSION_NOT_ALLOWED',
  );
  denied(
    policy(),
    request({ resources: [...request().resources, { resource: 'project:other', permissions: ['read'] }] }),
    'RESOURCE_NOT_ALLOWED',
  );
  const p = policy({ resources: [{ resource: 'https://fixture.invalid/a', permissions: ['read'] }] });
  denied(
    p,
    request({ resources: [{ resource: 'https://FIXTURE.invalid/a', permissions: ['read'] }] }),
    'RESOURCE_NOT_ALLOWED',
  );
});

test('undeclared target permissions cannot be hidden behind a read-only operation', () => {
  denied(
    policy(),
    request({ paths: [{ path: request().paths[0].path, permissions: ['write'] }] }),
    'INVALID_REQUEST',
  );
  denied(
    policy(),
    request({ resources: [{ resource: 'project:fixture', permissions: ['network'] }] }),
    'INVALID_REQUEST',
  );
  denied(policy(), pathRequest('C:\\work\\fixture', ['network']), 'INVALID_REQUEST');
  const r = request({ paths: [], resources: [] });
  assert.equal(evaluateCommandPolicy(policy({ paths: [], resources: [] }), r).allowed, true);
});

test('ambiguous, relative, device, stream, reserved and wildcard paths fail closed in both inputs', () => {
  for (const target of [
    '',
    'relative/file',
    'C:relative',
    '\\work\\fixture',
    '\\\\?\\C:\\work\\fixture',
    '//./C:/work/fixture',
    '\\\\server',
    '\\\\server\\',
    '\\\\\\server\\share',
    'C:\\work\\fixture\\file:secret',
    'C:\\work\\fixture\\trailing.',
    'C:\\work\\fixture\\trailing \\file',
    'C:\\work\\fixture\\NUL.txt',
    'C:\\work\\fixture\\com1',
    'C:\\work\\fixture\\LPT\u00b2.log',
    'C:\\work\\fixture\\file*',
    'C:\\work\\fixture\\file?',
    '/work/fixture\\file',
    '/work/fixture/*',
    ' C:\\work\\fixture',
    'C:\\work\\fixture\nPRIVATE',
    'x'.repeat(4097),
  ]) {
    denied(policy(), pathRequest(target), 'INVALID_REQUEST');
    denied(
      policy({ paths: [{ path: target, match: 'subtree', permissions: ['read'] }] }),
      request(),
      'INVALID_POLICY',
    );
  }
});

test('invalid policy versions, unknown keys, missing fields, duplicate IDs and oversized scopes deny', () => {
  const p = policy();
  for (const invalid of [
    undefined,
    null,
    [],
    {},
    { ...p, version: 2 },
    { ...p, maxRisk: 'unknown' },
    { ...p, maxRisk: '__proto__' },
    { ...p, extra: true },
    { ...p, permissions: ['read', 'read'] },
    { ...p, permissions: ['*'] },
    { ...p, tools: Array(1) },
    { ...p, tools: Array(65).fill(p.tools[0]) },
    { ...p, tools: [p.tools[0], p.tools[0]] },
    { ...p, tools: [{ ...p.tools[0], tool: '*' }] },
    { ...p, tools: [{ ...p.tools[0], permissions: [] }] },
    { ...p, tools: [{ ...p.tools[0], risk: 'safe' }] },
    { ...p, paths: Array(129).fill(p.paths[0]) },
    { ...p, paths: [{ ...p.paths[0], caseSensitive: undefined }] },
    { ...p, paths: [{ ...p.paths[0], match: '*' }] },
    { ...p, paths: [{ ...p.paths[0], permissions: ['admin'] }] },
    { ...p, resources: Array(129).fill(p.resources[0]) },
    { ...p, resources: [p.resources[0], p.resources[0]] },
    { ...p, resources: [{ resource: ' private ', permissions: ['read'] }] },
    { ...p, tools: [{ ...p.tools[0], allowEverything: true }] },
    Object.create(p),
  ])
    denied(invalid, request(), 'INVALID_POLICY', 'unknown');
  for (const key of Object.keys(p)) {
    const missing = { ...p };
    delete missing[key];
    denied(missing, request(), 'INVALID_POLICY');
  }
});

test('invalid and oversized requests cannot self-authorize, supply risk, or omit scope', () => {
  const r = request();
  for (const invalid of [
    null,
    undefined,
    [],
    {},
    { ...r, permissions: [] },
    { ...r, permissions: ['read', 'read'] },
    { ...r, permissions: ['toString'] },
    { ...r, tool: '' },
    { ...r, tool: 'x'.repeat(129) },
    { ...r, paths: Array(1) },
    { ...r, paths: Array(65).fill(r.paths[0]) },
    { ...r, resources: Array(65).fill(r.resources[0]) },
    { ...r, resources: [{ resource: 'x'.repeat(513), permissions: ['read'] }] },
    { ...r, risk: 'low' },
    { ...r, hostApproval: true },
    { ...r, explicitUserAuthorization: true },
    { ...r, paths: [{ ...r.paths[0], match: 'subtree' }] },
    Object.create(r),
  ])
    denied(policy(), invalid, 'INVALID_REQUEST', 'unknown');
  for (const key of Object.keys(r)) {
    const missing = { ...r };
    delete missing[key];
    denied(policy(), missing, 'INVALID_REQUEST');
  }
});

test('malformed in-process objects fail closed without invoking getters or leaking error content', () => {
  const p = policy();
  const getter = { ...p };
  let reads = 0;
  Object.defineProperty(getter, 'tools', {
    enumerable: true,
    get() {
      reads++;
      throw new Error('PRIVATE_SECRET');
    },
  });
  denied(getter, request(), 'INVALID_POLICY');
  assert.equal(reads, 0);
  const throwing = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('PRIVATE_SECRET');
      },
    },
  );
  const result = evaluateCommandPolicy(throwing, request());
  assert.equal(result.allowed, false);
  assert.equal(result.risk, 'unknown');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_SECRET'));
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(evaluateCommandPolicy(p, revoked.proxy).allowed, false);
});

test('evaluation is deterministic and does not mutate frozen inputs or expose execution adapters', async () => {
  const freeze = (value) => {
    for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
    return Object.freeze(value);
  };
  const p = freeze(policy());
  const r = freeze(request());
  const before = JSON.stringify([p, r]);
  const first = evaluateCommandPolicy(p, r);
  assert.deepEqual(evaluateCommandPolicy(p, r), first);
  assert.equal(JSON.stringify([p, r]), before);
  assert.deepEqual(Object.keys(await import('../src/command-policy.ts')), ['evaluateCommandPolicy']);
});
