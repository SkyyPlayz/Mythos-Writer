// Entity CRUD service — Obsidian-compatible markdown in vault.
// Storage path: entities/<type>/<id>.md
// No Electron dependency; pure FS so it's fully testable in Node.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  writeVaultFileAtomic,
  readVaultFile,
  deleteVaultFile,
  parseFrontmatter,
  serializeFrontmatter,
  yamlInlineQuote,
} from './vault.js';
import type { EntityEntry, EntityRelation, EntityRelationship, EntityRelationshipRow, Manifest } from './ipc.js';
import { getReciprocal, parseRelationsBlock, serializeRelations, stripRelationsBlock } from './entityRelations.js';

// ─── Path helpers ───

export function entityRelPath(type: EntityEntry['type'], id: string): string {
  return `entities/${type}s/${id}.md`;
}

// ─── Frontmatter serialization for entities ───

interface EntityFrontmatter {
  id: string;
  name: string;
  type: EntityEntry['type'];
  aliases?: string[];
  tags?: string[];
  relations?: EntityRelation[];
  properties?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function serializeEntityFrontmatter(fm: EntityFrontmatter, prose: string): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${fm.id}`);
  lines.push(`name: ${fm.name}`);
  lines.push(`type: ${fm.type}`);
  // Write `aliases: []` even when empty so downstream readers (e.g. Linker)
  // can distinguish "no aliases defined yet" (undefined, no line) from
  // "migrated — confirmed no aliases" (explicit empty array).
  if (fm.aliases !== undefined) lines.push(`aliases: [${fm.aliases.map(yamlInlineQuote).join(', ')}]`);
  if (fm.tags?.length) lines.push(`tags: [${fm.tags.map(yamlInlineQuote).join(', ')}]`);
  if (fm.properties && Object.keys(fm.properties).length > 0) {
    for (const [k, v] of Object.entries(fm.properties)) {
      lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }
  lines.push(`createdAt: ${fm.createdAt}`);
  lines.push(`updatedAt: ${fm.updatedAt}`);
  if (fm.relations?.length) {
    lines.push('---', '');
    const relBlock = serializeRelations(fm.relations);
    return (
      lines.slice(0, -2).join('\n') +
      '\n' +
      relBlock +
      '---\n' +
      prose
    );
  }
  lines.push('---', '');
  return lines.join('\n') + prose;
}

function parseEntityFrontmatter(raw: string): { fm: EntityFrontmatter; prose: string } | null {
  // Extract raw frontmatter text between the --- delimiters.
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const rawFrontmatterText = fmMatch ? fmMatch[1] : '';

  // Parse relations from the block YAML before the standard parser strips them.
  const relations = parseRelationsBlock(rawFrontmatterText);

  // Strip the relations block so parseFrontmatter doesn't choke on multi-line YAML.
  const strippedRaw = stripRelationsBlock(raw);

  const { frontmatter, prose } = parseFrontmatter(strippedRaw);
  if (!frontmatter.id || !frontmatter.name || !frontmatter.type) return null;

  const knownKeys = new Set(['id', 'name', 'type', 'aliases', 'tags', 'createdAt', 'updatedAt']);
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (!knownKeys.has(k)) properties[k] = v;
  }

  return {
    fm: {
      id: String(frontmatter.id),
      name: String(frontmatter.name),
      type: frontmatter.type as EntityEntry['type'],
      aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : undefined,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : undefined,
      relations: relations.length > 0 ? relations : undefined,
      properties: Object.keys(properties).length > 0 ? properties : undefined,
      createdAt: String(frontmatter.createdAt ?? new Date().toISOString()),
      updatedAt: String(frontmatter.updatedAt ?? new Date().toISOString()),
    },
    prose,
  };
}

function fmToEntry(fm: EntityFrontmatter, relPath: string): EntityEntry {
  return {
    id: fm.id,
    name: fm.name,
    type: fm.type,
    path: relPath,
    aliases: fm.aliases,
    tags: fm.tags,
    relations: fm.relations,
    properties: fm.properties,
    createdAt: fm.createdAt,
    updatedAt: fm.updatedAt,
  };
}

// ─── CRUD ───

export function createEntity(
  vaultRoot: string,
  manifest: Manifest,
  opts: {
    name: string;
    type: EntityEntry['type'];
    aliases?: string[];
    tags?: string[];
    relations?: EntityRelation[];
    prose?: string;
    properties?: Record<string, unknown>;
  }
): EntityEntry {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const relPath = entityRelPath(opts.type, id);

  const fm: EntityFrontmatter = {
    id,
    name: opts.name,
    type: opts.type,
    aliases: opts.aliases?.length ? opts.aliases : undefined,
    tags: opts.tags?.length ? opts.tags : undefined,
    relations: opts.relations?.length ? opts.relations : undefined,
    properties: opts.properties && Object.keys(opts.properties).length > 0 ? opts.properties : undefined,
    createdAt: now,
    updatedAt: now,
  };

  const content = serializeEntityFrontmatter(fm, opts.prose ?? '');
  writeVaultFileAtomic(vaultRoot, relPath, content);

  const entry = fmToEntry(fm, relPath);

  // Update manifest
  manifest.entities = manifest.entities.filter((e) => e.id !== id);
  manifest.entities.push(entry);

  return entry;
}

export function readEntity(
  vaultRoot: string,
  manifest: Manifest,
  id: string
): EntityEntry | null {
  const entry = manifest.entities.find((e) => e.id === id);
  if (!entry) return null;

  try {
    const { content } = readVaultFile(vaultRoot, entry.path);
    const parsed = parseEntityFrontmatter(content);
    if (!parsed) return entry;
    return fmToEntry(parsed.fm, entry.path);
  } catch {
    return entry;
  }
}

export function updateEntity(
  vaultRoot: string,
  manifest: Manifest,
  id: string,
  changes: {
    name?: string;
    aliases?: string[];
    tags?: string[];
    relations?: EntityRelation[];
    prose?: string;
    properties?: Record<string, unknown>;
  }
): EntityEntry {
  const entry = manifest.entities.find((e) => e.id === id);
  if (!entry) throw new Error(`Entity not found: ${id}`);

  let existingProse = '';
  let existingFm: EntityFrontmatter = {
    id: entry.id,
    name: entry.name,
    type: entry.type,
    aliases: entry.aliases,
    tags: entry.tags,
    relations: entry.relations,
    properties: entry.properties,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };

  try {
    const { content } = readVaultFile(vaultRoot, entry.path);
    const parsed = parseEntityFrontmatter(content);
    if (parsed) {
      existingFm = parsed.fm;
      existingProse = parsed.prose;
    }
  } catch {
    // file missing — rewrite from manifest data
  }

  const updatedFm: EntityFrontmatter = {
    ...existingFm,
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.aliases !== undefined ? { aliases: changes.aliases } : {}),
    ...(changes.tags !== undefined ? { tags: changes.tags } : {}),
    ...(changes.relations !== undefined ? { relations: changes.relations } : {}),
    ...(changes.properties !== undefined ? { properties: changes.properties } : {}),
    updatedAt: new Date().toISOString(),
  };

  const prose = changes.prose !== undefined ? changes.prose : existingProse;
  const content = serializeEntityFrontmatter(updatedFm, prose);
  writeVaultFileAtomic(vaultRoot, entry.path, content);

  const updated = fmToEntry(updatedFm, entry.path);

  manifest.entities = manifest.entities.map((e) => (e.id === id ? updated : e));

  return updated;
}

// ─── Typed-relation apply (SKY-195 / SKY-901) ───
//
// Adds a forward relation to the source entity and its reciprocal to the target
// entity, writing both entity files. Idempotent: a relation already present is
// not re-added.
//
// If either entity is missing from the manifest (stale suggestion referencing a
// deleted entity), neither side is written — preserves referential integrity so
// no dangling relation pointing at a missing entity ends up persisted. The
// caller (suggestionsAccept) uses the returned write flags to downgrade the
// apply status from 'applied' to 'accepted' when nothing was persisted.
export function applyTypedRelation(
  vaultRoot: string,
  manifest: Manifest,
  payload: { relationType: string; sourceEntityId: string; targetEntityId: string },
): { sourceWritten: boolean; targetWritten: boolean } {
  const { relationType, sourceEntityId, targetEntityId } = payload;

  const sourceEntry = manifest.entities.find((e) => e.id === sourceEntityId);
  const targetEntry = manifest.entities.find((e) => e.id === targetEntityId);
  if (!sourceEntry || !targetEntry) {
    return { sourceWritten: false, targetWritten: false };
  }

  let sourceWritten = false;
  const sourceExisting = sourceEntry.relations ?? [];
  const sourceAlreadyHas = sourceExisting.some(
    (r) => r.type === relationType && r.target === targetEntityId,
  );
  if (!sourceAlreadyHas) {
    updateEntity(vaultRoot, manifest, sourceEntityId, {
      relations: [...sourceExisting, { type: relationType, target: targetEntityId }],
    });
    sourceWritten = true;
  }

  const reciprocal = getReciprocal(relationType);
  let targetWritten = false;
  // Re-read after the source updateEntity rebuilt the manifest entry — for
  // self-referential edge cases the target entry object may be stale.
  const refreshedTarget = manifest.entities.find((e) => e.id === targetEntityId);
  const targetExisting = refreshedTarget?.relations ?? [];
  const targetAlreadyHas = targetExisting.some(
    (r) => r.type === reciprocal && r.target === sourceEntityId,
  );
  if (!targetAlreadyHas) {
    updateEntity(vaultRoot, manifest, targetEntityId, {
      relations: [...targetExisting, { type: reciprocal, target: sourceEntityId }],
    });
    targetWritten = true;
  }

  return { sourceWritten, targetWritten };
}

export function deleteEntity(
  vaultRoot: string,
  manifest: Manifest,
  id: string
): { id: string; deleted: boolean } {
  const entry = manifest.entities.find((e) => e.id === id);
  if (!entry) return { id, deleted: false };

  let deleted = false;
  try {
    const result = deleteVaultFile(vaultRoot, entry.path);
    deleted = result.deleted;
  } catch {
    // ignore FS errors
  }

  manifest.entities = manifest.entities.filter((e) => e.id !== id);

  return { id, deleted };
}

export function listEntities(
  vaultRoot: string,
  manifest: Manifest,
  type?: EntityEntry['type']
): EntityEntry[] {
  let entries = manifest.entities;
  if (type) entries = entries.filter((e) => e.type === type);

  // Re-read each file to pick up any direct vault edits
  return entries.map((entry) => {
    try {
      const { content } = readVaultFile(vaultRoot, entry.path);
      const parsed = parseEntityFrontmatter(content);
      if (parsed) return fmToEntry(parsed.fm, entry.path);
    } catch {
      // file missing — return manifest data as-is
    }
    return entry;
  });
}

// ─── Backlinks: scan scene markdown files for entity name / alias mentions ───

export interface EntityBacklinkScene {
  sceneId: string;
  sceneTitle: string;
  scenePath: string;
  snippet: string;
}

export function getEntityBacklinks(
  vaultRoot: string,
  manifest: Manifest,
  entityId: string
): { entityId: string; scenes: EntityBacklinkScene[] } {
  const entity = manifest.entities.find((e) => e.id === entityId);
  if (!entity) return { entityId, scenes: [] };

  const names = [entity.name, ...(entity.aliases ?? [])].filter(Boolean);
  if (names.length === 0) return { entityId, scenes: [] };

  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wikiParts = names.map((n) => `\\[\\[${escape(n)}\\]\\]`);
  const plainParts = names.map((n) => `(?<![\\w])${escape(n)}(?![\\w])`);
  const pattern = new RegExp(`(${[...wikiParts, ...plainParts].join('|')})`, 'i');

  // Flatten all scenes from nested story/chapter/scene tree + flat fallback list
  const seen = new Set<string>();
  const allScenes: Array<{ id: string; title: string; path: string }> = [];
  for (const story of manifest.stories ?? []) {
    for (const chapter of story.chapters ?? []) {
      for (const scene of chapter.scenes ?? []) {
        if (!seen.has(scene.id)) {
          allScenes.push({ id: scene.id, title: scene.title, path: scene.path });
          seen.add(scene.id);
        }
      }
    }
  }
  for (const scene of manifest.scenes ?? []) {
    if (!seen.has(scene.id)) {
      allScenes.push({ id: scene.id, title: scene.title, path: scene.path });
      seen.add(scene.id);
    }
  }

  const results: EntityBacklinkScene[] = [];

  for (const scene of allScenes) {
    let content = '';
    try {
      ({ content } = readVaultFile(vaultRoot, scene.path));
    } catch {
      continue;
    }

    const match = pattern.exec(content);
    if (!match) continue;

    const idx = match.index;
    const start = Math.max(0, idx - 60);
    const end = Math.min(content.length, idx + match[0].length + 60);
    let snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
    if (start > 0) snippet = '…' + snippet;
    if (end < content.length) snippet += '…';

    results.push({ sceneId: scene.id, sceneTitle: scene.title, scenePath: scene.path, snippet });
  }

  return { entityId, scenes: results };
}

// ─── Migration: backfill aliases: [] on existing entity files ───
// Scans all entities in the manifest and writes `aliases: []` to any file
// that has no `aliases` field in its frontmatter.  This is idempotent and
// additive — files with existing aliases are untouched.
// Call once per vault open alongside reindexEntities.

export function migrateEntityAliases(
  vaultRoot: string,
  manifest: Manifest,
): { migrated: number } {
  let migrated = 0;
  for (const entry of manifest.entities) {
    try {
      const { content } = readVaultFile(vaultRoot, entry.path);
      const parsed = parseEntityFrontmatter(content);
      if (!parsed) continue;
      if (parsed.fm.aliases !== undefined) continue;
      const updatedFm: EntityFrontmatter = { ...parsed.fm, aliases: [] };
      const newContent = serializeEntityFrontmatter(updatedFm, parsed.prose);
      writeVaultFileAtomic(vaultRoot, entry.path, newContent);
      entry.aliases = [];
      migrated++;
    } catch {
      // skip unreadable or malformed files
    }
  }
  return { migrated };
}

// ─── Relationships (SKY-232) ───

export function listEntityRelationships(
  manifest: Manifest,
  entityId: string
): { entityId: string; relationships: EntityRelationshipRow[]; allLabels: string[] } {
  const rels = manifest.relationships ?? [];
  const rows: EntityRelationshipRow[] = [];
  for (const rel of rels) {
    let direction: 'outgoing' | 'incoming' | null = null;
    let otherId: string | null = null;
    if (rel.fromEntityId === entityId) { direction = 'outgoing'; otherId = rel.toEntityId; }
    else if (rel.toEntityId === entityId) { direction = 'incoming'; otherId = rel.fromEntityId; }
    if (!direction || !otherId) continue;
    const other = manifest.entities.find((e) => e.id === otherId);
    if (!other) continue;
    rows.push({ id: rel.id, label: rel.label, direction, otherEntityId: other.id, otherEntityName: other.name, otherEntityType: other.type, createdAt: rel.createdAt });
  }
  const allLabels = [...new Set(rels.map((r) => r.label))].sort();
  return { entityId, relationships: rows, allLabels };
}

export function createEntityRelationship(
  manifest: Manifest,
  fromEntityId: string,
  toEntityId: string,
  label: string
): EntityRelationshipRow {
  if (!manifest.entities.find((e) => e.id === fromEntityId)) throw new Error(`Entity not found: ${fromEntityId}`);
  const toEntity = manifest.entities.find((e) => e.id === toEntityId);
  if (!toEntity) throw new Error(`Entity not found: ${toEntityId}`);
  const rel: EntityRelationship = { id: crypto.randomUUID(), fromEntityId, toEntityId, label, createdAt: new Date().toISOString() };
  if (!manifest.relationships) manifest.relationships = [];
  manifest.relationships.push(rel);
  return { id: rel.id, label: rel.label, direction: 'outgoing', otherEntityId: toEntity.id, otherEntityName: toEntity.name, otherEntityType: toEntity.type, createdAt: rel.createdAt };
}

export function deleteEntityRelationship(
  manifest: Manifest,
  relationshipId: string
): { deleted: boolean } {
  const before = (manifest.relationships ?? []).length;
  manifest.relationships = (manifest.relationships ?? []).filter((r) => r.id !== relationshipId);
  return { deleted: manifest.relationships.length < before };
}

// ─── Vault reindex: scan entities/ folder for orphan entity files ───

export function reindexEntities(vaultRoot: string, manifest: Manifest): void {
  const entityDir = path.join(vaultRoot, 'entities');
  if (!fs.existsSync(entityDir)) return;

  const known = new Map(manifest.entities.map((e) => [e.id, e]));

  // GH#632: guard both readdir levels — a single unreadable type directory must not abort the whole index.
  let typeDirs: fs.Dirent[];
  try {
    typeDirs = fs.readdirSync(entityDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const typePluralDir of typeDirs) {
    if (!typePluralDir.isDirectory()) continue;
    const typeDir = path.join(entityDir, typePluralDir.name);

    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(typeDir, { withFileTypes: true });
    } catch {
      continue; // skip this type directory and continue with others
    }
    for (const file of files) {
      if (!file.name.endsWith('.md') || file.isDirectory()) continue;
      const relPath = `entities/${typePluralDir.name}/${file.name}`;
      const fullPath = path.join(typeDir, file.name);

      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = parseEntityFrontmatter(raw);
        if (!parsed) continue;
        const entry = fmToEntry(parsed.fm, relPath);
        if (!known.has(entry.id)) {
          manifest.entities.push(entry);
          known.set(entry.id, entry);
        }
      } catch {
        // skip unreadable files
      }
    }
  }
}
