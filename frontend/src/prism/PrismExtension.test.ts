import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from '../WikiLinkExtension';
import { HeadingFocusExtension, headingFocusKey } from '../HeadingFocusExtension';
import {
  PRISM_META,
  PRISM_RESCAN_DEBOUNCE_MS,
  PrismExtension,
  buildPrismDecorations,
  extractPrismParagraphs,
  getPrismState,
  type PrismEditorConfig,
} from './PrismExtension';
import { DEFAULT_PRISM_SETTINGS, applyPrismPatch, type PrismSettingsPatch } from './settings';
import { __resetPrismStoresForTests, prismLiveStore } from './store';
import { runPrismRules } from './rules';
import type { PrismCheckId, PrismSettings } from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

// Paragraph 1: crutch ("really"), adverb ("slowly"), passive ("was opened"),
// filter ("felt"). Paragraph 2: dialogue, a showy tag ("hissed"), and an
// italic thought outside the quotes (inner monologue).
const SCENE_HTML =
  '<p>She really walked slowly to the door. It was opened by the guard. She felt the cold.</p>' +
  '<p>“Hello,” she hissed. <em>Not again,</em> she thought.</p>';

const editors: Editor[] = [];

function makeEditor(content = SCENE_HTML): Editor {
  const editor = new Editor({
    extensions: [StarterKit, Markdown, WikiLink, HeadingFocusExtension, PrismExtension],
    content,
  });
  editors.push(editor);
  return editor;
}

function settingsWith(patch: PrismSettingsPatch): PrismSettings {
  return applyPrismPatch(DEFAULT_PRISM_SETTINGS, patch);
}

function configure(
  editor: Editor,
  settings: PrismSettings,
  sceneId = 'scene-1',
  storyId: string | null = 'story-1'
) {
  const config: PrismEditorConfig = { storyId, sceneId, settings };
  editor.view.dispatch(editor.state.tr.setMeta(PRISM_META, config));
}

/** Rendered Prism marks: [check id, text] pairs, in document order. */
function marks(editor: Editor, kind: 'flag' | 'tint'): Array<[string, string]> {
  return Array.from(editor.view.dom.querySelectorAll<HTMLElement>(`.prism-${kind}`)).map((el) => [
    (kind === 'flag' ? el.dataset.prismFlag : el.dataset.prismTint) ?? '',
    el.textContent ?? '',
  ]);
}

/** The tooltip a hover over `needle` shows: the nearest titled ancestor of its text node. */
function titleAt(editor: Editor, needle: string): string | null {
  const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.textContent?.includes(needle)) {
      return n.parentElement?.closest('[title]')?.getAttribute('title') ?? null;
    }
  }
  throw new Error(`no text node contains ${needle}`);
}

/** No text node sits under two titled Prism flags (the tooltip is unambiguous). */
function expectOneTitlePerText(editor: Editor) {
  const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    let titled = 0;
    for (let el = n.parentElement; el && el !== editor.view.dom; el = el.parentElement) {
      if (el.matches('.prism-flag[title]')) titled++;
    }
    expect(titled, `"${n.textContent}"`).toBeLessThanOrEqual(1);
  }
}

/** Position of the first occurrence of `needle` in the doc's text. */
function posOf(editor: Editor, needle: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text) {
      const i = node.text.indexOf(needle);
      if (i >= 0) found = pos + i;
    }
    return true;
  });
  if (found < 0) throw new Error(`"${needle}" not in doc`);
  return found;
}

beforeEach(() => {
  __resetPrismStoresForTests();
});

afterEach(() => {
  vi.useRealTimers();
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy();
  __resetPrismStoresForTests();
});

// ─── extractPrismParagraphs ─────────────────────────────────────────────────

