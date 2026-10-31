import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCommandSafety } from '../src/command-safety.ts';

const cwd = 'C:\\work\\fixture';
function command(executable, args = [], extra = {}) {
  return { executable, args, cwd, ...extra };
}
function classify(executable, args = [], extra = {}) {
  return classifyCommandSafety(command(executable, args, extra));
}
function caps(executable, args, root = cwd) {
  return { root, buildTestCommands: [{ executable, args }] };
}
function expectReview(executable, args, reasonCode, risk = 'high') {
  assert.deepEqual(classify(executable, args, { explicitUserAuthorization: true, hostApproval: true }), {
    risk,
    requiresReview: true,
    reasonCode,
  });
}

test('default explicit user authorization is required and host approval is independent', () => {
  for (const extra of [
    {},
    { hostApproval: true },
    { explicitUserAuthorization: false, hostApproval: true },
  ]) {
    assert.deepEqual(classify('git', ['status', '--short'], extra), {
      risk: 'low',
      requiresReview: true,
      reasonCode: 'KNOWN_GIT_READ',
    });
  }
  for (const hostApproval of [undefined, false, true]) {
    assert.equal(
      classify('git', ['status'], { explicitUserAuthorization: true, hostApproval }).requiresReview,
      false,
    );
  }
});

test('known Git reads use exact verbs and option grammars', () => {
  for (const args of [
    ['--version'],
    ['status'],
    ['status', '--porcelain=v1', '--branch', '-z'],
    ['rev-parse', 'HEAD'],
    ['rev-parse', '--show-toplevel'],
    ['log', '--oneline', '-n', '5'],
    ['log', '--max-count=10', '--no-decorate'],
    ['diff', '--no-ext-diff', '--no-textconv', '--stat'],
  ])
    assert.equal(classify('git', args).reasonCode, 'KNOWN_GIT_READ');
  for (const args of [
    ['status-evil'],
    ['STATUS'],
    ['status', '--help'],
    ['log', '-p'],
    ['log', '--output=private'],
    ['log', '--format=%(secret)'],
    ['log', '-n', '0'],
    ['log', '-n'],
    ['rev-parse', '--git-path', 'config'],
    ['diff'],
    ['diff', '--no-ext-diff'],
    ['diff', '--no-textconv'],
    ['diff', '--no-ext-diff', '--no-textconv', '--ext-diff'],
    ['show', 'HEAD'],
    ['branch', '-D', 'main'],
  ])
    expectReview('git', args, 'UNKNOWN_COMMAND', 'unknown');
});

test('Windows executable path/casing is normalized without lowercasing case-sensitive arguments', () => {
  for (const executable of [
    'git.exe',
    'GIT.EXE',
    'C:\\Program Files\\Git\\bin\\GIT.EXE',
    'C:/Tools/git.exe',
    '/usr/bin/git',
  ]) {
    assert.equal(classify(executable, ['status']).reasonCode, 'KNOWN_GIT_READ');
  }
  expectReview('git', ['Push'], 'UNKNOWN_COMMAND', 'unknown');
  expectReview('notgit.exe', ['status'], 'UNKNOWN_COMMAND', 'unknown');
  expectReview('git.exe.evil', ['status'], 'UNKNOWN_COMMAND', 'unknown');
});

test('build/test needs a scoped exact literal capability and explicit user authorization', () => {
  for (const [executable, args] of [
    ['npm', ['run', 'build']],
    ['npm.cmd', ['test']],
    ['dotnet', ['test', '--no-restore']],
    ['cargo', ['check', '--offline']],
    ['node', ['--test', 'test/fixture.test.mjs']],
    ['pytest', ['-q']],
    ['python', ['-m', 'pytest', '-q']],
    ['dotnet', ['build', 'Fixture.csproj', '-c', 'Release', '--nologo']],
  ]) {
    assert.deepEqual(classify(executable, args), {
      risk: 'medium',
      requiresReview: true,
      reasonCode: 'BUILD_TEST_CAPABILITY_REQUIRED',
    });
    const projectCaps = caps(executable, args);
    assert.equal(classify(executable, args, { projectCaps, hostApproval: true }).requiresReview, true);
    assert.deepEqual(classify(executable, args, { projectCaps, explicitUserAuthorization: true }), {
      risk: 'medium',
      requiresReview: false,
      reasonCode: 'DEVELOPER_BUILD_TEST',
    });
  }
});

