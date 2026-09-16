import type { Chapter, EntityEntry, EntityType, Scene, Story } from './types';
import { sanitizeVaultName } from '@mythos-writer/shared/vaultNameSanitizer';

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
    }
  /** SKY-11615: a whole chapter, for `[[Chapter Title]]` links that name no scene. */
  | {
      kind: 'chapter';
      label: string;
      storyId: string;
      chapterId: string;
      chapter: Chapter;
      story: Story;
    }
  /** SKY-11615: a Notes-Vault folder — opens as a board. */
  | {
      kind: 'folder';
      label: string;
      /** Vault-relative folder path, the same shape Boards navigates by. */
      folderPath: string;
    };

export interface CrossTabLinkContext {
  stories: Story[];
  entities: EntityEntry[];
  notePaths?: string[];
  /**
   * SKY-11615: vault-relative Notes-Vault FOLDER paths — the `isDirectory`
   * half of the same `listNotesVault()` result that yields `notePaths`, so
   * supplying it costs no extra IPC. Only `resolveWikiLinkTarget` reads it;
   * `resolveCrossTabLink` never resolves folders, which keeps the editors'
   * unresolved-link → create-note behaviour exactly as it was.
   */
  folderPaths?: string[];
  onNotify?: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

export interface CrossTabLinkResolution {
  status: 'none' | 'single' | 'ambiguous';
  rawTarget: string;
  matches: CrossTabLinkMatch[];
}

/** M9a (SKY-9822): exported so the References panel can type its rows. */
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
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

/**
 * Match `[[wiki-link]]` targets in raw markdown/prose. Shared by the
 * Backlinks card and the M9a References panel — global flag, so callers
 * must reset `lastIndex` before an `exec` loop (or use `matchAll`, which
 * clones the regex).
 */
export const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

export function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\.md$/i, '').replace(/\\/g, '/');
}

export function basenameNoExt(value: string): string {
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

/**
 * SKY-11615: chapter-level story targets. Deliberately a sibling of
 * `resolveScene` rather than a branch inside it — `[[scene: X]]` must keep
 * meaning "a scene", and the caller decides the scene-before-chapter order.
 */
function resolveChapter(value: string, stories: Story[]): CrossTabLinkMatch[] {
  const needle = normalize(value);
  if (!needle) return [];
  const matches: CrossTabLinkMatch[] = [];
  for (const story of stories) {
    for (const chapter of story.chapters) {
      if (normalize(chapter.title) === needle || basenameNoExt(chapter.path) === needle) {
        matches.push({
          kind: 'chapter',
          label: chapter.title,
          storyId: story.id,
          chapterId: chapter.id,
          chapter,
          story,
        });
      }
    }
  }
  return matches;
}

/**
 * SKY-11615: Notes-Vault folder targets. Matches the folder's own name or its
 * full vault-relative path, both case-insensitively — the mockup's vault walk
 * (`resolveWiki`, design-liquid-neon 6355) compares on the folder label only,
 * and the path form is the disambiguator for same-named folders.
 */
function resolveFolder(value: string, folderPaths: string[]): CrossTabLinkMatch[] {
  const needle = normalize(value);
  if (!needle) return [];
  const matches: CrossTabLinkMatch[] = [];
  for (const folderPath of folderPaths) {
    if (normalize(folderPath) !== needle && basenameNoExt(folderPath) !== needle) continue;
    const posix = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
    matches.push({
      kind: 'folder',
      label: posix.split('/').pop() ?? posix,
      folderPath: posix,
    });
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

// ─── Wiki-link title index (SKY-5702: resolved/unresolved inline styling) ───

export interface WikiLinkTitleIndexContext {
  stories: Story[];
  entities: EntityEntry[];
  notePaths?: string[];
}

/**
 * Build a flat set of normalized, resolvable stems (entity names/aliases,
 * note path stems, scene titles/path stems) across both vaults. Cheap O(1)
 * membership checks let the editor mark [[wiki links]] as unresolved without
 * re-running full cross-tab resolution on every decoration pass.
 */
export function buildWikiLinkTitleIndex(context: WikiLinkTitleIndexContext): Set<string> {
  const titles = new Set<string>();
  for (const entity of context.entities) {
    titles.add(normalize(entity.name));
    for (const alias of entity.aliases ?? []) titles.add(normalize(alias));
    titles.add(basenameNoExt(entity.path));
  }
  for (const notePath of context.notePaths ?? []) {
    titles.add(basenameNoExt(notePath));
  }
  for (const story of context.stories) {
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) {
        titles.add(normalize(scene.title));
        titles.add(basenameNoExt(scene.path));
      }
    }
  }
  return titles;
}

export interface WikiLinkCandidate {
  /** Stable React key — not a persisted document id. */
  key: string;
  title: string;
  /** Entity type, 'scene', or 'other' for a plain note. */
  kind: string;
  vault: 'story' | 'notes';
}

/**
 * Build the flat, deduplicated list of linkable titles across both vaults for
 * the `[[` autocomplete popup (SKY-5702). Client-side and synchronous — built
 * from the same live `stories`/`entities`/`notePaths` state the app already
 * holds, so a note or scene created moments ago is linkable immediately
 * (unlike the FTS `searchVault` index, which only reindexes on vault-watcher
 * events and can lag behind just-created content).
 */
export function buildWikiLinkCandidates(context: WikiLinkTitleIndexContext): WikiLinkCandidate[] {
  const candidates: WikiLinkCandidate[] = [];
  const seenStems = new Set<string>();

  for (const entity of context.entities) {
    seenStems.add(normalize(entity.name));
    candidates.push({ key: `entity:${entity.id}`, title: entity.name, kind: entity.type, vault: 'notes' });
  }
  for (const notePath of context.notePaths ?? []) {
    const stem = basenameNoExt(notePath);
    if (seenStems.has(stem)) continue; // an entity already covers this title
    seenStems.add(stem);
    const title = notePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ?? notePath;
    candidates.push({ key: `note:${notePath}`, title, kind: 'other', vault: 'notes' });
  }
  for (const story of context.stories) {
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) {
        candidates.push({ key: `scene:${scene.id}`, title: scene.title, kind: 'scene', vault: 'story' });
      }
    }
  }

  return candidates;
}

