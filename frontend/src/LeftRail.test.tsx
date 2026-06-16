import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LeftRail, { DEFAULT_LEFT_SIDEBAR_LAYOUT } from './LeftRail';
import { PanelDragProvider } from './PanelDragContext';

function renderLeftRail(onViewChange = vi.fn()) {
  render(
    <PanelDragProvider onDrop={vi.fn()}>
      <LeftRail
        activeView="editor"
        onViewChange={onViewChange}
        leftSidebarLayout={DEFAULT_LEFT_SIDEBAR_LAYOUT}
        onLeftSidebarLayoutChange={vi.fn()}
        renderPanelContent={() => null}
        rightPanelCount={0}
      />
    </PanelDragProvider>,
  );
  return onViewChange;
}

describe('LeftRail graph navigation', () => {
  it('registers a Graph icon in the fixed left sidebar nav zone', () => {
    renderLeftRail();

    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(within(nav).getByRole('button', { name: /graph/i })).toBeInTheDocument();
  });

  it('opens the graph main-area tab from the left nav icon', () => {
    const onViewChange = renderLeftRail();

    fireEvent.click(screen.getByRole('button', { name: /graph/i }));

    expect(onViewChange).toHaveBeenCalledWith('graph');
  });

  it('registers vault-graph as an addable left sidebar panel id', () => {
    renderLeftRail();

    fireEvent.click(screen.getByRole('button', { name: /add panel/i }));

    const picker = screen.getByRole('listbox', { name: /available panels/i });
    expect(within(picker).getByRole('option', { name: 'Graph' })).toBeInTheDocument();
  });
});
