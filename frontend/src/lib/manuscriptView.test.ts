// Unit tests for the manuscriptView pure selector — SKY-3210
import { describe, it, expect } from 'vitest';
import { selectManuscriptView, stepScene } from './manuscriptView';
import type { SelectionState, ChapterHeadingBand, SceneBand } from './manuscriptView';
import type { Manifest, Story, Chapter, Scene } from '../types';

// ─── Test data factories ─────────────────────────────────────────────────────

const NOW = '2026-01-01T00:00:00.000Z';

function makeScene(id: string, title: string, order: number, chapterId: string, storyId: string): Scene {
  return {
    id,
    title,
    path: `Manuscript/story/${id}.md`,
    order,
    chapterId,
    storyId,
    blocks: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeChapter(id: string, title: string, order: number, scenes: Scene[]): Chapter {
  return {
    id,
    title,
    path: `Manuscript/story/${id}`,
    order,
    scenes,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeStory(id: string, title: string, chapters: Chapter[]): Story {
  return {
    id,
    title,
    path: `Manuscript/${id}`,
    chapters,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeManifest(stories: Story[]): Manifest {
  return {
    version: '1',
    vaultRoot: '/tmp/vault',
    stories,
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };
}

// Convenience: single story, 2 chapters, 3 scenes total
function makeTwoChapterManifest() {
  const s1 = makeScene('scene-1', 'Opening', 0, 'ch-1', 'story-1');
  const s2 = makeScene('scene-2', 'Rising Action', 1, 'ch-1', 'story-1');
  const s3 = makeScene('scene-3', 'Climax', 0, 'ch-2', 'story-1');

  const ch1 = makeChapter('ch-1', 'Chapter One', 0, [s1, s2]);
  const ch2 = makeChapter('ch-2', 'Chapter Two', 1, [s3]);

  const story = makeStory('story-1', 'My Story', [ch1, ch2]);
  return { manifest: makeManifest([story]), s1, s2, s3, ch1, ch2, story };
}

// ─── Empty / degenerate ───────────────────────────────────────────────────────

describe('empty manifest', () => {
  it('returns empty bands when there are no stories', () => {
    const result = selectManuscriptView({
      manifest: makeManifest([]),
      selection: { storyId: null, chapterId: null, sceneId: null },
      depth: 'book',
    });
    expect(result.bands).toHaveLength(0);
    expect(result.orderedSceneIds).toHaveLength(0);
    expect(result.canPrev).toBe(false);
    expect(result.canNext).toBe(false);
  });

  it('returns empty when storyId is provided but not found', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'does-not-exist', chapterId: null, sceneId: null },
      depth: 'book',
    });
    expect(result.bands).toHaveLength(0);
  });
});

// ─── depth=book ──────────────────────────────────────────────────────────────

describe('depth=book', () => {
  it('emits all chapter headings and scenes across the whole story', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    // ch1-heading, scene-1, scene-2, ch2-heading, scene-3
    expect(result.bands).toHaveLength(5);
    expect(result.bands[0].kind).toBe('chapter-heading');
    expect((result.bands[0] as ChapterHeadingBand).chapterId).toBe('ch-1');
    expect(result.bands[1].kind).toBe('scene');
    expect((result.bands[1] as SceneBand).sceneId).toBe('scene-1');
    expect(result.bands[2].kind).toBe('scene');
    expect((result.bands[2] as SceneBand).sceneId).toBe('scene-2');
    expect(result.bands[3].kind).toBe('chapter-heading');
    expect((result.bands[3] as ChapterHeadingBand).chapterId).toBe('ch-2');
    expect(result.bands[4].kind).toBe('scene');
    expect((result.bands[4] as SceneBand).sceneId).toBe('scene-3');
  });

  it('assigns headingLevel h1 to chapter bands', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    const chBands = result.bands.filter(b => b.kind === 'chapter-heading') as ChapterHeadingBand[];
    expect(chBands.every(b => b.headingLevel === 'h1')).toBe(true);
  });

  it('assigns headingLevel h2 to scene bands', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    const sceneBands = result.bands.filter(b => b.kind === 'scene') as SceneBand[];
    expect(sceneBands.every(b => b.headingLevel === 'h2')).toBe(true);
  });

  it('falls back to first story when storyId is null', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: null, chapterId: null, sceneId: null },
      depth: 'book',
    });
    expect(result.bands).toHaveLength(5);
  });

  it('sorts chapters by order', () => {
    const s3 = makeScene('scene-3', 'Climax', 0, 'ch-2', 'story-1');
    const s1 = makeScene('scene-1', 'Opening', 0, 'ch-1', 'story-1');
    // ch-2 has order=1, ch-1 has order=0; story lists them reversed
    const ch2 = makeChapter('ch-2', 'Chapter Two', 1, [s3]);
    const ch1 = makeChapter('ch-1', 'Chapter One', 0, [s1]);
    const story = makeStory('story-1', 'My Story', [ch2, ch1]); // reversed in array
    const manifest = makeManifest([story]);

    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    // Despite reversed array, ch-1 (order=0) should come first
    expect((result.bands[0] as ChapterHeadingBand).chapterId).toBe('ch-1');
    expect((result.bands[2] as ChapterHeadingBand).chapterId).toBe('ch-2');
  });

  it('sorts scenes by order within each chapter', () => {
    // scenes inserted in reverse order in array
    const s2 = makeScene('scene-2', 'Rising', 1, 'ch-1', 'story-1');
    const s1 = makeScene('scene-1', 'Opening', 0, 'ch-1', 'story-1');
    const ch1 = makeChapter('ch-1', 'Chapter One', 0, [s2, s1]); // reversed
    const story = makeStory('story-1', 'My Story', [ch1]);
    const manifest = makeManifest([story]);

    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    expect((result.bands[1] as SceneBand).sceneId).toBe('scene-1');
    expect((result.bands[2] as SceneBand).sceneId).toBe('scene-2');
  });

  it('includes storyId on each scene band', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    const sceneBands = result.bands.filter(b => b.kind === 'scene') as SceneBand[];
    expect(sceneBands.every(b => b.storyId === 'story-1')).toBe(true);
  });

  it('preserves draftState on scene bands', () => {
    const s1: Scene = {
      ...makeScene('scene-1', 'Opening', 0, 'ch-1', 'story-1'),
      draftState: 'review',
    };
    const ch1 = makeChapter('ch-1', 'Chapter One', 0, [s1]);
    const story = makeStory('story-1', 'My Story', [ch1]);
    const manifest = makeManifest([story]);

    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    const sceneBand = result.bands.find(b => b.kind === 'scene') as SceneBand;
    expect(sceneBand.draftState).toBe('review');
  });

  it('leaves draftState undefined when scene has no draftState', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    const sceneBand = result.bands.find(b => b.kind === 'scene') as SceneBand;
    expect(sceneBand.draftState).toBeUndefined();
  });

  it('emits a chapter heading with correct title and order', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    const chBand = result.bands[0] as ChapterHeadingBand;
    expect(chBand.title).toBe('Chapter One');
    expect(chBand.order).toBe(0);
  });

  it('handles a chapter with no scenes (emits heading only, no crash)', () => {
    const ch1 = makeChapter('ch-1', 'Empty Chapter', 0, []);
    const story = makeStory('story-1', 'My Story', [ch1]);
    const manifest = makeManifest([story]);

    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    expect(result.bands).toHaveLength(1);
    expect(result.bands[0].kind).toBe('chapter-heading');
  });
});