/** True if `rawTarget` (a wikiLink node's `target` attr) resolves to a known title. */
export function isWikiLinkTargetResolved(rawTarget: string, titleIndex: ReadonlySet<string>): boolean {
  const stem = rawTarget.split('#')[0].split('|')[0].trim();
  const typed = parseTypedTarget(stem);
  const needle = normalize(typed ? typed.value : stem);
  if (!needle) return true; // empty target — nothing to flag as broken
  return titleIndex.has(needle);
}

// ─── M16 (Beta 3): wiki-link kind styling + unresolved-click note creation ───

/**
 * Normalized stems that resolve to STORY scenes. Fed to the editors alongside
 * the resolved-title index so [[scene links]] render gold (prototype #ffd319)
 * while note links keep the slot-B purple — Liquid Neon `mkLink` parity.
 */
export function buildSceneWikiLinkTitleIndex(stories: Story[]): Set<string> {
  const titles = new Set<string>();
  for (const story of stories) {
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) {
        titles.add(normalize(scene.title));
        titles.add(basenameNoExt(scene.path));
      }
    }
  }
  return titles;
}

/** The display stem of a wiki-link target: strips `#heading` anchors and `|alias` suffixes. */
export function wikiLinkTargetStem(rawTarget: string): string {
  return rawTarget.split('#')[0].split('|')[0].trim();
}

/**
 * Notes-Vault-relative path for a note created from an unresolved [[link]]
 * (Obsidian parity: clicking a dashed link creates the note). Filesystem-hostile
 * characters are replaced so the write cannot escape or fail on any OS.
 */
export function notePathForUnresolvedLink(rawTarget: string): string | null {
  const stem = wikiLinkTargetStem(rawTarget);
  if (!stem || /^\.+$/.test(stem)) return null;
  const fileName = sanitizeVaultName(stem.replace(/\s+/g, ' ').trim());
  if (!fileName) return null;
  return `${fileName}.md`;
}

