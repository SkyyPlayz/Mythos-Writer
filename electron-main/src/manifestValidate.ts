// MYT-792: runtime schema validation for renderer-supplied Manifest payloads.
//
// `vault:manifest:write` accepts the entire Manifest from the renderer and
// persists it verbatim. Downstream handlers (scene/chapter/entity CRUD,
// archive scan, FTS rebuild) then read those fields back as canonical
// metadata. A buggy or compromised renderer can stuff arbitrary values into
// the manifest unless we validate at the IPC boundary. This module is that
// boundary — call assertValidManifest() before persisting any renderer-
// supplied manifest.
//
// Defence-in-depth: callers may also invoke assertValidManifest() on the
// result of readManifest() to detect tampering with manifest.json on disk.
import type { Manifest } from './ipc.js';
import { SCHEMA_VERSION } from './manifest.js';

// ─── Bounds ───
// These are deliberately generous — a real writer's vault sits well under
// any of these, but a malicious renderer trying to OOM the next reindex
// will overshoot them by orders of magnitude.

export const LIMITS = {
  versionMaxLen: 64,
  vaultRootMaxLen: 4096,
  pathMaxLen: 1024,
  stringFieldMaxLen: 4096,
  storiesMax: 50_000,
  entitiesMax: 100_000,
  suggestionsMax: 200_000,
  scenesMax: 200_000,
  chaptersMax: 100_000,
  boardReferencesMax: 100_000,
  provenanceMax: 200_000,
  aliasesMax: 256,
  tagsMax: 256,
  blocksMax: 5_000,
} as const;

export class ManifestValidationError extends Error {
  readonly field: string;
  readonly reason: string;
  constructor(field: string, reason: string) {
    super(`Manifest validation failed at ${field}: ${reason}`);
    this.name = 'ManifestValidationError';
    this.field = field;
    this.reason = reason;
  }
}

const ABSOLUTE_PATH_RE = /^(?:[/\\]|[A-Za-z]:[/\\])/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureString(value: unknown, field: string, maxLen: number = LIMITS.stringFieldMaxLen): string {
  if (typeof value !== 'string') {
    throw new ManifestValidationError(field, `expected string, got ${typeof value}`);
  }
  if (value.length > maxLen) {
    throw new ManifestValidationError(field, `string exceeds ${maxLen} chars (${value.length})`);
  }
  return value;
}

function ensureOptionalString(value: unknown, field: string, maxLen: number = LIMITS.stringFieldMaxLen): void {
  if (value === undefined || value === null) return;
  ensureString(value, field, maxLen);
}

function ensureFiniteNumber(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ManifestValidationError(field, `expected finite number, got ${typeof value}`);
  }
}

function ensureArray(value: unknown, field: string, maxLen: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new ManifestValidationError(field, `expected array, got ${Array.isArray(value) ? 'array' : typeof value}`);
  }
  if (value.length > maxLen) {
    throw new ManifestValidationError(field, `array length ${value.length} exceeds cap ${maxLen}`);
  }
  return value;
}

function ensureOptionalStringArray(value: unknown, field: string, maxLen: number): void {
  if (value === undefined || value === null) return;
  const arr = ensureArray(value, field, maxLen);
  for (let i = 0; i < arr.length; i++) ensureString(arr[i], `${field}[${i}]`, LIMITS.stringFieldMaxLen);
}

/**
 * Syntactic check for vault-relative paths recorded in the manifest.
 * Rejects absolute paths, `..` traversal segments, embedded NUL bytes, and
 * over-long strings. If `mustEndIn` is provided, the path must end with that
 * extension (case-insensitive). Empty paths are rejected.
 *
 * NOTE: this is a lightweight syntactic check — actual containment is still
 * enforced by realSafePath() in vault.ts whenever the path is dereferenced.
 * The check exists to keep junk and clearly-malicious values out of the
 * manifest in the first place.
 */