describe('extractPrismParagraphs', () => {
  it('maps every paragraph offset 1:1 onto doc positions across italic text and inline atoms', () => {
    const editor = makeEditor(
      '<p>He met <span data-wiki-link="Elara Voss"></span> at <em>the old</em> mill.</p>' +
        '<h2>Chapter <strong><em>two</em></strong> begins</h2>'
    );
    const { paragraphs, toDoc } = extractPrismParagraphs(editor.state.doc);

    expect(paragraphs.map((p) => p.text)).toEqual([
      'He met ￼ at the old mill.',
      'Chapter two begins',
    ]);
    for (let p = 0; p < paragraphs.length; p++) {
      const text = paragraphs[p].text;
      // Every single character (atom placeholder included) lines up with its doc position.
      for (let o = 0; o < text.length; o++) {
        const expected = text[o] === '￼' ? '[atom]' : text[o];
        expect(editor.state.doc.textBetween(toDoc(p, o), toDoc(p, o + 1), '', '[atom]')).toBe(
          expected
        );
      }
    }

    // Italic runs are reported as offsets into the paragraph text.
    expect(paragraphs[0].italic).toEqual([[12, 19]]);
    expect(paragraphs[0].text.slice(12, 19)).toBe('the old');
    expect(paragraphs[1].italic).toEqual([[8, 11]]);

    // A range after the atom maps exactly.
    const millFrom = paragraphs[0].text.indexOf('mill');
    expect(editor.state.doc.textBetween(toDoc(0, millFrom), toDoc(0, millFrom + 4))).toBe('mill');
  });

  it('merges adjacent italic text nodes with different other marks into one run', () => {
    const editor = makeEditor('<p>A <em>quiet </em><em><strong>loud</strong></em> day.</p>');
    const { paragraphs } = extractPrismParagraphs(editor.state.doc);
    expect(paragraphs[0].italic).toEqual([[2, 12]]);
  });

  it('skips code blocks and blanks inline code without shifting offsets', () => {
    const editor = makeEditor(
      '<p>Use <code>really()</code> now.</p><pre><code>really just very</code></pre><p>After the code.</p>'
    );
    const { paragraphs, toDoc } = extractPrismParagraphs(editor.state.doc);
    expect(paragraphs.map((p) => p.text)).toEqual([
      `Use ${' '.repeat('really()'.length)} now.`,
      'After the code.',
    ]);
    const nowFrom = paragraphs[0].text.indexOf('now');
    expect(editor.state.doc.textBetween(toDoc(0, nowFrom), toDoc(0, nowFrom + 3))).toBe('now');
    // The paragraph after the code block maps past it.
    expect(editor.state.doc.textBetween(toDoc(1, 0), toDoc(1, 5))).toBe('After');
  });
});

// ─── buildPrismDecorations ──────────────────────────────────────────────────

describe('buildPrismDecorations', () => {
  it('never creates empty or out-of-doc decorations', () => {
    const editor = makeEditor('<p>She really left.</p>');
    const doc = editor.state.doc;
    const extraction = extractPrismParagraphs(doc);
    const settings = settingsWith({ flags: true, proseColors: true });
    const decos = buildPrismDecorations(
      doc,
      extraction,
      {
        findings: [
          { checkId: 'adverbs', paragraph: 0, from: 4, to: 4, message: 'empty' },
          { checkId: 'adverbs', paragraph: 0, from: 400, to: 500, message: 'past the end' },
          { checkId: 'adverbs', paragraph: 0, from: 10, to: 4, message: 'reversed' },
          { checkId: 'crutch-words', paragraph: 0, from: 4, to: 10, message: 'ok' },
        ],
        stats: { words: 3, sentences: 1, avgSentenceWords: 3, readingEase: 100 },
      },
      settings
    );
    const found = decos.find();
    expect(found).toHaveLength(1);
    expect(doc.textBetween(found[0].from, found[0].to)).toBe('really');
    for (const d of found) {
      expect(d.from).toBeLessThan(d.to);
      expect(d.to).toBeLessThanOrEqual(doc.content.size);
    }
  });
});

// ─── Plugin ─────────────────────────────────────────────────────────────────

