import { describe, it, expect } from 'vitest';
import { groupVaultsByMythos } from './mythosVaultGrouping';

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
