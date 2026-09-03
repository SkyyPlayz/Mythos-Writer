// SKY-11236: unit tests for per-vault tab workspace logic — restore filtering
// + active-id validation, non-mutating per-vault persist merge (isolation), and
// the one-time legacy migration gating that is the crux of the leak fix.
import { describe, it, expect } from 'vitest';
import {
  restoreVaultTabs,
  writeVaultWorkspace,
  migrateLegacyDocTabs,
  shouldMigrateLegacy,
} from './vaultWorkspaceTabs';

function noteTab(id: string, docPath: string): WorkspaceTab {
  return { id, kind: 'note', title: docPath, icon: '📄', docPath };
}
function sceneTab(id: string, docId: string, opts?: { provisional?: boolean }): WorkspaceTab {
  return { id, kind: 'scene', title: id, icon: '📝', docId, storyId: 's1', provisional: opts?.provisional };
}
function boardTab(id: string, docId?: string, storyId?: string): WorkspaceTab {
  return { id, kind: 'board', title: id, icon: '🎬', docId, storyId };
}

describe('restoreVaultTabs', () => {
  it('returns fully-empty strips for an unknown/never-opened vault (no leak)', () => {
    const r = restoreVaultTabs(undefined);
    expect(r).toEqual({
      storyDocTabs: [],
      activeStoryDocTabId: null,
      notesDocTabs: [],
      activeNotesDocTabId: null,
      boardDocTabs: [],
      activeBoardDocTabId: null,
    });
  });

  it('keeps note/entities notes tabs and validates the active id', () => {
    const r = restoreVaultTabs({
      notesDocTabs: [noteTab('a', 'A.md'), noteTab('b', 'B.md')],
      activeNotesDocTabId: 'b',
    });
    expect(r.notesDocTabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(r.activeNotesDocTabId).toBe('b');
  });

  it('drops an active id that no longer points at a surviving tab', () => {
    const r = restoreVaultTabs({
      notesDocTabs: [noteTab('a', 'A.md')],
      activeNotesDocTabId: 'gone',
    });
    expect(r.activeNotesDocTabId).toBeNull();
  });

  it('filters provisional scenes and board tabs missing ids', () => {
    const r = restoreVaultTabs({
      storyDocTabs: [sceneTab('s', 'scene-1'), sceneTab('prov', 'scene-2', { provisional: true })],
      boardDocTabs: [boardTab('ok', 'd1', 'st1'), boardTab('bad', undefined, 'st1')],
    });
    expect(r.storyDocTabs.map((t) => t.id)).toEqual(['s']);
    expect(r.boardDocTabs.map((t) => t.id)).toEqual(['ok']);
  });
});

describe('writeVaultWorkspace — isolation between vaults', () => {
  it('writes only the target vault and preserves every other vault untouched', () => {
    const vaultA = '/vaults/A/Story Vault';
    const vaultB = '/vaults/B/Story Vault';
    let map = writeVaultWorkspace(undefined, vaultA, {
      notes: { tabs: [noteTab('a1', 'Mira Veynn.md')], activeId: 'a1' },
    });
    // Working in B must not disturb A.
    map = writeVaultWorkspace(map, vaultB, {
      notes: { tabs: [noteTab('b1', 'Other.md')], activeId: 'b1' },
    });
    expect(map[vaultA]?.notesDocTabs?.map((t) => t.id)).toEqual(['a1']);
    expect(map[vaultB]?.notesDocTabs?.map((t) => t.id)).toEqual(['b1']);
    // A restored later is exactly A's original tab, not B's.
    expect(restoreVaultTabs(map[vaultA]).notesDocTabs.map((t) => t.docPath)).toEqual(['Mira Veynn.md']);
  });

  it('does not mutate the previous map and merges sections independently', () => {
    const vault = '/v/Story Vault';
    const first = writeVaultWorkspace(undefined, vault, {
      story: { tabs: [sceneTab('s1', 'd1')], activeId: 's1' },
    });
    const second = writeVaultWorkspace(first, vault, {
      notes: { tabs: [noteTab('n1', 'N.md')], activeId: 'n1' },
    });
    // first is untouched (no notes section).
    expect(first[vault]?.notesDocTabs).toBeUndefined();
    // second carries both the earlier story section and the new notes section.
    expect(second[vault]?.storyDocTabs?.map((t) => t.id)).toEqual(['s1']);
    expect(second[vault]?.notesDocTabs?.map((t) => t.id)).toEqual(['n1']);
  });

  it('strips provisional scenes on persist', () => {
    const vault = '/v/Story Vault';
    const map = writeVaultWorkspace(undefined, vault, {
      story: { tabs: [sceneTab('s1', 'd1'), sceneTab('p', 'd2', { provisional: true })], activeId: 's1' },
    });
    expect(map[vault]?.storyDocTabs?.map((t) => t.id)).toEqual(['s1']);
  });
});

describe('legacy migration gating (leak fix crux)', () => {
  it('migrates on the first initial load, before any vaultWorkspaces exist', () => {
    expect(shouldMigrateLegacy(undefined, false, '/v')).toBe(true);
  });

  it('never migrates on a vault switch — a switch to an unseen vault yields empty tabs', () => {
    expect(shouldMigrateLegacy(undefined, true, '/v')).toBe(false);
  });

  it('never migrates once a workspace map already exists on disk', () => {
    expect(shouldMigrateLegacy({ '/v': {} }, false, '/v')).toBe(false);
  });

  it('does not migrate without a known vault root', () => {
    expect(shouldMigrateLegacy(undefined, false, '')).toBe(false);
  });

  it('migrateLegacyDocTabs snapshots the flat fields into a workspace entry', () => {
    const ws = migrateLegacyDocTabs({
      notesDocTabs: [noteTab('a', 'A.md')],
      activeNotesDocTabId: 'a',
      storyDocTabs: [sceneTab('s', 'd1')],
      activeStoryDocTabId: 's',
    });
    expect(restoreVaultTabs(ws).notesDocTabs.map((t) => t.id)).toEqual(['a']);
    expect(restoreVaultTabs(ws).storyDocTabs.map((t) => t.id)).toEqual(['s']);
    expect(restoreVaultTabs(ws).activeStoryDocTabId).toBe('s');
  });
});
