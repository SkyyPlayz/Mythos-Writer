import { describe, it, expect } from 'vitest';
import { traitDetail, PARTNER_TEACH_OPTIONS } from './partnerPersonality';

describe('partnerPersonality', () => {
  it('Adaptive is default teaching detail with DEFAULT tag', () => {
    const d = traitDetail('teach', 'Adaptive');
    expect(d.tag).toBe('DEFAULT');
    expect(d.copy.length).toBeGreaterThan(10);
    expect(d.beh).toHaveLength(3);
  });

  it('panel copy left / behavior right: every teach option has copy + 3 beh', () => {
    for (const opt of PARTNER_TEACH_OPTIONS) {
      const d = traitDetail('teach', opt);
      expect(d.copy).toBeTruthy();
      expect(d.beh).toHaveLength(3);
    }
  });

  it('Verbosity sits as its own trait with Balanced default', () => {
    const d = traitDetail('verbosity', 'Balanced');
    expect(d.tag).toBe('DEFAULT');
    expect(d.label).toBe('VERBOSITY');
  });
});
