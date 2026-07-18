import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { InconsistencyCard } from './InconsistencyCard';
import type { InconsistencyItem } from './InconsistencyCard';

function makeItem(overrides: Partial<InconsistencyItem> = {}): InconsistencyItem {
  return {
    id: 'item-1',
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

  it('calls onResolve with ignore when Ignore button clicked', async () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    // "Ignore" button has aria-label "Ignore — His eyes were blue"
    fireEvent.click(screen.getByRole('button', { name: /^ignore/i }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('item-1', 'ignore'));
  });
});

// SKY-6978 (Beta4/M18): button copy must match the M9 comments-v2 archive
// action labels verbatim (frontend/src/comments/agentActions.ts AGENT_ACTIONS)
// so the Notes right panel's flag cards read identically to the manuscript's
// Archive Agent comment card.
describe('InconsistencyCard — action labels match M9 wording', () => {
  it('renders the full M9-canonical labels, not the old short copy', () => {
    render(
      <InconsistencyCard
        item={makeItem()}
        archiveStoryEditConsentGiven={true}
        onResolve={onResolve}
        onConsentGranted={onConsentGranted}
      />,
    );
    expect(screen.getByText('Edit notes to match')).toBeInTheDocument();
    expect(screen.getByText('Suggest story change')).toBeInTheDocument();
    expect(screen.getByText('Ignore')).toBeInTheDocument();
  });
});

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
    // aria-label: "Match Archive to Story — His eyes were blue"
    fireEvent.click(screen.getByRole('button', { name: /match archive to story/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /match archive to story/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /match archive to story/i }));
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
    // aria-label: "Suggest Story Change — His eyes were blue"
    fireEvent.click(screen.getByRole('button', { name: /suggest story change/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /suggest story change/i }));
    // aria-label: "Apply suggested edit"
    fireEvent.click(screen.getByRole('button', { name: /apply suggested edit/i }));
    await waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith('item-1', 'suggest_story_change'),
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
    fireEvent.click(screen.getByRole('button', { name: /suggest story change/i }));
    // aria-label: "Edit before applying"
    fireEvent.click(screen.getByRole('button', { name: /edit before applying/i }));
    expect(screen.getByRole('textbox', { name: /edit suggested manuscript change/i })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /suggest story change/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /suggest story change/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /suggest story change/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /suggest story change/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /suggest story change/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggested manuscript change')).not.toBeInTheDocument();
  });
});
