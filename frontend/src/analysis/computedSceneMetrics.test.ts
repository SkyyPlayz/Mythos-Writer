// Beta 4 M13 — computed scene metrics tests (§5.4).
// Everything here must hold with AI completely disabled: the module is pure
// text analysis with no window.api / IPC involvement.

import { describe, it, expect } from 'vitest';
import {
  computeSceneMetrics,
  computedAnalysisRows,
  countWords,
  splitSentences,
  stripDialogue,
  sceneParagraphs,
  formatWordCount,
  formatReadTime,
  formatAvgSentenceLength,
  formatSplit,
  formatFilterWordSummary,
  sceneBalanceNote,
  READ_WPM,
  type AnalyzableScene,
  type ComputedSceneMetrics,
} from './computedSceneMetrics';

function scene(blocks: Array<{ type?: string; content: string }>): AnalyzableScene {
  return {
    title: 'Into the Undercity',
    blocks: blocks.map((b, i) => ({
      type: (b.type ?? 'prose') as AnalyzableScene['blocks'][number]['type'],
      content: b.content,
      order: i,
    })),
  };
}

// ── Primitives ──────────────────────────────────────────────────────────────

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('The stairwell yawned like a throat.')).toBe(6);
  });
  it('is 0 for empty/whitespace text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });
  it('collapses runs of whitespace', () => {
    expect(countWords('one  two\n three')).toBe(3);
  });
});

describe('splitSentences', () => {
  it('splits on . ! ? and …', () => {
    expect(splitSentences('She ran. He followed! Where now? Nowhere…')).toHaveLength(4);
  });
  it('keeps trailing quotes attached to the sentence', () => {
    const s = splitSentences('“Stop.” He ran.');
    expect(s).toEqual(['“Stop.”', 'He ran.']);
  });
  it('counts an unterminated tail fragment as a sentence', () => {
    expect(splitSentences('The fog rolled in. No one saw it coming')).toHaveLength(2);
  });
  it('is empty for empty text', () => {
    expect(splitSentences('')).toEqual([]);
  });
});

describe('stripDialogue', () => {
  it('removes straight- and curly-quoted spans', () => {
    const stripped = stripDialogue('He said, "run home" and “stay low” twice.');
    expect(stripped.replace(/\s+/g, ' ').trim()).toBe('He said, and twice.');
  });
});

