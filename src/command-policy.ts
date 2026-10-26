import path from 'node:path';

export type CommandPermission = 'read' | 'write' | 'execute' | 'delete' | 'network' | 'admin';
export type CommandRisk = 'low' | 'medium' | 'high' | 'unknown';
type Permissions = readonly CommandPermission[];

export type CommandPathGrant = Readonly<{
  path: string;
  match: 'exact' | 'subtree';
  /** Defaults to true, including Windows case-sensitive directories. POSIX must use true. */
  caseSensitive?: boolean;
  permissions: Permissions;
}>;
export type CommandPolicy = Readonly<{
  version: 1;
  permissions: Permissions;
  maxRisk: Exclude<CommandRisk, 'unknown'>;
  tools: readonly Readonly<{ tool: string; permissions: Permissions; risk: CommandRisk }>[];
  paths: readonly CommandPathGrant[];
  resources: readonly Readonly<{ resource: string; permissions: Permissions }>[];
}>;
export type CommandPolicyRequest = Readonly<{
  tool: string;
  permissions: Permissions;
  paths: readonly Readonly<{ path: string; permissions: Permissions }>[];
  resources: readonly Readonly<{ resource: string; permissions: Permissions }>[];
}>;
export type CommandPolicyReason =
  | 'ALLOWED'
  | 'INVALID_POLICY'
  | 'INVALID_REQUEST'
  | 'TOOL_NOT_ALLOWED'
  | 'PERMISSION_NOT_ALLOWED'
  | 'TOOL_PERMISSION_NOT_ALLOWED'
  | 'PATH_NOT_ALLOWED'
  | 'PATH_PERMISSION_NOT_ALLOWED'
  | 'RESOURCE_NOT_ALLOWED'
  | 'RESOURCE_PERMISSION_NOT_ALLOWED'
  | 'UNKNOWN_RISK'
  | 'RISK_LIMIT_EXCEEDED';
export type CommandPolicyDecision = Readonly<{
  allowed: boolean;
  previewOnly: true;
  risk: CommandRisk;
  reasonCode: CommandPolicyReason;
}>;

const permissionRisk = {
  read: 'low',
  write: 'medium',
  execute: 'medium',
  delete: 'high',
  network: 'high',
  admin: 'high',
} as const;
const riskRank = { low: 0, medium: 1, high: 2, unknown: 3 } as const;
const pathPermissions = ['read', 'write', 'execute', 'delete'];
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function record(
  value: unknown,
  required: string[],
  optional: string[] = [],
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    Object.getOwnPropertySymbols(value).length === 0 &&
    required.every((key) => own(descriptors, key)) &&
    Object.keys(descriptors).every(
      (key) => (required.includes(key) || optional.includes(key)) && own(descriptors[key]!, 'value'),
    )
  );
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function list(value: unknown, max: number, valid: (item: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.length <= max && Array.from(value).every(valid);
}
function permissions(value: unknown, empty = false): value is CommandPermission[] {
  return (
    list(value, 6, (item) => typeof item === 'string' && own(permissionRisk, item)) &&
    (empty || value.length > 0) &&
    new Set(value).size === value.length
  );
}
function tool(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value);
}
function risk(value: unknown): value is CommandRisk {
  return typeof value === 'string' && own(riskRank, value);
}

type NormalPath = { style: 'windows' | 'posix'; value: string };
function normalPath(value: unknown): NormalPath | undefined {
  if (!text(value, 4096)) return;
  if (/^[A-Za-z]:[\\/]/.test(value) || /^[\\/]{2}/.test(value)) {
    const windows = value.replaceAll('/', '\\');
    // Exclude device/extended namespaces, drive-relative paths and ambiguous UNC authorities.
    if (/^\\\\[?.]\\/.test(windows)) return;
    let components: string[];
    if (/^[A-Za-z]:\\/.test(windows)) components = windows.slice(3).split('\\');
    else {
      components = windows.slice(2).split('\\');
      if (components.length < 2 || !components[0] || !components[1]) return;
      if (components.slice(0, 2).some((part) => part === '.' || part === '..')) return;
    }
    // Windows normalizes traversal above a drive/UNC share root by silently
    // clipping it. Refuse that spelling rather than expanding a share grant.
    const relative = /^[A-Za-z]:\\/.test(windows) ? components : components.slice(2);
    let depth = 0;
    for (const part of relative) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (depth === 0) return;
        depth--;
      } else depth++;
    }
    if (
      components.some(
        (part) =>
          /[<>:"|?*]/.test(part) ||
          (part !== '.' && part !== '..' && /[. ]$/.test(part)) ||
          /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(
            part,
          ),
      )
    )
      return;
    const normalized = path.win32.normalize(windows);
    const root = path.win32.parse(normalized).root;
    return {
      style: 'windows',
      value: normalized.length > root.length ? normalized.replace(/\\+$/, '') : root,
    };
  }
  if (!value.startsWith('/') || /[\\*?]/.test(value)) return;
  const normalized = path.posix.normalize(value);
  return { style: 'posix', value: normalized === '/' ? normalized : normalized.replace(/\/+$/, '') };
}

