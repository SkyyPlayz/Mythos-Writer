import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** Shield: realpath-contained inside frontend/ — relative must not start with `..` or be absolute. */
function isInsideFrontend(absPath: string): boolean {
  let realRoot: string;
  try {
    realRoot = realpathSync(frontendRoot);
  } catch {
    return false;
  }
  let realFile: string;
  try {
    realFile = realpathSync(absPath);
  } catch {
    try {
      const realParent = realpathSync(path.dirname(absPath));
      realFile = path.join(realParent, path.basename(absPath));
    } catch {
      return false;
    }
  }
  const rel = path.relative(realRoot, realFile);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Vitest stubs `.css?raw` to '' — serve real CSS text for H4 contract tests.
 * Shield BLOCK 5357119278: Vitest-only registration; exact `\.css\?raw$`;
 * realpath jail; load only virtual ids issued by resolveId + re-check before read.
 */
export function cssRawForTestsPlugin(): Plugin {
  const allowedVirtualIds = new Set<string>();

  return {
    name: 'mythos-css-raw-for-tests',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!/\.css\?raw$/.test(id)) return null;
      const filePart = id.split('?')[0]!;
      let abs: string;
      if (filePart.startsWith('/src/')) {
        abs = path.join(frontendRoot, filePart.slice(1));
      } else if (path.isAbsolute(filePart)) {
        abs = filePart;
      } else if (importer) {
        const imp = importer.startsWith('\0') ? importer : importer.split('?')[0]!;
        const from = imp
          .replace(/^\0mythos-css-raw:/, '')
          .replace(/\.rawtxt$/, '');
        abs = path.resolve(path.dirname(from), filePart);
      } else {
        abs = path.resolve(frontendRoot, filePart.replace(/^\//, ''));
      }
      abs = path.normalize(abs);
      if (!isInsideFrontend(abs)) return null;
      const virtualId = `\0mythos-css-raw:${abs}.rawtxt`;
      allowedVirtualIds.add(virtualId);
      return virtualId;
    },
    load(id) {
      if (!id.startsWith('\0mythos-css-raw:')) return null;
      // Shield (4): only ids this resolveId issued.
      if (!allowedVirtualIds.has(id)) return null;
      const file = id.slice('\0mythos-css-raw:'.length).replace(/\.rawtxt$/, '');
      // Shield (4): re-check realpath containment immediately before readFileSync.
      if (!isInsideFrontend(file)) return null;
      const text = readFileSync(file, 'utf8');
      return `export default ${JSON.stringify(text)};\n`;
    },
  };
}
