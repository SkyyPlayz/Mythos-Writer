import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import VaultSidebar from './VaultSidebar';
import type { Story, Chapter, Scene } from './types';

const STUB_SCENE: Scene = {
  id: 'sc1',
  title: 'The Arrival',
  path: 'stories/s1/chapters/ch1/scenes/sc1.md',
  order: 0,
  chapterId: 'ch1',
  storyId: 's1',
  blocks: [],
  draftState: 'in-progress',
  createdAt: '',
  updatedAt: '',
};

const STUB_CHAPTER: Chapter = {
  id: 'ch1',
  title: 'Chapter One',
  path: 'stories/s1/chapters/ch1',
  order: 0,
  createdAt: '',
  updatedAt: '',
  scenes: [STUB_SCENE],
};

const STUB_STORY: Story = {
  id: 's1',
  title: 'The Amber Chronicle',
  path: 'stories/s1',
  createdAt: '',
  updatedAt: '',
  chapters: [STUB_CHAPTER],
};

function stubWindowApi() {
  (window as unknown as { api: unknown }).api = {
    listVault: vi.fn().mockResolvedValue({
      items: [
        { path: 'Notes', name: 'Notes', isDirectory: true, modifiedAt: '' },
        { path: 'Notes/ideas.md', name: 'ideas.md', isDirectory: false, modifiedAt: '' },
      ],
    }),
    startVaultWatch: vi.fn().mockResolvedValue({}),
    onVaultFileChanged: vi.fn().mockReturnValue(() => {}),
  };
}

function renderSidebar(selectedSceneId: string | null = null) {
  return render(
    <VaultSidebar
      stories={[STUB_STORY]}
      selectedSceneId={selectedSceneId}
      onSelectScene={vi.fn()}
      onCreateStory={vi.fn()}
      onCreateChapter={vi.fn()}
      onCreateScene={vi.fn()}
    />,
  );
}

// Helper: expand the single story (auto-expanded) and its chapter, then return scene row
async function openToSceneRow(selectedSceneId: string | null = null) {
  const utils = renderSidebar(selectedSceneId);
  // The story auto-expands when there's exactly one story (useEffect) — wait for that
  await waitFor(() => {
    expect(screen.queryAllByRole('button', { name: /chapter one/i }).length).toBeGreaterThan(0);
  });
  // Expand the chapter
  fireEvent.click(screen.getAllByRole('button', { name: /chapter one/i })[0]);
  return utils;
}

describe('VaultSidebar — WCAG 4.1.2 aria attributes (MYT-580)', () => {
  beforeEach(() => { stubWindowApi(); vi.clearAllMocks(); });

  describe('Scene rows — aria-pressed (Issue 2)', () => {
    it('unselected scene row carries aria-pressed="false"', async () => {
      await openToSceneRow(null);
      const sceneRow = screen.getByRole('button', { name: 'The Arrival' });
      expect(sceneRow).toHaveAttribute('aria-pressed', 'false');
    });

    it('selected scene row carries aria-pressed="true"', async () => {
      await openToSceneRow('sc1');
      const sceneRow = screen.getByRole('button', { name: 'The Arrival' });
      expect(sceneRow).toHaveAttribute('aria-pressed', 'true');
    });

    it('scene row carries an aria-label matching its title', async () => {
      await openToSceneRow(null);
      expect(screen.getByRole('button', { name: 'The Arrival' })).toBeInTheDocument();
    });
  });

  describe('NotesTreeNode directory rows — aria-expanded (Issue 1)', () => {
    it('root Notes directory starts expanded with aria-expanded="true"', async () => {
      // Root-level directories are auto-expanded on initial tree load
      const { findByRole } = renderSidebar();
      const notesDir = await findByRole('button', { name: 'Collapse Notes' });
      expect(notesDir).toHaveAttribute('aria-expanded', 'true');
    });

    it('collapsed directory row has aria-expanded="false"', async () => {
      const { findByRole } = renderSidebar();
      const notesDir = await findByRole('button', { name: 'Collapse Notes' });
      fireEvent.click(notesDir);
      expect(notesDir).toHaveAttribute('aria-expanded', 'false');
    });

    it('directory row aria-label switches from Collapse to Expand on click', async () => {
      const { findByRole } = renderSidebar();
      const notesDir = await findByRole('button', { name: 'Collapse Notes' });
      fireEvent.click(notesDir);
      expect(notesDir).toHaveAttribute('aria-label', 'Expand Notes');
    });
  });
});
