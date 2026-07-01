import type { Chapter, EntityEntry, EntityType, Scene, Story } from './types';

export type CrossTabLinkMatch =
  | {
      kind: 'scene';
      label: string;
      storyId: string;
      chapterId: string;
      sceneId: string;
      scene: Scene;
      chapter: Chapter;
      story: Story;
    }
  | {
      kind: 'entity';
      label: string;
      entityId: string;
      entityPath: string;
      entity: EntityEntry;
    };

export interface CrossTabLinkContext {
  stories: Story[];
  entities: EntityEntry[];
  notePaths?: string[];
  onNotify?: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

export interface CrossTabLinkResolution {
  status: 'none' | 'single' | 'ambiguous';
  rawTarget: string;
  matches: CrossTabLinkMatch[];
}

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  character: 'Character',
  location: 'Location',
  faction: 'Faction',
  item: 'Item',
  event: 'Event',
  concept: 'Concept',
  other: 'Entity',
};

const ENTITY_TYPE_ALIASES: Record<string, EntityType> = {
  character: 'character',
  characters: 'character',
  location: 'location',
  locations: 'location',
  faction: 'faction',
  factions: 'faction',
  item: 'item',
  items: 'item',
  event: 'event',
  events: 'event',
  concept: 'concept',
  concepts: 'concept',
  entity: 'other',
  entities: 'other',
  other: 'other',
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\.md$/i, '').replace(/\\/g, '/');
}

function basenameNoExt(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return normalize(normalized.split('/').pop() ?? normalized);
}

function parseTypedTarget(rawTarget: string): { type: string; value: string } | null {
  const match = rawTarget.trim().match(/^([^:]+):\s*(.+)$/);
  if (!match) return null;
  return { type: match[1].trim(), value: match[2].trim() };
}

function resolveScene(value: string, stories: Story[]): CrossTabLinkMatch[] {
  const normalized = normalize(value);
  const parts = normalized.split('/').filter(Boolean);
  const sceneName = parts[parts.length - 1] ?? normalized;
  const chapterName = parts.length > 1 ? parts[parts.length - 2] : null;

  const matches: CrossTabLinkMatch[] = [];
  for (const story of stories) {
    for (const chapter of story.chapters) {
      const chapterMatches = !chapterName || normalize(chapter.title) === chapterName || basenameNoExt(chapter.path) === chapterName;
      if (!chapterMatches) continue;
      for (const scene of chapter.scenes) {
        const sceneMatches = normalize(scene.title) === sceneName || basenameNoExt(scene.path) === sceneName || normalize(scene.path).endsWith(normalized);
        if (sceneMatches) {
          matches.push({
            kind: 'scene',
            label: `${chapter.title} / ${scene.title}`,
            storyId: story.id,
            chapterId: chapter.id,
            sceneId: scene.id,
            scene,
            chapter,
            story,
          });
        }
      }
    }
  }
  return matches;
}

function resolveEntity(typeLabel: string, value: string, entities: EntityEntry[], notePaths: string[] = []): CrossTabLinkMatch[] {
  const entityType = ENTITY_TYPE_ALIASES[normalize(typeLabel)];
  if (!entityType) return [];
  const needle = normalize(value);
  const matches = entities
    .filter((entity) => {
      const typeMatches = entityType === 'other' ? true : entity.type === entityType;
      if (!typeMatches) return false;
      if (normalize(entity.name) === needle) return true;
      if (basenameNoExt(entity.path) === needle) return true;
      return (entity.aliases ?? []).some((alias) => normalize(alias) === needle);
    })
    .map((entity) => ({
      kind: 'entity' as const,
      label: `${ENTITY_TYPE_LABELS[entity.type]}: ${entity.name}`,
      entityId: entity.id,
      entityPath: entity.path,
      entity,
    }));

  const seenPaths = new Set(matches.map((match) => normalize(match.entityPath)));
  const allowedDirs = entityType === 'other'
    ? []
    : [entityType, `${entityType}s`];
  const noteMatches = notePaths
    .filter((notePath) => notePath.toLowerCase().endsWith('.md'))
    .filter((notePath) => basenameNoExt(notePath) === needle)
    .filter((notePath) => {
      if (entityType === 'other') return true;
      const segments = normalize(notePath).split('/');
      return segments.some((segment) => allowedDirs.includes(segment));
    })
    .filter((notePath) => !seenPaths.has(normalize(notePath)))
    .map((notePath) => {
      const name = notePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ?? value;
      const entity: EntityEntry = {
        id: `note:${notePath}`,
        name,
        type: entityType,
        path: notePath,
        createdAt: '',
        updatedAt: '',
      };
      return {
        kind: 'entity' as const,
        label: `${ENTITY_TYPE_LABELS[entity.type]}: ${entity.name}`,
        entityId: entity.id,
        entityPath: entity.path,
        entity,
      };
    });

  const combined = [...matches, ...noteMatches];
  if (combined.length > 0) return combined;

  const fallbackDirs: Record<EntityType, string> = {
    character: 'Characters',
    location: 'Locations',
    faction: 'Factions',
    item: 'Items',
    event: 'Events',
    concept: 'Concepts',
    other: 'Entities',
  };
  const fallbackName = value.trim().replace(/[\\/]/g, '-');
  const fallbackPath = `${fallbackDirs[entityType]}/${fallbackName}.md`;
  const fallbackEntity: EntityEntry = {
    id: `note:${fallbackPath}`,
    name: value.trim(),
    type: entityType,
    path: fallbackPath,
    createdAt: '',
    updatedAt: '',
  };
  return [{
    kind: 'entity' as const,
    label: `${ENTITY_TYPE_LABELS[fallbackEntity.type]}: ${fallbackEntity.name}`,
    entityId: fallbackEntity.id,
    entityPath: fallbackEntity.path,
    entity: fallbackEntity,
  }];
}

