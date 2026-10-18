import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Workspace } from './workspace.js';

export async function overview(workspace: Workspace, project: string) {
  const root = await workspace.directory(project);
  const listing = await workspace.list(project, true, 0, 500);
  const files = listing.entries.filter((x) => x.type === 'file');
  const languages: Record<string, number> = {};
  const names: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.py': 'Python',
    '.cs': 'C#',
    '.rs': 'Rust',
    '.go': 'Go',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.cpp': 'C++',
    '.lua': 'Lua',
    '.ps1': 'PowerShell',
  };
  for (const file of files) {
    const name = names[path.extname(file.path).toLowerCase()];
    if (name) languages[name] = (languages[name] ?? 0) + 1;
  }
  const manifests = files
    .filter((f) =>
      /(?:^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|.*\.(?:csproj|slnx?|gradle|kts))$/.test(
        f.path,
      ),
    )
    .map((f) => f.path);
  type Manifest = {
    scripts?: Record<string, unknown>;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  let npm: Manifest | null = null;
  try {
    const target = await workspace.resolve(path.join(root, 'package.json'));
    const info = await workspace.info(target);
    if (info.size <= 256_000) npm = JSON.parse(await readFile(target, 'utf8')) as Manifest;
  } catch {
    /* Overview can still describe a missing/malformed manifest. */
  }
  const dependencyNames = Object.keys({ ...npm?.dependencies, ...npm?.devDependencies });
  const frameworkPackages: Record<string, string> = {
    next: 'Next.js',
    react: 'React',
    vue: 'Vue',
    svelte: 'Svelte',
    '@angular/core': 'Angular',
    express: 'Express',
    fastify: 'Fastify',
    '@modelcontextprotocol/server': 'MCP TypeScript SDK',
  };
  const frameworks = dependencyNames
    .filter((name) => frameworkPackages[name])
    .map((name) => ({
      name: frameworkPackages[name],
      evidence: `${workspace.relative(root)}/package.json`,
      dependency: name,
    }));
  return {
    project: workspace.relative(root),
    languages,
    frameworks,
    manifests,
    listingTruncated: listing.truncated,
    candidateEntryPoints: files
      .filter((f) => /(?:^|\/)(?:main|index|server|app|program)\.[^/]+$/i.test(f.path))
      .slice(0, 30)
      .map((f) => f.path),
    npm: npm
      ? {
          scripts: npm.scripts ?? {},
          dependencies: Object.keys(npm.dependencies ?? {}),
          devDependencies: Object.keys(npm.devDependencies ?? {}),
        }
      : null,
    note: 'Manifest and filename evidence only; entry points are candidates. Listing samples at most 500 entries. Listed scripts are not automatically approved for execution.',
  };
}
