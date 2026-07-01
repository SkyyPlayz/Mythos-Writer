// Backup / restore — creates and reads .mwbackup archives (zip).
// This module has no Electron dependency and can be unit-tested in Node.
//
// Backup contents (user vault markdown files are NOT included):
//   header.json                       — schema, versions, timestamp
//   userData/app-settings.json        — app settings (secrets redacted — #628)
//   userData/vault-settings.json      — vault path settings
//   storyVault/manifest.json          — story manifest
//   storyVault/.mythos/**             — state.db, snapshots, backups, etc.
//   notesVault/manifest.json          — notes manifest (if present)
//   notesVault/.mythos/**             — notes vault metadata (if present)

import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';

export const BACKUP_SCHEMA_VERSION = 1;

// --- #733: zip-slip guard ---------------------------------------------------

const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const UNC_RE = /^\\\\/;

/**
 * Resolve `entryName` against `destBase` and return the absolute path, or
 * throw if the result escapes `destBase` by any vector (zip-slip, `..`,
 * absolute paths, Windows drive letters, UNC paths, null bytes).
 */
export function safeRestoreJoin(destBase: string, entryName: string): string {
  if (entryName.includes('\0')) {
    throw new Error(`Zip-slip rejected: null byte in entry ${JSON.stringify(entryName)}`);
  }
  if (WINDOWS_DRIVE_RE.test(entryName) || UNC_RE.test(entryName)) {
    throw new Error(`Zip-slip rejected: absolute path in entry ${entryName}`);
  }
  const normalizedBase = path.resolve(destBase);
  const resolved = path.resolve(normalizedBase, entryName);
  if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + path.sep)) {
    throw new Error(`Zip-slip rejected: entry ${JSON.stringify(entryName)} escapes restore directory`);
  }
  return resolved;
}

// --- #628: settings redaction -----------------------------------------------

/**
 * Return a copy of the parsed app-settings object with all known plaintext
 * secret fields zeroed out so they are never written into backup archives.
 *
 * Fields redacted: apiKey, provider.apiKey, voice.openaiApiKey,
 * stt.cloudApiKey, tts.cloudApiKey, agents.*.provider.apiKey.
 */
export function redactAppSettings(raw: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...raw };

  if (typeof redacted.apiKey === 'string') redacted.apiKey = '';

  if (redacted.provider && typeof redacted.provider === 'object') {
    const p = redacted.provider as Record<string, unknown>;
    if (typeof p.apiKey === 'string') redacted.provider = { ...p, apiKey: '' };
  }

  if (redacted.voice && typeof redacted.voice === 'object') {
    const v = redacted.voice as Record<string, unknown>;
    if (typeof v.openaiApiKey === 'string') redacted.voice = { ...v, openaiApiKey: '' };
  }

  if (redacted.stt && typeof redacted.stt === 'object') {
    const s = redacted.stt as Record<string, unknown>;
    if (typeof s.cloudApiKey === 'string') redacted.stt = { ...s, cloudApiKey: '' };
  }

  if (redacted.tts && typeof redacted.tts === 'object') {
    const t = redacted.tts as Record<string, unknown>;
    if (typeof t.cloudApiKey === 'string') redacted.tts = { ...t, cloudApiKey: '' };
  }

  if (redacted.agents && typeof redacted.agents === 'object') {
    const agents = redacted.agents as Record<string, unknown>;
    const redactedAgents: Record<string, unknown> = { ...agents };
    for (const agentKey of Object.keys(redactedAgents)) {
      const agent = redactedAgents[agentKey];
      if (agent && typeof agent === 'object') {
        const a = agent as Record<string, unknown>;
        if (a.provider && typeof a.provider === 'object') {
          const p = a.provider as Record<string, unknown>;
          if (typeof p.apiKey === 'string') {
            redactedAgents[agentKey] = { ...a, provider: { ...p, apiKey: '' } };
          }
        }
      }
    }
    redacted.agents = redactedAgents;
  }

  return redacted;
}

export interface BackupHeader {
  schemaVersion: number;
  appVersion: string;
  manifestSchemaVersion: number;
  createdAt: string;
}

export interface BackupOptions {
  userDataPath: string;
  storyVaultRoot: string;
  notesVaultRoot: string;
  appVersion: string;
  manifestSchemaVersion: number;
  outputPath: string;
}

export interface BackupResult {
  path: string;
  bytes: number;
}

export interface RestoreOptions {
  archivePath: string;
  userDataPath: string;
  storyVaultRoot: string;
  notesVaultRoot: string;
  overwrite?: boolean;
}

export interface RestoreResult {
  restored: boolean;
  details: string[];
  requiresConfirmation?: boolean;
}

