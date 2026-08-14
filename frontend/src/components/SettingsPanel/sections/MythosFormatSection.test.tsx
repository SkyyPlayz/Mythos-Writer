// SKY-8882 defect #2 — Settings → Vaults format card must not keep showing
// the "older v0.4 layout" copy (and upgrade button) for a vault that used to
// be v0.4 but the app has since switched/created into a v2 vault, all
// without a remount.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import MythosFormatSection from './MythosFormatSection';
import { notifyMythosActiveVaultChanged } from '../../../migration/MythosMigrationCenter';

const v04Status: MythosMigrationStatus = {
  format: 'v0.4-twin-root',
  shouldPrompt: true,
  storyVaultRoot: '/vaults/My Vault/Story Vault',
  notesVaultRoot: '/vaults/My Vault/Notes Vault',
  vaultName: 'My Vault',
  suggestedTarget: '/vaults/My Vault (MythosVault)',
};

const mockStatus = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockStatus.mockResolvedValue(v04Status);
  Object.defineProperty(window, 'api', {
    value: { mythosMigrationStatus: mockStatus },
    writable: true,
    configurable: true,
  });
});

describe('MythosFormatSection', () => {
  it('shows the v0.4 upgrade card for a v0.4 vault', async () => {
    render(<MythosFormatSection />);
    await screen.findByTestId('mythos-format-upgrade-btn');
    expect(screen.getByTestId('mythos-format-current').textContent).toContain('v0.4 two-folder');
  });

  it('shows the current-format copy (no upgrade button) for a v2 vault', async () => {
    mockStatus.mockResolvedValue({ ...v04Status, format: 'mythos-v2' });
    render(<MythosFormatSection />);
    await screen.findByTestId('mythos-format-current');
    expect(screen.getByTestId('mythos-format-current').textContent).toContain('MythosVault');
    expect(screen.queryByTestId('mythos-format-upgrade-btn')).toBeNull();
  });

  it('re-probes and drops the upgrade card when the active vault changes to v2 in-session', async () => {
    render(<MythosFormatSection />);
    await screen.findByTestId('mythos-format-upgrade-btn');

    mockStatus.mockResolvedValue({ ...v04Status, format: 'mythos-v2' });
    act(() => {
      notifyMythosActiveVaultChanged();
    });

    await waitFor(() => expect(mockStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('mythos-format-upgrade-btn')).toBeNull());
  });
});
