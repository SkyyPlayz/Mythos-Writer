import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LeftRail, { DEFAULT_LEFT_SIDEBAR_LAYOUT } from './LeftRail';
import { PanelDragProvider } from './PanelDragContext';

function renderLeftRail() {
  render(
    <PanelDragProvider onDrop={vi.fn()}>
      <LeftRail
        leftSidebarLayout={DEFAULT_LEFT_SIDEBAR_LAYOUT}
        onLeftSidebarLayoutChange={vi.fn()}
        renderPanelContent={() => null}
        rightPanelCount={0}
      />
    </PanelDragProvider>,
  );
}

describe('LeftRail panels', () => {
  it('does not render the legacy fixed main navigation zone', () => {
    renderLeftRail();

    expect(screen.queryByRole('navigation', { name: /main navigation/i })).not.toBeInTheDocument();
  });

  it('registers vault-graph as an addable left sidebar panel id', () => {
    renderLeftRail();

    fireEvent.click(screen.getByRole('button', { name: /add panel/i }));

    const picker = screen.getByRole('listbox', { name: /available panels/i });
    expect(within(picker).getByRole('option', { name: 'Graph' })).toBeInTheDocument();
  });

  describe('GH #633 — Writing Assistant / Continuity / Scene Preview in left sidebar picker', () => {
    it('shows Writing Assistant in the add-panel picker', () => {
      renderLeftRail();
      fireEvent.click(screen.getByRole('button', { name: /add panel/i }));
      const picker = screen.getByRole('listbox', { name: /available panels/i });
      expect(within(picker).getByRole('option', { name: 'Writing Assistant' })).toBeInTheDocument();
    });

    it('shows Continuity in the add-panel picker', () => {
      renderLeftRail();
      fireEvent.click(screen.getByRole('button', { name: /add panel/i }));
      const picker = screen.getByRole('listbox', { name: /available panels/i });
      expect(within(picker).getByRole('option', { name: 'Continuity' })).toBeInTheDocument();
    });

    it('shows Scene Preview in the add-panel picker', () => {
      renderLeftRail();
      fireEvent.click(screen.getByRole('button', { name: /add panel/i }));
      const picker = screen.getByRole('listbox', { name: /available panels/i });
      expect(within(picker).getByRole('option', { name: 'Scene Preview' })).toBeInTheDocument();
    });

    it('hides Writing Assistant from picker when already in the layout', () => {
      const layout = {
        ...DEFAULT_LEFT_SIDEBAR_LAYOUT,
        panels: [{ id: 'writing-assistant' as const, collapsed: false }],
      };
      render(
        <PanelDragProvider onDrop={vi.fn()}>
          <LeftRail
            leftSidebarLayout={layout}
            onLeftSidebarLayoutChange={vi.fn()}
            renderPanelContent={() => null}
            rightPanelCount={0}
          />
        </PanelDragProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: /add panel/i }));
      const picker = screen.getByRole('listbox', { name: /available panels/i });
      expect(within(picker).queryByRole('option', { name: 'Writing Assistant' })).toBeNull();
    });
  });
});