// ─── depth=chapter ───────────────────────────────────────────────────────────

describe('depth=chapter', () => {
  it('emits heading + scenes for selected chapter only', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-2', sceneId: null },
      depth: 'chapter',
    });
    expect(result.bands).toHaveLength(2); // heading + scene-3
    expect((result.bands[0] as ChapterHeadingBand).chapterId).toBe('ch-2');
    expect((result.bands[1] as SceneBand).sceneId).toBe('scene-3');
  });

  it('chapter heading is h1 in chapter depth', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: null },
      depth: 'chapter',
    });
    expect((result.bands[0] as ChapterHeadingBand).headingLevel).toBe('h1');
  });

  it('scenes are h2 in chapter depth', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: null },
      depth: 'chapter',
    });
    const sceneBands = result.bands.filter(b => b.kind === 'scene') as SceneBand[];
    expect(sceneBands.every(b => b.headingLevel === 'h2')).toBe(true);
  });

  it('falls back to first chapter when chapterId is null', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'chapter',
    });
    expect((result.bands[0] as ChapterHeadingBand).chapterId).toBe('ch-1');
  });

  it('returns empty bands when chapterId is not found', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'no-such-chapter', sceneId: null },
      depth: 'chapter',
    });
    expect(result.bands).toHaveLength(0);
  });

  it('orderedSceneIds spans the whole story even in chapter depth', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: null },
      depth: 'chapter',
    });
    // orderedSceneIds is always the full story list for cross-chapter navigation
    expect(result.orderedSceneIds).toEqual(['scene-1', 'scene-2', 'scene-3']);
  });
});