/**
 * Markdown for a just-created wiki-link note — same frontmatter contract as
 * the M15 template notes (quoted `title:` + `createdAt:`), no `type:` since
 * an unresolved link carries no entity kind.
 */
export function buildUnresolvedLinkNote(rawTarget: string, now: string = new Date().toISOString()): string {
  const stem = wikiLinkTargetStem(rawTarget);
  return [
    '---',
    `title: "${stem.replace(/"/g, "'")}"`,
    `createdAt: ${now}`,
    '---',
    '',
    `# ${stem}`,
    '',
    '',
  ].join('\n');
}

/** Stable list key for a match, exhaustive over the union so a new kind is a
 *  compile error here rather than a duplicate React key at runtime. */
export function crossTabLinkMatchKey(match: CrossTabLinkMatch): string {
  switch (match.kind) {
    case 'scene': return `scene-${match.sceneId}`;
    case 'chapter': return `chapter-${match.chapterId}`;
    case 'entity': return `entity-${match.entityId}`;
    case 'folder': return `folder-${match.folderPath}`;
  }
}

// ─── SKY-11615: plain-text [[wiki link]] segments + single-target resolution ──

export type WikiSegment =
  | { isLink: false; text: string }
  | { isLink: true; raw: string; target: string };

/**
 * Split prose into plain-text and `[[link]]` segments — port of the design
 * mockup's `wikiSegs` (design-liquid-neon 6335). Used by surfaces that render
 * a raw string rather than a ProseMirror document (Timeline event cards and
 * the Inspector's event summary), where the editor's decoration plugin has
 * nothing to attach to.
 */
export function parseWikiSegments(text: string): WikiSegment[] {
  const source = String(text ?? '');
  const segments: WikiSegment[] = [];
  const re = new RegExp(WIKI_LINK_RE.source, 'g'); // own lastIndex, safe to loop
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    if (match.index > last) segments.push({ isLink: false, text: source.slice(last, match.index) });
    segments.push({ isLink: true, raw: match[0], target: match[1] });
    last = match.index + match[0].length;
  }
  if (last < source.length) segments.push({ isLink: false, text: source.slice(last) });
  return segments;
}

/**
 * What a `[[link]]` reads as on screen — port of the mockup's `wikiDisp`
 * (design-liquid-neon 6347): an alias replaces the name outright, a heading
 * anchor renders as `Name › Heading`, and a bare `[[#Heading]]` shows just the
 * heading. The separator is the mockup's `›`, not a plain `>`.
 */
export function wikiLinkDisplayText(target: string): string {
  const raw = String(target ?? '');
  if (raw.includes('|')) return raw.split('|').slice(1).join('|').trim();
  const hash = raw.indexOf('#');
  if (hash === 0) return raw.slice(1).trim();
  if (hash > 0) return `${raw.slice(0, hash).trim()} › ${raw.slice(hash + 1).trim()}`;
  return raw.trim();
}

/**
 * Resolve one `[[link]]` to a single navigable target in the product's
 * documented order: story scene → story chapter → vault note → vault folder →
 * unresolved (SKY-11594 AC / mockup `resolveWiki`). Ambiguity is resolved by
 * that order rather than surfaced as a picker, because a link inside prose has
 * to paint one colour.
 *
 * Reuses the same matchers the editors run — `resolveUntypedStem` for scenes
 * and notes — so a link that resolves here resolves identically everywhere.
 * Returns null when nothing matches, including for a bare `[[#Heading]]`,
 * which is an in-document anchor with no target of its own.
 */
export function resolveWikiLinkTarget(
  rawTarget: string,
  context: CrossTabLinkContext,
): CrossTabLinkMatch | null {
  const stem = wikiLinkTargetStem(rawTarget);
  if (!stem) return null;

  const untyped = resolveUntypedStem(stem, context);
  const scene = untyped.find((match) => match.kind === 'scene');
  if (scene) return scene;

  const chapter = resolveChapter(stem, context.stories)[0];
  if (chapter) return chapter;

  const note = untyped.find((match) => match.kind === 'entity');
  if (note) return note;

  return resolveFolder(stem, context.folderPaths ?? [])[0] ?? null;
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
