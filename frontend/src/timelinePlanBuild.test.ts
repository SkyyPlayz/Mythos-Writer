// Beta 3 M23 — timeline auto-build from vault Story Plans.
//
// Coverage:
//   §1  parsePlanUnits — headings/list grammar, frontmatter, fences, h1 skip,
//       checkbox + wiki-link + emphasis cleanup
//   §2  normalizePlanTitle — "Chapter 3:" prefixes, punctuation, case
//   §3  mergePlannedIntoTimeline — pass-through with no units; synthetic
//       planned scenes/chapters (wordCount 0 ⇒ grey classification); matched
//       units attach to real chapters/scenes; end-to-end derive keeps the
//       "you are here" position on written data
//   §4  skip-backward flags — planned scenes behind the last written plan
//       position and never written
//   §5  TimelineFlag emission (SKY-7379) — the auto-build pass reshapes skip
//       flags, structural gaps, and projected continuity contradictions into
//       the unified timeline-scoped flag contract

import { describe, expect, it } from 'vitest';
import type { InconsistencyItem } from './InconsistencyCard';
import { deriveAeonTimeline, type AeonChapterInput, type AeonSceneInput } from './timelineAeon';
import {
  cleanPlanTitle,
  mergePlannedIntoTimeline,
  normalizePlanTitle,
  parsePlanUnits,
} from './timelinePlanBuild';

function mkScene(id: string, title: string, chapterId: string, wordCount: number): AeonSceneInput {
  return { id, title, chapterId, date: '', wordCount, pov: '', mood: '', arcIds: [], characterIds: [] };
}

const REAL_CHAPTERS: AeonChapterInput[] = [
  { id: 'ch-1', title: 'The Quiet Before' },
  { id: 'ch-2', title: 'A City in Shadows' },
];

const REAL_SCENES: AeonSceneInput[] = [
  mkScene('sc-1', "The Watcher's Call", 'ch-1', 900),
  mkScene('sc-2', 'The Broken Gate', 'ch-1', 0),
  mkScene('sc-3', 'Embers on the Water', 'ch-2', 1200),
];

// ─── §1 parsing ─────────────────────────────────────────────────────────────

describe('parsePlanUnits', () => {
  it('maps h2 → chapter units, h3/list items → scene units, skips h1', () => {
    const md = [
      '# Plan — The Broken Gate',
      '## Chapter 1: The Quiet Before',
      '### The Watcher\'s Call',
      '- [ ] The Broken Gate',
      '* Signal fires',
      '1. March on the Gate',
      '## Act Two',
    ].join('\n');
    const units = parsePlanUnits(md, 'Plans/gate');
    expect(units.map((u) => `${u.kind}:${u.title}`)).toEqual([
      'chapter:Chapter 1: The Quiet Before',
      "scene:The Watcher's Call",
      'scene:The Broken Gate',
      'scene:Signal fires',
      'scene:March on the Gate',
      'chapter:Act Two',
    ]);
    expect(units.every((u) => u.planId === 'Plans/gate')).toBe(true);
  });

  it('ignores frontmatter and fenced code blocks', () => {
    const md = [
      '---',
      'tags: [plan]',
      '---',
      '```',
      '## Not a chapter',
      '- not a beat',
      '```',
      '- A real beat',
    ].join('\n');
    const units = parsePlanUnits(md, 'p');
    expect(units).toEqual([{ kind: 'scene', title: 'A real beat', planId: 'p' }]);
  });

  it('cleans wiki links, checkboxes, and emphasis from titles', () => {
    expect(cleanPlanTitle('[x] **[[Scenes/The Broken Gate|The Broken Gate]]**')).toBe('The Broken Gate');
    expect(cleanPlanTitle('[[Embers on the Water]] _draft_')).toBe('Embers on the Water draft');
  });

  it('returns nothing for prose-only notes', () => {
    expect(parsePlanUnits('Just some thoughts.\nNothing structured.', 'p')).toEqual([]);
  });
});

// ─── §2 normalization ───────────────────────────────────────────────────────

describe('normalizePlanTitle', () => {
  it('drops Chapter/Scene/Part numbering prefixes and punctuation', () => {
    expect(normalizePlanTitle('Chapter 1: The Quiet Before')).toBe('the quiet before');
    expect(normalizePlanTitle('Scene 12 — The Broken Gate!')).toBe('the broken gate');
    expect(normalizePlanTitle('Part IV: Embers')).toBe('embers');
  });

  it('does not eat words that merely start with a prefix', () => {
    expect(normalizePlanTitle('Chasing shadows')).toBe('chasing shadows');
    expect(normalizePlanTitle('Scenery of the coast')).toBe('scenery of the coast');
  });
});

// ─── §3 merge ───────────────────────────────────────────────────────────────

