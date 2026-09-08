/**
 * M17 (Beta 4 "Refine"): purple callout cards in the Notes rich editor.
 *
 * CF-11 (15-beta4-comparison-and-carryovers): the Obsidian round-trip must
 * stay lossless — every shape this extension parses into a card MUST
 * serialize back byte-identically, and every shape it cannot round-trip must
 * stay flagged by the fidelity guard (notesFidelityGuard) so Rich mode warns
 * before opening.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Markdown } from 'tiptap-markdown';
import { AlignedParagraph, AlignedHeading } from './lib/alignedBlocks';
import { WikiLink } from './WikiLinkExtension';
import { NoteCallout, sanitizeCalloutTitle } from './NoteCalloutExtension';
import { NoteLinksBlock } from './NoteLinksBlockExtension';
import { detectLossyFeatures, supportedCalloutLineCount } from './notesFidelityGuard';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = Editor & { storage: any };

/** The exact extension stack the Notes rich editor mounts (useRichEditor base + M17 extras). */
function makeNotesEditor(content: string): AnyEditor {
  return new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false, heading: false }),
      AlignedParagraph,
      AlignedHeading,
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
      WikiLink,
      Markdown,
      NoteCallout,
      NoteLinksBlock,
    ],
    content,
  }) as AnyEditor;
}

function roundTrip(markdown: string): string {
  const editor = makeNotesEditor(markdown);
  const out = editor.storage.markdown.getMarkdown() as string;
  editor.destroy();
  return out;
}

describe('NoteCallout — parsing (prototype callout card)', () => {
  it('parses the simple callout shape into a card with type as label + body', () => {
    const editor = makeNotesEditor('> [!legend]\n> Sailors speak of a hum that rises from the depths.');
    const callout = editor.view.dom.querySelector('[data-note-callout]') as HTMLElement | null;
    expect(callout).not.toBeNull();
    expect(callout?.getAttribute('data-callout-type')).toBe('legend');
    expect(callout?.hasAttribute('data-callout-title')).toBe(false);
    const title = callout?.querySelector('[data-testid="note-callout-title"]');
    expect(title?.textContent).toBe('legend');
    const body = callout?.querySelector('.note-callout-body');
    expect(body?.textContent).toContain('Sailors speak of a hum');
    editor.destroy();
  });

  it('parses a titled callout into a card with type + title, title as the label', () => {
    const editor = makeNotesEditor('> [!note] Rule of the city\n> Nothing in Veynn is ever truly lost.');
    const callout = editor.view.dom.querySelector('[data-note-callout]') as HTMLElement | null;
    expect(callout).not.toBeNull();
    expect(callout?.getAttribute('data-callout-type')).toBe('note');
    expect(callout?.getAttribute('data-callout-title')).toBe('Rule of the city');
    const title = callout?.querySelector('[data-testid="note-callout-title"]');
    expect(title?.textContent).toBe('Rule of the city');
    editor.destroy();
  });

  it('parses a title-only titled callout (no body line)', () => {
    const editor = makeNotesEditor('> [!info] Heads up');
    const callout = editor.view.dom.querySelector('[data-note-callout]') as HTMLElement | null;
    expect(callout).not.toBeNull();
    expect(callout?.getAttribute('data-callout-type')).toBe('info');
    expect(callout?.getAttribute('data-callout-title')).toBe('Heads up');
    editor.destroy();
  });

  it('parses a title-only callout', () => {
    const editor = makeNotesEditor('> [!warning]');
    const callout = editor.view.dom.querySelector('[data-note-callout]');
    expect(callout).not.toBeNull();
    expect(editor.view.dom.querySelector('blockquote')).toBeNull();
    editor.destroy();
  });

  it('preserves multi-word legacy bracket-only label casing (prototype "Rule of the city")', () => {
    const editor = makeNotesEditor('> [!Rule of the city]\n> Nothing in Veynn is ever truly lost.');
    expect(editor.view.dom.querySelector('[data-note-callout]')?.getAttribute('data-callout-type'))
      .toBe('Rule of the city');
    editor.destroy();
  });

  it('parses a multi-line callout body into a card, one paragraph per source line', () => {
    const editor = makeNotesEditor('> [!note]\n> line one\n> line two');
    const callout = editor.view.dom.querySelector('[data-note-callout]');
    expect(callout).not.toBeNull();
    expect(editor.view.dom.querySelector('blockquote')).toBeNull();
    expect(callout?.querySelectorAll('.note-callout-body p')).toHaveLength(2);
    editor.destroy();
  });

  it('parses a foldable callout (> [!x]- / > [!x]+) into a card, preserving the marker', () => {
    const collapsed = makeNotesEditor('> [!note]-\n> hidden body');
    const collapsedCard = collapsed.view.dom.querySelector('[data-note-callout]');
    expect(collapsedCard).not.toBeNull();
    expect(collapsedCard?.getAttribute('data-callout-fold')).toBe('-');
    collapsed.destroy();

    const expandable = makeNotesEditor('> [!note]+\n> visible by default');
    expect(expandable.view.dom.querySelector('[data-note-callout]')?.getAttribute('data-callout-fold')).toBe('+');
    expandable.destroy();
  });

  it('leaves a fold marker followed by trailing text to the blockquote rule (unsupported shape)', () => {
    const editor = makeNotesEditor('> [!note]- folded\n> hidden body');
    expect(editor.view.dom.querySelector('[data-note-callout]')).toBeNull();
    expect(editor.view.dom.querySelector('blockquote')).not.toBeNull();
    editor.destroy();
  });

  it('leaves a nested quote inside the body to the blockquote rule (unsupported shape)', () => {
    const editor = makeNotesEditor('> [!note]\n> > nested quote');
    expect(editor.view.dom.querySelector('[data-note-callout]')).toBeNull();
    expect(editor.view.dom.querySelector('blockquote')).not.toBeNull();
    editor.destroy();
  });

  it('leaves plain blockquotes untouched', () => {
    const editor = makeNotesEditor('> just a quote');
    expect(editor.view.dom.querySelector('[data-note-callout]')).toBeNull();
    expect(editor.view.dom.querySelector('blockquote')).not.toBeNull();
    editor.destroy();
  });
});