test('capability matching preserves argument case, count, ordering and executable identity', () => {
  const projectCaps = caps('C:\\Tools\\npm.cmd', ['run', 'build']);
  assert.equal(
    classify('c:/TOOLS/NPM.CMD', ['run', 'build'], { projectCaps }).reasonCode,
    'DEVELOPER_BUILD_TEST',
  );
  for (const [executable, args] of [
    ['npm', ['run', 'build']],
    ['C:\\other\\npm.cmd', ['run', 'build']],
    ['C:\\Tools\\npm.cmd', ['run', 'Build']],
    ['C:\\Tools\\npm.cmd', ['run', 'build', '--', '--watch']],
    ['C:\\Tools\\npm.cmd', ['build', 'run']],
  ])
    assert.equal(classify(executable, args, { projectCaps }).requiresReview, true);
});

test('project capability paths reject sibling, traversal, drive and path-style escapes', () => {
  const projectCaps = caps('npm', ['test']);
  for (const other of [
    'C:\\work\\fixture-other',
    'C:\\work\\fixture\\..\\other',
    'D:\\work\\fixture',
    '/work/fixture',
  ]) {
    assert.equal(
      classify('npm', ['test'], { cwd: other, projectCaps }).reasonCode,
      'BUILD_TEST_CAPABILITY_REQUIRED',
    );
  }
  assert.equal(
    classify('npm', ['test'], { cwd: 'c:/WORK/fixture/subdir', projectCaps }).reasonCode,
    'DEVELOPER_BUILD_TEST',
  );
  const unixCaps = caps('npm', ['test'], '/work/fixture');
  assert.equal(
    classify('npm', ['test'], { cwd: '/work/Fixture', projectCaps: unixCaps }).reasonCode,
    'BUILD_TEST_CAPABILITY_REQUIRED',
  );
  assert.equal(
    classify('npm', ['test'], { cwd: '/work/fixture/subdir', projectCaps: unixCaps }).reasonCode,
    'DEVELOPER_BUILD_TEST',
  );
});

test('unknown executables and mutation verbs cannot gain permission from caps', () => {
  for (const [executable, args] of [
    ['custom-build.exe', ['test']],
    ['node', ['private.js']],
    ['python', ['-c', 'print(1)']],
    ['npm', ['run', 'deploy']],
    ['git', ['reset', '--hard']],
    ['git', ['clean', '-fd']],
  ])
    expectReview(executable, args, 'UNKNOWN_COMMAND', 'unknown');
  assert.equal(
    classify('custom', ['build'], { projectCaps: caps('custom', ['build']), explicitUserAuthorization: true })
      .requiresReview,
    true,
  );
});

test('privileged operations, VM power and security tools are always reviewed', () => {
  for (const [executable, args] of [
    ['C:\\Windows\\System32\\SC.EXE', ['stop', 'Workbridge']],
    ['shutdown', ['/r']],
    ['netsh', ['advfirewall', 'set', 'allprofiles', 'state', 'off']],
    ['icacls', ['fixture', '/grant', 'Everyone:F']],
    ['vmrun.exe', ['-T', 'ws', 'stop', 'fixture.vmx']],
    ['vmrun', ['list']],
    ['VBoxManage', ['controlvm', 'fixture', 'poweroff']],
    ['sudo', ['anything']],
    ['docker', ['system', 'prune']],
  ])
    expectReview(executable, args, 'PRIVILEGED_OR_MACHINE_STATE');
});

