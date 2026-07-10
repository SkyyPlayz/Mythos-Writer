// W0.2 (Beta 4 "Refine"): shared frontmatter splitter — the engine behind
// "frontmatter never renders in Rich view" (FULL-SPEC §6, GAP-REPORT-v2 P0#2).
import { describe, expect, it } from 'vitest';
import { replaceDisplayBody, splitFrontmatter, splitKanbanSettings, stripHiddenBlocks } from './frontmatter';

// The exact first-minute-embarrassment fixture from GAP-REPORT-v2 P0#2: an
// Obsidian-Kanban board.md whose plugin frontmatter rendered as a giant heading.
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

describe('splitFrontmatter', () => {
  it('splits a normal frontmatter block verbatim from the body', () => {
    const raw = '---\ntitle: My Note\ntype: location\n---\nBody text.\n';
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toBe('---\ntitle: My Note\ntype: location\n---\n');
    expect(body).toBe('Body text.\n');
    expect(frontmatter + body).toBe(raw);
  });

  it('returns the whole input as body when there is no frontmatter', () => {
    const raw = '# Heading\n\nJust a note.\n';
    expect(splitFrontmatter(raw)).toEqual({ frontmatter: '', body: raw });
  });

  it('does not treat a mid-file --- ruler as frontmatter', () => {
    const raw = 'Intro paragraph.\n\n---\n\nAfter the ruler.\n';
    expect(splitFrontmatter(raw)).toEqual({ frontmatter: '', body: raw });
  });

  it('handles \\r\\n line endings on fences and inner lines', () => {
    const raw = '---\r\nkanban-plugin: board\r\n---\r\nBoard body.\r\n';
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toBe('---\r\nkanban-plugin: board\r\n---\r\n');
    expect(body).toBe('Board body.\r\n');
    expect(frontmatter + body).toBe(raw);
  });

  it('treats an unterminated fence as body, never swallowing content', () => {
    const raw = '---\ntitle: Oops no closing fence\n\nParagraph that must stay visible.\n';
    expect(splitFrontmatter(raw)).toEqual({ frontmatter: '', body: raw });
  });

  it('treats a bare --- first line with no further lines as body', () => {
    expect(splitFrontmatter('---')).toEqual({ frontmatter: '', body: '---' });
    expect(splitFrontmatter('---\n')).toEqual({ frontmatter: '', body: '---\n' });
  });

  it('accepts an empty frontmatter block', () => {
    const { frontmatter, body } = splitFrontmatter('---\n---\nBody.\n');
    expect(frontmatter).toBe('---\n---\n');
    expect(body).toBe('Body.\n');
  });

  it('accepts a closing fence at EOF without a trailing newline', () => {
    const raw = '---\ntitle: T\n---';
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toBe(raw);
    expect(body).toBe('');
  });

  it('does not treat ---- (setext-ish) as a closing fence', () => {
    const raw = '---\ntitle: T\n----\nstill inside?\n';
    // No valid closing fence → unterminated → all body.
    expect(splitFrontmatter(raw)).toEqual({ frontmatter: '', body: raw });
  });

  it('requires the opening fence on the very first line', () => {
    const raw = '\n---\ntitle: T\n---\nBody\n';
    expect(splitFrontmatter(raw)).toEqual({ frontmatter: '', body: raw });
  });
});

