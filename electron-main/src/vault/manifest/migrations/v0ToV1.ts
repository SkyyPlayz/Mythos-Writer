// v0 → v1 migration for manifest.json.
// v0 is any manifest.json that lacks schemaVersion or has schemaVersion 0.
// It may come from the old IPC Manifest shape (stories/chapters/scenes with blocks)
// or may be a partial/unknown structure — we coerce what we can and default the rest.

import type {
  ManifestV1,
  ManifestSceneEntry,
  ManifestEntityEntry,
  SuggestionRef,
  ProvenanceEntry,
  BoardRef,
} from '../types.js';

type Raw = Record<string, unknown>;

function coerceString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

function coerceIso(val: unknown): string {
  return typeof val === 'string' && !isNaN(Date.parse(val)) ? val : new Date().toISOString();
}

function coerceNumber(val: unknown, fallback = 0): number {
  return typeof val === 'number' ? val : fallback;
}

function coerceArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

function migrateScene(raw: Raw, idx: number): ManifestSceneEntry {
  return {
    id: coerceString(raw.id, `scene-${idx}`),
    path: coerceString(raw.path),
    title: coerceString(raw.title, `Scene ${idx + 1}`),
    chapter: typeof raw.chapterId === 'string' ? raw.chapterId : undefined,
    order: coerceNumber(raw.order, idx),
    timestamps: undefined,
    sceneCardRefs: undefined,
    createdAt: coerceIso(raw.createdAt),
    updatedAt: coerceIso(raw.updatedAt),
  };
}

function migrateEntity(raw: Raw, idx: number): ManifestEntityEntry {
  const validTypes = ['character', 'location', 'item', 'concept', 'other'] as const;
  type EType = typeof validTypes[number];
  const rawType = raw.type;
  const entityType: EType = validTypes.includes(rawType as EType) ? (rawType as EType) : 'other';
  return {
    id: coerceString(raw.id, `entity-${idx}`),
    name: coerceString(raw.name, `Entity ${idx + 1}`),
    type: entityType,
    path: coerceString(raw.path),
    aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((a) => typeof a === 'string') : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : undefined,
    createdAt: coerceIso(raw.createdAt),
    updatedAt: coerceIso(raw.updatedAt),
  };
}

function migrateSuggestions(raw: Raw[]): SuggestionRef[] {
  return raw.map((s, i) => {
    const validStatuses = ['proposed', 'accepted', 'dismissed', 'applied', 'rolled_back'] as const;
    type SStatus = typeof validStatuses[number];
    const status: SStatus = validStatuses.includes(s.status as SStatus) ? (s.status as SStatus) : 'proposed';
    return {
      id: coerceString(s.id, `sug-${i}`),
      status,
      targetPath: typeof s.targetPath === 'string' ? s.targetPath : undefined,
    };
  });
}

function migrateProvenance(rawProvenance: unknown): ProvenanceEntry[] {
  // Old format: Record<string, string> (suggestionId → vaultPath)
  if (typeof rawProvenance === 'object' && rawProvenance !== null && !Array.isArray(rawProvenance)) {
    return Object.entries(rawProvenance as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string')
      .map(([suggestionId, vaultPath]) => ({
        vaultPath: vaultPath as string,
        suggestionId,
        createdAt: new Date().toISOString(),
      }));
  }
  if (Array.isArray(rawProvenance)) {
    return (rawProvenance as Raw[]).map((p, i) => ({
      vaultPath: coerceString(p.vaultPath, `unknown-${i}`),
      suggestionId: typeof p.suggestionId === 'string' ? p.suggestionId : undefined,
      runId: typeof p.runId === 'string' ? p.runId : undefined,
      agentType: typeof p.agentType === 'string' ? p.agentType : undefined,
      createdAt: coerceIso(p.createdAt),
    }));
  }
  return [];
}

function migrateBoards(rawBoards: unknown): BoardRef[] {
  if (!Array.isArray(rawBoards)) return [];
  return (rawBoards as unknown[]).map((b, i) => {
    if (typeof b === 'string') {
      return { id: `board-${i}`, path: b, updatedAt: new Date().toISOString() };
    }
    const o = b as Raw;
    return {
      id: coerceString(o.id, `board-${i}`),
      path: coerceString(o.path),
      storyId: typeof o.storyId === 'string' ? o.storyId : undefined,
      title: typeof o.title === 'string' ? o.title : undefined,
      updatedAt: coerceIso(o.updatedAt),
    };
  });
}

/** Migrate any v0 manifest (schemaVersion absent or 0) to ManifestV1. */
export function migrateV0ToV1(raw: Raw): ManifestV1 {
  const rawScenes = coerceArray(raw.scenes) as Raw[];
  const rawEntities = coerceArray(raw.entities) as Raw[];
  const rawSuggestions = coerceArray(raw.suggestions) as Raw[];

  return {
    schemaVersion: 1,
    version: coerceString(raw.version, '1.0.0'),
    vaultRoot: coerceString(raw.vaultRoot),
    scenes: rawScenes.map((s, i) => migrateScene(s, i)),
    entities: rawEntities.map((e, i) => migrateEntity(e, i)),
    suggestions: migrateSuggestions(rawSuggestions),
    provenance: migrateProvenance(raw.provenance),
    boards: migrateBoards(raw.boardReferences ?? raw.boards),
    // Preserve legacy top-level list fields under unknowns
    stories: coerceArray(raw.stories),
    chapters: coerceArray(raw.chapters),
  };
}