describe('PrismExtension plugin', () => {
  it('is inert until a config arrives: no scan, no marks, no snapshot', () => {
    const editor = makeEditor();
    expect(getPrismState(editor.state)?.config).toBeNull();
    expect(getPrismState(editor.state)?.result).toBeNull();
    editor.commands.insertContentAt(1, 'Really ');
    expect(getPrismState(editor.state)?.result).toBeNull();
    expect(getPrismState(editor.state)?.dirty).toBe(false);
    expect(editor.view.dom.querySelector('.prism-flag, .prism-tint')).toBeNull();
    expect(prismLiveStore.get('scene-1')).toBeNull();
  });

  it('with flags off it still detects and publishes, but draws nothing', () => {
    const editor = makeEditor();
    configure(editor, DEFAULT_PRISM_SETTINGS);

    const st = getPrismState(editor.state);
    expect(st?.result?.findings.some((f) => f.checkId === 'adverbs')).toBe(true);
    expect(editor.view.dom.querySelector('.prism-flag, .prism-tint')).toBeNull();

    const snap = prismLiveStore.get('scene-1');
    expect(snap).not.toBeNull();
    expect(snap?.storyId).toBe('story-1');
    expect(snap?.findings).toHaveLength(st?.result?.findings.length ?? -1);
    expect(snap?.stats.words).toBeGreaterThan(0);
    const adverb = snap?.findings.find((f) => f.checkId === 'adverbs');
    expect(adverb && editor.state.doc.textBetween(adverb.docFrom, adverb.docTo)).toBe('slowly');
    expect(adverb?.snippet).toBe('She really walked slowly to the door.');
  });

  it('with flags on it draws an underline for every enabled flag check', () => {
    const editor = makeEditor();
    configure(editor, settingsWith({ flags: true }));
    const flags = marks(editor, 'flag');
    expect(flags).toEqual(
      expect.arrayContaining([
        ['crutch-words', 'really'],
        ['adverbs', 'slowly'],
        ['passive-voice', 'was opened'],
        ['filter-words', 'felt'],
        ['dialogue-tags', 'hissed'],
      ])
    );
    const el = editor.view.dom.querySelector<HTMLElement>('.prism-flag--adverbs');
    expect(el?.className).toContain('prism-flag');
    expect(el?.getAttribute('title')).toBe('Adverb: ‘slowly’');
    // Prose colors stay off.
    expect(marks(editor, 'tint')).toEqual([]);
  });

  it('turning one check off hides only that check, without re-scanning', () => {
    const editor = makeEditor();
    configure(editor, settingsWith({ flags: true }));
    const resultBefore = getPrismState(editor.state)?.result;

    configure(editor, settingsWith({ flags: true, checks: { adverbs: false } }));
    const ids = marks(editor, 'flag').map(([id]) => id);
    expect(ids).not.toContain('adverbs');
    expect(ids).toEqual(
      expect.arrayContaining(['crutch-words', 'passive-voice', 'filter-words', 'dialogue-tags'])
    );
    // Same doc + same thresholds: the cached result is reused.
    expect(getPrismState(editor.state)?.result).toBe(resultBefore);
  });

  it('a threshold change re-scans', () => {
    // 12 words: under the default 30-word limit, over a 10-word one.
    const editor = makeEditor('<p>The rain fell on the roofs of the town all night long.</p>');
    configure(editor, settingsWith({ flags: true }));
    const resultBefore = getPrismState(editor.state)?.result;
    expect(marks(editor, 'flag').some(([id]) => id === 'long-sentences')).toBe(false);
    configure(editor, settingsWith({ flags: true, thresholds: { longSentenceWords: 10 } }));
    expect(getPrismState(editor.state)?.result).not.toBe(resultBefore);
    expect(marks(editor, 'flag')).toEqual([
      ['long-sentences', 'The rain fell on the roofs of the town all night long.'],
    ]);
  });

  it('with prose colors on it tints dialogue, inner monologue and (when enabled) narration', () => {
    const editor = makeEditor();
    configure(editor, settingsWith({ proseColors: true }));
    const tints = marks(editor, 'tint');
    expect(tints).toEqual(
      expect.arrayContaining([
        ['dialogue', '“Hello,”'],
        ['inner-monologue', 'Not again,'],
      ])
    );
    // Narrator is off by default.
    expect(tints.some(([id]) => id === 'narrator')).toBe(false);
    expect(marks(editor, 'flag')).toEqual([]);
    expect(editor.view.dom.querySelector('.prism-tint--dialogue')?.hasAttribute('title')).toBe(
      false
    );

    configure(editor, settingsWith({ proseColors: true, checks: { narrator: true } }));
    expect(
      marks(editor, 'tint').some(([id, text]) => id === 'narrator' && text.startsWith('She really'))
    ).toBe(true);
  });

  it('maps marks while typing, then rescans once after the debounce', () => {
    vi.useFakeTimers();
    const editor = makeEditor();
    configure(editor, settingsWith({ flags: true }));
    const firstSnapshot = prismLiveStore.get('scene-1');
    const scan = getPrismState(editor.state)?.scan;

    // Type at the very start: the existing marks shift with the text.
    editor.commands.insertContentAt(1, 'Then ');
    editor.commands.insertContentAt(1, 'And ');
    expect(getPrismState(editor.state)?.dirty).toBe(true);
    expect(getPrismState(editor.state)?.scan).toBe(scan);
    expect(marks(editor, 'flag')).toEqual(expect.arrayContaining([['adverbs', 'slowly']]));

    // Add a new crutch word — not drawn until the rescan.
    editor.commands.insertContentAt(posOf(editor, 'cold'), 'very ');
    expect(marks(editor, 'flag').some(([, text]) => text === 'very')).toBe(false);

    vi.advanceTimersByTime(PRISM_RESCAN_DEBOUNCE_MS - 1);
    expect(getPrismState(editor.state)?.scan).toBe(scan);
    vi.advanceTimersByTime(1);
    expect(getPrismState(editor.state)?.scan).toBe((scan ?? 0) + 1);
    expect(getPrismState(editor.state)?.dirty).toBe(false);
    expect(marks(editor, 'flag')).toEqual(expect.arrayContaining([['crutch-words', 'very']]));

    const snap = prismLiveStore.get('scene-1');
    expect(snap).not.toBe(firstSnapshot);
    const very = snap?.findings.find(
      (f) => f.checkId === 'crutch-words' && f.snippet.includes('very cold')
    );
    expect(very && editor.state.doc.textBetween(very.docFrom, very.docTo)).toBe('very');

    // No further rescans are pending.
    vi.advanceTimersByTime(PRISM_RESCAN_DEBOUNCE_MS * 4);
    expect(getPrismState(editor.state)?.scan).toBe((scan ?? 0) + 1);
  });

  it('a rescan meta recomputes synchronously', () => {
    const editor = makeEditor();
    configure(editor, settingsWith({ flags: true }));
    editor.commands.insertContentAt(posOf(editor, 'cold'), 'just ');
    expect(marks(editor, 'flag').some(([, text]) => text === 'just')).toBe(false);
    editor.view.dispatch(editor.state.tr.setMeta(PRISM_META, { rescan: true }));
    expect(marks(editor, 'flag')).toEqual(expect.arrayContaining([['crutch-words', 'just']]));
  });

  it('does not republish an identical snapshot', () => {
    const editor = makeEditor();
    configure(editor, settingsWith({ flags: true }));
    const snap = prismLiveStore.get('scene-1');
    const listener = vi.fn();
    const unsubscribe = prismLiveStore.subscribe(listener);
    editor.view.dispatch(editor.state.tr.setMeta(PRISM_META, { rescan: true }));
    expect(listener).not.toHaveBeenCalled();
    expect(prismLiveStore.get('scene-1')).toBe(snap);
    unsubscribe();
  });

  it('moves the snapshot when the editor switches scenes', () => {
    const editor = makeEditor();
    configure(editor, DEFAULT_PRISM_SETTINGS, 'scene-1');
    configure(editor, DEFAULT_PRISM_SETTINGS, 'scene-2');
    expect(prismLiveStore.get('scene-1')).toBeNull();
    expect(prismLiveStore.get('scene-2')?.sceneId).toBe('scene-2');
  });

  it('destroy clears the live snapshot and the pending rescan; nothing dispatches afterwards', () => {
    vi.useFakeTimers();
    const editor = makeEditor();
    configure(editor, settingsWith({ flags: true }));
    expect(prismLiveStore.get('scene-1')).not.toBeNull();

    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    editor.commands.insertContentAt(1, 'Really ');
    const rescanCall = setTimeoutSpy.mock.calls.findIndex(
      ([, ms]) => ms === PRISM_RESCAN_DEBOUNCE_MS
    );
    expect(rescanCall).toBeGreaterThanOrEqual(0);
    const rescanTimer = setTimeoutSpy.mock.results[rescanCall].value;

    const dispatch = vi.spyOn(editor.view, 'dispatch');
    editor.destroy();
    expect(prismLiveStore.get('scene-1')).toBeNull();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(rescanTimer);
    vi.advanceTimersByTime(PRISM_RESCAN_DEBOUNCE_MS * 2);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("destroy leaves another editor's snapshot for the same scene alone", () => {
    const a = makeEditor();
    configure(a, DEFAULT_PRISM_SETTINGS);
    const b = makeEditor('<p>A different, really short scene.</p>');
    configure(b, DEFAULT_PRISM_SETTINGS);
    const fromB = prismLiveStore.get('scene-1');
    a.destroy();
    expect(prismLiveStore.get('scene-1')).toBe(fromB);
  });

  it('reveal selects the finding range (clamped to the doc) and focuses the editor', () => {
    const editor = makeEditor();
    configure(editor, DEFAULT_PRISM_SETTINGS);
    const snap = prismLiveStore.get('scene-1');
    const passive = snap?.findings.find((f) => f.checkId === 'passive-voice');
    if (!snap || !passive) throw new Error('expected a passive-voice finding');
    const focus = vi.spyOn(editor.view, 'focus');

    snap.reveal(passive.docFrom, passive.docTo);
    const { from, to } = editor.state.selection;
    expect([from, to]).toEqual([passive.docFrom, passive.docTo]);
    expect(editor.state.doc.textBetween(from, to)).toBe('was opened');
    expect(focus).toHaveBeenCalled();

    // Out-of-range positions clamp instead of throwing.
    expect(() => snap.reveal(-20, 10_000)).not.toThrow();
    expect(editor.state.selection.to).toBeLessThanOrEqual(editor.state.doc.content.size);
  });

  it('snippets stay within 80 characters, keep the finding, and mark cuts with an ellipsis', () => {
    const long =
      'In the grey hour before the bells the market had not yet woken and the carts stood in rows, ' +
      'and she walked very carefully between them, counting the stalls and the shuttered windows and the gulls on every roof.';
    const editor = makeEditor(`<p>${long}</p>`);
    configure(editor, DEFAULT_PRISM_SETTINGS);
    const findings = prismLiveStore.get('scene-1')?.findings ?? [];
    const adverb = findings.find((f) => f.checkId === 'adverbs');
    expect(adverb?.snippet).toContain('carefully');
    expect(adverb?.snippet.startsWith('…')).toBe(true);
    expect(adverb?.snippet.endsWith('…')).toBe(true);
    for (const f of findings) expect(f.snippet.length).toBeLessThanOrEqual(80);
  });

  it('snippets collapse runs of whitespace and line breaks', () => {
    const editor = makeEditor('<p>x</p>');
    configure(editor, DEFAULT_PRISM_SETTINGS);
    editor.view.dispatch(editor.state.tr.insertText('She \t felt   the', 1, 2));
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '<br>cold.');
    editor.view.dispatch(editor.state.tr.setMeta(PRISM_META, { rescan: true }));
    const filter = prismLiveStore
      .get('scene-1')
      ?.findings.find((f) => f.checkId === 'filter-words');
    expect(filter?.snippet).toBe('She felt the cold.');
  });

  it('snippets show inline atoms by their display text', () => {
    const editor = makeEditor(
      '<p>He saw <span data-wiki-link="Elara Voss" data-wiki-link-alias="Elara"></span> leave.</p>'
    );
    configure(editor, DEFAULT_PRISM_SETTINGS);
    const filter = prismLiveStore
      .get('scene-1')
      ?.findings.find((f) => f.checkId === 'filter-words');
    expect(filter?.snippet).toBe('He saw Elara leave.');
  });

  it('decorations match a direct run of the engine over the extraction', () => {
    const editor = makeEditor();
    const settings = settingsWith({ flags: true, proseColors: true, checks: { narrator: true } });
    configure(editor, settings);
    const extraction = extractPrismParagraphs(editor.state.doc);
    const result = runPrismRules(extraction.paragraphs, settings.thresholds);
    const expected = buildPrismDecorations(editor.state.doc, extraction, result, settings)
      .find()
      .map((d) => [d.from, d.to]);
    const actual = getPrismState(editor.state)
      ?.decorations.find()
      .map((d) => [d.from, d.to]);
    expect(actual).toEqual(expected);
    const ids = new Set<PrismCheckId>(result.findings.map((f) => f.checkId));
    expect(ids.size).toBeGreaterThan(5);
  });
});

// ─── Overlapping marks ──────────────────────────────────────────────────────

describe('PrismExtension overlapping marks', () => {
  // 37 words: one long sentence that also holds a word-level adverb flag.
  const LONG_WITH_ADVERB =
    '<p>She walked slowly down the long road past the mill and the river and the old stone ' +
    'bridge where the carts had stood for years in the rain while the town slept on and she ' +
    'kept on walking away from them.</p>';

  it('a word-level flag inside a long sentence keeps its own span, class and title', () => {
    const editor = makeEditor(LONG_WITH_ADVERB);
    configure(editor, settingsWith({ flags: true }));

    const adverb = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-prism-flag="adverbs"]')
    );
    expect(adverb).toHaveLength(1);
    expect(adverb[0].textContent).toBe('slowly');
    // Its own element: not merged with the sentence flag's class or title.
    expect(adverb[0].className).toBe('prism-flag prism-flag--adverbs');
    expect(adverb[0].getAttribute('title')).toBe('Adverb: ‘slowly’');

    // ...nested inside the long-sentence flag, which keeps its own attributes.
    const sentence = adverb[0].parentElement?.closest<HTMLElement>('[data-prism-flag]');
    expect(sentence?.dataset.prismFlag).toBe('long-sentences');
    expect(sentence?.className).toBe('prism-flag prism-flag--long-sentences');
    // Hovering the word shows the word's message, whatever the nesting order:
    // the sentence's piece over the word carries no competing title...
    expect(sentence?.hasAttribute('title')).toBe(false);
    expect(titleAt(editor, 'slowly')).toBe('Adverb: ‘slowly’');
    // ...and the sentence's own message sits on every piece outside the word.
    const sentenceTitles = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-prism-flag="long-sentences"][title]')
    );
    expect(sentenceTitles.map((el) => el.textContent).join('')).toBe(
      editor.state.doc.textContent.replace('slowly', '')
    );
    for (const el of sentenceTitles) expect(el.getAttribute('title')).toMatch(/^Long sentence/);
    expect(titleAt(editor, 'bridge')).toMatch(/^Long sentence/);

    // The sentence flag still covers the whole sentence (split around the nested word).
    const sentenceText = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-prism-flag="long-sentences"]')
    )
      .map((el) => el.textContent)
      .join('');
    expect(sentenceText).toBe(editor.state.doc.textContent);
  });

  it('a word flag that ends a wider flag still owns the tooltip (dialogue tag ending on its adverb)', () => {
    const editor = makeEditor('<p>“Go,” she whispered softly.</p>');
    configure(editor, settingsWith({ flags: true }));
    const tag = editor.view.dom.querySelectorAll<HTMLElement>('[data-prism-flag="dialogue-tags"]');
    const tagText = Array.from(tag)
      .map((el) => el.textContent)
      .join('');
    expect(tagText.endsWith('softly')).toBe(true);
    expect(editor.view.dom.querySelector('[data-prism-flag="adverbs"]')?.textContent).toBe(
      'softly'
    );

    expect(titleAt(editor, 'softly')).toBe('Adverb: ‘softly’');
    // The rest of the tag still explains the tag.
    expect(titleAt(editor, 'whispered')).toMatch(/^Dialogue tag propped up by an adverb/);
    expectOneTitlePerText(editor);
  });

  it('a long sentence ending on an adverb (no final punctuation) keeps the adverb tooltip', () => {
    const editor = makeEditor(
      LONG_WITH_ADVERB.replace('walked slowly', 'walked').replace(
        'walking away from them.',
        'walking slowly'
      )
    );
    configure(editor, settingsWith({ flags: true }));
    expect(editor.view.dom.querySelector('[data-prism-flag="long-sentences"]')).not.toBeNull();
    expect(titleAt(editor, 'slowly')).toBe('Adverb: ‘slowly’');
    expect(titleAt(editor, 'bridge')).toMatch(/^Long sentence/);
    expectOneTitlePerText(editor);
  });

  it('partially overlapping flags list both messages where they overlap, narrowest first', () => {
    // A synthetic result: the decoration builder, not the rules, is under test.
    const editor = makeEditor('<p>one two three four five</p>');
    const extraction = extractPrismParagraphs(editor.state.doc);
    const settings = settingsWith({ flags: true });
    const result = runPrismRules(extraction.paragraphs, settings.thresholds);
    const text = extraction.paragraphs[0].text;
    const span = (needle: string, end: string) => ({
      from: text.indexOf(needle),
      to: text.indexOf(end) + end.length,
    });
    result.findings = [
      { checkId: 'passive-voice', paragraph: 0, ...span('one', 'three'), message: 'Passive A' },
      { checkId: 'dialogue-tags', paragraph: 0, ...span('three', 'five'), message: 'Tag B' },
      { checkId: 'adverbs', paragraph: 0, ...span('two', 'two'), message: 'Adverb C' },
    ];
    const set = buildPrismDecorations(editor.state.doc, extraction, result, settings);
    editor.registerPlugin(new Plugin({ props: { decorations: () => set } }));

    expect(titleAt(editor, 'one')).toBe('Passive A');
    expect(titleAt(editor, 'two')).toBe('Adverb C');
    // "three" is the overlap: neither flag contains the other. Passive A is
    // 13 chars, Tag B 15, so Passive A comes first.
    expect(titleAt(editor, 'three')).toBe('Passive A · Tag B');
    expect(titleAt(editor, 'five')).toBe('Tag B');
    expectOneTitlePerText(editor);
  });

  it('a flag inside dialogue keeps data-prism-flag; the tint carries data-prism-tint', () => {
    const editor = makeEditor('<p>“I really should go,” she said.</p>');
    configure(editor, settingsWith({ flags: true, proseColors: true }));
    const crutch = editor.view.dom.querySelector<HTMLElement>('.prism-flag--crutch-words');
    expect(crutch?.textContent).toBe('really');
    expect(crutch?.dataset.prismFlag).toBe('crutch-words');
    expect(crutch?.hasAttribute('data-prism-tint')).toBe(false);
    const tint = crutch?.closest<HTMLElement>('.prism-tint--dialogue');
    expect(tint?.dataset.prismTint).toBe('dialogue');
    expect(tint?.hasAttribute('data-prism-flag')).toBe(false);
    expect(tint?.hasAttribute('title')).toBe(false);
  });
});

