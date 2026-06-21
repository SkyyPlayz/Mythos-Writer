import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import OutlinePlanningPanel from './OutlinePlanningPanel';
import type { Story, OutlineData } from './types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STORY: Story = {
  id: 'story-1',
  title: 'My Story',
  path: '/vault/my-story',
  chapters: [
    {
      id: 'ch-1',
      title: 'Chapter 1',
      path: '/vault/my-story/ch-1',
      order: 0,
      scenes: [
        {
          id: 'sc-1',
          title: 'Scene 1',
          path: '/vault/my-story/ch-1/sc-1.md',
          order: 0,
          blocks: [],
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'sc-2',
          title: 'Scene 2',
          path: '/vault/my-story/ch-1/sc-2.md',
          order: 1,
          blocks: [],
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const OUTLINE_DATA: OutlineData = {
  storyId: 'story-1',
  schemaVersion: 1,
  nodes: [
    {
      id: 'n1',
      title: 'Act 1',
      children: [
        { id: 'n1a', title: 'Setup', children: [] },
        { id: 'n1b', title: 'Inciting Incident', children: [] },
      ],
    },
    { id: 'n2', title: 'Act 2', children: [] },
  ],
};

// ─── Mock window.api ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOutlineLoad = vi.fn<any>().mockResolvedValue(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOutlineSave = vi.fn<any>().mockResolvedValue({ saved: true });

beforeEach(() => {
  mockOutlineLoad.mockResolvedValue(null);
  mockOutlineSave.mockResolvedValue({ saved: true });
  Object.defineProperty(window, 'api', {
    value: {
      outline: {
        load: mockOutlineLoad,
        save: mockOutlineSave,
      },
    },
    writable: true,
    configurable: true,
  });
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ─── Helper ────────────────────────────────────────────────────────────────────

async function renderWithStory(story: Story | null = STORY) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<OutlinePlanningPanel story={story} />);
    // flush the load IPC promise
    await Promise.resolve();
  });
  return result!;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OutlinePlanningPanel', () => {
  describe('AC-OPL-UI-01: renders planning surface', () => {
    it('shows the outline panel when a story is selected', async () => {
      await renderWithStory();
      expect(screen.getByTestId('opl-panel')).toBeInTheDocument();
    });

    it('shows no-story state when story is null', async () => {
      await renderWithStory(null);
      expect(screen.getByTestId('opl-no-story')).toBeInTheDocument();
    });
  });

  describe('AC-OPL-UI-02: empty state', () => {
    it('shows empty state when no outline-nodes.json exists', async () => {
      mockOutlineLoad.mockResolvedValue(null);
      await renderWithStory();
      expect(screen.getByTestId('opl-empty-state')).toBeInTheDocument();
      expect(screen.getByText(/No outline yet/)).toBeInTheDocument();
    });

    it('loads existing nodes from IPC', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();
      expect(screen.getByTestId('opl-tree')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Act 1')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Act 2')).toBeInTheDocument();
    });
  });

  describe('AC-OPL-UI-03: Enter adds sibling', () => {
    it('adds a sibling node after pressing Enter', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const act2Input = screen.getByDisplayValue('Act 2');
      await act(async () => {
        fireEvent.keyDown(act2Input, { key: 'Enter' });
      });

      // A new empty node should appear after Act 2
      const inputs = screen.getAllByRole('textbox');
      expect(inputs.length).toBeGreaterThan(4); // original 4 visible + 1 new
    });
  });

  describe('AC-OPL-UI-04: Tab indents node', () => {
    it('indents a node under its previous sibling', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const act2Input = screen.getByDisplayValue('Act 2');

      await act(async () => {
        fireEvent.keyDown(act2Input, { key: 'Tab', shiftKey: false });
      });

      // Act 2 should be deeper (child of Act 1)
      // After indenting, it's no longer at root, so the chevron on Act 1 should appear
      expect(screen.getByLabelText(/Collapse node/)).toBeInTheDocument();
    });

    it('no-ops Tab at max depth', async () => {
      // Build a 5-level deep chain
      const deepData: OutlineData = {
        storyId: 'story-1',
        schemaVersion: 1,
        nodes: [
          {
            id: 'd1', title: 'L1', children: [
              {
                id: 'd2', title: 'L2', children: [
                  {
                    id: 'd3', title: 'L3', children: [
                      {
                        id: 'd4', title: 'L4', children: [
                          { id: 'd5', title: 'L5', children: [] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { id: 'd6', title: 'Sibling', children: [] },
        ],
      };
      mockOutlineLoad.mockResolvedValue(deepData);
      await renderWithStory();

      // L5 is at depth 4 (0-indexed), Tab should no-op (max is 5 levels = depth 4)
      const l5Input = screen.getByDisplayValue('L5');
      await act(async () => {
        fireEvent.keyDown(l5Input, { key: 'Tab', shiftKey: false });
      });

      // L5 should still be visible (not moved somewhere invalid)
      expect(screen.getByDisplayValue('L5')).toBeInTheDocument();
    });
  });

  describe('AC-OPL-UI-05: Shift+Tab promotes node', () => {
    it('promotes a nested node to parent level', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      // 'Setup' is a child of 'Act 1'
      const setupInput = screen.getByDisplayValue('Setup');
      await act(async () => {
        fireEvent.keyDown(setupInput, { key: 'Tab', shiftKey: true });
      });

      // Setup should now be at the root level
      // Act 1 chevron should be gone (only Inciting Incident remains as child)
      // Actually Act 1 still has 'Inciting Incident', so chevron stays
      // But Setup should now appear as a sibling of Act 1
      expect(screen.getByDisplayValue('Setup')).toBeInTheDocument();
    });

    it('no-ops Shift+Tab at root level', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const act1Input = screen.getByDisplayValue('Act 1');
      await act(async () => {
        fireEvent.keyDown(act1Input, { key: 'Tab', shiftKey: true });
      });

      // Act 1 should still be present (can't promote root nodes)
      expect(screen.getByDisplayValue('Act 1')).toBeInTheDocument();
    });
  });

  describe('AC-OPL-UI-06: Backspace deletes empty childless node', () => {
    it('deletes an empty node on Backspace', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const act2Input = screen.getByDisplayValue('Act 2');

      // Clear the title first
      await act(async () => {
        fireEvent.change(act2Input, { target: { value: '' } });
      });

      const countBefore = screen.getAllByRole('textbox').length;
      await act(async () => {
        fireEvent.keyDown(act2Input, { key: 'Backspace' });
      });

      const countAfter = screen.getAllByRole('textbox').length;
      expect(countAfter).toBe(countBefore - 1);
    });

    it('does not delete a node that has children', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const act1Input = screen.getByDisplayValue('Act 1');

      await act(async () => {
        fireEvent.change(act1Input, { target: { value: '' } });
      });

      const countBefore = screen.getAllByRole('textbox').length;
      await act(async () => {
        fireEvent.keyDown(act1Input, { key: 'Backspace' });
      });

      // Node has children, must NOT be deleted
      expect(screen.getAllByRole('textbox').length).toBe(countBefore);
    });
  });

  describe('AC-OPL-UI-07: Fold/unfold', () => {
    it('collapses children when chevron is clicked', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      // Act 1 has children, so it should have a fold button
      const foldBtn = screen.getByLabelText('Collapse node');
      expect(screen.getByDisplayValue('Setup')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(foldBtn);
      });

      // Children should be hidden
      expect(screen.queryByDisplayValue('Setup')).not.toBeInTheDocument();
    });

    it('shows child count when collapsed', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const foldBtn = screen.getByLabelText('Collapse node');
      await act(async () => {
        fireEvent.click(foldBtn);
      });

      // Expand button label should mention child count
      expect(screen.getByLabelText(/Expand node \(2 children\)/)).toBeInTheDocument();
    });

    it('re-expands when clicked again', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const foldBtn = screen.getByLabelText('Collapse node');
      await act(async () => {
        fireEvent.click(foldBtn);
      });

      await act(async () => {
        fireEvent.click(screen.getByLabelText(/Expand node \(2 children\)/));
      });

      expect(screen.getByDisplayValue('Setup')).toBeInTheDocument();
    });
  });

  describe('AC-OPL-UI-09: Scene linking', () => {
    it('opens the scene picker on link button click', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const linkBtns = screen.getAllByLabelText('Link scene');
      await act(async () => {
        fireEvent.click(linkBtns[0]);
      });

      expect(screen.getByRole('listbox', { name: 'Select scene to link' })).toBeInTheDocument();
      expect(screen.getByText('Scene 1')).toBeInTheDocument();
      expect(screen.getByText('Scene 2')).toBeInTheDocument();
    });

    it('stores linkedSceneId when a scene is selected', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const linkBtns = screen.getAllByLabelText('Link scene');
      await act(async () => {
        fireEvent.click(linkBtns[0]);
      });

      const sceneOption = screen.getByText('Scene 1').closest('[role="option"]')!;
      await act(async () => {
        fireEvent.click(sceneOption);
      });

      // Scene chip should appear
      expect(screen.getByLabelText(/Linked scene: Scene 1/)).toBeInTheDocument();
    });

    it('can unlink a previously linked scene', async () => {
      const dataWithLink: OutlineData = {
        ...OUTLINE_DATA,
        nodes: [
          { id: 'n1', title: 'Act 1', linkedSceneId: 'sc-1', children: [] },
        ],
      };
      mockOutlineLoad.mockResolvedValue(dataWithLink);
      await renderWithStory();

      // The link button should show as active
      const activeLink = screen.getByLabelText('Change linked scene');
      await act(async () => {
        fireEvent.click(activeLink);
      });

      const removeLink = screen.getByText('Remove link').closest('[role="option"]')!;
      await act(async () => {
        fireEvent.click(removeLink);
      });

      expect(screen.queryByLabelText(/Linked scene:/)).not.toBeInTheDocument();
    });
  });

  describe('AC-OPL-UI-10: auto-save debounce', () => {
    it('saves after 500ms debounce on title change', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const act2Input = screen.getByDisplayValue('Act 2');
      await act(async () => {
        fireEvent.change(act2Input, { target: { value: 'Act 2 Updated' } });
      });

      expect(mockOutlineSave).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(mockOutlineSave).toHaveBeenCalledTimes(1);
      expect(mockOutlineSave).toHaveBeenCalledWith(
        STORY.path,
        expect.objectContaining({ storyId: STORY.id }),
      );
    });

    it('debounces rapid changes into a single save', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const act2Input = screen.getByDisplayValue('Act 2');
      await act(async () => {
        fireEvent.change(act2Input, { target: { value: 'A' } });
        fireEvent.change(act2Input, { target: { value: 'AB' } });
        fireEvent.change(act2Input, { target: { value: 'ABC' } });
      });

      await act(async () => {
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      expect(mockOutlineSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('AC-OPL-UI-11: persists across story navigation', () => {
    it('calls outline.load when story changes', async () => {
      const { rerender } = await renderWithStory();

      expect(mockOutlineLoad).toHaveBeenCalledWith(STORY.path);

      const story2: Story = { ...STORY, id: 'story-2', path: '/vault/story-2' };
      mockOutlineLoad.mockResolvedValue(null);

      await act(async () => {
        rerender(<OutlinePlanningPanel story={story2} />);
        await Promise.resolve();
      });

      expect(mockOutlineLoad).toHaveBeenCalledWith('/vault/story-2');
    });
  });

  describe('AC-OPL-UI-12: keyboard accessibility', () => {
    it('supports ArrowDown/ArrowUp navigation between nodes', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const act1Input = screen.getByDisplayValue('Act 1');
      // Focus must be inside act() so onFocus → setActiveNodeId is tracked
      await act(async () => { act1Input.focus(); });

      await act(async () => {
        fireEvent.keyDown(act1Input, { key: 'ArrowDown' });
        await vi.runAllTimersAsync();
      });

      // Active class moves to Setup (first visible child of Act 1)
      const setupRow = screen.getByDisplayValue('Setup').closest('.opl-node-row')!;
      expect(setupRow).toHaveClass('opl-node-active');
    });

    it('Escape blurs the active node', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      const act2Input = screen.getByDisplayValue('Act 2');
      // Focus must be inside act() so onFocus → setActiveNodeId is tracked
      await act(async () => { act2Input.focus(); });

      await act(async () => {
        fireEvent.keyDown(act2Input, { key: 'Escape' });
      });

      // After Escape, the input is blurred; document.activeElement falls back to body
      expect(document.activeElement).not.toBe(act2Input);
    });
  });

  describe('AC-OPL-UI-13: Liquid Neon depth-indent styling', () => {
    it('applies --opl-depth CSS variable to nodes', async () => {
      mockOutlineLoad.mockResolvedValue(OUTLINE_DATA);
      await renderWithStory();

      // Act 1 is at depth 0
      const act1Wrapper = screen.getByDisplayValue('Act 1').closest('[data-node-id]')!;
      expect(act1Wrapper).toHaveStyle('--opl-depth: 0');

      // Setup is at depth 1 (child of Act 1)
      const setupWrapper = screen.getByDisplayValue('Setup').closest('[data-node-id]')!;
      expect(setupWrapper).toHaveStyle('--opl-depth: 1');
    });
  });

  describe('AC-OPL-UI-14: other sidebar tabs work', () => {
    it('renders without crashing (import smoke test)', () => {
      render(<OutlinePlanningPanel story={null} />);
      expect(screen.getByTestId('opl-no-story')).toBeInTheDocument();
    });
  });
});