describe('NoteCallout — CF-11 byte-lossless round-trip', () => {
  it('round-trips a title + single-body callout byte-identically', () => {
    const md = '> [!legend]\n> Sailors speak of a hum that rises from the depths on still nights.';
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips a title-only callout byte-identically', () => {
    expect(roundTrip('> [!warning]')).toBe('> [!warning]');
  });

  it('round-trips a multi-line callout body byte-identically', () => {
    const md = '> [!note]\n> line one\n> line two\n> line three';
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips a foldable callout (collapsed and expandable) byte-identically', () => {
    expect(roundTrip('> [!note]-\n> hidden body')).toBe('> [!note]-\n> hidden body');
    expect(roundTrip('> [!note]+\n> visible by default')).toBe('> [!note]+\n> visible by default');
    expect(roundTrip('> [!note]-')).toBe('> [!note]-'); // fold marker, no body
  });

  it('round-trips `> [!type] Title` byte-identically (title only, no body)', () => {
    expect(roundTrip('> [!note] Rule of the city')).toBe('> [!note] Rule of the city');
  });

  it('round-trips `> [!type] Title` with a body line byte-identically', () => {
    const md = '> [!info] Heads up\n> Careful along the eastern ridge.';
    expect(roundTrip(md)).toBe(md);
  });


  it('round-trips the prototype note body (paragraphs, callout, H2s, bullets, links block)', () => {
    const md = [
      'An ancient floodgate built by a lost civilization to control the tides of the [[Great Deep]].',
      '',
      '> [!legend]',
      '> Sailors speak of a hum that rises from the depths on still nights — a sound like voices, or a city dreaming.',
      '',
      '## Architecture',
      '',
      '- Massive stone arches encrusted with coral and black algae',
      '- Gate mechanisms of unknown metal, engraved with wave-like glyphs',
      '',
      '## Linked Notes',
      '',
      '[[The Great Deep]] · [[Drownlight]] · [[Lost Civilization]] · [[Tide Mechanics]]',
    ].join('\n');
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips inline marks inside the callout body', () => {
    const md = '> [!voice]\n> Dry, watchful, **allergic to ceremony**.';
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips a [[wiki link]] inside the callout body', () => {
    const md = '> [!source]\n> First mentioned in [[Tide Mechanics]].';
    expect(roundTrip(md)).toBe(md);
  });

  it('serializes an edited title back into the marker, keeping the source type', () => {
    const editor = makeNotesEditor('> [!legend]\n> Body text.');
    let calloutPos = -1;
    let liveAttrs: Record<string, unknown> = {};
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'noteCallout') {
        calloutPos = pos;
        liveAttrs = node.attrs;
      }
      return calloutPos === -1;
    });
    expect(calloutPos).toBeGreaterThanOrEqual(0);
    expect(liveAttrs.type).toBe('legend');
    expect(liveAttrs.title).toBe('');
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(calloutPos, undefined, { ...liveAttrs, title: 'Old Legend' }),
    );
    const md = editor.storage.markdown.getMarkdown() as string;
    editor.destroy();
    expect(md).toBe('> [!legend] Old Legend\n> Body text.');
  });
});