describe('mergePlannedIntoTimeline', () => {
  it('passes real data through untouched when there are no plan units', () => {
    const out = mergePlannedIntoTimeline(REAL_SCENES, REAL_CHAPTERS, []);
    expect(out.scenes).toBe(REAL_SCENES);
    expect(out.chapters).toBe(REAL_CHAPTERS);
    expect(out.skipped).toEqual([]);
  });

  it('creates synthetic planned scenes under matched real chapters', () => {
    const units = parsePlanUnits(
      ['## Chapter 1: The Quiet Before', '- Signal fires'].join('\n'),
      'p',
    );
    const out = mergePlannedIntoTimeline(REAL_SCENES, REAL_CHAPTERS, units);
    expect(out.chapters).toHaveLength(2); // chapter matched — no synthetic
    const added = out.scenes.filter((s) => s.id.startsWith('plan:'));
    expect(added).toHaveLength(1);
    expect(added[0].title).toBe('Signal fires');
    expect(added[0].chapterId).toBe('ch-1');
    expect(added[0].wordCount).toBe(0); // ⇒ planned/grey in Plan-vs-Progress
  });

  it('creates synthetic chapters for unmatched plan headings', () => {
    const units = parsePlanUnits(['## Act Two', '- March on the Gate'].join('\n'), 'p');
    const out = mergePlannedIntoTimeline(REAL_SCENES, REAL_CHAPTERS, units);
    expect(out.chapters).toHaveLength(3);
    expect(out.chapters[2].title).toBe('Act Two');
    const added = out.scenes.filter((s) => s.id.startsWith('plan:'));
    expect(added[0].chapterId).toBe(out.chapters[2].id);
  });

  it('groups chapterless beats under a shared "Planned from notes" chapter', () => {
    const out = mergePlannedIntoTimeline(REAL_SCENES, REAL_CHAPTERS, parsePlanUnits('- A beat\n- Another beat', 'p'));
    const fallback = out.chapters.find((c) => c.title === 'Planned from notes');
    expect(fallback).toBeDefined();
    expect(out.scenes.filter((s) => s.chapterId === fallback!.id)).toHaveLength(2);
  });

  it('does not duplicate scenes the manuscript already has (matched titles)', () => {
    const units = parsePlanUnits("- The Watcher's Call\n- The Broken Gate", 'p');
    const out = mergePlannedIntoTimeline(REAL_SCENES, REAL_CHAPTERS, units);
    expect(out.scenes).toHaveLength(REAL_SCENES.length);
  });

  it('dedupes repeated plan titles across units', () => {
    const out = mergePlannedIntoTimeline(REAL_SCENES, REAL_CHAPTERS, parsePlanUnits('- Signal fires\n- Signal fires', 'p'));
    expect(out.scenes.filter((s) => s.id.startsWith('plan:'))).toHaveLength(1);
  });

  it('feeds deriveAeonTimeline: planned units grey out, "you are here" stays on written data', () => {
    const units = parsePlanUnits(['## Act Two', '- March on the Gate'].join('\n'), 'p');
    const merged = mergePlannedIntoTimeline(REAL_SCENES, REAL_CHAPTERS, units);
    const data = deriveAeonTimeline({
      storyTitle: 'The Last City',
      scenes: merged.scenes,
      chapters: merged.chapters,
      arcs: [],
      characters: [],
      worldEvents: [],
      concepts: [],
    });
    expect(data.chapters).toHaveLength(3);
    expect(data.chapters[2].written).toBe(false); // planned chapter is grey
    expect(data.hereIndex).toBe(1); // last WRITTEN chapter is still ch-2
  });

  it('populates a timeline from plans alone (no written scenes — no manual entry)', () => {
    const units = parsePlanUnits(['## Act One', '- First beat', '- Second beat'].join('\n'), 'p');
    const merged = mergePlannedIntoTimeline([], [], units);
    const data = deriveAeonTimeline({
      storyTitle: 'Fresh Story',
      scenes: merged.scenes,
      chapters: merged.chapters,
      arcs: [],
      characters: [],
      worldEvents: [],
      concepts: [],
    });
    expect(data.chapters).toHaveLength(1);
    expect(data.events).toHaveLength(2);
    expect(data.events.every((e) => !e.written)).toBe(true);
  });
});

// ─── §4 skip-backward flags ─────────────────────────────────────────────────