describe('sceneParagraphs', () => {
  it('numbers paragraphs 1-based across blocks and splits on blank lines', () => {
    const ps = sceneParagraphs(scene([
      { content: 'First paragraph.\n\nSecond paragraph.' },
      { content: 'Third paragraph.' },
    ]));
    expect(ps.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(ps[2].text).toBe('Third paragraph.');
  });
  it('skips note blocks entirely', () => {
    const ps = sceneParagraphs(scene([
      { type: 'note', content: 'todo: fix this later' },
      { content: 'Real prose.' },
    ]));
    expect(ps).toHaveLength(1);
    expect(ps[0].index).toBe(1);
  });
  it('respects block order over array order', () => {
    const s: AnalyzableScene = {
      title: 't',
      blocks: [
        { type: 'prose', content: 'Second.', order: 1 },
        { type: 'prose', content: 'First.', order: 0 },
      ],
    };
    expect(sceneParagraphs(s).map((p) => p.text)).toEqual(['First.', 'Second.']);
  });
});

// ── Core metrics ────────────────────────────────────────────────────────────

describe('computeSceneMetrics — words / read time / sentences', () => {
  it('word count sums all non-note paragraphs', () => {
    const m = computeSceneMetrics(scene([
      { content: 'One two three.' },
      { type: 'note', content: 'not counted at all' },
      { content: 'Four five.' },
    ]));
    expect(m.words).toBe(5);
  });

  it('read time uses READ_WPM with a 1-minute floor', () => {
    expect(READ_WPM).toBe(250);
    const words = Array.from({ length: 500 }, (_, i) => `w${i}`).join(' ') + '.';
    const m = computeSceneMetrics(scene([{ content: words }]));
    expect(m.readTimeMinutes).toBe(2);
    const short = computeSceneMetrics(scene([{ content: 'Tiny scene here.' }]));
    expect(short.readTimeMinutes).toBe(1);
    const empty = computeSceneMetrics(scene([]));
    expect(empty.readTimeMinutes).toBe(0);
  });

  it('average sentence length is words / sentences', () => {
    const m = computeSceneMetrics(scene([{ content: 'One two three four. Five six.' }]));
    expect(m.sentenceCount).toBe(2);
    expect(m.avgSentenceWords).toBe(3);
  });

  it('everything zeroes out on an empty scene (AI-disabled acceptance floor)', () => {
    const m = computeSceneMetrics(scene([]));
    expect(m.words).toBe(0);
    expect(m.sentenceCount).toBe(0);
    expect(m.avgSentenceWords).toBe(0);
    expect(m.dialoguePct + m.descriptionPct + m.actionPct).toBe(0);
    expect(m.filterWordTotal).toBe(0);
    expect(m.adverbDialogueTags).toBe(0);
    expect(m.pov).toBe('Unclear');
  });
});

describe('computeSceneMetrics — dialogue/description/action split', () => {
  it('block types are authoritative when available', () => {
    const m = computeSceneMetrics(scene([
      { type: 'dialogue', content: 'one two three four' },       // 4 words
      { type: 'description', content: 'one two three four' },    // 4 words
      { type: 'action', content: 'one two' },                    // 2 words
    ]));
    expect(m.dialoguePct).toBe(40);
    expect(m.descriptionPct).toBe(40);
    expect(m.actionPct).toBe(20);
  });

  it('percentages always sum to 100 when the scene has words', () => {
    const m = computeSceneMetrics(scene([
      { type: 'dialogue', content: 'a b' },
      { type: 'description', content: 'a b' },
      { type: 'action', content: 'a b' },
    ]));
    expect(m.dialoguePct + m.descriptionPct + m.actionPct).toBe(100);
  });

  it('prose blocks: quoted spans are dialogue', () => {
    const m = computeSceneMetrics(scene([
      { content: '“Stay close now,” Kael whispered near.' }, // 3 quoted + 3 narration words
    ]));
    expect(m.dialoguePct).toBe(50);
  });

  it('prose blocks: motion-verb sentences count as action, the rest as description', () => {
    const m = computeSceneMetrics(scene([
      { content: 'The market smelled of rust and rain. Mira sprinted across the square.' },
    ]));
    expect(m.actionPct).toBeGreaterThan(0);
    expect(m.descriptionPct).toBeGreaterThan(0);
    expect(m.dialoguePct).toBe(0);
  });
});

describe('computeSceneMetrics — filter words with locations', () => {
  it('finds filter words and records 1-based paragraph indexes', () => {
    const m = computeSceneMetrics(scene([
      { content: 'The tunnel curved down into the dark.' },
      { content: 'She felt the cold. She heard water. She saw nothing.' },
    ]));
    expect(m.filterWordTotal).toBe(3);
    expect(m.filterWordHits).toEqual([
      { word: 'felt', paragraph: 2 },
      { word: 'heard', paragraph: 2 },
      { word: 'saw', paragraph: 2 },
    ]);
  });

  it('matches case-insensitively', () => {
    const m = computeSceneMetrics(scene([{ content: 'Felt like rain. FELT like more.' }]));
    expect(m.filterWordTotal).toBe(2);
  });

  it('ignores filter words spoken inside dialogue', () => {
    const m = computeSceneMetrics(scene([
      { content: '“I heard you the first time,” she snapped.' },
    ]));
    expect(m.filterWordTotal).toBe(0);
  });

  it('ignores dialogue-typed blocks entirely', () => {
    const m = computeSceneMetrics(scene([
      { type: 'dialogue', content: 'I felt that. I saw it too.' },
    ]));
    expect(m.filterWordTotal).toBe(0);
  });
});

describe('computeSceneMetrics — adverb dialogue tags', () => {
  it('counts verb-then-adverb tags on quoted lines', () => {
    const m = computeSceneMetrics(scene([
      { content: '“Stay close,” he said nervously.' },
    ]));
    expect(m.adverbDialogueTags).toBe(1);
  });

  it('counts adverb-then-verb tags and named speakers', () => {
    const m = computeSceneMetrics(scene([
      { content: '“Go,” Mira said quietly. “Now,” he urgently whispered.' },
    ]));
    expect(m.adverbDialogueTags).toBe(2);
  });

  it('ignores -ly words that are not manner adverbs', () => {
    const m = computeSceneMetrics(scene([
      { content: '“Fine,” he said only to the family.' },
    ]));
    expect(m.adverbDialogueTags).toBe(0);
  });

  it('ignores adverbs in narration without dialogue', () => {
    const m = computeSceneMetrics(scene([
      { content: 'He walked slowly to the gate and said nothing.' },
    ]));
    expect(m.adverbDialogueTags).toBe(0);
  });
});

describe('computeSceneMetrics — POV & pacing heuristics', () => {
  it('detects first person from narration pronouns', () => {
    const m = computeSceneMetrics(scene([
      { content: 'I took the stairs two at a time. My hands would not stop shaking.' },
    ]));
    expect(m.pov).toBe('First person');
  });

  it('detects third person', () => {
    const m = computeSceneMetrics(scene([
      { content: 'She took the stairs two at a time. Her hands would not stop shaking.' },
    ]));
    expect(m.pov).toBe('Third person');
  });

  it('detects second person', () => {
    const m = computeSceneMetrics(scene([
      { content: 'You take the stairs two at a time. Your hands will not stop shaking.' },
    ]));
    expect(m.pov).toBe('Second person');
  });

  it('first-person dialogue does not fool third-person detection', () => {
    const m = computeSceneMetrics(scene([
      { content: '“I know what I did,” she told him. He turned his back on her.' },
    ]));
    expect(m.pov).toBe('Third person');
  });

  it('bands pacing on average sentence length', () => {
    const fast = computeSceneMetrics(scene([{ content: 'She ran. He hid. Doors slammed.' }]));
    expect(fast.pacing).toBe('Fast');
    const slow = computeSceneMetrics(scene([{
      content: 'The corridor unspooled ahead of them in a long procession of arches and rotting banners that nobody living could remember the names of anymore.',
    }]));
    expect(slow.pacing).toBe('Slow');
  });
});

// ── Formatters (prototype value shapes) ─────────────────────────────────────

describe('formatters', () => {
  it('formatWordCount uses thousands separators (1,842)', () => {
    expect(formatWordCount(1842)).toBe('1,842');
    expect(formatWordCount(42)).toBe('42');
  });

  it('formatReadTime matches the prototype shape (~7 min)', () => {
    expect(formatReadTime({ words: 1842, readTimeMinutes: 7 })).toBe('~7 min');
    expect(formatReadTime({ words: 0, readTimeMinutes: 0 })).toBe('0 min');
  });

  it('formatAvgSentenceLength renders one decimal (16.4 words)', () => {
    expect(formatAvgSentenceLength(16.42)).toBe('16.4 words');
    expect(formatAvgSentenceLength(0)).toBe('0.0 words');
  });

  it('formatSplit matches the prototype shape (38% · 47% · 15%)', () => {
    expect(formatSplit({ dialoguePct: 38, descriptionPct: 47, actionPct: 15 }))
      .toBe('38% · 47% · 15%');
  });

  it('formatFilterWordSummary clusters when half the hits share a paragraph', () => {
    const hits = [
      { word: 'felt', paragraph: 2 },
      { word: 'saw', paragraph: 2 },
      { word: 'heard', paragraph: 2 },
      { word: 'felt', paragraph: 5 },
    ];
    expect(formatFilterWordSummary({ filterWordTotal: 4, filterWordHits: hits }))
      .toBe('4 — clustered in ¶2');
  });

  it('formatFilterWordSummary lists paragraphs when spread out', () => {
    const hits = [
      { word: 'felt', paragraph: 1 },
      { word: 'saw', paragraph: 3 },
    ];
    expect(formatFilterWordSummary({ filterWordTotal: 2, filterWordHits: hits }))
      .toBe('2 — ¶1, ¶3');
  });

  it('formatFilterWordSummary summarises very spread-out hits', () => {
    const hits = [1, 3, 5, 7].map((p) => ({ word: 'saw', paragraph: p }));
    expect(formatFilterWordSummary({ filterWordTotal: 4, filterWordHits: hits }))
      .toBe('4 — across 4 paragraphs');
  });

  it('formatFilterWordSummary is "0" with no hits', () => {
    expect(formatFilterWordSummary({ filterWordTotal: 0, filterWordHits: [] })).toBe('0');
  });

  it('computedAnalysisRows emits the six prototype rows in order', () => {
    const m = computeSceneMetrics(scene([
      { content: 'She felt the dark press close. “Run,” he said sharply. Mira sprinted for the stairs.' },
    ]));
    const rows = computedAnalysisRows(m);
    expect(rows.map(([k]) => k)).toEqual([
      'Words',
      'Read time',
      'Avg sentence length',
      'Dialogue · Description · Action',
      'Filter words (felt, saw, heard)',
      'Adverb dialogue tags',
    ]);
    expect(rows[0][1]).toBe(formatWordCount(m.words));
    expect(rows[4][1]).toContain('¶1');
    expect(rows[5][1]).toBe('1');
  });
});

describe('sceneBalanceNote', () => {
  const base: Omit<ComputedSceneMetrics, 'dialoguePct' | 'descriptionPct' | 'actionPct'> = {
    words: 100, readTimeMinutes: 1, sentenceCount: 10, avgSentenceWords: 10,
    filterWordTotal: 0, filterWordHits: [], adverbDialogueTags: 0,
    pov: 'Third person', pacing: 'Medium',
  };

  it('empty scene', () => {
    expect(sceneBalanceNote({ ...base, words: 0, dialoguePct: 0, descriptionPct: 0, actionPct: 0 }))
      .toMatch(/Nothing to measure yet/);
  });
  it('balanced description/action gets the prototype note', () => {
    expect(sceneBalanceNote({ ...base, dialoguePct: 38, descriptionPct: 47, actionPct: 15 }))
      .not.toMatch(/balance/); // 47 vs 15 is a 32-point gap — leaning
    expect(sceneBalanceNote({ ...base, dialoguePct: 30, descriptionPct: 40, actionPct: 30 }))
      .toBe('Nice balance of description and action.');
  });
  it('dialogue-heavy', () => {
    expect(sceneBalanceNote({ ...base, dialoguePct: 60, descriptionPct: 25, actionPct: 15 }))
      .toMatch(/Dialogue-heavy/);
  });
  it('action-forward', () => {
    expect(sceneBalanceNote({ ...base, dialoguePct: 10, descriptionPct: 30, actionPct: 60 }))
      .toMatch(/Action-forward/);
  });
  it('description-rich', () => {
    expect(sceneBalanceNote({ ...base, dialoguePct: 10, descriptionPct: 70, actionPct: 20 }))
      .toMatch(/Description-rich/);
  });
});
