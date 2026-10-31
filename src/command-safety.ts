import path from 'node:path';

export type CommandSafetyAdvisory = Readonly<{
  risk: 'low' | 'medium' | 'high' | 'unknown';
  requiresReview: boolean;
  reasonCode: CommandSafetyReason;
}>;

export type CommandSafetyReason =
  | 'INVALID_INPUT'
  | 'SECRET_EXPOSURE_RISK'
  | 'SHELL_INTERPRETATION_REQUIRED'
  | 'SHELL_SYNTAX_REVIEW_REQUIRED'
  | 'PRIVILEGED_OR_MACHINE_STATE'
  | 'NETWORK_PUBLISHING'
  | 'NETWORK_ACCESS'
  | 'CONFIGURATION_EDIT'
  | 'KNOWN_GIT_READ'
  | 'DEVELOPER_BUILD_TEST'
  | 'BUILD_TEST_CAPABILITY_REQUIRED'
  | 'UNKNOWN_COMMAND';

/** Trusted project metadata, not a caller-supplied blanket command permission. */
export type CommandSafetyProjectCaps = {
  root: string;
  buildTestCommands: readonly { executable: string; args: readonly string[] }[];
};

export type CommandSafetyInput = {
  executable: string;
  args: readonly string[];
  cwd: string;
  projectCaps?: CommandSafetyProjectCaps;
  explicitUserAuthorization?: boolean;
  /** Informational only: the host gate cannot grant user task authorization. */
  hostApproval?: boolean;
};

const shells = new Set([
  'cmd',
  'powershell',
  'pwsh',
  'bash',
  'sh',
  'zsh',
  'fish',
  'wsl',
  'cscript',
  'wscript',
]);
const machineState = new Set([
  'sudo',
  'su',
  'runas',
  'shutdown',
  'reboot',
  'systemctl',
  'sc',
  'net',
  'netsh',
  'bcdedit',
  'diskpart',
  'dism',
  'sfc',
  'takeown',
  'icacls',
  'chmod',
  'chown',
  'vmrun',
  'vmware',
  'vmware-vdiskmanager',
  'vmware-vmx',
  'vboxmanage',
  'manage-bde',
  'auditpol',
  'secedit',
]);
const publishingTools = new Set(['wrangler', 'vercel', 'az', 'azd', 'aws', 'gcloud', 'terraform']);
const secretFlags =
  /^(?:--?(?:password|passwd|token|secret|api[-_]?key|access[-_]?token|credential|authorization)(?:=|$)|\/(?:password|passwd|token|secret|credential):)/i;
const secretAssignment =
  /^(?:(?:--?[^=]*|\/(?:p|property):)?(?:password|passwd|token|secret|api[-_]?key|access[-_]?token|authorization))=/i;
const shellSyntax = /[\r\n\0;&|<>`^]|\$\(|\$\{/;

function advisory(
  risk: CommandSafetyAdvisory['risk'],
  reasonCode: CommandSafetyReason,
  authorized = false,
): CommandSafetyAdvisory {
  return Object.freeze({ risk, requiresReview: !authorized, reasonCode });
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function literal(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\0\r\n]/.test(value);
}

function argv(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    Array.from(value).every((s) => typeof s === 'string' && s.length <= 4096 && !/[\0\r\n]/.test(s))
  );
}

function windows(value: string) {
  return /^[a-z]:[\\/]|^\\\\/i.test(value);
}

function absolute(value: unknown): value is string {
  return (
    literal(value) && !/^[\\/]{2}[?.][\\/]/.test(value) && (windows(value) || path.posix.isAbsolute(value))
  );
}

function normalized(value: string) {
  return windows(value) ? path.win32.normalize(value).toLowerCase() : path.posix.normalize(value);
}

function executableName(value: string) {
  return path.win32
    .basename(value)
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat|com|ps1)$/, '');
}

function validExecutable(value: unknown): value is string {
  return (
    literal(value) &&
    value.trim() === value &&
    !/["'\0\r\n;&|<>`^$]/.test(value) &&
    (absolute(value) || /^[a-z0-9][a-z0-9_.-]*$/i.test(value))
  );
}

function validCaps(value: unknown): value is CommandSafetyProjectCaps {
  return (
    record(value) &&
    Object.keys(value).every((k) => ['root', 'buildTestCommands'].includes(k)) &&
    absolute(value.root) &&
    Array.isArray(value.buildTestCommands) &&
    value.buildTestCommands.length <= 32 &&
    Array.from(value.buildTestCommands).every(
      (c) =>
        record(c) &&
        Object.keys(c).every((k) => ['executable', 'args'].includes(k)) &&
        validExecutable(c.executable) &&
        argv(c.args),
    )
  );
}

