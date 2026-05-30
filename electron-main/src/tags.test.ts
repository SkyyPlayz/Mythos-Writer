import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb, upsertTag, listTags, renameTag, deleteTag, setItemTags, getItemTags, getItemsForTag, bulkApplyTags } from './db.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-tags-'));
  openDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('tags', () => {
  it('upsertTag creates and returns same tag', () => {
    const t1 = upsertTag('protagonist');
    const t2 = upsertTag('protagonist');
    expect(t1.id).toBe(t2.id);
    expect(t1.name).toBe('protagonist');
  });

  it('upsertTag is case-insensitive', () => {
    const t1 = upsertTag('Hero');
    const t2 = upsertTag('hero');
    expect(t1.id).toBe(t2.id);
  });

  it('listTags returns all tags sorted', () => {
    upsertTag('zebra');
    upsertTag('apple');
    const tags = listTags();
    expect(tags[0].name).toBe('apple');
    expect(tags[1].name).toBe('zebra');
  });

  it('renameTag cascade: updates name', () => {
    const tag = upsertTag('old-name');
    const renamed = renameTag(tag.id, 'new-name');
    expect(renamed.name).toBe('new-name');
    const tags = listTags();
    expect(tags.find((t) => t.id === tag.id)?.name).toBe('new-name');
  });

  it('deleteTag removes tag and item_tags entries', () => {
    const tag = upsertTag('temporary');
    setItemTags('entity-1', 'entity', ['temporary']);
    expect(getItemTags('entity-1')).toContain('temporary');
    deleteTag(tag.id);
    expect(getItemTags('entity-1')).not.toContain('temporary');
    expect(listTags().find((t) => t.id === tag.id)).toBeUndefined();
  });

  it('setItemTags replaces item tag set', () => {
    setItemTags('scene-1', 'scene', ['action', 'chapter-1']);
    expect(getItemTags('scene-1')).toEqual(['action', 'chapter-1'].sort());
    setItemTags('scene-1', 'scene', ['drama']);
    expect(getItemTags('scene-1')).toEqual(['drama']);
  });

  it('getItemsForTag returns items with that tag', () => {
    setItemTags('entity-a', 'entity', ['magic', 'fantasy']);
    setItemTags('scene-b', 'scene', ['magic']);
    const items = getItemsForTag('magic');
    expect(items).toHaveLength(2);
    expect(items.some((i) => i.itemId === 'entity-a')).toBe(true);
    expect(items.some((i) => i.itemId === 'scene-b')).toBe(true);
  });

  it('bulkApplyTags adds and removes tags', () => {
    setItemTags('scene-1', 'scene', ['old']);
    setItemTags('scene-2', 'scene', ['old']);
    bulkApplyTags(['scene-1', 'scene-2'], 'scene', ['new-tag'], ['old']);
    expect(getItemTags('scene-1')).toContain('new-tag');
    expect(getItemTags('scene-1')).not.toContain('old');
    expect(getItemTags('scene-2')).toContain('new-tag');
  });
});
