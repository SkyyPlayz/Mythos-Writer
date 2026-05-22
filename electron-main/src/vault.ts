// Pure vault I/O functions — no Electron dependency, fully testable.
// The vaultRoot parameter is always resolved before calling these.
import fs from 'fs';
import path from 'path';

function safePath(vaultRoot: string, relativePath: string): string {
  const resolved = path.resolve(vaultRoot, relativePath);
  if (!resolved.startsWith(path.resolve(vaultRoot))) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

export function readVaultFile(vaultRoot: string, filePath: string): { content: string; path: string } {
  const fullPath = safePath(vaultRoot, filePath);
  return { content: fs.readFileSync(fullPath, 'utf-8'), path: filePath };
}

export function writeVaultFile(
  vaultRoot: string,
  filePath: string,
  content: string
): { path: string; bytes: number } {
  const fullPath = safePath(vaultRoot, filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return { path: filePath, bytes: Buffer.byteLength(content, 'utf-8') };
}

export function listVaultFiles(
  vaultRoot: string,
  root?: string
): { items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> } {
  const baseDir = root ? safePath(vaultRoot, root) : vaultRoot;
  const items: Array<{ path: string; name: string; isDirectory: boolean; modifiedAt: string }> = [];

  function walk(dir: string, prefix: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(prefix, entry.name);
      items.push({
        path: relativePath,
        name: entry.name,
        isDirectory: entry.isDirectory(),
        modifiedAt: new Date(fs.statSync(fullPath).mtime).toISOString(),
      });
      if (entry.isDirectory()) walk(fullPath, relativePath);
    }
  }

  walk(baseDir, '');
  return { items };
}

export function deleteVaultFile(vaultRoot: string, filePath: string): { path: string; deleted: boolean } {
  const fullPath = safePath(vaultRoot, filePath);
  const exists = fs.existsSync(fullPath);
  if (exists) fs.unlinkSync(fullPath);
  return { path: filePath, deleted: exists };
}
