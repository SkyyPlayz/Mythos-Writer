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
});
