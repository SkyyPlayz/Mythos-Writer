import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PARTNER_DISPLAY_NAME,
  resolvePartnerDisplayName,
  resolvePartnerAuthorLabel,
  partnerHandStatusLine,
} from './partnerIdentity';

describe('partnerIdentity', () => {
  it('defaults to Mythos', () => {
    expect(resolvePartnerDisplayName()).toBe(DEFAULT_PARTNER_DISPLAY_NAME);
    expect(resolvePartnerDisplayName({})).toBe('Mythos');
  });

  it('uses brainstorm rename as the partner spine name', () => {
    expect(resolvePartnerDisplayName({ brainstorm: 'Athena' })).toBe('Athena');
    expect(resolvePartnerDisplayName({ brainstorm: '  ' })).toBe('Mythos');
  });

  it('maps legacy agent kinds to the partner author label', () => {
    expect(resolvePartnerAuthorLabel({ brainstorm: 'Athena' }, 'coach')).toBe('Athena');
    expect(resolvePartnerAuthorLabel(undefined, 'beta')).toBe('Mythos');
  });

  it('builds status lines for idle / busy / call / mute', () => {
    expect(partnerHandStatusLine(null, false, false, false)).toMatch(/Listening quietly/);
    expect(partnerHandStatusLine('writer', true, false, false)).toMatch(/Writer is working/);
    expect(partnerHandStatusLine(null, false, true, false)).toBe('LISTENING');
    expect(partnerHandStatusLine(null, false, true, true)).toBe('MUTED');
    expect(partnerHandStatusLine('analyst', true, true, false)).toBe('LISTENING · Analyst WORKING');
  });
});
