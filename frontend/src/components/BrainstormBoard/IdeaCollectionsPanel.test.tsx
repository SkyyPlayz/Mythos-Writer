// SKY-11192/SKY-11674 §3 — File/Filing…/Filed✓+Open states, and the
// review-blocking constraint that File only fires from a direct click.
import { render, screen, fireEvent } from '@testing-library/react';
import IdeaCollectionsPanel, { type CollectionIdea } from './IdeaCollectionsPanel';
import type { IdeaFileStatus } from './useIdeaCollectionsFiling';

const IDEA: CollectionIdea = {
  key: 'starter-beats-0',
  cat: 'beats',
  title: 'Midpoint Reversal',
  desc: 'The goal changes.',
  chips: ['Starter', 'Structure'],
};

function renderPanel(status: IdeaFileStatus, overrides: Partial<{ onFile: () => void; onOpen: () => void }> = {}) {
  const onFile = overrides.onFile ?? vi.fn();
  const onOpen = overrides.onOpen ?? vi.fn();
  render(
    <IdeaCollectionsPanel
      pool={[IDEA]}
      statusFor={() => status}
      onFile={onFile}
      onOpen={onOpen}
    />,
  );
  return { onFile, onOpen };
}

function openGroup(groupKey: string) {
  fireEvent.click(screen.getByTestId(`bs-coll-toggle-${groupKey}`));
}

describe('IdeaCollectionsPanel', () => {
  it('unfiled: shows a labeled File button, not an icon-only control', () => {
    renderPanel('unfiled');
    openGroup('all');
    const btn = screen.getByTestId('bs-coll-file');
    expect(btn).toHaveTextContent('File');
  });

  it('File click calls onFile with the idea — the only call site (review-blocking constraint)', () => {
    const { onFile } = renderPanel('unfiled');
    openGroup('all');
    fireEvent.click(screen.getByTestId('bs-coll-file'));
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(IDEA);
  });

  it('filing: shows "Filing…" and no File button (can\'t double-click while in flight)', () => {
    renderPanel('filing');
    openGroup('all');
    expect(screen.getByText('Filing…')).toBeTruthy();
    expect(screen.queryByTestId('bs-coll-file')).toBeNull();
  });

  it('filed: shows "Filed ✓" and an Open link, no File button', () => {
    renderPanel('filed');
    openGroup('all');
    expect(screen.getByText('Filed ✓')).toBeTruthy();
    expect(screen.getByTestId('bs-coll-open')).toBeTruthy();
    expect(screen.queryByTestId('bs-coll-file')).toBeNull();
  });

  it('Open click calls onOpen with the idea', () => {
    const { onOpen } = renderPanel('filed');
    openGroup('all');
    fireEvent.click(screen.getByTestId('bs-coll-open'));
    expect(onOpen).toHaveBeenCalledWith(IDEA);
  });

  it('search filters ideas and auto-expands matching groups', () => {
    renderPanel('unfiled');
    fireEvent.change(screen.getByTestId('bs-coll-search'), { target: { value: 'midpoint' } });
    // Search auto-expands every matching group (here: "All Ideas" + "Story Beats").
    expect(screen.getAllByText('Midpoint Reversal').length).toBeGreaterThan(0);
  });
});