function pathGrant(value: unknown): boolean {
  if (!record(value, ['path', 'match', 'permissions'], ['caseSensitive'])) return false;
  const normalized = normalPath(value.path);
  return (
    !!normalized &&
    ['exact', 'subtree'].includes(value.match as string) &&
    permissions(value.permissions) &&
    value.permissions.every((p) => pathPermissions.includes(p)) &&
    (!own(value, 'caseSensitive') || typeof value.caseSensitive === 'boolean') &&
    (normalized.style === 'windows' || value.caseSensitive !== false)
  );
}
function resourceGrant(value: unknown): boolean {
  return (
    record(value, ['resource', 'permissions']) && text(value.resource, 512) && permissions(value.permissions)
  );
}
function validPolicy(value: unknown): value is CommandPolicy {
  if (!record(value, ['version', 'permissions', 'maxRisk', 'tools', 'paths', 'resources'])) return false;
  return (
    value.version === 1 &&
    permissions(value.permissions, true) &&
    risk(value.maxRisk) &&
    value.maxRisk !== 'unknown' &&
    list(
      value.tools,
      64,
      (item) =>
        record(item, ['tool', 'permissions', 'risk']) &&
        tool(item.tool) &&
        permissions(item.permissions) &&
        risk(item.risk),
    ) &&
    new Set(value.tools.map((item) => (item as { tool: string }).tool)).size === value.tools.length &&
    list(value.paths, 128, pathGrant) &&
    list(value.resources, 128, resourceGrant) &&
    new Set(value.resources.map((item) => (item as { resource: string }).resource)).size ===
      value.resources.length
  );
}
function validRequest(value: unknown): value is CommandPolicyRequest {
  if (!record(value, ['tool', 'permissions', 'paths', 'resources']) || !permissions(value.permissions))
    return false;
  const requested = value.permissions;
  return (
    tool(value.tool) &&
    list(
      value.paths,
      64,
      (item) =>
        record(item, ['path', 'permissions']) &&
        !!normalPath(item.path) &&
        permissions(item.permissions) &&
        item.permissions.every((p) => pathPermissions.includes(p) && requested.includes(p)),
    ) &&
    list(
      value.resources,
      64,
      (item) =>
        resourceGrant(item) &&
        (item as { permissions: CommandPermission[] }).permissions.every((p) => requested.includes(p)),
    )
  );
}
function covers(granted: Permissions, requested: Permissions): boolean {
  return requested.every((p) => granted.includes(p));
}
function matches(grant: CommandPathGrant, target: string): boolean {
  const base = normalPath(grant.path)!;
  const candidate = normalPath(target)!;
  if (base.style !== candidate.style) return false;
  let root = base.value;
  let value = candidate.value;
  if (grant.caseSensitive === false) {
    root = root.toLowerCase();
    value = value.toLowerCase();
  }
  const separator = base.style === 'windows' ? '\\' : '/';
  return (
    value === root ||
    (grant.match === 'subtree' && value.startsWith(root.endsWith(separator) ? root : root + separator))
  );
}
function decision(
  allowed: boolean,
  risk: CommandRisk,
  reasonCode: CommandPolicyReason,
): CommandPolicyDecision {
  return Object.freeze({ allowed, previewOnly: true, risk, reasonCode });
}

/**
 * Pure lexical scope preview; no execution, filesystem lookup, approval or permission changes.
 * The policy and complete operation metadata must come from a trusted caller, separately
 * from command/user input. This does not parse shell/argv or infer omitted effects. Tool risk
 * is a trusted floor; permission risk can only raise it. Unknown risk always fails closed.
 * All allowlists are additive: a single matching grant must cover each target's permissions;
 * narrower grants are not deny rules. Tool/resource names are exact and case-sensitive.
 * Resources are opaque IDs (no URL parsing, decoding, prefix matching or glob expansion).
 * Windows slash/dot normalization is lexical; case folding needs explicit opt-in. Callers
 * must independently resolve symlinks/junctions, binary identity and Windows case behavior,
 * validate scope again at execution, and satisfy real host/user gates. An allowed preview
 * is not an OS sandbox or an authorization to run terminal_run.
 */
export function evaluateCommandPolicy(policy: unknown, request: unknown): CommandPolicyDecision {
  try {
    if (!validPolicy(policy)) return decision(false, 'unknown', 'INVALID_POLICY');
    if (!validRequest(request)) return decision(false, 'unknown', 'INVALID_REQUEST');
    const grant = policy.tools.find((entry) => entry.tool === request.tool);
    if (!grant) return decision(false, 'unknown', 'TOOL_NOT_ALLOWED');
    let classified = grant.risk;
    for (const permission of request.permissions) {
      const minimum = permissionRisk[permission];
      if (riskRank[minimum] > riskRank[classified]) classified = minimum;
    }
    if (classified === 'unknown') return decision(false, classified, 'UNKNOWN_RISK');
    if (!covers(policy.permissions, request.permissions))
      return decision(false, classified, 'PERMISSION_NOT_ALLOWED');
    if (!covers(grant.permissions, request.permissions))
      return decision(false, classified, 'TOOL_PERMISSION_NOT_ALLOWED');
    for (const target of request.paths) {
      const grants = policy.paths.filter((entry) => matches(entry, target.path));
      if (!grants.length) return decision(false, classified, 'PATH_NOT_ALLOWED');
      if (!grants.some((entry) => covers(entry.permissions, target.permissions)))
        return decision(false, classified, 'PATH_PERMISSION_NOT_ALLOWED');
    }
    for (const target of request.resources) {
      const resource = policy.resources.find((entry) => entry.resource === target.resource);
      if (!resource) return decision(false, classified, 'RESOURCE_NOT_ALLOWED');
      if (!covers(resource.permissions, target.permissions))
        return decision(false, classified, 'RESOURCE_PERMISSION_NOT_ALLOWED');
    }
    if (riskRank[classified] > riskRank[policy.maxRisk])
      return decision(false, classified, 'RISK_LIMIT_EXCEEDED');
    return decision(true, classified, 'ALLOWED');
  } catch {
    // Malformed in-process values (e.g. throwing proxies) must not turn into an allow.
    return decision(false, 'unknown', 'INVALID_POLICY');
  }
}
