import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectSwitcher, { deriveSingleStoryTitle } from './ProjectSwitcher';

const longVaultRoot = '/home/skyy/Mythos/Vaults/Extremely Long Series Name/Story Vault';
const notesVaultRoot = '/home/skyy/Mythos/Vaults/Extremely Long Series Name/Notes Vault';

function setApi(overrides: Partial<Record<string, unknown>> = {}) {
  (window as unknown as { api: unknown }).api = {
    projectList: vi.fn().mockResolvedValue({
      activeNotesVaultRoot: notesVaultRoot,
      projects: [
        {
          name: 'Fallback name',
          vaultRoot: longVaultRoot,
          notesVaultRoot,
          openedAt: '2026-06-11T00:00:00.000Z',
        },
      ],
    }),
    vaultGetPaths: vi.fn().mockResolvedValue({ homeDir: '/home/skyy', pathSeparator: '/' }),
    projectSwitch: vi.fn().mockResolvedValue({ switched: true, notesVaultRoot }),
    ...overrides,
  };
}

describe('ProjectSwitcher path display', () => {
  beforeEach(() => {
    setApi();
  });

  it('middle-truncates recent project paths while preserving full path in the tooltip', async () => {
    render(<ProjectSwitcher activeVaultRoot={longVaultRoot} onSwitched={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /active project/i }));

    const option = await screen.findByRole('option', { name: /Extremely Long Series Name/i });
    await waitFor(() => expect(screen.getByText('~/Mythos/…/Story Vault')).toBeInTheDocument());

    expect(option).toHaveAttribute('title', `${longVaultRoot}\n${notesVaultRoot}`);
  });
});

// ─── SKY-9262 (P0.5) — workspace label prefers the story title ───────────────

describe('deriveSingleStoryTitle', () => {
  it('returns the title when the vault holds exactly one story', () => {
    expect(deriveSingleStoryTitle([{ title: 'The Last City of Veynn' }])).toBe('The Last City of Veynn');
  });

  it('returns undefined for zero, several, or untitled stories', () => {
    expect(deriveSingleStoryTitle(undefined)).toBeUndefined();
    expect(deriveSingleStoryTitle([])).toBeUndefined();
    expect(deriveSingleStoryTitle([{ title: 'A' }, { title: 'B' }])).toBeUndefined();
    expect(deriveSingleStoryTitle([{ title: '   ' }])).toBeUndefined();
  });
});

describe('ProjectSwitcher workspace label (SKY-9262)', () => {
  beforeEach(() => {
    setApi();
  });

  it('shows the single story title instead of the vault directory name', async () => {
    render(
      <ProjectSwitcher
        activeVaultRoot={longVaultRoot}
        activeStoryTitle="The Last City of Veynn"
        onSwitched={vi.fn()}
      />,
    );
    // Flush the mount-time projectList load, then assert the story title
    // still wins over both the directory name and the recents entry name.
    await waitFor(() => expect(screen.getByText('The Last City of Veynn')).toBeInTheDocument());
    expect(screen.queryByText('Extremely Long Series Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Fallback name')).not.toBeInTheDocument();
  });

  it('falls back to the recents project name when no single-story title exists', async () => {
    render(<ProjectSwitcher activeVaultRoot={longVaultRoot} onSwitched={vi.fn()} />);
    // Once projectList resolves, the recents entry's name wins over the
    // directory-derived fallback.
    await waitFor(() => expect(screen.getByText('Fallback name')).toBeInTheDocument());
  });
});
