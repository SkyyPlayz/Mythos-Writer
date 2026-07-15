// Beta 4 M10 acceptance: "load-draft undo restores exactly".
// The controller captures the live editor text BEFORE any write and undo
// re-applies that byte-identical string — including trailing whitespace,
// blank lines, and text typed after the last debounced save.
import { describe, it, expect, vi } from 'vitest';
import { loadDraft, undoLoadDraft, type DraftLoadDeps } from './loadUndo';
import type { SceneDraftEntry } from './useSceneDrafts';

const DRAFT: SceneDraftEntry = {
  ts: 'draft-4',
  label: 'Draft 4',
  content: 'The loaded draft body.',
  intent: 'save',
  savedAtMs: null,
};

function makeDeps(currentText: string): DraftLoadDeps & { applied: string[] } {
  const applied: string[] = [];
  return {
    applied,
    getCurrentContent: vi.fn(() => currentText),
    applyContent: vi.fn((c: string) => { applied.push(c); }),
    rollback: vi.fn(async () => ({})),
  };
}

describe('loadDraft', () => {
  it('captures the pre-load text BEFORE the store rollback, then applies the draft', async () => {
    const deps = makeDeps('pre-load editor text');
    const order: string[] = [];
    (deps.getCurrentContent as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('capture');
      return 'pre-load editor text';
    });
    (deps.rollback as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('rollback');
      return {};
    });
    const undo = await loadDraft(deps, 'scene-1', DRAFT);
    expect(order).toEqual(['capture', 'rollback']);
    expect(deps.rollback).toHaveBeenCalledWith('draft-4');
    expect(deps.applied).toEqual([DRAFT.content]);
    expect(undo).toEqual({
      sceneId: 'scene-1',
      content: 'pre-load editor text',
      loadedLabel: 'Draft 4',
    });
  });

  it('leaves the editor untouched and arms no undo when the store write fails', async () => {
    const deps = makeDeps('pre-load editor text');
    (deps.rollback as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('rollback boom'));
    await expect(loadDraft(deps, 'scene-1', DRAFT)).rejects.toThrow('rollback boom');
    expect(deps.applyContent).not.toHaveBeenCalled();
  });

  it('treats a resolved { error } IPC payload as failure too (MYT-790 sanitizer shape)', async () => {
    const deps = makeDeps('pre-load editor text');
    (deps.rollback as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'Version not found' });
    await expect(loadDraft(deps, 'scene-1', DRAFT)).rejects.toThrow('Version not found');
    expect(deps.applyContent).not.toHaveBeenCalled();
  });
});

describe('undoLoadDraft — exact restore', () => {
  it('re-applies the captured pre-load string byte-identically', async () => {
    // Deliberately awkward content: trailing spaces, blank lines, unicode.
    const exact = 'Line one.  \n\n\n  “Quoted” — em-dash…\n\ttabbed\n';
    const deps = makeDeps(exact);
    const undo = await loadDraft(deps, 'scene-1', DRAFT);
    undoLoadDraft(deps, undo);
    expect(deps.applied).toEqual([DRAFT.content, exact]);
    // Byte-identical, not merely similar:
    expect(deps.applied[1]).toBe(exact);
  });

  it('round-trips even when the loaded draft equals the pre-load text', async () => {
    const deps = makeDeps(DRAFT.content);
    const undo = await loadDraft(deps, 'scene-1', DRAFT);
    undoLoadDraft(deps, undo);
    expect(deps.applied).toEqual([DRAFT.content, DRAFT.content]);
  });
});
