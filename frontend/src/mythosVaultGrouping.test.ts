import { describe, it, expect } from 'vitest';
import { groupVaultsByMythos, mythosRootForDisplay } from './mythosVaultGrouping';

describe('groupVaultsByMythos', () => {
  it('collapses multiple story roots that share a mythos root', () => {
    const groups = groupVaultsByMythos([
      { vaultRoot: '/m/A/Story Vault', mythosVaultRoot: '/m/A', name: 'A' },
      { vaultRoot: '/m/A/Stories/Other', mythosVaultRoot: '/m/A', name: 'A' },
      { vaultRoot: '/m/B/Story Vault', mythosVaultRoot: '/m/B', name: 'B' },
    ], '/m/A/Story Vault');
    expect(groups).toHaveLength(2);
    expect(groups[0].mythosRoot).toBe('/m/A');
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[0].primary.vaultRoot).toBe('/m/A/Story Vault');
  });
});

describe('mythosRootForDisplay', () => {
  it('uses resolved mythosVaultRoot when distinct from story vault', () => {
    expect(
      mythosRootForDisplay({
        vaultRoot: '/m/A/Story Vault',
        mythosVaultRoot: '/m/A',
        name: 'A',
      }),
    ).toBe('/m/A');
  });

  it('strips default Story Vault dirname when main fell back to story path', () => {
    const mythos = '/tmp/Mythos/with/deep/name';
    expect(
      mythosRootForDisplay({
        vaultRoot: `${mythos}/Story Vault`,
        mythosVaultRoot: `${mythos}/Story Vault`,
        name: 'X',
      }),
    ).toBe(mythos);
  });

  it('keeps legacy vault root when it is not a Story Vault subfolder', () => {
    expect(
      mythosRootForDisplay({
        vaultRoot: '/legacy/vault',
        mythosVaultRoot: '/legacy/vault',
        name: 'Legacy',
      }),
    ).toBe('/legacy/vault');
  });
});
