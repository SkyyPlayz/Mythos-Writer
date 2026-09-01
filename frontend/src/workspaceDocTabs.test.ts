// Beta 4 M4: unit tests for the document-tab helpers (tabs = documents, §4)
// + the provisional-scene lifecycle decisions (§1.5) + strip visibility.
import { describe, it, expect } from 'vitest';
import {
  sceneStatusFromDraftState,
  makeSceneTab,
  makeNoteTab,
  makeEntityBrowserTab,
  makeOutlineTab,
  noteTitleFromPath,
  upsertSceneTab,
  upsertNoteTab,
  upsertEntityBrowserTab,
  upsertOutlineTab,
  upsertBoardTab,
  reconcileBoardTabs,
  makeSceneCrafterSetupTab,
  SCENE_CRAFTER_SETUP_TAB_ID,
  reconcileSceneTabs,
  workspaceStripModeFor,
  provisionalSceneIsAway,
  renameCommitsProvisional,
  PROVISIONAL_CREATED_TOAST,
  PROVISIONAL_DISCARDED_TOAST,
  PROVISIONAL_SCENE_TITLE,
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

// ─── SKY-9920 (M5 item 5): Entity Browser as an openable document tab ───

describe('makeEntityBrowserTab', () => {
  it('builds an entities-kind tab with no docId/docPath', () => {
    const tab = makeEntityBrowserTab(() => 'tab-eb');
    expect(tab).toMatchObject({ id: 'tab-eb', kind: 'entities', title: 'Entity Browser' });
    expect(tab.docId).toBeUndefined();
    expect(tab.docPath).toBeUndefined();
  });
});

describe('upsertEntityBrowserTab', () => {
  it('appends a tab for a new strip and focuses it', () => {
    const result = upsertEntityBrowserTab([], () => 'tab-eb');
    expect(result.created).toBe(true);
    expect(result.activeId).toBe('tab-eb');
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].kind).toBe('entities');
  });

  it('focuses the existing Entity Browser tab instead of duplicating (one per strip)', () => {
    const first = upsertEntityBrowserTab([], () => 'tab-eb');
    const second = upsertEntityBrowserTab(first.tabs, () => 'tab-dup');
    expect(second.created).toBe(false);
    expect(second.activeId).toBe('tab-eb');
    expect(second.tabs).toBe(first.tabs); // unchanged reference — no state churn
    expect(second.tabs).toHaveLength(1);
  });

  it('coexists alongside scene/note tabs without disturbing them', () => {
    const sceneTab = makeSceneTab(makeScene('sc-a', 'Scene A'), () => 'tab-a');
    const result = upsertEntityBrowserTab([sceneTab], () => 'tab-eb');
    expect(result.tabs).toEqual([sceneTab, expect.objectContaining({ id: 'tab-eb', kind: 'entities' })]);
  });
});

describe('makeOutlineTab', () => {
  it('builds an outline-kind tab with no docId/docPath', () => {
    const tab = makeOutlineTab(() => 'tab-opl');
    expect(tab).toMatchObject({ id: 'tab-opl', kind: 'outline', title: 'Outline Planning' });
    expect(tab.docId).toBeUndefined();
    expect(tab.docPath).toBeUndefined();
  });
});

describe('upsertOutlineTab', () => {
  it('appends a tab for a new strip and focuses it', () => {
    const result = upsertOutlineTab([], () => 'tab-opl');
    expect(result.created).toBe(true);
    expect(result.activeId).toBe('tab-opl');
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].kind).toBe('outline');
  });

  it('focuses the existing Outline Planning tab instead of duplicating (one per strip)', () => {
    const first = upsertOutlineTab([], () => 'tab-opl');
    const second = upsertOutlineTab(first.tabs, () => 'tab-dup');
    expect(second.created).toBe(false);
    expect(second.activeId).toBe('tab-opl');
    expect(second.tabs).toBe(first.tabs); // unchanged reference — no state churn
    expect(second.tabs).toHaveLength(1);
  });

  it('coexists alongside scene/entities tabs without disturbing them', () => {
    const sceneTab = makeSceneTab(makeScene('sc-a', 'Scene A'), () => 'tab-a');
    const entityTab = makeEntityBrowserTab(() => 'tab-eb');
    const result = upsertOutlineTab([sceneTab, entityTab], () => 'tab-opl');
    expect(result.tabs).toEqual([sceneTab, entityTab, expect.objectContaining({ id: 'tab-opl', kind: 'outline' })]);
  });
});

// ─── SKY-11069: Scene Crafter boards as document tabs (owner ruling) ───

const BOARD_A = { id: 'Boards/st1/Board 1.canvas.json', name: 'Board 1', storyId: 'st1' };
const BOARD_B = { id: 'Boards/st1/Board 2.canvas.json', name: 'Board 2', storyId: 'st1' };