describe('skip-backward flags', () => {
  it('flags planned scenes behind the last written plan position', () => {
    // Plan order: Watcher's Call (written) → Broken Gate (real, unwritten) →
    // Signal fires (planned) → Embers on the Water (written, LAST) → Finale.
    const md = [
      "- The Watcher's Call",
      '- The Broken Gate',
      '- Signal fires',
      '- Embers on the Water',
      '- Finale',
    ].join('\n');
    const out = mergePlannedIntoTimeline(REAL_SCENES, REAL_CHAPTERS, parsePlanUnits(md, 'Plans/gate'));
    expect(out.skipped.map((f) => f.title)).toEqual(['The Broken Gate', 'Signal fires']);
    expect(out.skipped[0].planId).toBe('Plans/gate');
  });

  it('flags nothing when writing follows plan order', () => {
    const md = ["- The Watcher's Call", '- The Broken Gate', '- Finale'].join('\n');
    const out = mergePlannedIntoTimeline(
      [mkScene('sc-1', "The Watcher's Call", 'ch-1', 900), mkScene('sc-2', 'The Broken Gate', 'ch-1', 0)],
      REAL_CHAPTERS,
      parsePlanUnits(md, 'p'),
    );
    expect(out.skipped).toEqual([]);
  });

  it('flags nothing when no plan unit is written yet', () => {
    const out = mergePlannedIntoTimeline([], [], parsePlanUnits('- One\n- Two', 'p'));
    expect(out.skipped).toEqual([]);
  });
});

// ─── §5 TimelineFlag emission (SKY-7379) ────────────────────────────────────

describe('TimelineFlag emission (SKY-7379)', () => {
  it('emits ordering_skip, gap, and contradiction flags matching the shared TimelineFlag shape', () => {
    // Same skip-backward story as §4, plus a trailing chapter heading with no
    // scenes under it (structural gap) and an open continuity flag anchored
    // to a real scene on this timeline (contradiction).
    const md = [
      "- The Watcher's Call",
      '- The Broken Gate',
      '- Signal fires',
      '- Embers on the Water',
      '- Finale',
      '## Interlude',
    ].join('\n');

    const continuityItem: InconsistencyItem = {
      id: 'ic-1',
      category: 'factual_contradiction',
      severity: 'medium',
      manuscriptAnchor: { sceneId: 'sc-1', offset: 10, excerpt: 'a contradiction excerpt' },
      vaultAnchor: { notePath: 'Vault/x.md', line: 1, excerpt: 'vault excerpt' },
      rationale: 'Scene contradicts the vault entry',
      proposedResolution: { matchArchiveToStory: '', suggestStoryChange: '' },
      status: 'open',
      resolvedAt: null,
      resolvedAction: null,
      createdAt: '2026-07-01T00:00:00.000Z',
    };

    const out = mergePlannedIntoTimeline(
      REAL_SCENES,
      REAL_CHAPTERS,
      parsePlanUnits(md, 'Plans/gate'),
      [continuityItem],
    );

    for (const flag of out.flags) {
      expect(flag).toMatchObject({
        id: expect.any(String),
        kind: expect.stringMatching(/^(contradiction|gap|ordering_skip)$/),
        description: expect.any(String),
        anchor: expect.any(String),
        affectedItemId: expect.any(String),
      });
    }

    expect(out.flags.map((f) => f.kind).sort()).toEqual([
      'contradiction',
      'gap',
      'ordering_skip',
      'ordering_skip',
    ]);

    expect(out.flags.find((f) => f.kind === 'contradiction')).toEqual({
      id: 'ic-1',
      kind: 'contradiction',
      description: 'Scene contradicts the vault entry',
      anchor: 'a contradiction excerpt',
      affectedItemId: 'sc-1',
    });

    const gap = out.flags.find((f) => f.kind === 'gap')!;
    expect(gap.description).toContain('Interlude');
    expect(gap.affectedItemId).toBe(out.chapters.find((c) => c.title === 'Interlude')!.id);
  });

  it('drops a resolved continuity flag and one anchored off this timeline', () => {
    const resolved: InconsistencyItem = {
      id: 'ic-resolved',
      category: 'factual_contradiction',
      severity: 'low',
      manuscriptAnchor: { sceneId: 'sc-1', offset: 0, excerpt: 'x' },
      vaultAnchor: { notePath: 'v.md', line: 1, excerpt: 'y' },
      rationale: 'already handled',
      proposedResolution: { matchArchiveToStory: '', suggestStoryChange: '' },
      status: 'resolved',
      resolvedAt: '2026-07-02T00:00:00.000Z',
      resolvedAction: 'match_archive_to_story',
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    const offTimeline: InconsistencyItem = {
      ...resolved,
      id: 'ic-off-timeline',
      status: 'open',
      resolvedAt: null,
      resolvedAction: null,
      manuscriptAnchor: { sceneId: 'sc-not-here', offset: 0, excerpt: 'z' },
    };
    const out = mergePlannedIntoTimeline(REAL_SCENES, REAL_CHAPTERS, [], [resolved, offTimeline]);
    expect(out.flags.filter((f) => f.kind === 'contradiction')).toEqual([]);
  });
});