// ─── Two editors on one scene ───────────────────────────────────────────────

describe('PrismExtension with two editors on one scene', () => {
  function focusEvent(editor: Editor) {
    editor.view.dom.dispatchEvent(new FocusEvent('focus'));
  }

  it('the focused editor owns the snapshot, even after the other one republishes', () => {
    const a = makeEditor();
    configure(a, DEFAULT_PRISM_SETTINGS);
    const fromA = prismLiveStore.get('scene-1');
    const b = makeEditor('<p>A different, really short scene.</p>');
    configure(b, DEFAULT_PRISM_SETTINGS);
    const fromB = prismLiveStore.get('scene-1');
    expect(fromB).not.toBe(fromA);

    // The writer clicks into A: "Go to" now targets A.
    focusEvent(a);
    expect(prismLiveStore.get('scene-1')).toBe(fromA);

    // B rescans in the background (e.g. it remounted after A saved): A keeps it.
    b.commands.insertContentAt(1, 'Very ');
    b.view.dispatch(b.state.tr.setMeta(PRISM_META, { rescan: true }));
    expect(prismLiveStore.get('scene-1')).toBe(fromA);

    // Focus B: it takes over with its latest snapshot.
    focusEvent(b);
    expect(prismLiveStore.get('scene-1')?.findings.some((f) => f.snippet.startsWith('Very'))).toBe(
      true
    );
  });

  it("destroying one editor falls back to the other editor's snapshot", () => {
    const a = makeEditor();
    configure(a, DEFAULT_PRISM_SETTINGS);
    const fromA = prismLiveStore.get('scene-1');
    const b = makeEditor('<p>A different, really short scene.</p>');
    configure(b, DEFAULT_PRISM_SETTINGS);
    expect(prismLiveStore.get('scene-1')).not.toBe(fromA);

    b.destroy();
    expect(prismLiveStore.get('scene-1')).toBe(fromA);

    // The survivor's reveal still drives its own editor.
    const passive = fromA?.findings.find((f) => f.checkId === 'passive-voice');
    if (!fromA || !passive) throw new Error('expected a passive-voice finding');
    fromA.reveal(passive.docFrom, passive.docTo);
    expect(a.state.doc.textBetween(a.state.selection.from, a.state.selection.to)).toBe(
      'was opened'
    );

    a.destroy();
    expect(prismLiveStore.get('scene-1')).toBeNull();
  });
});