describe('upsertBoardTab', () => {
  it('appends a tab for a new board and focuses it (docId = board vault path)', () => {
    const result = upsertBoardTab([], BOARD_A, () => 'tab-b1');
    expect(result.created).toBe(true);
    expect(result.activeId).toBe('tab-b1');
    expect(result.tabs[0]).toMatchObject({ kind: 'board', docId: BOARD_A.id, storyId: 'st1', title: 'Board 1' });
  });

  it('focuses the existing tab for the same board instead of duplicating', () => {
    const first = upsertBoardTab([], BOARD_A, () => 'tab-b1');
    const second = upsertBoardTab(first.tabs, BOARD_A, () => 'tab-dup');
    expect(second.created).toBe(false);
    expect(second.activeId).toBe('tab-b1');
    expect(second.tabs).toBe(first.tabs); // unchanged reference — no state churn
  });

  it('refreshes a stale title when the board was renamed on disk', () => {
    const first = upsertBoardTab([], BOARD_A, () => 'tab-b1');
    const renamed = upsertBoardTab(first.tabs, { ...BOARD_A, name: 'Renamed' }, () => 'tab-dup');
    expect(renamed.created).toBe(false);
    expect(renamed.activeId).toBe('tab-b1');
    expect(renamed.tabs[0].title).toBe('Renamed');
  });

  it('different boards get their own tabs', () => {
    const first = upsertBoardTab([], BOARD_A, () => 'tab-b1');
    const second = upsertBoardTab(first.tabs, BOARD_B, () => 'tab-b2');
    expect(second.created).toBe(true);
    expect(second.tabs).toHaveLength(2);
  });
});

describe('makeSceneCrafterSetupTab', () => {
  it('is permanent (pinned, never closable) with the stable synthetic id', () => {
    const tab = makeSceneCrafterSetupTab();
    expect(tab.id).toBe(SCENE_CRAFTER_SETUP_TAB_ID);
    expect(tab.permanent).toBe(true);
    expect(tab.kind).toBe('kanban');
  });
});

describe('reconcileBoardTabs', () => {
  it('drops tabs whose board file is gone and refreshes renamed titles', () => {
    const tabs = [
      upsertBoardTab([], BOARD_A, () => 'tab-b1').tabs[0],
      upsertBoardTab([], BOARD_B, () => 'tab-b2').tabs[0],
    ];
    const result = reconcileBoardTabs(tabs, 'st1', [{ id: BOARD_A.id, name: 'Renamed' }]);
    expect(result.changed).toBe(true);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0]).toMatchObject({ id: 'tab-b1', title: 'Renamed' });
  });

  it("never touches another story's board tabs", () => {
    const other = upsertBoardTab([], { id: 'Boards/st2/Elsewhere.canvas.json', name: 'Elsewhere', storyId: 'st2' }, () => 'tab-other').tabs[0];
    const result = reconcileBoardTabs([other], 'st1', []);
    expect(result.changed).toBe(false);
    expect(result.tabs).toEqual([other]);
  });

  it('reports changed=false when disk matches the tabs', () => {
    const tabs = upsertBoardTab([], BOARD_A, () => 'tab-b1').tabs;
    const result = reconcileBoardTabs(tabs, 'st1', [{ id: BOARD_A.id, name: BOARD_A.name }]);
    expect(result.changed).toBe(false);
    expect(result.tabs).toBe(tabs);
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

  it('hides the strip on Brainstorm, Timeline and Vault Graph', () => {
    expect(workspaceStripModeFor('brainstorm', 'editor', 'editor')).toEqual({ kind: 'hidden' });
    expect(workspaceStripModeFor('story', 'timeline', 'editor')).toEqual({ kind: 'hidden' });
    expect(workspaceStripModeFor('vault-graph', 'editor', 'editor')).toEqual({ kind: 'hidden' });
  });

  it('shows the board document strip on Scene Crafter (SKY-11069 owner ruling)', () => {
    expect(workspaceStripModeFor('story', 'kanban', 'editor')).toEqual({ kind: 'docs', strip: 'board' });
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

// ─── M8: inline heading renames commit provisional scenes (§1.5) ────────────

describe('renameCommitsProvisional (M8)', () => {
  it('a real title commits the provisional scene', () => {
    expect(renameCommitsProvisional('The Sunken Gate')).toBe(true);
    expect(renameCommitsProvisional('  Dawn Watch  ')).toBe(true);
  });

  it('empty or placeholder titles leave the scene provisional', () => {
    expect(renameCommitsProvisional('')).toBe(false);
    expect(renameCommitsProvisional('   ')).toBe(false);
    expect(renameCommitsProvisional(PROVISIONAL_SCENE_TITLE)).toBe(false);
    expect(renameCommitsProvisional('  Untitled Scene  ')).toBe(false);
  });
});
