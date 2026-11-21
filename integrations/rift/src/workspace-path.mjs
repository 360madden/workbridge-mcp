import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Existing sibling RIFT tool repositories are under the physical workspace
// root, not inside this npm package. Their files are independently hash-checked
// when an offline research run is admitted.
export function riftProjectsRoot(moduleUrl, envRoot = process.env.WORKBRIDGE_ROOT) {
  if (typeof envRoot === 'string' && envRoot && /^[A-Za-z]:\\/.test(envRoot)) {
    return resolve(envRoot);
  }
  const src = dirname(fileURLToPath(moduleUrl));
  const packaged = src
    .toLowerCase()
    .includes(['dist', 'research-runtime', 'rift', 'src'].join(sep).toLowerCase());
  // Source checkout: C:\work\workbridge-mcp\integrations\rift\src => 4 up.
  // Sealed runtime:  C:\work\workbridge-mcp\dist\research-runtime\rift\src => 5 up.
  return resolve(src, packaged ? '../../../../..' : '../../../..');
}