function resolveUntypedStem(rawTarget: string, context: CrossTabLinkContext): CrossTabLinkMatch[] {
  // Strip [[stem#heading]] anchor and [[stem|alias]] alias before matching.
  const stem = rawTarget.split('#')[0].split('|')[0].trim();
  const needle = normalize(stem);

  const matches: CrossTabLinkMatch[] = [];
  const seenEntityIds = new Set<string>();

  // 1. Entity name / alias exact match (any entity type, case-insensitive).
  for (const entity of context.entities) {
    const names = [entity.name, ...(entity.aliases ?? [])].map((n) => normalize(n));
    if (names.includes(needle) || basenameNoExt(entity.path) === needle) {
      if (!seenEntityIds.has(entity.id)) {
        seenEntityIds.add(entity.id);
        matches.push({
          kind: 'entity',
          label: `${ENTITY_TYPE_LABELS[entity.type]}: ${entity.name}`,
          entityId: entity.id,
          entityPath: entity.path,
          entity,
        });
      }
    }
  }

  // 2. Plain note path stem match — only when no entity matched above.
  if (matches.length === 0) {
    for (const notePath of context.notePaths ?? []) {
      if (basenameNoExt(notePath) === needle) {
        const id = `note:${notePath}`;
        if (!seenEntityIds.has(id)) {
          seenEntityIds.add(id);
          const name = notePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ?? stem;
          const entity: EntityEntry = { id, name, type: 'other', path: notePath, createdAt: '', updatedAt: '' };
          matches.push({
            kind: 'entity',
            label: entity.name,
            entityId: id,
            entityPath: notePath,
            entity,
          });
        }
      }
    }
  }

  // 3. Story scene title or filename stem match (always checked — can produce ambiguity with entity).
  for (const story of context.stories) {
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) {
        if (normalize(scene.title) === needle || basenameNoExt(scene.path) === needle) {
          matches.push({
            kind: 'scene',
            label: `${chapter.title} / ${scene.title}`,
            storyId: story.id,
            chapterId: chapter.id,
            sceneId: scene.id,
            scene,
            chapter,
            story,
          });
        }
      }
    }
  }

  return matches;
}

export function resolveCrossTabLink(rawTarget: string, context: CrossTabLinkContext): CrossTabLinkResolution {
  const typed = parseTypedTarget(rawTarget);
  if (!typed) {
    const matches = resolveUntypedStem(rawTarget, context);
    if (matches.length === 0) {
      context.onNotify?.(`No note or scene found for "[[${rawTarget}]]"`, 'warn');
      return { status: 'none', rawTarget, matches: [] };
    }
    return {
      status: matches.length === 1 ? 'single' : 'ambiguous',
      rawTarget,
      matches,
    };
  }

  const matches = normalize(typed.type) === 'scene'
    ? resolveScene(typed.value, context.stories)
    : resolveEntity(typed.type, typed.value, context.entities, context.notePaths);

  return {
    status: matches.length === 0 ? 'none' : matches.length === 1 ? 'single' : 'ambiguous',
    rawTarget,
    matches,
  };
}
