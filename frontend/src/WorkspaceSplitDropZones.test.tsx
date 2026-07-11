// Beta 4 M4: split drop zones — drag a tab DOWN (lower 45%) or RIGHT (right 44%),
// the hovered zone highlights with a doc chip, dropping reports the zone.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WorkspaceSplitDropZones from './WorkspaceSplitDropZones';
import { WORKSPACE_TAB_DRAG_MIME } from './WorkspaceTabBar';

afterEach(() => cleanup());

function makeDT(withTabMime = true) {
  return {
    types: withTabMime ? [WORKSPACE_TAB_DRAG_MIME] : ['text/plain'],
    dropEffect: '',
    effectAllowed: 'move',
  };
}

describe('WorkspaceSplitDropZones (M4)', () => {
  it('renders both zones, initially without highlight or chip', () => {
    render(<WorkspaceSplitDropZones dragLabel="Into the Undercity" onDropZone={vi.fn()} />);
    const right = screen.getByTestId('workspace-split-dropzone-right');
    const down = screen.getByTestId('workspace-split-dropzone-down');
    expect(right.className).not.toContain('wsdz-zone--active');
    expect(down.className).not.toContain('wsdz-zone--active');
    expect(screen.queryByText('Into the Undercity')).toBeNull();
  });

  it('highlights the hovered zone and shows the dragged doc chip', () => {
    render(<WorkspaceSplitDropZones dragLabel="Into the Undercity" onDropZone={vi.fn()} />);
    const down = screen.getByTestId('workspace-split-dropzone-down');
    fireEvent.dragOver(down, { dataTransfer: makeDT() });
    expect(down.className).toContain('wsdz-zone--active');
    expect(screen.getByText('Into the Undercity')).toBeTruthy();
    fireEvent.dragLeave(down);
    expect(down.className).not.toContain('wsdz-zone--active');
  });

  it('ignores drags that are not workspace tabs', () => {
    render(<WorkspaceSplitDropZones dragLabel="Doc" onDropZone={vi.fn()} />);
    const right = screen.getByTestId('workspace-split-dropzone-right');
    fireEvent.dragOver(right, { dataTransfer: makeDT(false) });
    expect(right.className).not.toContain('wsdz-zone--active');
  });

  it('drop on the RIGHT zone reports "right"', () => {
    const onDropZone = vi.fn();
    render(<WorkspaceSplitDropZones dragLabel="Doc" onDropZone={onDropZone} />);
    const right = screen.getByTestId('workspace-split-dropzone-right');
    fireEvent.dragOver(right, { dataTransfer: makeDT() });
    fireEvent.drop(right, { dataTransfer: makeDT() });
    expect(onDropZone).toHaveBeenCalledWith('right');
  });

  it('drop on the DOWN zone reports "down" and clears the highlight', () => {
    const onDropZone = vi.fn();
    render(<WorkspaceSplitDropZones dragLabel="Doc" onDropZone={onDropZone} />);
    const down = screen.getByTestId('workspace-split-dropzone-down');
    fireEvent.dragOver(down, { dataTransfer: makeDT() });
    fireEvent.drop(down, { dataTransfer: makeDT() });
    expect(onDropZone).toHaveBeenCalledWith('down');
    expect(down.className).not.toContain('wsdz-zone--active');
  });
});