test('configuration changes and publishing are distinguished from build/test', () => {
  for (const [executable, args] of [
    ['git', ['config', 'core.hooksPath', 'fixture']],
    ['npm', ['config', 'set', 'registry', 'fixture']],
    ['reg.exe', ['add', 'HKCU\\Fixture']],
    ['setx', ['PATH', 'fixture']],
  ])
    expectReview(executable, args, 'CONFIGURATION_EDIT');
  for (const [executable, args] of [
    ['git', ['push', 'origin', 'main']],
    ['npm', ['publish']],
    ['dotnet', ['nuget', 'push', 'fixture.nupkg']],
    ['cargo', ['publish']],
    ['docker', ['push', 'fixture']],
    ['wrangler.cmd', ['deploy']],
    ['vercel', ['deploy']],
    ['gh', ['release', 'create', 'fixture']],
  ])
    expectReview(
      executable,
      args,
      executable.endsWith('.cmd') ? 'SHELL_INTERPRETATION_REQUIRED' : 'NETWORK_PUBLISHING',
    );
});

test('network tools remain review-required even with matching project caps', () => {
  for (const [executable, args] of [
    ['git', ['fetch']],
    ['npm', ['ci']],
    ['npx', ['test']],
    ['curl', ['https://fixture.invalid']],
  ]) {
    expectReview(executable, args, 'NETWORK_ACCESS');
    assert.equal(
      classify(executable, args, { projectCaps: caps(executable, args), explicitUserAuthorization: true })
        .requiresReview,
      true,
    );
  }
});

test('secret options, recognized sensitive files and credential readers never echo input', () => {
  for (const [executable, args] of [
    ['git', ['status', '--token=PRIVATE_SECRET']],
    ['tool', ['--Password', 'PRIVATE_SECRET']],
    ['dotnet', ['test', '/p:Password=PRIVATE_SECRET']],
    ['tool', ['API_KEY=PRIVATE_SECRET']],
    ['cat', ['C:\\private\\.env.production']],
    ['cat', ['--file=C:\\private\\credentials.json']],
    ['git', ['config', '--list']],
    ['git', ['credential', 'fill']],
    ['npm', ['config', 'get', 'registry']],
    ['printenv', []],
    ['cmdkey', ['/list']],
  ]) {
    expectReview(executable, args, 'SECRET_EXPOSURE_RISK');
    const result = classify(executable, args);
    assert.deepEqual(Object.keys(result).sort(), ['reasonCode', 'requiresReview', 'risk']);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_SECRET'));
    assert.ok(Object.isFrozen(result));
  }
});

test('literal shell interpreters and platform escape syntax never inherit benign classifications', () => {
  for (const executable of ['cmd.exe', 'PowerShell.EXE', 'pwsh', 'bash', 'wsl', 'test.bat', 'script.ps1']) {
    expectReview(executable, ['/c', 'git status'], 'SHELL_INTERPRETATION_REQUIRED');
  }
  for (const token of ['x&y', 'x;y', 'x|y', 'x>y', 'x<y', 'x`y', 'x^y', '$(evil)', '${evil}']) {
    expectReview('npm', ['run', 'build', token], 'SHELL_SYNTAX_REVIEW_REQUIRED');
  }
});

test('malicious execution and redirect flags override matching developer capabilities', () => {
  for (const args of [
    ['run', 'build', '--prefix', '../other'],
    ['run', 'build', '--registry=https://fixture.invalid'],
    ['run', 'build', '--require=private.js'],
    ['run', 'build', '--import', 'private.js'],
    ['run', 'build', '@private.rsp'],
    ['run', 'build', '--config=other'],
    ['run', 'build', '-c', 'evil'],
    ['run', 'build', '--script-shell=evil'],
    ['run', 'build', '--workspace=other'],
    ['run', 'build', '--', '--eval=evil'],
    ['run', 'build', '--unknown-option'],
  ]) {
    const result = classify('npm', args, { projectCaps: caps('npm', args), explicitUserAuthorization: true });
    assert.deepEqual(result, { risk: 'unknown', requiresReview: true, reasonCode: 'UNKNOWN_COMMAND' });
  }
});

