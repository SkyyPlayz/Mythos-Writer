import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { InconsistencyCard } from './InconsistencyCard';
import type { InconsistencyItem } from './InconsistencyCard';

function makeItem(overrides: Partial<InconsistencyItem> = {}): InconsistencyItem {
  return {
    id: 'item-1',
    scope: 'story_vault',
    category: 'character_attribute_drift',
    severity: 'high',
    manuscriptAnchor: { sceneId: 'scene-1', offset: 10, excerpt: 'His eyes were blue' },
    vaultAnchor: { notePath: 'characters/kael.md', line: 4, excerpt: 'brown eyes' },
    rationale: 'Manuscript says blue eyes but vault says brown eyes.',
    proposedResolution: {
      matchArchiveToStory: 'Update vault entry to say blue eyes.',
      suggestStoryChange: 'Change manuscript to say brown eyes.',
    },
    status: 'open',
    resolvedAt: null,
    resolvedAction: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const onResolve = vi.fn();
const onConsentGranted = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  onResolve.mockResolvedValue(undefined);
});

describe('InconsistencyCard — render', () => {
  it('shows severity badge and category label', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    expect(screen.getByRole('img', { name: /high severity/i })).toBeInTheDocument();
    expect(screen.getByText('Character Attribute Drift')).toBeInTheDocument();
  });

  it('shows manuscript and vault anchor excerpts', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    // Anchors expose excerpts via title attribute
    expect(screen.getByTitle(/His eyes were blue/)).toBeInTheDocument();
    expect(screen.getByTitle(/brown eyes/)).toBeInTheDocument();
  });

  it('shows critical severity badge', () => {
    render(
      <InconsistencyCard
        item={makeItem({ severity: 'critical' })}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    expect(screen.getByRole('img', { name: /critical severity/i })).toBeInTheDocument();
  });
});

describe('InconsistencyCard — Ignore action', () => {
  it('calls onResolve with ignore when dismiss button clicked', async () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('item-1', 'ignore'));
  });
});

// M12.B3 (SKY-10738): owner's annotated screenshot ruling replaces the
// prototype's three action-row buttons with two — `Suggest fix` opens a
// sub-choice between the two underlying fix directions (still both
// reachable), `Open sources` reveals the full anchors. Dismiss/ignore stays
// reachable via the header's × button (SKY-9825's M9 wording tests removed:
// the top-level buttons they asserted on no longer exist).
describe('InconsistencyCard — action row (M12.B3)', () => {
  it('renders exactly the two SKY-10738 actions', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    expect(screen.getByText('Suggest fix')).toBeInTheDocument();
    expect(screen.getByText('Open sources')).toBeInTheDocument();
    expect(screen.queryByText('Edit notes to match')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggest story change')).not.toBeInTheDocument();
    expect(screen.queryByText('Ignore')).not.toBeInTheDocument();
  });

  it('"Suggest fix" opens a choice between updating notes and suggesting a story change', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /suggest fix/i }));
    expect(screen.getByRole('button', { name: /update your notes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /suggest a change to the story/i })).toBeInTheDocument();
  });

  it('"Open sources" reveals both full anchors and toggles closed on second click', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    const openSources = screen.getByRole('button', { name: /open sources/i });
    fireEvent.click(openSources);
    expect(screen.getByTestId('ic-sources-preview')).toBeInTheDocument();
    expect(screen.getByText('Vault note')).toBeInTheDocument();
    fireEvent.click(openSources);
    expect(screen.queryByTestId('ic-sources-preview')).not.toBeInTheDocument();
  });

  it('labels the second anchor "Earlier scene" for a story_internal flag (no vault side)', () => {
    render(
      <InconsistencyCard
        item={makeItem({ scope: 'story_internal' })}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open sources/i }));
    expect(screen.getByText('Earlier scene')).toBeInTheDocument();
    expect(screen.queryByText('Vault note')).not.toBeInTheDocument();
  });

  it('story_internal "Suggest fix" skips the choice and opens the suggest panel directly (no vault side)', () => {
    render(
      <InconsistencyCard
        item={makeItem({ scope: 'story_internal' })}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /suggest fix/i }));
    expect(screen.queryByRole('button', { name: /update your notes/i })).not.toBeInTheDocument();
    expect(screen.getByText('How to fix (AI)')).toBeInTheDocument();
    expect(screen.getByText(/Change manuscript to say brown eyes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply edit|apply suggested|edit before applying/i })).not.toBeInTheDocument();
  });
});

/** Drives the new two-step entry: "Suggest fix" → fix-choice sub-menu. */
function openMatchArchive() {
  fireEvent.click(screen.getByRole('button', { name: /suggest fix/i }));
  fireEvent.click(screen.getByRole('button', { name: /update your notes/i }));
}
function openSuggestStoryChange() {
  fireEvent.click(screen.getByRole('button', { name: /suggest fix/i }));
  fireEvent.click(screen.getByRole('button', { name: /suggest a change to the story/i }));
}

describe('InconsistencyCard — Match Archive action', () => {
  it('opens expand area with proposed vault change when Match Archive clicked', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openMatchArchive();
    expect(screen.getByText('Proposed vault change')).toBeInTheDocument();
    expect(screen.getByText('Update vault entry to say blue eyes.')).toBeInTheDocument();
  });

  it('calls onResolve with match_archive_to_story when Apply Change clicked', async () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openMatchArchive();
    // aria-label: "Apply vault change"
    fireEvent.click(screen.getByRole('button', { name: /apply vault change/i }));
    await waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith('item-1', 'match_archive_to_story'),
    );
  });

  it('cancels expand area when Cancel clicked', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openMatchArchive();
    expect(screen.getByText('Proposed vault change')).toBeInTheDocument();
    // aria-label: "Cancel match archive"
    fireEvent.click(screen.getByRole('button', { name: /cancel match archive/i }));
    expect(onResolve).not.toHaveBeenCalled();
  });
});

describe('InconsistencyCard — Suggest Edit action', () => {
  it('shows read-only how to fix and does not resolve the flag', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    expect(screen.getByText('How to fix (AI)')).toBeInTheDocument();
    expect(screen.getByText(/Change manuscript to say brown eyes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply edit|apply suggested|edit before applying/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('shows the same how-to-fix note when consent was never given', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={false}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('How to fix (AI)')).toBeInTheDocument();
    expect(onConsentGranted).not.toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();
  });
});

describe('InconsistencyCard — consent modal', () => {
  it('does not render a manuscript-edit consent dialog', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={false}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/Archive Agent — Editing Your Manuscript/i)).not.toBeInTheDocument();
    expect(screen.getByText('How to fix (AI)')).toBeInTheDocument();
  });
});