// ─── depth=scene ─────────────────────────────────────────────────────────────

describe('depth=scene', () => {
  it('emits a single scene band for the selected scene', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: 'scene-2' },
      depth: 'scene',
    });
    expect(result.bands).toHaveLength(1);
    expect(result.bands[0].kind).toBe('scene');
    expect((result.bands[0] as SceneBand).sceneId).toBe('scene-2');
  });

  it('scene band is h2', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: 'scene-1' },
      depth: 'scene',
    });
    expect((result.bands[0] as SceneBand).headingLevel).toBe('h2');
  });

  it('selectedSceneIndex reflects position in orderedSceneIds', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: 'scene-2' },
      depth: 'scene',
    });
    // scene-2 is index 1 in [scene-1, scene-2, scene-3]
    expect(result.selectedSceneIndex).toBe(1);
  });

  it('selectedSceneIndex is 0 for the first scene', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: 'scene-1' },
      depth: 'scene',
    });
    expect(result.selectedSceneIndex).toBe(0);
  });

  it('selectedSceneIndex is last index for the last scene', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-2', sceneId: 'scene-3' },
      depth: 'scene',
    });
    expect(result.selectedSceneIndex).toBe(2);
  });

  it('returns empty bands when sceneId is not found', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: 'ghost-scene' },
      depth: 'scene',
    });
    expect(result.bands).toHaveLength(0);
  });

  it('selectedSceneIndex is -1 at depth=book', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: 'scene-1' },
      depth: 'book',
    });
    expect(result.selectedSceneIndex).toBe(-1);
  });

  it('finds scene across chapter boundaries (sceneId in ch-2, selection has ch-1)', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: 'scene-3' },
      depth: 'scene',
    });
    // Should still find scene-3 even if chapterId says ch-1
    expect(result.bands).toHaveLength(1);
    expect((result.bands[0] as SceneBand).sceneId).toBe('scene-3');
    expect((result.bands[0] as SceneBand).chapterId).toBe('ch-2');
  });
});

// ─── orderedSceneIds ──────────────────────────────────────────────────────────

describe('orderedSceneIds', () => {
  it('lists all scene IDs in chapter/scene order across the story', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    expect(result.orderedSceneIds).toEqual(['scene-1', 'scene-2', 'scene-3']);
  });

  it('respects chapter ordering when building orderedSceneIds', () => {
    // Create story with chapters in reversed order in array
    const s3 = makeScene('scene-3', 'Climax', 0, 'ch-2', 'story-1');
    const s1 = makeScene('scene-1', 'Opening', 0, 'ch-1', 'story-1');
    const ch2 = makeChapter('ch-2', 'Chapter Two', 1, [s3]);
    const ch1 = makeChapter('ch-1', 'Chapter One', 0, [s1]);
    const story = makeStory('story-1', 'My Story', [ch2, ch1]); // ch2 first in array
    const manifest = makeManifest([story]);

    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    // ch-1 (order=0) comes before ch-2 (order=1)
    expect(result.orderedSceneIds).toEqual(['scene-1', 'scene-3']);
  });
});