test('developer option grammars reject execution hooks and escaping fixture paths despite exact caps', () => {
  for (const [executable, args] of [
    ['dotnet', ['build', '/p:CustomAfterMicrosoftCommonTargets=evil']],
    ['dotnet', ['test', '--logger', 'evil']],
    ['dotnet', ['build', '../Other.csproj']],
    ['cargo', ['test', '--manifest-path', '../Cargo.toml']],
    ['cargo', ['build', '--config', 'evil']],
    ['node', ['--test', '--test-reporter=evil']],
    ['node', ['--test', '../private.js']],
    ['node', ['--test', 'C:\\private.js']],
    ['pytest', ['-p', 'evil']],
    ['python', ['-m', 'pytest', '--override-ini', 'evil']],
  ]) {
    assert.deepEqual(
      classify(executable, args, { projectCaps: caps(executable, args), explicitUserAuthorization: true }),
      {
        risk: 'unknown',
        requiresReview: true,
        reasonCode: 'UNKNOWN_COMMAND',
      },
    );
  }
});

test('Git global overrides cannot hide a dangerous subcommand behind a benign-looking argument', () => {
  for (const args of [
    ['-c', 'alias.status=evil', 'status'],
    ['-C', 'other', 'status'],
    ['--git-dir=other', 'status'],
    ['status', '--', 'push'],
    ['log', '--exec=evil'],
    ['--no-pager', 'push'],
  ])
    expectReview('git', args, 'UNKNOWN_COMMAND', 'unknown');
});

test('invalid, oversized, ambiguous and extra inputs fail closed without leaking or throwing', () => {
  const base = command('git', ['status']);
  for (const input of [
    null,
    undefined,
    [],
    {},
    { ...base, executable: '"git.exe"' },
    { ...base, executable: '../git.exe' },
    { ...base, executable: 'C:git.exe' },
    { ...base, executable: 'git & evil' },
    { ...base, cwd: 'relative' },
    { ...base, cwd: '\\\\?\\C:\\work\\fixture' },
    { ...base, cwd: '//./C:/work/fixture' },
    { ...base, args: ['status\nPRIVATE_SECRET'] },
    { ...base, args: 'status' },
    { ...base, args: [42] },
    { ...base, args: Array(129).fill('') },
    { ...base, args: ['status', ...Array(1)].map((s) => s) },
    { ...base, args: Array(1) },
    { ...base, args: ['x'.repeat(4097)] },
    { ...base, explicitUserAuthorization: 'true' },
    { ...base, hostApproval: 1 },
    { ...base, allowEverything: true },
    { ...base, projectCaps: { root: cwd, buildTestCommands: [], allowEverything: true } },
    { ...base, projectCaps: caps('npm', ['test'], 'relative') },
    { ...base, projectCaps: { root: cwd, buildTestCommands: Array(1) } },
    Object.create(base),
  ])
    assert.deepEqual(classifyCommandSafety(input), {
      risk: 'unknown',
      requiresReview: true,
      reasonCode: 'INVALID_INPUT',
    });
});

test('inputs remain unchanged and no execution or approval adapter is exposed', async () => {
  const input = command('npm', ['test'], {
    projectCaps: caps('npm', ['test']),
    explicitUserAuthorization: true,
  });
  const before = structuredClone(input);
  Object.freeze(input.args);
  Object.freeze(input);
  classifyCommandSafety(input);
  assert.deepEqual(input, before);
  assert.deepEqual(Object.keys(await import('../src/command-safety.ts')), ['classifyCommandSafety']);
});
