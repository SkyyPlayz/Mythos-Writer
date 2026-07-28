import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import {
  buildEntityTerms,
  findEntityMentions,
  AutoLinkerExtension,
  AUTO_LINKER_META,
  getAutoLinkerState,
} from './AutoLinkerExtension';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEntity(
  id: string,
  name: string,
  aliases?: string[],
  noAutoLink?: boolean,
): EntityEntry {
  return {
    id,
    name,
    type: 'character',
    path: `entities/characters/${id}.md`,
    aliases,
    createdAt: '',
    updatedAt: '',
    properties: noAutoLink ? { noAutoLink: true } : undefined,
  };
}

// ─── buildEntityTerms ────────────────────────────────────────────────────────

describe('buildEntityTerms', () => {
  it('includes canonical name', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara')]);
    expect(terms.some((t) => t.text === 'Elara')).toBe(true);
  });

  it('includes aliases', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara Voss', ['El', 'The Weaver'])]);
    expect(terms.some((t) => t.text === 'The Weaver')).toBe(true);
  });

  it('sets canonicalName to entity name even for aliases', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara Voss', ['The Weaver'])]);
    const weaverTerm = terms.find((t) => t.text === 'The Weaver');
    expect(weaverTerm?.canonicalName).toBe('Elara Voss');
  });

  it('excludes terms shorter than 2 chars', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'A', ['B'])]);
    expect(terms).toHaveLength(0);
  });

  it('excludes entities with noAutoLink flag', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Mom', [], true)]);
    expect(terms).toHaveLength(0);
  });

  it('excludes noAutoLink entities but keeps others', () => {
    const terms = buildEntityTerms([
      makeEntity('e1', 'Mom', [], true),
      makeEntity('e2', 'Elara'),
    ]);
    expect(terms.map((t) => t.text)).not.toContain('Mom');
    expect(terms.map((t) => t.text)).toContain('Elara');
  });

  it('sorts by length descending', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara', ['Elara Voss'])]);
    expect(terms[0].text.length).toBeGreaterThanOrEqual(terms[1].text.length);
  });
});

// ─── findEntityMentions ──────────────────────────────────────────────────────

describe('findEntityMentions — boundary detection', () => {
  it('matches an entity name at start of sentence', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara')]);
    const matches = findEntityMentions('Elara walked through the door.', terms);
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(0);
    expect(matches[0].to).toBe(5);
    expect(matches[0].anchorText).toBe('Elara');
  });

  it('matches an entity name mid-sentence', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara')]);
    const matches = findEntityMentions('He saw Elara leave.', terms);
    expect(matches).toHaveLength(1);
    expect(matches[0].anchorText).toBe('Elara');
  });

  it('does NOT match partial word (prefix)', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Eli')]);
    const matches = findEntityMentions('Elizabeth was there.', terms);
    expect(matches).toHaveLength(0);
  });

  it('does NOT match partial word (suffix)', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Eli')]);
    const matches = findEntityMentions('Carefully Eli left.', terms);
    // "Carefully" has "eli" as substring but "y" before it is \w
    // "Eli" standalone should match
    const carefullyMatch = matches.some((m) => m.from < 9);
    expect(carefullyMatch).toBe(false);
  });

  it('matches at end of string (no next char)', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara')]);
    const matches = findEntityMentions('It was Elara', terms);
    expect(matches).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara')]);
    const matches = findEntityMentions('elara and ELARA were there.', terms);
    expect(matches).toHaveLength(2);
  });

  it('preserves original casing in anchorText', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara')]);
    const matches = findEntityMentions('elara walked.', terms);
    expect(matches[0].anchorText).toBe('elara');
  });

  it('does not match if adjacent to word char on either side', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Ell')]);
    const matches = findEntityMentions('Hello Elliot and Ell.', terms);
    expect(matches).toHaveLength(1);
    expect(matches[0].anchorText).toBe('Ell');
  });
});

describe('findEntityMentions — alias resolution', () => {
  it('matches alias and reports canonical name', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara Voss', ['The Weaver'])]);
    const matches = findEntityMentions('The Weaver arrived.', terms);
    expect(matches).toHaveLength(1);
    expect(matches[0].canonicalName).toBe('Elara Voss');
    expect(matches[0].anchorText).toBe('The Weaver');
  });

  it('matches canonical name and alias independently', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara', ['El'])]);
    // "El" is 2 chars so it's included
    const matches = findEntityMentions('Elara and El met.', terms);
    // "Elara" is matched first (longer), then "El" as a separate word
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => m.canonicalName === 'Elara')).toBe(true);
  });
});

describe('findEntityMentions — opt-out', () => {
  it('returns no matches for noAutoLink entity', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Mom', [], true)]);
    const matches = findEntityMentions('Mom came to dinner.', terms);
    expect(matches).toHaveLength(0);
  });

  it('skips noAutoLink entity but matches others', () => {
    const terms = buildEntityTerms([
      makeEntity('e1', 'Mom', [], true),
      makeEntity('e2', 'Elara'),
    ]);
    const matches = findEntityMentions('Mom and Elara were there.', terms);
    expect(matches).toHaveLength(1);
    expect(matches[0].canonicalName).toBe('Elara');
  });
});