function ensureVaultPath(value: unknown, field: string, mustEndIn?: string): void {
  const p = ensureString(value, field, LIMITS.pathMaxLen);
  if (p.length === 0) {
    throw new ManifestValidationError(field, 'path must not be empty');
  }
  if (p.includes('\0')) {
    throw new ManifestValidationError(field, 'path contains NUL byte');
  }
  if (ABSOLUTE_PATH_RE.test(p)) {
    throw new ManifestValidationError(field, 'path must be vault-relative, not absolute');
  }
  for (const segment of p.split(/[/\\]/)) {
    if (segment === '..') {
      throw new ManifestValidationError(field, "path contains '..' traversal segment");
    }
  }
  if (mustEndIn && !p.toLowerCase().endsWith(mustEndIn)) {
    throw new ManifestValidationError(field, `path must end in ${mustEndIn}`);
  }
}

function validateBlock(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new ManifestValidationError(field, 'block must be an object');
  }
  ensureString(value.id, `${field}.id`);
  ensureString(value.type, `${field}.type`, 32);
  ensureFiniteNumber(value.order, `${field}.order`);
  ensureString(value.content, `${field}.content`, 5 * 1024 * 1024); // 5 MB hard cap per block
  ensureString(value.updatedAt, `${field}.updatedAt`);
}

function validateSceneEntry(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new ManifestValidationError(field, 'scene entry must be an object');
  }
  ensureString(value.id, `${field}.id`);
  ensureString(value.title, `${field}.title`);
  ensureVaultPath(value.path, `${field}.path`, '.md');
  ensureFiniteNumber(value.order, `${field}.order`);
  ensureOptionalString(value.chapterId, `${field}.chapterId`);
  ensureOptionalString(value.storyId, `${field}.storyId`);
  ensureOptionalString(value.currentDraftId, `${field}.currentDraftId`);
  const blocks = ensureArray(value.blocks, `${field}.blocks`, LIMITS.blocksMax);
  for (let i = 0; i < blocks.length; i++) validateBlock(blocks[i], `${field}.blocks[${i}]`);
  ensureString(value.createdAt, `${field}.createdAt`);
  ensureString(value.updatedAt, `${field}.updatedAt`);
}

function validateChapterEntry(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new ManifestValidationError(field, 'chapter entry must be an object');
  }
  ensureString(value.id, `${field}.id`);
  ensureString(value.title, `${field}.title`);
  ensureVaultPath(value.path, `${field}.path`);
  ensureFiniteNumber(value.order, `${field}.order`);
  const scenes = ensureArray(value.scenes, `${field}.scenes`, LIMITS.scenesMax);
  for (let i = 0; i < scenes.length; i++) validateSceneEntry(scenes[i], `${field}.scenes[${i}]`);
  ensureString(value.createdAt, `${field}.createdAt`);
  ensureString(value.updatedAt, `${field}.updatedAt`);
}

function validateStoryEntry(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new ManifestValidationError(field, 'story entry must be an object');
  }
  ensureString(value.id, `${field}.id`);
  ensureString(value.title, `${field}.title`);
  ensureOptionalString(value.synopsis, `${field}.synopsis`, 64 * 1024);
  ensureVaultPath(value.path, `${field}.path`);
  const chapters = ensureArray(value.chapters, `${field}.chapters`, LIMITS.chaptersMax);
  for (let i = 0; i < chapters.length; i++) validateChapterEntry(chapters[i], `${field}.chapters[${i}]`);
  ensureString(value.createdAt, `${field}.createdAt`);
  ensureString(value.updatedAt, `${field}.updatedAt`);
}

function validateEntityEntry(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new ManifestValidationError(field, 'entity entry must be an object');
  }
  ensureString(value.id, `${field}.id`);
  ensureString(value.name, `${field}.name`);
  ensureString(value.type, `${field}.type`, 32);
  ensureVaultPath(value.path, `${field}.path`, '.md');
  ensureOptionalStringArray(value.aliases, `${field}.aliases`, LIMITS.aliasesMax);
  ensureOptionalStringArray(value.tags, `${field}.tags`, LIMITS.tagsMax);
  ensureString(value.createdAt, `${field}.createdAt`);
  ensureString(value.updatedAt, `${field}.updatedAt`);
}