export async function backupAppData(options: BackupOptions): Promise<BackupResult> {
  const zip = new JSZip();

  const header: BackupHeader = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: options.appVersion,
    manifestSchemaVersion: options.manifestSchemaVersion,
    createdAt: new Date().toISOString(),
  };
  zip.file('header.json', JSON.stringify(header, null, 2));

  // #628: redact secrets before archiving app-settings.json
  addSettingsRedacted(zip, path.join(options.userDataPath, 'app-settings.json'), 'userData/app-settings.json');
  addFileIfExists(zip, path.join(options.userDataPath, 'vault-settings.json'), 'userData/vault-settings.json');

  addFileIfExists(zip, path.join(options.storyVaultRoot, 'manifest.json'), 'storyVault/manifest.json');
  addDirIfExists(zip, path.join(options.storyVaultRoot, '.mythos'), 'storyVault/.mythos');

  addFileIfExists(zip, path.join(options.notesVaultRoot, 'manifest.json'), 'notesVault/manifest.json');
  addDirIfExists(zip, path.join(options.notesVaultRoot, '.mythos'), 'notesVault/.mythos');

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, buffer);
  return { path: options.outputPath, bytes: buffer.length };
}

export async function restoreAppData(options: RestoreOptions): Promise<RestoreResult> {
  if (!fs.existsSync(options.archivePath)) {
    throw new Error(`Archive not found: ${options.archivePath}`);
  }

  const buffer = fs.readFileSync(options.archivePath);
  const zip = await JSZip.loadAsync(buffer);

  const headerFile = zip.file('header.json');
  if (!headerFile) throw new Error('Invalid backup archive: missing header.json');
  const header = JSON.parse(await headerFile.async('text')) as BackupHeader;
  if (header.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported backup schema version ${header.schemaVersion} (expected ${BACKUP_SCHEMA_VERSION})`,
    );
  }

  if (!options.overwrite) {
    const sentinels = [
      path.join(options.userDataPath, 'app-settings.json'),
      path.join(options.userDataPath, 'vault-settings.json'),
    ];
    if (sentinels.some((f) => fs.existsSync(f))) {
      return {
        restored: false,
        requiresConfirmation: true,
        details: ['App data already exists; pass overwrite: true to replace it.'],
      };
    }
  }

  const details: string[] = [];

  const extractFile = async (zipPath: string, destPath: string): Promise<void> => {
    const file = zip.file(zipPath);
    if (!file) return;
    const content = await file.async('nodebuffer');
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
    details.push(`restored: ${zipPath}`);
  };

  // #733: safeRestoreJoin prevents zip-slip — rejects `..`, absolute, drive, UNC, null-byte entries
  const extractDir = async (zipPrefix: string, destBase: string): Promise<void> => {
    const matched = zip.filter((rel) => rel.startsWith(zipPrefix));
    for (const entry of matched) {
      if (entry.dir) continue;
      const rel = entry.name.slice(zipPrefix.length);
      const destPath = safeRestoreJoin(destBase, rel);
      const content = await entry.async('nodebuffer');
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, content);
      details.push(`restored: ${entry.name}`);
    }
  };

  await extractFile('userData/app-settings.json', path.join(options.userDataPath, 'app-settings.json'));
  await extractFile('userData/vault-settings.json', path.join(options.userDataPath, 'vault-settings.json'));
  await extractFile('storyVault/manifest.json', path.join(options.storyVaultRoot, 'manifest.json'));
  await extractDir('storyVault/.mythos/', path.join(options.storyVaultRoot, '.mythos'));
  await extractFile('notesVault/manifest.json', path.join(options.notesVaultRoot, 'manifest.json'));
  await extractDir('notesVault/.mythos/', path.join(options.notesVaultRoot, '.mythos'));

  return { restored: true, details };
}

function addFileIfExists(zip: JSZip, filePath: string, zipPath: string): void {
  if (fs.existsSync(filePath)) {
    zip.file(zipPath, fs.readFileSync(filePath));
  }
}

// #628: read app-settings.json, redact secret keys, then store in zip
function addSettingsRedacted(zip: JSZip, filePath: string, zipPath: string): void {
  if (!fs.existsSync(filePath)) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return;
  }
  zip.file(zipPath, JSON.stringify(redactAppSettings(parsed), null, 2));
}

function addDirIfExists(zip: JSZip, dirPath: string, zipPrefix: string): void {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return;
  walkDir(dirPath, (absPath, relPath) => {
    zip.file(`${zipPrefix}/${relPath}`, fs.readFileSync(absPath));
  });
}

function walkDir(
  dir: string,
  cb: (absPath: string, relPath: string) => void,
  prefix = '',
): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(abs, cb, rel);
    } else if (entry.isFile()) {
      cb(abs, rel);
    }
  }
}
