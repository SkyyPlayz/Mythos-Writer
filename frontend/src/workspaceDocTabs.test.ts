// Beta 4 M4: unit tests for the document-tab helpers (tabs = documents, §4)
// + the provisional-scene lifecycle decisions (§1.5) + strip visibility.
import { describe, it, expect } from 'vitest';
import {
  sceneStatusFromDraftState,
  makeSceneTab,
  makeNoteTab,
  noteTitleFromPath,
  upsertSceneTab,
  upsertNoteTab,
  reconcileSceneTabs,
  workspaceStripModeFor,
  provisionalSceneIsAway,
  PROVISIONAL_CREATED_TOAST,
  PROVISIONAL_DISCARDED_TOAST,
} from './workspaceDocTabs';
import type { Scene, Story } from './types';

function makeScene(id: string, title: string, draftState?: Scene['draftState']): Scene {
  return {
    id,
    title,
    path: `stories/st1/chapters/ch1/scenes/${id}.md`,
    order: 0,
    chapterId: 'ch1',
    storyId: 'st1',
    blocks: [],
    draftState,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeStory(scenes: Scene[]): Story {
  return {
    id: 'st1',
    title: 'Story One',
    path: 'stories/st1',
    chapters: [
      {
        id: 'ch1',
        title: 'Chapter One',
        path: 'stories/st1/chapters/ch1',
        order: 0,
        scenes,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('sceneStatusFromDraftState', () => {
  it('maps the §2 scene statuses: todo | draft | done', () => {
    expect(sceneStatusFromDraftState(undefined)).toBe('todo');
    expect(sceneStatusFromDraftState('in-progress')).toBe('draft');
    expect(sceneStatusFromDraftState('review')).toBe('draft');
    expect(sceneStatusFromDraftState('final')).toBe('done');
  });
});

describe('makeSceneTab / makeNoteTab', () => {
  it('builds a scene tab carrying document identity + status', () => {
    const tab = makeSceneTab(makeScene('sc1', 'Into the Undercity', 'final'), () => 'tab-1');
    expect(tab).toMatchObject({
      id: 'tab-1',
      kind: 'scene',
      title: 'Into the Undercity',
      docId: 'sc1',
      status: 'done',
    });
    expect(tab.provisional).toBeUndefined();
  });

  it('marks provisional scene tabs (§1.5)', () => {
    const tab = makeSceneTab(makeScene('sc1', 'Untitled Scene'), () => 'tab-1', true);
    expect(tab.provisional).toBe(true);
    expect(tab.status).toBe('todo');
  });

  it('titles note tabs from the file name', () => {
    expect(noteTitleFromPath('Notes Vault/Characters/Mira Veynn.md')).toBe('Mira Veynn');
    expect(noteTitleFromPath('flat-note.MD')).toBe('flat-note');
    const tab = makeNoteTab('Worldbuilding/The Sunken Gate.md', () => 'tab-n');
    expect(tab).toMatchObject({ id: 'tab-n', kind: 'note', title: 'The Sunken Gate', docPath: 'Worldbuilding/The Sunken Gate.md' });
  });
});

describe('upsertSceneTab', () => {
  const sceneA = makeScene('sc-a', 'Scene A');

  it('appends a tab for a new document and focuses it', () => {
    const result = upsertSceneTab([], sceneA, () => 'tab-a');
    expect(result.created).toBe(true);
    expect(result.activeId).toBe('tab-a');
    expect(result.tabs).toHaveLength(1);
  });

  it('focuses the existing tab instead of duplicating', () => {
    const first = upsertSceneTab([], sceneA, () => 'tab-a');
    const second = upsertSceneTab(first.tabs, sceneA, () => 'tab-dup');
    expect(second.created).toBe(false);
    expect(second.activeId).toBe('tab-a');
    expect(second.tabs).toBe(first.tabs); // unchanged reference — no state churn
  });

  it('refreshes a stale title/status on focus', () => {
    const first = upsertSceneTab([], sceneA, () => 'tab-a');
    const renamed = { ...sceneA, title: 'Scene A (final)', draftState: 'final' as const };
    const second = upsertSceneTab(first.tabs, renamed);
    expect(second.created).toBe(false);
    expect(second.tabs[0].title).toBe('Scene A (final)');
    expect(second.tabs[0].status).toBe('done');
  });
});

describe('upsertNoteTab', () => {
  it('appends then focuses without duplicating', () => {
    const first = upsertNoteTab([], 'Characters/Mira.md', () => 'tab-m');
    expect(first.created).toBe(true);
    const second = upsertNoteTab(first.tabs, 'Characters/Mira.md', () => 'tab-dup');
    expect(second.created).toBe(false);
    expect(second.activeId).toBe('tab-m');
    expect(second.tabs).toBe(first.tabs);
  });
});

describe('reconcileSceneTabs', () => {
  it('drops tabs whose scene no longer exists and refreshes stale titles', () => {
    const keep = makeScene('sc-keep', 'Kept Scene', 'in-progress');
    const tabs = [
      makeSceneTab({ ...keep, title: 'Old Title', draftState: undefined }, () => 'tab-keep'),
      makeSceneTab(makeScene('sc-gone', 'Deleted Scene'), () => 'tab-gone'),
    ];
    const result = reconcileSceneTabs(tabs, [makeStory([keep])]);
    expect(result.changed).toBe(true);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0]).toMatchObject({ id: 'tab-keep', title: 'Kept Scene', status: 'draft' });
  });

  it('keeps provisional tabs even though their scene is not in the manifest (§1.5)', () => {
    const prov = makeSceneTab(makeScene('sc-prov', 'Untitled Scene'), () => 'tab-prov', true);
    const result = reconcileSceneTabs([prov], [makeStory([])]);
    expect(result.changed).toBe(false);
    expect(result.tabs).toEqual([prov]);
  });

  it('reports changed=false when everything matches', () => {
    const scene = makeScene('sc-1', 'Stable');
    const tabs = [makeSceneTab(scene, () => 'tab-1')];
    const result = reconcileSceneTabs(tabs, [makeStory([scene])]);
    expect(result.changed).toBe(false);
    expect(result.tabs).toBe(tabs);
  });
});

describe('workspaceStripModeFor (§4: strip on Story + Notes only)', () => {
  it('shows the Story document strip on editor/structure/book sub-views', () => {
    expect(workspaceStripModeFor('story', 'editor', 'editor')).toEqual({ kind: 'docs', strip: 'story' });
    expect(workspaceStripModeFor('story', 'structure', 'editor')).toEqual({ kind: 'docs', strip: 'story' });
    expect(workspaceStripModeFor('story', 'book', 'editor')).toEqual({ kind: 'docs', strip: 'story' });
    // M12: the Coach sub-tab keeps the Story doc strip (prototype showTabStrip 7404).
    expect(workspaceStripModeFor('story', 'coach', 'editor')).toEqual({ kind: 'docs', strip: 'story' });
  });

  it('shows the Notes document strip on the notes editor sub-view', () => {
    expect(workspaceStripModeFor('notes', 'editor', 'editor')).toEqual({ kind: 'docs', strip: 'notes' });
  });

  it('hides the strip on Brainstorm, Timeline and Graph', () => {
    expect(workspaceStripModeFor('brainstorm', 'editor', 'editor')).toEqual({ kind: 'hidden' });
    expect(workspaceStripModeFor('story', 'timeline', 'editor')).toEqual({ kind: 'hidden' });
    expect(workspaceStripModeFor('notes', 'editor', 'graph')).toEqual({ kind: 'hidden' });
  });

  it('shows the static view pseudo-tab on Scene Crafter and Entities (prototype tabList fallback)', () => {
    expect(workspaceStripModeFor('story', 'kanban', 'editor')).toEqual({ kind: 'static', label: 'Scene Crafter' });
    expect(workspaceStripModeFor('notes', 'editor', 'entities')).toEqual({ kind: 'static', label: 'Entities' });
  });
});

describe('provisionalSceneIsAway (§1.5 silent-discard trigger)', () => {
  const base = {
    activeTab: 'story' as AppTab,
    storySubView: 'editor' as StorySubView,
    viewDepth: 'scene',
    selectedSceneId: 'sc-prov',
    provisionalSceneId: 'sc-prov',
  };

  it('is not away while the provisional scene stays open in the editor', () => {
    expect(provisionalSceneIsAway(base)).toBe(false);
  });

  it('is away when another document is selected', () => {
    expect(provisionalSceneIsAway({ ...base, selectedSceneId: 'sc-other' })).toBe(true);
    expect(provisionalSceneIsAway({ ...base, selectedSceneId: null })).toBe(true);
  });

  it('is away when leaving the Story editor (view, section or zoom)', () => {
    expect(provisionalSceneIsAway({ ...base, activeTab: 'notes' })).toBe(true);
    expect(provisionalSceneIsAway({ ...base, activeTab: 'brainstorm' })).toBe(true);
    expect(provisionalSceneIsAway({ ...base, storySubView: 'timeline' })).toBe(true);
    expect(provisionalSceneIsAway({ ...base, viewDepth: 'book' })).toBe(true);
  });
});

describe('provisional toast copy (§1.5 verbatim)', () => {
  it('matches the spec strings', () => {
    expect(PROVISIONAL_DISCARDED_TOAST).toBe('Empty scene discarded — nothing was saved');
    expect(PROVISIONAL_CREATED_TOAST).toBe(
      'New scene — it saves the moment you type. Close it untouched and it vanishes.',
    );
  });
});
