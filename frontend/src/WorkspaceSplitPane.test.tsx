import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkspaceSplitPane from './WorkspaceSplitPane';
import { SPLITTABLE_TAB_KINDS, TAB_KIND_META } from './workspaceTabKinds';

describe('WorkspaceSplitPane (GH#643 split panes v1)', () => {
  it('renders the kind title, icon, and children', () => {
    render(
      <WorkspaceSplitPane kind="vault-graph" onClose={vi.fn()}>
        <div data-testid="pane-child">graph here</div>
      </WorkspaceSplitPane>,
    );
    expect(screen.getByTestId('workspace-split-pane')).toBeInTheDocument();
    expect(screen.getByText('Graph')).toBeInTheDocument();
    expect(screen.getByTestId('pane-child')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Split pane: Graph' })).toBeInTheDocument();
  });

  it('invokes onClose from the close button', () => {
    const onClose = vi.fn();
    render(
      <WorkspaceSplitPane kind="timeline" onClose={onClose}>
        <div />
      </WorkspaceSplitPane>,
    );
    fireEvent.click(screen.getByTestId('workspace-split-pane-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('every splittable kind has picker metadata', () => {
    for (const kind of SPLITTABLE_TAB_KINDS) {
      expect(TAB_KIND_META[kind]).toBeDefined();
    }
    // v1 explicitly excludes the two editor kinds.
    expect(SPLITTABLE_TAB_KINDS.has('story-editor')).toBe(false);
    expect(SPLITTABLE_TAB_KINDS.has('notes-editor')).toBe(false);
  });
});