function hasBuildCapability(input: CommandSafetyInput) {
  const caps = input.projectCaps;
  if (!caps) return false;
  const api = windows(caps.root) ? path.win32 : path.posix;
  if (windows(caps.root) !== windows(input.cwd)) return false;
  const relative = api.relative(normalized(caps.root), normalized(input.cwd));
  if (relative === '..' || relative.startsWith('..' + api.sep) || api.isAbsolute(relative)) return false;
  return caps.buildTestCommands.some(
    (c) =>
      normalized(c.executable) === normalized(input.executable) &&
      c.args.length === input.args.length &&
      c.args.every((arg, i) => arg === input.args[i]),
  );
}

function secretArgument(arg: string) {
  if (secretFlags.test(arg) || secretAssignment.test(arg)) return true;
  // Only recognized filenames/keys; arbitrary argument values are never emitted.
  const file = path.win32.basename(arg.replace(/^--?[a-z-]+=/i, '')).toLowerCase();
  return /^(?:\.env(?:\..+)?|\.npmrc|\.netrc|credentials(?:\.json)?|id_(?:rsa|ed25519)(?:\.pub)?)$/.test(
    file,
  );
}

function knownGitRead(args: readonly string[]) {
  const [verb, ...flags] = args;
  if (verb === '--version') return flags.length === 0;
  if (verb === 'status')
    return flags.every((f) =>
      [
        '--short',
        '-s',
        '--branch',
        '-b',
        '--porcelain',
        '--porcelain=v1',
        '--porcelain=v2',
        '-z',
        '--untracked-files=no',
        '--untracked-files=normal',
        '--untracked-files=all',
      ].includes(f),
    );
  if (verb === 'rev-parse')
    return flags.length === 1 && ['HEAD', '--show-toplevel', '--is-inside-work-tree'].includes(flags[0]!);
  if (verb === 'log') {
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i]!;
      if (['--oneline', '--no-decorate', '--decorate=no', '--all'].includes(flag)) continue;
      if (/^--max-count=[1-9][0-9]{0,3}$/.test(flag)) continue;
      if (flag === '-n' && /^[1-9][0-9]{0,3}$/.test(flags[++i] ?? '')) continue;
      return false;
    }
    return true;
  }
  // Both flags are mandatory: native Git diff can otherwise invoke external helpers.
  if (verb === 'diff')
    return (
      flags.includes('--no-ext-diff') &&
      flags.includes('--no-textconv') &&
      flags.every((f) =>
        [
          '--no-ext-diff',
          '--no-textconv',
          '--stat',
          '--name-only',
          '--name-status',
          '--cached',
          '--staged',
          '--check',
        ].includes(f),
      )
    );
  return false;
}

function buildTestShape(name: string, args: readonly string[]) {
  if (name === 'npm')
    return (
      (args[0] === 'run' && ['build', 'test', 'check', 'lint', 'typecheck'].includes(args[1] ?? '')) ||
      args[0] === 'test'
    );
  if (name === 'dotnet') return ['build', 'test'].includes(args[0] ?? '');
  if (name === 'cargo') return ['build', 'test', 'check', 'clippy'].includes(args[0] ?? '');
  if (name === 'node') return args[0] === '--test';
  if (name === 'pytest') return true;
  if (name === 'python' || name === 'python3') return args[0] === '-m' && args[1] === 'pytest';
  return false;
}

function safeProjectFile(value: string, extension: RegExp) {
  return (
    !value.startsWith('-') &&
    !value.startsWith('/') &&
    !/[\\:]|(?:^|\/)\.\.(?:\/|$)/.test(value) &&
    /^[a-z0-9_./ -]+$/i.test(value) &&
    extension.test(value)
  );
}

function knownBuildOptions(name: string, args: readonly string[]) {
  // Deliberately small grammar. New project flags need review rather than a wildcard.
  if (name === 'npm') return args.length === (args[0] === 'run' ? 2 : 1);
  if (name === 'dotnet') {
    for (let i = 1; i < args.length; i++) {
      const arg = args[i]!;
      if (['--no-restore', '--no-build', '--nologo'].includes(arg)) continue;
      if (['--configuration', '-c'].includes(arg) && ['Debug', 'Release'].includes(args[++i] ?? '')) continue;
      if (['--verbosity', '-v'].includes(arg) && ['quiet', 'minimal', 'normal'].includes(args[++i] ?? ''))
        continue;
      if (safeProjectFile(arg, /\.(?:slnx?|csproj|fsproj|vbproj)$/i)) continue;
      return false;
    }
    return true;
  }
  if (name === 'cargo')
    return args
      .slice(1)
      .every((a) =>
        ['--offline', '--locked', '--frozen', '--release', '--all-targets', '--no-default-features'].includes(
          a,
        ),
      );
  if (name === 'node')
    return args
      .slice(1)
      .every(
        (a) => /^--test-concurrency=[1-9][0-9]{0,2}$/.test(a) || safeProjectFile(a, /\.(?:mjs|cjs|js|ts)$/i),
      );
  const options = name === 'pytest' ? args : args.slice(2);
  return options.every(
    (a) =>
      ['-q', '-v', '--quiet', '--verbose', '--disable-warnings', '--no-header', '--no-summary'].includes(a) ||
      /^--maxfail=[1-9][0-9]{0,2}$/.test(a) ||
      safeProjectFile(a, /\.py$/i),
  );
}

