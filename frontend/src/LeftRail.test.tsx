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

  it('collapses the panel column when toggle button is clicked', () => {
    const onLayoutChange = vi.fn();
    render(
      <PanelDragProvider onDrop={vi.fn()}>
        <LeftRail
          leftSidebarLayout={DEFAULT_LEFT_SIDEBAR_LAYOUT}
          onLeftSidebarLayoutChange={onLayoutChange}
          renderPanelContent={() => null}
          rightPanelCount={0}
        />
      </PanelDragProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /collapse left sidebar/i }));
    expect(onLayoutChange).toHaveBeenCalledWith(
      expect.objectContaining({ sidebarCollapsed: true }),
    );
  });

  it('renders collapsed state when sidebarCollapsed is true', () => {
    const { container } = render(
      <PanelDragProvider onDrop={vi.fn()}>
        <LeftRail
          leftSidebarLayout={{ ...DEFAULT_LEFT_SIDEBAR_LAYOUT, sidebarCollapsed: true }}
          onLeftSidebarLayoutChange={vi.fn()}
          renderPanelContent={() => null}
          rightPanelCount={0}
        />
      </PanelDragProvider>,
    );
    expect(container.querySelector('.left-rail--collapsed')).not.toBeNull();
    expect(container.querySelector('.lr-panel-zone')).toBeNull();
  });

  it('registers vault-graph as an addable left sidebar panel id', () => {
    renderLeftRail();

    fireEvent.click(screen.getByRole('button', { name: /add panel/i }));

    const picker = screen.getByRole('listbox', { name: /available panels/i });
    expect(within(picker).getByRole('option', { name: 'Graph' })).toBeInTheDocument();
  });
});