// ─── canPrev / canNext ───────────────────────────────────────────────────────

describe('canPrev / canNext', () => {
  it('are false when there are no scenes', () => {
    const ch1 = makeChapter('ch-1', 'Empty Chapter', 0, []);
    const story = makeStory('story-1', 'My Story', [ch1]);
    const manifest = makeManifest([story]);

    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    expect(result.canPrev).toBe(false);
    expect(result.canNext).toBe(false);
  });

  it('are false when there is exactly one scene', () => {
    const s1 = makeScene('scene-1', 'Opening', 0, 'ch-1', 'story-1');
    const ch1 = makeChapter('ch-1', 'Chapter One', 0, [s1]);
    const story = makeStory('story-1', 'My Story', [ch1]);
    const manifest = makeManifest([story]);

    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: 'scene-1' },
      depth: 'scene',
    });
    expect(result.canPrev).toBe(false);
    expect(result.canNext).toBe(false);
  });

  it('are true when there are two or more scenes', () => {
    const { manifest } = makeTwoChapterManifest();
    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: 'scene-1' },
      depth: 'scene',
    });
    expect(result.canPrev).toBe(true);
    expect(result.canNext).toBe(true);
  });
});

// ─── stepScene ───────────────────────────────────────────────────────────────

describe('stepScene', () => {
  const { manifest } = makeTwoChapterManifest();
  const orderedIds = ['scene-1', 'scene-2', 'scene-3'];

  it('steps next from first scene to second scene', () => {
    const result = stepScene(orderedIds, 'scene-1', 'next', manifest);
    expect(result?.sceneId).toBe('scene-2');
  });

  it('steps next from second to third (cross-chapter)', () => {
    // scene-2 is in ch-1, scene-3 is in ch-2
    const result = stepScene(orderedIds, 'scene-2', 'next', manifest);
    expect(result?.sceneId).toBe('scene-3');
    expect(result?.chapterId).toBe('ch-2');
  });

  it('wraps next from last scene to first scene (edge-arrow wrap)', () => {
    const result = stepScene(orderedIds, 'scene-3', 'next', manifest);
    expect(result?.sceneId).toBe('scene-1');
  });

  it('steps prev from last scene to second-to-last', () => {
    const result = stepScene(orderedIds, 'scene-3', 'prev', manifest);
    expect(result?.sceneId).toBe('scene-2');
  });

  it('steps prev from second scene to first (cross-chapter)', () => {
    const result = stepScene(orderedIds, 'scene-2', 'prev', manifest);
    expect(result?.sceneId).toBe('scene-1');
    expect(result?.chapterId).toBe('ch-1');
  });

  it('wraps prev from first scene to last scene (edge-arrow wrap)', () => {
    const result = stepScene(orderedIds, 'scene-1', 'prev', manifest);
    expect(result?.sceneId).toBe('scene-3');
  });

  it('returns null when orderedSceneIds is empty', () => {
    const result = stepScene([], 'scene-1', 'next', manifest);
    expect(result).toBeNull();
  });

  it('resolves storyId correctly for each scene', () => {
    const result = stepScene(orderedIds, 'scene-2', 'next', manifest);
    expect(result?.storyId).toBe('story-1');
  });

  it('starts at index 0 (next direction) when currentSceneId is null', () => {
    const result = stepScene(orderedIds, null, 'next', manifest);
    expect(result?.sceneId).toBe('scene-1');
  });

  it('starts at last index (prev direction) when currentSceneId is null', () => {
    const result = stepScene(orderedIds, null, 'prev', manifest);
    expect(result?.sceneId).toBe('scene-3');
  });

  it('handles an unknown currentSceneId by treating as null', () => {
    const result = stepScene(orderedIds, 'ghost-scene', 'next', manifest);
    expect(result?.sceneId).toBe('scene-1');
  });

  it('returns null when orderedSceneIds contains an id not in manifest', () => {
    const result = stepScene(['no-such-scene'], 'no-such-scene', 'next', manifest);
    expect(result).toBeNull();
  });
});

