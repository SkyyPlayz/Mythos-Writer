// SKY-10: Per-scene versioned drafts.
//
// Layout (per-chapter, visible):
//   <chapterRelPath>/versions/<entityId>/<isoTs>-<hash8>.md
//
// Each snapshot is the byte-identical scene file content (frontmatter + prose)
// prefixed with a small versioning header that records intent + content hash.
//
// Why per-chapter, visible:
//   - Authors browsing the vault in Obsidian / Finder see history next to the
//     scenes it belongs to, not buried at the vault root.
//   - Moving a chapter folder drags its history with it.
//   - `versions/` is user data — naming it as a dotfile would hide it from
//     the very tools authors use to inspect their vault.
//
// Why hash in filename:
//   - Lexicographic sort = chronological sort (ISO timestamp with `:` / `.`
//     swapped to `-`).
//   - Hash suffix gives forensic confidence the file content matches its name
//     and dedupes byte-identical autosaves.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type VersionIntent =
  | 'save'
  | 'auto'
  | 'agent-suggestion-applied'
  | 'pre-rollback'
  | 'migration';

const ALLOWED_INTENTS: readonly VersionIntent[] = [
  'save',
  'auto',
  'agent-suggestion-applied',
  'pre-rollback',
  'migration',
] as const;

export interface SceneVersion {
  /** Scene (or chapter) id this snapshot belongs to. */
  sceneId: string;
  /** Filename stem — sanitized ISO timestamp + 8-char content hash. Sortable. */
  ts: string;
  /** Stored file content (byte-identical to the scene file at snapshot time). */
  content: string;
  /** Author intent at snapshot time. */
  intent: VersionIntent;
  /** sha256(content) full hex — header field; filename uses first 8 chars. */
  contentHash: string;
}

export interface SaveVersionOptions {
  /** Required: chapter folder relative path inside the vault (e.g. "Manuscript/My Story/01 - Opening"). */
  chapterRelPath: string;
  /** Defaults to 'save'. */
  intent?: VersionIntent;
  /** Override retention cap (default 100). */
  retention?: number;
}

const DEFAULT_RETENTION = 100;

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const SAFE_TS_RE = /^[A-Za-z0-9_.\-]+$/;

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID_RE.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}

function assertSafeTs(value: string): void {
  if (!SAFE_TS_RE.test(value) || value.includes('..')) {
    throw new Error(`Invalid ts: ${value}`);
  }
}

function assertValidIntent(intent: VersionIntent): void {
  if (!ALLOWED_INTENTS.includes(intent)) {
    throw new Error(`Invalid intent: ${intent}`);
  }
}

/**
 * Resolve the per-chapter versions directory for a scene/chapter id, ensuring
 * the result stays under the requested chapter folder (which itself must be
 * inside the vault root).
 */
function safeVersionsDir(vaultRoot: string, chapterRelPath: string, entityId: string): string {
  assertSafeId(entityId, 'sceneId');
  const vaultAbs = path.resolve(vaultRoot);
  const chapterAbs = path.resolve(vaultAbs, chapterRelPath);
  const vaultWithSep = vaultAbs.endsWith(path.sep) ? vaultAbs : `${vaultAbs}${path.sep}`;
  if (chapterAbs !== vaultAbs && !chapterAbs.startsWith(vaultWithSep)) {
    throw new Error(`Invalid chapterRelPath: ${chapterRelPath}`);
  }
  const versionsRoot = path.resolve(chapterAbs, 'versions');
  const resolved = path.resolve(versionsRoot, entityId);
  const versionsWithSep = versionsRoot.endsWith(path.sep)
    ? versionsRoot
    : `${versionsRoot}${path.sep}`;
  if (resolved !== versionsRoot && !resolved.startsWith(versionsWithSep)) {
    throw new Error(`Invalid sceneId: ${entityId}`);
  }
  return resolved;
}

function isoStampForFs(d: Date = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

// Process-wide monotonic counter ensures filenames sort in creation order even
// when multiple saves land within the same millisecond (where the ISO stamp
// is byte-identical and the hash suffix would otherwise order randomly).
let _seq = 0;
function nextSeq(): string {
  _seq += 1;
  return _seq.toString().padStart(8, '0');
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

const VERSION_FENCE = '<!-- SKY-10:version -->';

function serializeSnapshotFile(version: SceneVersion, sourceTs: string | null): string {
  const header = [
    VERSION_FENCE,
    `sceneId: ${version.sceneId}`,
    `ts: ${sourceTs ?? version.ts}`,
    `intent: ${version.intent}`,
    `contentHash: ${version.contentHash}`,
    VERSION_FENCE,
    '',
  ].join('\n');
  return header + version.content;
}

function parseSnapshotFile(raw: string): {
  intent: VersionIntent;
  contentHash: string;
  content: string;
} | null {
  if (!raw.startsWith(VERSION_FENCE)) return null;
  const end = raw.indexOf(`${VERSION_FENCE}\n`, VERSION_FENCE.length);
  if (end === -1) return null;
  const headerBlock = raw.slice(VERSION_FENCE.length, end).trim();
  const tail = raw.slice(end + VERSION_FENCE.length + 1); // +1 for the trailing \n
  // Body starts after one separator newline written by serializeSnapshotFile.
  const content = tail.startsWith('\n') ? tail.slice(1) : tail;

  let intent: VersionIntent = 'save';
  let contentHash = '';
  for (const line of headerBlock.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key === 'intent' && (ALLOWED_INTENTS as readonly string[]).includes(val)) {
      intent = val as VersionIntent;
    } else if (key === 'contentHash') {
      contentHash = val;
    }
  }
  return { intent, contentHash, content };
}

interface SnapshotFileMeta {
  filename: string;
  ts: string;
  intent: VersionIntent;
  contentHash: string;
}

function readSnapshotMeta(dir: string, filename: string): SnapshotFileMeta | null {
  const fullPath = path.join(dir, filename);
  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseSnapshotFile(raw);
    const ts = filename.slice(0, -3); // strip .md
    if (parsed) {
      return { filename, ts, intent: parsed.intent, contentHash: parsed.contentHash };
    }
    return { filename, ts, intent: 'save', contentHash: '' };
  } catch {
    return null;
  }
}

