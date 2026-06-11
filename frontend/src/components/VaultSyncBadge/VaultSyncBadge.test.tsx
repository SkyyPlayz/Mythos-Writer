import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../theme';
import VaultSyncBadge from './index';

function compositeOnHex(r: number, g: number, b: number, a: number, bg: string): string {
  const bgR = parseInt(bg.slice(1, 3), 16);
  const bgG = parseInt(bg.slice(3, 5), 16);
  const bgB = parseInt(bg.slice(5, 7), 16);
  const outR = Math.round(r * a + bgR * (1 - a));
  const outG = Math.round(g * a + bgG * (1 - a));
  const outB = Math.round(b * a + bgB * (1 - a));
  return `#${outR.toString(16).padStart(2, '0')}${outG.toString(16).padStart(2, '0')}${outB.toString(16).padStart(2, '0')}`;
}

describe('VaultSyncBadge', () => {
  it('renders an accessible local badge', () => {
    render(<VaultSyncBadge provider={null} />);

    expect(screen.getByLabelText('Vault sync status: Local')).toHaveTextContent('(Local)');
  });

  it('renders an accessible provider badge', () => {
    render(<VaultSyncBadge provider="dropbox" />);

    expect(screen.getByLabelText('Vault sync status: Synced via Dropbox')).toHaveTextContent('✓ Synced via Dropbox');
  });

  it('uses WCAG AA token pairings for local and synced states in dark surfaces', () => {
    const darkInset = '#15191f';

    // text contrast (WCAG 1.4.3, 4.5:1 AA)
    expect(contrastRatio('#8a9bb0', darkInset)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#4ade80', darkInset)).toBeGreaterThanOrEqual(4.5);

    // border contrast (WCAG 1.4.11, 3:1 non-text UI components)
    // synced: color-mix(in srgb, #4ade80 55%, transparent) composited on darkInset
    expect(contrastRatio(compositeOnHex(74, 222, 128, 0.55, darkInset), darkInset)).toBeGreaterThanOrEqual(3);
    // local: rgba(255,255,255,0.40) composited on darkInset
    expect(contrastRatio(compositeOnHex(255, 255, 255, 0.40, darkInset), darkInset)).toBeGreaterThanOrEqual(3);
  });
});
