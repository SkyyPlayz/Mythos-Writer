import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectSwitcher from './ProjectSwitcher';

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