describe('findEntityMentions — overlap prevention', () => {
  it('longer match wins when it starts at the same position', () => {
    const terms = buildEntityTerms([
      makeEntity('e1', 'Elara Voss'),
      makeEntity('e2', 'Elara'),
    ]);
    const matches = findEntityMentions('Elara Voss arrived.', terms);
    // Only one match: the longer "Elara Voss"
    expect(matches).toHaveLength(1);
    expect(matches[0].anchorText).toBe('Elara Voss');
  });

  it('two non-overlapping occurrences both match', () => {
    const terms = buildEntityTerms([makeEntity('e1', 'Elara')]);
    const matches = findEntityMentions('Elara left. Later Elara returned.', terms);
    expect(matches).toHaveLength(2);
  });

  it('overlapping aliases produce only one match per range', () => {
    const terms = buildEntityTerms([
      makeEntity('e1', 'River'),
      makeEntity('e2', 'River Stone'), // longer
    ]);
    const matches = findEntityMentions('River Stone crossed the bridge.', terms);
    expect(matches).toHaveLength(1);
    expect(matches[0].anchorText).toBe('River Stone');
  });
});

// ─── Plugin integration (SKY-8224: scoped per-keystroke rebuild) ────────────

function makeAutoLinkerEditor(content: string, entities: EntityEntry[]) {
  const editor = new Editor({
    extensions: [StarterKit, AutoLinkerExtension, Markdown],
    content,
  });
  editor.view.dispatch(
    editor.state.tr.setMeta(AUTO_LINKER_META, { entities, mode: 'suggest' }),
  );
  return editor;
}

describe('AutoLinkerExtension plugin — decoration correctness across edits', () => {
  it('decorates a mention in a two-paragraph doc', () => {
    const editor = makeAutoLinkerEditor('<p>Elara walked.</p><p>Nothing else here.</p>', [
      makeEntity('e1', 'Elara'),
    ]);
    const hints = editor.view.dom.querySelectorAll('.archive-wl-hint');
    editor.destroy();
    expect(hints).toHaveLength(1);
  });

  it('adds a new mention decoration when typing into a second paragraph, without disturbing the first', () => {
    const editor = makeAutoLinkerEditor('<p>Elara walked.</p><p>Then, </p>', [
      makeEntity('e1', 'Elara'),
    ]);
    // place cursor at the end of the second paragraph and type another mention
    const endPos = editor.state.doc.content.size - 1;
    editor.chain().focus().setTextSelection(endPos).insertContent('Elara returned.').run();

    const hints = editor.view.dom.querySelectorAll('.archive-wl-hint');
    editor.destroy();
    expect(hints).toHaveLength(2);
  });

  it('removes a decoration when the mention text is edited away', () => {
    const editor = makeAutoLinkerEditor('<p>Elara walked in.</p>', [makeEntity('e1', 'Elara')]);
    expect(editor.view.dom.querySelectorAll('.archive-wl-hint')).toHaveLength(1);

    // Select "Elara" (positions 1-6 in a single-paragraph doc) and replace it.
    editor.chain().focus().setTextSelection({ from: 1, to: 6 }).insertContent('Somebody').run();

    const hints = editor.view.dom.querySelectorAll('.archive-wl-hint');
    editor.destroy();
    expect(hints).toHaveLength(0);
  });

  it('re-scans the whole document when entities/mode change via meta', () => {
    const editor = makeAutoLinkerEditor('<p>Elara and Voss talked.</p>', [
      makeEntity('e1', 'Elara'),
    ]);
    expect(editor.view.dom.querySelectorAll('.archive-wl-hint')).toHaveLength(1);

    editor.view.dispatch(
      editor.state.tr.setMeta(AUTO_LINKER_META, {
        entities: [makeEntity('e1', 'Elara'), makeEntity('e2', 'Voss')],
        mode: 'suggest',
      }),
    );

    const hints = editor.view.dom.querySelectorAll('.archive-wl-hint');
    const state = getAutoLinkerState(editor.state);
    editor.destroy();
    expect(hints).toHaveLength(2);
    expect(state?.entities).toHaveLength(2);
  });

  it('mode "off" clears decorations and stops scanning on further edits', () => {
    const editor = makeAutoLinkerEditor('<p>Elara walked.</p>', [makeEntity('e1', 'Elara')]);
    editor.view.dispatch(
      editor.state.tr.setMeta(AUTO_LINKER_META, { entities: [makeEntity('e1', 'Elara')], mode: 'off' }),
    );
    expect(editor.view.dom.querySelectorAll('.archive-wl-hint')).toHaveLength(0);

    editor.chain().focus().setTextSelection(editor.state.doc.content.size - 1).insertContent(' Elara again.').run();
    const hints = editor.view.dom.querySelectorAll('.archive-wl-hint');
    editor.destroy();
    expect(hints).toHaveLength(0);
  });
});