describe('NoteCallout — guard/parser contract (shapes cannot drift)', () => {
  const SUPPORTED = [
    '> [!legend]\n> A single body line.',
    '> [!warning]',
    '> [!Rule of the city]\n> Nothing is ever lost.',
    '> [!note]\n> line one\n> line two', // multi-line body
    '> [!note]-\n> body', // fold marker (collapsed)
    '> [!note]+\n> body', // fold marker (expandable)
    '> [!note]-', // fold marker, title only
    '> [!note] Rule of the city',
    '> [!note] Rule of the city\n> Nothing in Veynn is ever truly lost.',
    '> [!info] Heads up',
  ];
  const UNSUPPORTED = [
    '> [!note]- folded\n> body', // trailing text after the fold marker
    '> [!a]\n> [!b]', // back-to-back callouts without a blank line
    '> [!note]\n> body\nlazy continuation', // lazy continuation would be rewritten
    '>[!note]\n> body', // missing space after >
    '> [!note]\n> > nested quote', // nested quote inside the body
    '> [!note]  Padded title', // two spaces before the title
    '> [!note] Trailing space ', // trailing whitespace after the title
  ];

  it('every supported shape parses to a card, round-trips, and passes the guard', () => {
    for (const md of SUPPORTED) {
      expect(supportedCalloutLineCount(md.split('\n'), 0), md).toBeGreaterThan(0);
      expect(detectLossyFeatures(md).map((f) => f.key), md).not.toContain('callouts');
      const editor = makeNotesEditor(md);
      expect(editor.view.dom.querySelector('[data-note-callout]'), md).not.toBeNull();
      expect(editor.storage.markdown.getMarkdown(), md).toBe(md);
      editor.destroy();
    }
  });

  it('every unsupported shape stays flagged lossy and never parses to a card', () => {
    for (const md of UNSUPPORTED) {
      expect(detectLossyFeatures(md).map((f) => f.key), md).toContain('callouts');
      const editor = makeNotesEditor(md);
      expect(editor.view.dom.querySelector('[data-note-callout]'), md).toBeNull();
      editor.destroy();
    }
  });
});

describe('sanitizeCalloutTitle', () => {
  it('strips brackets and newlines that would corrupt the [!…] marker', () => {
    expect(sanitizeCalloutTitle('Rule]\nof the city')).toBe('Rule of the city');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeCalloutTitle('  spaced   out  ')).toBe('spaced out');
  });
});