/**
 * Snapshot the given content for a scene/chapter.
 *
 * Dedup rule: if `intent === 'auto'` and the most recent prior snapshot has the
 * same content hash, the write is skipped and the prior snapshot is returned
 * unchanged. This prevents idle autosave thrash from filling the history.
 */
export function saveVersion(
  vaultRoot: string,
  sceneId: string,
  content: string,
  options: SaveVersionOptions,
): SceneVersion {
  const intent: VersionIntent = options.intent ?? 'save';
  assertValidIntent(intent);
  const retention = options.retention ?? DEFAULT_RETENTION;

  const dir = safeVersionsDir(vaultRoot, options.chapterRelPath, sceneId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const contentHash = sha256Hex(content);

  // Dedup for autosave: skip if the most recent snapshot has the same hash.
  if (intent === 'auto') {
    const newest = listSnapshotFiles(dir)[0];
    if (newest && newest.contentHash === contentHash) {
      return {
        sceneId,
        ts: newest.ts,
        content,
        intent: newest.intent,
        contentHash,
      };
    }
  }

  const stamp = isoStampForFs();
  const hash8 = contentHash.slice(0, 8);
  // Filename pattern: <stamp>_<seq>-<hash8>.md
  //   - stamp gives chronological coarse order
  //   - seq guarantees deterministic order across same-ms saves
  //   - hash8 gives forensic content identity
  const ts = `${stamp}_${nextSeq()}-${hash8}`;
  const candidate = path.join(dir, `${ts}.md`);

  const snapshot: SceneVersion = { sceneId, ts, content, intent, contentHash };
  fs.writeFileSync(candidate, serializeSnapshotFile(snapshot, ts), 'utf-8');
  pruneByRetention(dir, retention);
  return snapshot;
}

function listSnapshotFiles(dir: string): SnapshotFileMeta[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((f) => readSnapshotMeta(dir, f))
    .filter((m): m is SnapshotFileMeta => m !== null);
}

function pruneByRetention(dir: string, retention: number): void {
  if (retention <= 0) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  if (files.length <= retention) return;
  for (const f of files.slice(0, files.length - retention)) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      /* ignore */
    }
  }
}

/** List snapshots for a scene/chapter, newest first. Returns metadata + content. */
export function listVersions(
  vaultRoot: string,
  sceneId: string,
  options: { chapterRelPath: string },
): SceneVersion[] {
  const dir = safeVersionsDir(vaultRoot, options.chapterRelPath, sceneId);
  if (!fs.existsSync(dir)) return [];
  return listSnapshotFiles(dir)
    .map((meta) => {
      try {
        const raw = fs.readFileSync(path.join(dir, meta.filename), 'utf-8');
        const parsed = parseSnapshotFile(raw);
        const content = parsed ? parsed.content : raw;
        const intent = parsed ? parsed.intent : meta.intent;
        const contentHash = parsed ? parsed.contentHash : meta.contentHash;
        return {
          sceneId,
          ts: meta.ts,
          content,
          intent,
          contentHash,
        } satisfies SceneVersion;
      } catch {
        return null;
      }
    })
    .filter((v): v is SceneVersion => v !== null);
}

/** Get one snapshot by ts. Returns null if not found or unreadable. */
export function getVersion(
  vaultRoot: string,
  sceneId: string,
  ts: string,
  options: { chapterRelPath: string },
): SceneVersion | null {
  assertSafeTs(ts);
  const dir = safeVersionsDir(vaultRoot, options.chapterRelPath, sceneId);
  const fullPath = path.join(dir, `${ts}.md`);
  if (!fs.existsSync(fullPath)) return null;
  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseSnapshotFile(raw);
    if (parsed) {
      return {
        sceneId,
        ts,
        content: parsed.content,
        intent: parsed.intent,
        contentHash: parsed.contentHash,
      };
    }
    return { sceneId, ts, content: raw, intent: 'save', contentHash: sha256Hex(raw) };
  } catch {
    return null;
  }
}

/**
 * Roll back: snapshot the caller-provided `currentContent` as a `pre-rollback`
 * version, then return the target snapshot for the caller to write back to
 * the scene file. Two-step so the snapshot writer and the scene file writer
 * stay decoupled.
 */
export function rollbackVersion(
  vaultRoot: string,
  sceneId: string,
  ts: string,
  currentContent: string,
  options: { chapterRelPath: string },
): { restoredVersion: SceneVersion; preRollbackVersion: SceneVersion } {
  const target = getVersion(vaultRoot, sceneId, ts, options);
  if (!target) throw new Error(`Version not found for scene ${sceneId}: ${ts}`);
  const preRollbackVersion = saveVersion(vaultRoot, sceneId, currentContent, {
    chapterRelPath: options.chapterRelPath,
    intent: 'pre-rollback',
  });
  return { restoredVersion: target, preRollbackVersion };
}

// Exported for tests.
export const _internal = {
  VERSION_FENCE,
  DEFAULT_RETENTION,
  serializeSnapshotFile,
  parseSnapshotFile,
  sha256Hex,
};
