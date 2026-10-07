import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitKanbanSettings, splitFrontmatter, stripHiddenBlocks } from './frontmatter';
import {
  extractBodyHashtags,
  mergedNoteTags,
  setNoteTagsWithBodySync,
  syncBodyHashtagLines,
} from './noteTagSync';

const KANBAN_BOARD = [
  '---',
  'kanban-plugin: board',
  'mythos-board-version: 1',
  'story-id: 3f6a804a-aaaa-bbbb-cccc-000000000000',
  '---',
  '',
  '## To Do',
  '',
  '- [ ] Draft the flood scene',
  '',
  '%% kanban:settings',
  '```json',
  '{"kanban-plugin":"board"}',
  '```',
  '%%',
].join('\n');

describe('noteTagSync (PLAN-058 L6)', () => {
  it('extracts standalone body hashtags', () => {
    expect(extractBodyHashtags('#character\n\nProse.')).toEqual(['character']);
  });

  it('mirrors frontmatter tags as body hashtag lines', () => {
    const next = setNoteTagsWithBodySync('---\ntitle: Mira\n---\n\nBody.', ['character', 'pov']);
    expect(next).toContain('tags: [character, pov]');
    expect(next).toContain('#character');
    expect(next).toContain('#pov');
  });

  it('removes stale body hashtag lines when tags shrink', () => {
    const body = syncBodyHashtagLines('#character\n#old\n\nProse', ['character']);
    expect(body).toContain('#character');
    expect(body).not.toContain('#old');
  });

  it('H1: fenced standalone hashtag lines are not stripped or mirrored away', () => {
    const display = 'Prose.\n\n```md\n#character\n```\n';
    const synced = syncBodyHashtagLines(display, ['lore']);
    expect(synced).toContain('```md');
    expect(synced).toContain('#character');
    expect(synced).toContain('#lore');
    expect(extractBodyHashtags(display)).toEqual([]);
  });

  it('H1: body-only #character merges into chip list and survives unrelated tag add', () => {
    const raw = '---\ntitle: X\ntags: []\n---\nNote.\n#character\n';
    const display = stripHiddenBlocks(raw);
    expect(mergedNoteTags([], display)).toEqual(['character']);
    const next = setNoteTagsWithBodySync(raw, ['character', 'lore']);
    expect(next).toContain('tags: [character, lore]');
    expect(next).toMatch(/\n#character\n/);
    expect(next).toContain('#lore');
  });

  it('H1: Kanban settings trailer stays last after tag sync', () => {
    const next = setNoteTagsWithBodySync(KANBAN_BOARD, ['plot']);
    expect(next).toContain('#plot');
    expect(next.trimEnd().endsWith('%%')).toBe(true);
    const { body } = splitFrontmatter(next);
    const { kanbanSettings } = splitKanbanSettings(body);
    expect(kanbanSettings).toContain('kanban:settings');
    expect(body.slice(body.indexOf(kanbanSettings))).toBe(kanbanSettings);
  });
});

describe('noteTagSync mutant pins (M1–M3)', () => {
  it('M1: syncBodyHashtagLines tracks fenced regions', () => {
    const src = readFileSync(resolve(__dirname, 'noteTagSync.ts'), 'utf-8');
    expect(src).toMatch(/inFence/);
    expect(src).toMatch(/FENCE_OPENER/);
  });

  it('M2: NoteViewer initializes chips from mergedNoteTags', () => {
    const src = readFileSync(resolve(__dirname, '../NoteViewer.tsx'), 'utf-8');
    expect(src).toContain('mergedNoteTags(noteMeta.tags, displayBody)');
  });

  it('M3: setNoteTagsWithBodySync reattaches Kanban via replaceDisplayBody', () => {
    const src = readFileSync(resolve(__dirname, 'noteTagSync.ts'), 'utf-8');
    expect(src).toContain('replaceDisplayBody(withFm, syncedDisplay)');
  });
});