// ─── Cross-chapter orderedSceneIds integrity ─────────────────────────────────

describe('cross-chapter navigation coverage', () => {
  it('orderedSceneIds enables stepScene to cross chapter boundaries', () => {
    const { manifest } = makeTwoChapterManifest();
    const viewResult = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: 'ch-1', sceneId: 'scene-2' },
      depth: 'scene',
    });
    // scene-2 is last in ch-1; next should go to scene-3 in ch-2
    const step = stepScene(viewResult.orderedSceneIds, 'scene-2', 'next', manifest);
    expect(step?.chapterId).toBe('ch-2');
    expect(step?.sceneId).toBe('scene-3');
  });

  it('full round-trip wrap: step next from last back to first', () => {
    const { manifest } = makeTwoChapterManifest();
    const { orderedSceneIds } = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-1', chapterId: null, sceneId: null },
      depth: 'book',
    });
    expect(orderedSceneIds).toHaveLength(3);

    const fromLast = stepScene(orderedSceneIds, orderedSceneIds[2], 'next', manifest);
    expect(fromLast?.sceneId).toBe(orderedSceneIds[0]);

    const fromFirst = stepScene(orderedSceneIds, orderedSceneIds[0], 'prev', manifest);
    expect(fromFirst?.sceneId).toBe(orderedSceneIds[2]);
  });
});

// ─── Multi-story manifest ─────────────────────────────────────────────────────

describe('multi-story manifest', () => {
  it('selects the correct story by storyId', () => {
    const s1 = makeScene('s1', 'Scene A', 0, 'ch-a', 'story-a');
    const chA = makeChapter('ch-a', 'Chapter A', 0, [s1]);
    const storyA = makeStory('story-a', 'Story Alpha', [chA]);

    const s2 = makeScene('s2', 'Scene B', 0, 'ch-b', 'story-b');
    const chB = makeChapter('ch-b', 'Chapter B', 0, [s2]);
    const storyB = makeStory('story-b', 'Story Beta', [chB]);

    const manifest = makeManifest([storyA, storyB]);

    const result = selectManuscriptView({
      manifest,
      selection: { storyId: 'story-b', chapterId: null, sceneId: null },
      depth: 'book',
    });
    expect(result.bands).toHaveLength(2);
    expect((result.bands[0] as ChapterHeadingBand).chapterId).toBe('ch-b');
    expect((result.bands[1] as SceneBand).sceneId).toBe('s2');
  });
});

// ─── AC-C-1 validation ────────────────────────────────────────────────────────

describe('AC-C-1: depth slider switches Scene/Chapter/Full Book with H1/H2 labels', () => {
  const selection: SelectionState = {
    storyId: 'story-1',
    chapterId: 'ch-1',
    sceneId: 'scene-1',
  };

  const { manifest } = makeTwoChapterManifest();

  it('depth=book produces chapter H1 headings and scene H2 headings', () => {
    const result = selectManuscriptView({ manifest, selection, depth: 'book' });
    const chBands = result.bands.filter(b => b.kind === 'chapter-heading') as ChapterHeadingBand[];
    const scBands = result.bands.filter(b => b.kind === 'scene') as SceneBand[];
    expect(chBands.length).toBeGreaterThan(0);
    expect(chBands.every(b => b.headingLevel === 'h1')).toBe(true);
    expect(scBands.every(b => b.headingLevel === 'h2')).toBe(true);
  });

  it('depth=chapter produces H1 chapter heading and H2 scene bands', () => {
    const result = selectManuscriptView({ manifest, selection, depth: 'chapter' });
    expect((result.bands[0] as ChapterHeadingBand).headingLevel).toBe('h1');
    const scBands = result.bands.filter(b => b.kind === 'scene') as SceneBand[];
    expect(scBands.every(b => b.headingLevel === 'h2')).toBe(true);
  });

  it('depth=scene produces exactly one H2 scene band', () => {
    const result = selectManuscriptView({ manifest, selection, depth: 'scene' });
    expect(result.bands).toHaveLength(1);
    expect((result.bands[0] as SceneBand).headingLevel).toBe('h2');
  });
});
