// Runtime structural validator for ManifestV1.
// No external deps — type guards + shape checks only.
import type {
  ManifestV1,
  ManifestSceneEntry,
  ManifestEntityEntry,
  SuggestionRef,
  ProvenanceEntry,
  BoardRef,
} from './types.js';

export class ManifestValidationError extends Error {
  constructor(public readonly field: string, detail: string) {
    super(`ManifestV1 validation failed at "${field}": ${detail}`);
    this.name = 'ManifestValidationError';
  }
}

function assertString(val: unknown, field: string): string {
  if (typeof val !== 'string') throw new ManifestValidationError(field, `expected string, got ${typeof val}`);
  return val;
}

function assertNumber(val: unknown, field: string): number {
  if (typeof val !== 'number') throw new ManifestValidationError(field, `expected number, got ${typeof val}`);
  return val;
}

function assertArray(val: unknown, field: string): unknown[] {
  if (!Array.isArray(val)) throw new ManifestValidationError(field, `expected array, got ${typeof val}`);
  return val;
}

function validateScene(raw: unknown, idx: number): ManifestSceneEntry {
  const o = raw as Record<string, unknown>;
  assertString(o.id, `scenes[${idx}].id`);
  assertString(o.path, `scenes[${idx}].path`);
  assertString(o.title, `scenes[${idx}].title`);
  assertNumber(o.order, `scenes[${idx}].order`);
  assertString(o.createdAt, `scenes[${idx}].createdAt`);
  assertString(o.updatedAt, `scenes[${idx}].updatedAt`);
  return o as unknown as ManifestSceneEntry;
}

function validateEntity(raw: unknown, idx: number): ManifestEntityEntry {
  const o = raw as Record<string, unknown>;
  assertString(o.id, `entities[${idx}].id`);
  assertString(o.name, `entities[${idx}].name`);
  assertString(o.path, `entities[${idx}].path`);
  const validTypes = ['character', 'location', 'faction', 'item', 'event', 'concept', 'other'];
  if (!validTypes.includes(o.type as string))
    throw new ManifestValidationError(`entities[${idx}].type`, `must be one of ${validTypes.join(', ')}`);
  assertString(o.createdAt, `entities[${idx}].createdAt`);
  assertString(o.updatedAt, `entities[${idx}].updatedAt`);
  return o as unknown as ManifestEntityEntry;
}

function validateSuggestionRef(raw: unknown, idx: number): SuggestionRef {
  const o = raw as Record<string, unknown>;
  assertString(o.id, `suggestions[${idx}].id`);
  const validStatuses = ['proposed', 'accepted', 'dismissed', 'applied', 'rolled_back'];
  if (!validStatuses.includes(o.status as string))
    throw new ManifestValidationError(`suggestions[${idx}].status`, `must be one of ${validStatuses.join(', ')}`);
  return o as unknown as SuggestionRef;
}

function validateProvenance(raw: unknown, idx: number): ProvenanceEntry {
  const o = raw as Record<string, unknown>;
  assertString(o.vaultPath, `provenance[${idx}].vaultPath`);
  assertString(o.createdAt, `provenance[${idx}].createdAt`);
  return o as unknown as ProvenanceEntry;
}

function validateBoardRef(raw: unknown, idx: number): BoardRef {
  const o = raw as Record<string, unknown>;
  assertString(o.id, `boards[${idx}].id`);
  assertString(o.path, `boards[${idx}].path`);
  assertString(o.updatedAt, `boards[${idx}].updatedAt`);
  return o as unknown as BoardRef;
}

/**
 * Validate that `raw` is a structurally-valid ManifestV1.
 * Throws ManifestValidationError on the first structural violation found.
 */
export function validateManifestV1(raw: unknown): ManifestV1 {
  if (typeof raw !== 'object' || raw === null)
    throw new ManifestValidationError('root', 'expected object');
  const o = raw as Record<string, unknown>;

  if (o.schemaVersion !== 1)
    throw new ManifestValidationError('schemaVersion', `expected 1, got ${o.schemaVersion}`);
  assertString(o.version, 'version');
  assertString(o.vaultRoot, 'vaultRoot');

  assertArray(o.scenes, 'scenes').forEach((s, i) => validateScene(s, i));
  assertArray(o.entities, 'entities').forEach((e, i) => validateEntity(e, i));
  assertArray(o.suggestions, 'suggestions').forEach((s, i) => validateSuggestionRef(s, i));
  assertArray(o.provenance, 'provenance').forEach((p, i) => validateProvenance(p, i));
  assertArray(o.boards, 'boards').forEach((b, i) => validateBoardRef(b, i));

  return o as unknown as ManifestV1;
}

/** Construct a fresh empty ManifestV1 for a given vault root. */
export function emptyManifestV1(vaultRoot: string): ManifestV1 {
  return {
    schemaVersion: 1,
    version: '1.0.0',
    vaultRoot,
    scenes: [],
    entities: [],
    suggestions: [],
    provenance: [],
    boards: [],
    timeline: [],
  };
}