function validateSuggestionEntry(value: unknown, field: string): void {
  if (!isPlainObject(value)) {
    throw new ManifestValidationError(field, 'suggestion entry must be an object');
  }
  ensureString(value.id, `${field}.id`);
  ensureString(value.source, `${field}.source`);
  ensureString(value.status, `${field}.status`, 32);
  ensureFiniteNumber(value.confidence, `${field}.confidence`);
  ensureString(value.rationale, `${field}.rationale`, 16 * 1024);
  ensureString(value.timestamp, `${field}.timestamp`);
  // targetPath is an optional vault-relative path; we do not require .md
  // because it can refer to a directory (chapter/story).
  if (value.targetPath !== undefined && value.targetPath !== null) {
    ensureVaultPath(value.targetPath, `${field}.targetPath`);
  }
  ensureOptionalString(value.targetId, `${field}.targetId`);
}

/**
 * Validate a renderer-supplied Manifest. Throws ManifestValidationError on the
 * first invalid field — callers should not catch and continue: persisting a
 * partially-validated manifest is the bug we're trying to prevent.
 *
 * Returns the same reference for chaining (Manifest), but does not deep-copy.
 */
export function assertValidManifest(value: unknown): Manifest {
  if (!isPlainObject(value)) {
    throw new ManifestValidationError('manifest', `expected object, got ${value === null ? 'null' : typeof value}`);
  }

  // schemaVersion must match this build's SCHEMA_VERSION exactly. Accepting a
  // smaller value would let a renderer fake a "needs migration" state and
  // bypass future migration logic; accepting a larger value would let it
  // pretend to be from a newer build and skip migrations entirely.
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new ManifestValidationError(
      'manifest.schemaVersion',
      `expected ${SCHEMA_VERSION}, got ${JSON.stringify(value.schemaVersion)}`
    );
  }

  ensureString(value.version, 'manifest.version', LIMITS.versionMaxLen);
  ensureString(value.vaultRoot, 'manifest.vaultRoot', LIMITS.vaultRootMaxLen);

  const stories = ensureArray(value.stories, 'manifest.stories', LIMITS.storiesMax);
  for (let i = 0; i < stories.length; i++) validateStoryEntry(stories[i], `manifest.stories[${i}]`);

  const entities = ensureArray(value.entities, 'manifest.entities', LIMITS.entitiesMax);
  for (let i = 0; i < entities.length; i++) validateEntityEntry(entities[i], `manifest.entities[${i}]`);

  const suggestions = ensureArray(value.suggestions, 'manifest.suggestions', LIMITS.suggestionsMax);
  for (let i = 0; i < suggestions.length; i++) validateSuggestionEntry(suggestions[i], `manifest.suggestions[${i}]`);

  const scenes = ensureArray(value.scenes, 'manifest.scenes', LIMITS.scenesMax);
  for (let i = 0; i < scenes.length; i++) validateSceneEntry(scenes[i], `manifest.scenes[${i}]`);

  const chapters = ensureArray(value.chapters, 'manifest.chapters', LIMITS.chaptersMax);
  for (let i = 0; i < chapters.length; i++) validateChapterEntry(chapters[i], `manifest.chapters[${i}]`);

  if (!isPlainObject(value.provenance)) {
    throw new ManifestValidationError('manifest.provenance', 'expected object');
  }
  const provEntries = Object.entries(value.provenance);
  if (provEntries.length > LIMITS.provenanceMax) {
    throw new ManifestValidationError(
      'manifest.provenance',
      `entry count ${provEntries.length} exceeds cap ${LIMITS.provenanceMax}`
    );
  }
  for (const [k, v] of provEntries) {
    ensureString(k, `manifest.provenance.<key>`);
    ensureVaultPath(v, `manifest.provenance[${k}]`);
  }

  const boardRefs = ensureArray(value.boardReferences, 'manifest.boardReferences', LIMITS.boardReferencesMax);
  for (let i = 0; i < boardRefs.length; i++) {
    ensureVaultPath(boardRefs[i], `manifest.boardReferences[${i}]`);
  }

  return value as unknown as Manifest;
}