describe('splitKanbanSettings', () => {
  it('extracts a trailing %% kanban:settings %% block verbatim', () => {
    const body = '## Lane\n\n- [ ] Card\n\n%% kanban:settings\n```json\n{"a":1}\n```\n%%';
    const { body: display, kanbanSettings } = splitKanbanSettings(body);
    expect(display).toBe('## Lane\n\n- [ ] Card\n');
    expect(kanbanSettings).toBe('\n%% kanban:settings\n```json\n{"a":1}\n```\n%%');
    expect(display + kanbanSettings).toBe(body);
  });

  it('keeps trailing whitespace after the closing %% inside the trailer chunk', () => {
    const body = 'Card list\n\n%% kanban:settings\n{}\n%%\n\n';
    const { body: display, kanbanSettings } = splitKanbanSettings(body);
    expect(display + kanbanSettings).toBe(body);
    expect(display).toBe('Card list\n');
  });

  it('extracts an unterminated settings block up to EOF', () => {
    const body = 'Cards\n\n%% kanban:settings\n{"broken": true';
    const { body: display, kanbanSettings } = splitKanbanSettings(body);
    expect(display).toBe('Cards\n');
    expect(kanbanSettings).toBe('\n%% kanban:settings\n{"broken": true');
  });

  it('does not extract a settings block followed by real content', () => {
    const body = '%% kanban:settings\n{}\n%%\n\nReal prose after the block.\n';
    expect(splitKanbanSettings(body)).toEqual({ body, kanbanSettings: '' });
  });

  it('ignores ordinary %% comment blocks', () => {
    const body = 'Text\n\n%% just a comment %%\n';
    expect(splitKanbanSettings(body)).toEqual({ body, kanbanSettings: '' });
  });

  it('returns the body untouched when there is no settings block', () => {
    const body = 'Plain body.\n';
    expect(splitKanbanSettings(body)).toEqual({ body, kanbanSettings: '' });
  });
});

describe('stripHiddenBlocks (Rich/preview display body)', () => {
  it('a kanban board file renders neither frontmatter nor the settings block', () => {
    const display = stripHiddenBlocks(KANBAN_BOARD);
    expect(display).not.toContain('kanban-plugin');
    expect(display).not.toContain('mythos-board-version');
    expect(display).not.toContain('story-id');
    expect(display).not.toContain('kanban:settings');
    expect(display).not.toContain('---');
    expect(display).toContain('## To Do');
    expect(display).toContain('Draft the flood scene');
  });

  it('round-trips: frontmatter + display body + settings === original file', () => {
    const { frontmatter, body } = splitFrontmatter(KANBAN_BOARD);
    const { body: display, kanbanSettings } = splitKanbanSettings(body);
    expect(frontmatter + display + kanbanSettings).toBe(KANBAN_BOARD);
  });

  it('is the identity for a plain note', () => {
    const raw = '# Title\n\nA plain note with a --- ruler nowhere near the top.\n';
    expect(stripHiddenBlocks(raw)).toBe(raw);
  });
});

describe('replaceDisplayBody (Rich-mode save reassembly)', () => {
  it('is the exact inverse of stripHiddenBlocks when the body is unchanged', () => {
    for (const raw of [
      KANBAN_BOARD,
      '---\ntitle: T\n---\nBody.\n',
      'No frontmatter at all.\n',
      '---\r\ntitle: CRLF\r\n---\r\nBody.\r\n',
      '---\nunterminated: fence\n\nAll of this is body.\n',
    ]) {
      expect(replaceDisplayBody(raw, stripHiddenBlocks(raw))).toBe(raw);
    }
  });

  it('splices an edited body between the verbatim frontmatter and settings trailer', () => {
    const out = replaceDisplayBody(KANBAN_BOARD, '## To Do\n\n- [ ] A brand-new card\n');
    expect(out.startsWith('---\nkanban-plugin: board\n')).toBe(true);
    expect(out).toContain('A brand-new card');
    expect(out).toContain('%% kanban:settings');
    expect(out.trimEnd().endsWith('%%')).toBe(true);
    // The hidden chunks stayed byte-identical.
    expect(splitFrontmatter(out).frontmatter).toBe(splitFrontmatter(KANBAN_BOARD).frontmatter);
    expect(splitKanbanSettings(splitFrontmatter(out).body).kanbanSettings)
      .toBe(splitKanbanSettings(splitFrontmatter(KANBAN_BOARD).body).kanbanSettings);
  });

  it('leaves a plain note fully editable (no hidden chunks to re-attach)', () => {
    expect(replaceDisplayBody('Old body.\n', 'New body.\n')).toBe('New body.\n');
  });
});
