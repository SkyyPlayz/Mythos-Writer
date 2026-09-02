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
    expect(screen.getByText('Suggested manuscript change')).toBeInTheDocument();
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
  it('opens suggest expand immediately when consent already given', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    expect(screen.getByText('Suggested manuscript change')).toBeInTheDocument();
    expect(screen.getByText(/Change manuscript to say brown eyes/)).toBeInTheDocument();
  });

  it('calls onResolve with suggest_story_change when Apply Edit clicked', async () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    // aria-label: "Apply suggested edit"
    fireEvent.click(screen.getByRole('button', { name: /apply suggested edit/i }));
    // M9d: the drafted story-change text rides along so the suggestion
    // actually says what the author approved.
    await waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith(
        'item-1',
        'suggest_story_change',
        'Change manuscript to say brown eyes.',
      ),
    );
  });

  it('shows edit textarea when Edit before applying clicked', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    // aria-label: "Edit before applying"
    fireEvent.click(screen.getByRole('button', { name: /edit before applying/i }));
    expect(screen.getByRole('textbox', { name: /edit suggested manuscript change/i })).toBeInTheDocument();
  });

  it('passes the author-edited draft through onResolve (M9d)', async () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    fireEvent.click(screen.getByRole('button', { name: /edit before applying/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /edit suggested manuscript change/i }), {
      target: { value: 'Her eyes caught the brown of river silt.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /apply suggested edit/i }));
    await waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith(
        'item-1',
        'suggest_story_change',
        'Her eyes caught the brown of river silt.',
      ),
    );
  });
});

describe('InconsistencyCard — consent modal', () => {
  it('shows consent modal when consent not yet given', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={false}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Archive Agent — Editing Your Manuscript/i)).toBeInTheDocument();
  });

  it('skips consent modal when consent already given', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onConsentGranted and opens suggest panel when Continue clicked with checkbox checked', async () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={false}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    fireEvent.click(screen.getByRole('checkbox', { name: /don't show this again/i }));
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await waitFor(() => expect(onConsentGranted).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Suggested manuscript change')).toBeInTheDocument();
  });

  it('does not call onConsentGranted when Continue clicked without checkbox', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={false}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(onConsentGranted).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes modal without opening expand when Cancel clicked', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={false}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    openSuggestStoryChange();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggested manuscript change')).not.toBeInTheDocument();
  });
});
