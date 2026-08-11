import { describe, it, expect } from 'vitest';
import {
  SCENE_NOTE_SEPARATOR,
  parseSceneNotes,
  serializeSceneNotes,
  promotedSceneNoteName,
  buildPromotedSceneNoteContent,
} from './sceneNotes';

describe('parseSceneNotes / serializeSceneNotes', () => {
  it('empty and whitespace-only content parses to no notes', () => {
    expect(parseSceneNotes('')).toEqual([]);
    expect(parseSceneNotes('   \n  ')).toEqual([]);
  });

  it('legacy free-text content becomes a single note', () => {
    expect(parseSceneNotes('Check the tide tables.\nSecond line.')).toEqual([
      'Check the tide tables.\nSecond line.',
    ]);
  });

  it('round-trips a list through the SKY-1391 separator format', () => {
    const notes = ['First note', 'Second note', 'Third'];
    expect(parseSceneNotes(serializeSceneNotes(notes))).toEqual(notes);
  });

  it('parses content appended by the brainstorm bridge (existing + \\n---\\n + new)', () => {
    expect(parseSceneNotes(`Existing note${SCENE_NOTE_SEPARATOR}Appended by brainstorm`)).toEqual([
      'Existing note',
      'Appended by brainstorm',
    ]);
  });

  it('drops empty segments left by removals', () => {
    expect(parseSceneNotes(`One${SCENE_NOTE_SEPARATOR}${SCENE_NOTE_SEPARATOR}Two`)).toEqual([
      'One',
      'Two',
    ]);
  });
});

describe('promotedSceneNoteName', () => {
  it('uses the first line of the note', () => {
    expect(promotedSceneNoteName('Foreshadow the Lamplighter\nin the crowd scene')).toBe(
      'Foreshadow the Lamplighter',
    );
  });

  it('caps long titles at 60 chars with an ellipsis', () => {
    const name = promotedSceneNoteName('x'.repeat(100));
    expect(name.length).toBeLessThanOrEqual(61);
    expect(name.endsWith('…')).toBe(true);
  });

  it('sanitizes OS-reserved characters but keeps Unicode (R3)', () => {
    expect(promotedSceneNoteName('How does drownlight behave near iron?')).toBe(
      'How does drownlight behave near iron-',
    );
    expect(promotedSceneNoteName('🌊 Tide Mechanics')).toBe('🌊 Tide Mechanics');
  });

  it('falls back for empty input', () => {
    expect(promotedSceneNoteName('   ')).toBe('Scene note');
  });
});

describe('buildPromotedSceneNoteContent', () => {
  it('emits frontmatter with scene and story context, then the note body', () => {
    const content = buildPromotedSceneNoteContent(
      'Check the tide tables.',
      'Into the Undercity',
      'The Last City',
    );
    expect(content).toBe(
      [
        '---',
        'type: note',
        'source: promoted-scene-note',
        'scene: "Into the Undercity"',
        'story: "The Last City"',
        '---',
        '',
        'Check the tide tables.',
      ].join('\n'),
    );
  });

  it('escapes quotes and newlines in titles', () => {
    const content = buildPromotedSceneNoteContent('Body', 'A "quoted"\ntitle', '');
    expect(content).toContain('scene: "A \\"quoted\\"\\ntitle"');
    expect(content).toContain('story: "unknown"');
  });
});
