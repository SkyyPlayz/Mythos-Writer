import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../theme';
import VaultSyncBadge from './index';

describe('VaultSyncBadge', () => {
  it('renders an accessible local badge', () => {
    render(<VaultSyncBadge provider={null} />);

    expect(screen.getByLabelText('Vault sync status: Local')).toHaveTextContent('(Local)');
  });

  it('renders an accessible provider badge', () => {
    render(<VaultSyncBadge provider="dropbox" />);

    expect(screen.getByLabelText('Vault sync status: Synced via Dropbox')).toHaveTextContent('✓ Synced via Dropbox');
  });

  it('uses WCAG AA token pairings for local and synced text in dark surfaces', () => {
    const darkInset = '#15191f';

    expect(contrastRatio('#8a9bb0', darkInset)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#4ade80', darkInset)).toBeGreaterThanOrEqual(4.5);
  });
});