// ─── reveal ─────────────────────────────────────────────────────────────────

describe('PrismExtension reveal', () => {
  it('focuses the editor before it dispatches the selection', () => {
    const editor = makeEditor();
    configure(editor, DEFAULT_PRISM_SETTINGS);
    const snap = prismLiveStore.get('scene-1');
    const adverb = snap?.findings.find((f) => f.checkId === 'adverbs');
    if (!snap || !adverb) throw new Error('expected an adverb finding');
    const focus = vi.spyOn(editor.view, 'focus');
    const dispatch = vi.spyOn(editor.view, 'dispatch');

    snap.reveal(adverb.docFrom, adverb.docTo);
    expect(focus).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalled();
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(dispatch.mock.invocationCallOrder[0]);
    // One dispatch carries the selection and the scroll.
    const tr = dispatch.mock.calls[0][0];
    expect(tr.selectionSet).toBe(true);
    expect(tr.scrolledIntoView).toBe(true);
  });

  it('clears heading focus when the finding sits in a hidden section', () => {
    const editor = makeEditor(
      '<h1>One</h1><p>A plain line.</p><h1>Two</h1><p>She walked slowly.</p>'
    );
    configure(editor, DEFAULT_PRISM_SETTINGS);
    editor.commands.setHeadingFocus(1, 0);
    expect(editor.view.dom.querySelectorAll('.heading-focus-hidden').length).toBeGreaterThan(0);

    const snap = prismLiveStore.get('scene-1');
    const adverb = snap?.findings.find((f) => f.checkId === 'adverbs');
    if (!snap || !adverb) throw new Error('expected an adverb finding');
    snap.reveal(adverb.docFrom, adverb.docTo);

    expect(headingFocusKey.getState(editor.state)?.level).toBeNull();
    expect(editor.view.dom.querySelector('.heading-focus-hidden')).toBeNull();
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('slowly');
  });

  it('keeps heading focus when the finding is in the visible section', () => {
    const editor = makeEditor(
      '<h1>One</h1><p>She walked slowly.</p><h1>Two</h1><p>A plain line.</p>'
    );
    configure(editor, DEFAULT_PRISM_SETTINGS);
    editor.commands.setHeadingFocus(1, 0);
    const snap = prismLiveStore.get('scene-1');
    const adverb = snap?.findings.find((f) => f.checkId === 'adverbs');
    if (!snap || !adverb) throw new Error('expected an adverb finding');
    snap.reveal(adverb.docFrom, adverb.docTo);
    expect(headingFocusKey.getState(editor.state)).toEqual({ level: 1, index: 0 });
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('slowly');
  });
});