/**
 * Pure advisory for the existing literal executable/argv/cwd terminal contract.
 * Does not resolve binaries, read projects, spawn processes, or grant approval.
 * The caller must supply trusted caps and canonical, workspace-validated paths;
 * lexical path checks cannot establish binary provenance or reject symlinks.
 * Build/test code is project code execution, even when exactly capability-matched.
 * No result blocks or changes Jobs.terminal until separately integrated.
 */
export function classifyCommandSafety(value: unknown): CommandSafetyAdvisory {
  if (
    !record(value) ||
    !Object.keys(value).every((k) =>
      ['executable', 'args', 'cwd', 'projectCaps', 'explicitUserAuthorization', 'hostApproval'].includes(k),
    ) ||
    !validExecutable(value.executable) ||
    !argv(value.args) ||
    !absolute(value.cwd) ||
    (value.projectCaps !== undefined && !validCaps(value.projectCaps)) ||
    (value.explicitUserAuthorization !== undefined && typeof value.explicitUserAuthorization !== 'boolean') ||
    (value.hostApproval !== undefined && typeof value.hostApproval !== 'boolean')
  )
    return advisory('unknown', 'INVALID_INPUT');
  const input = value as CommandSafetyInput;
  const name = executableName(input.executable);
  const args = input.args;
  const verb = args[0];
  const folded = args.map((a) => a.toLowerCase());

  if (
    args.some(secretArgument) ||
    ['printenv', 'env', 'vault', 'cmdkey'].includes(name) ||
    (name === 'git' && verb === 'credential') ||
    (name === 'git' &&
      verb === 'config' &&
      args.some((a) => ['--list', '-l', '--get', '--get-all', '--get-regexp'].includes(a))) ||
    (name === 'npm' && verb === 'config' && ['get', 'list', 'ls'].includes(args[1] ?? ''))
  )
    return advisory('high', 'SECRET_EXPOSURE_RISK');
  if (shells.has(name) || (/\.(?:bat|cmd|ps1)$/i.test(input.executable) && name !== 'npm'))
    return advisory('high', 'SHELL_INTERPRETATION_REQUIRED');
  if (args.some((a) => shellSyntax.test(a))) return advisory('high', 'SHELL_SYNTAX_REVIEW_REQUIRED');
  if (machineState.has(name) || (name === 'docker' && ['system', 'volume'].includes(verb ?? '')))
    return advisory('high', 'PRIVILEGED_OR_MACHINE_STATE');
  if (
    publishingTools.has(name) ||
    (name === 'git' && ['push', 'send-email'].includes(verb ?? '')) ||
    (name === 'npm' &&
      ['publish', 'unpublish', 'login', 'adduser', 'owner', 'access', 'token'].includes(verb ?? '')) ||
    (name === 'dotnet' && verb === 'nuget' && args[1] === 'push') ||
    (name === 'cargo' && verb === 'publish') ||
    (name === 'docker' && verb === 'push') ||
    (name === 'gh' && ['release', 'api'].includes(verb ?? ''))
  )
    return advisory('high', 'NETWORK_PUBLISHING');
  if (
    (name === 'git' && ['fetch', 'pull', 'clone'].includes(verb ?? '')) ||
    ['curl', 'wget', 'ssh', 'scp', 'sftp', 'npx'].includes(name) ||
    (name === 'npm' && ['install', 'i', 'ci', 'exec'].includes(verb ?? ''))
  )
    return advisory('high', 'NETWORK_ACCESS');
  if (['reg', 'setx', 'regedit'].includes(name) || (['git', 'npm'].includes(name) && verb === 'config'))
    return advisory('high', 'CONFIGURATION_EDIT');

  // Options which redirect execution/configuration never inherit a benign verb's classification.
  if (
    folded.some((a) =>
      /^@|^(?:--(?:require|import|loader|experimental-loader|eval|config|prefix|registry|exec|upload-pack|receive-pack|output)(?:=|$)|-e$|\/(?:p|property|target):|-p:)/.test(
        a,
      ),
    )
  )
    return advisory('unknown', 'UNKNOWN_COMMAND');
  if (name === 'git' && knownGitRead(args))
    return advisory('low', 'KNOWN_GIT_READ', input.explicitUserAuthorization === true);
  if (buildTestShape(name, args)) {
    if (!knownBuildOptions(name, args)) return advisory('unknown', 'UNKNOWN_COMMAND');
    if (!hasBuildCapability(input)) return advisory('medium', 'BUILD_TEST_CAPABILITY_REQUIRED');
    return advisory('medium', 'DEVELOPER_BUILD_TEST', input.explicitUserAuthorization === true);
  }
  return advisory('unknown', 'UNKNOWN_COMMAND');
}
