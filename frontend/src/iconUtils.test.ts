import { describe, it, expect } from 'vitest';
import { parseIconValue, isSvgSafe } from './iconUtils';

describe('parseIconValue', () => {
  it('returns default for undefined', () => {
    expect(parseIconValue(undefined)).toEqual({ kind: 'default' });
  });

  it('returns default for empty string', () => {
    expect(parseIconValue('')).toEqual({ kind: 'default' });
  });

  it('parses emoji', () => {
    expect(parseIconValue('🗡️')).toEqual({ kind: 'emoji', value: '🗡️' });
  });

  it('parses lucide pack', () => {
    expect(parseIconValue('pack:lucide/sword')).toEqual({ kind: 'lucide', name: 'sword' });
  });

  it('parses lucide with dash', () => {
    expect(parseIconValue('pack:lucide/book-open')).toEqual({ kind: 'lucide', name: 'book-open' });
  });

  it('parses user svg pack', () => {
    expect(parseIconValue('pack:mypack/arrow')).toEqual({ kind: 'user-svg', pack: 'mypack', name: 'arrow' });
  });

  it('returns default for malformed pack (no slash)', () => {
    expect(parseIconValue('pack:lucide')).toEqual({ kind: 'default' });
  });

  it('returns default for pack with empty name after slash', () => {
    expect(parseIconValue('pack:lucide/')).toEqual({ kind: 'default' });
  });

  it('treats plain text as emoji', () => {
    expect(parseIconValue('star')).toEqual({ kind: 'emoji', value: 'star' });
  });
});

describe('isSvgSafe', () => {
  it('allows a clean SVG', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5z"/></svg>';
    expect(isSvgSafe(svg)).toBe(true);
  });

  it('rejects SVG with <script>', () => {
    expect(isSvgSafe('<svg><script>alert(1)</script></svg>')).toBe(false);
  });

  it('rejects SVG with <foreignObject>', () => {
    expect(isSvgSafe('<svg><foreignObject><div>hi</div></foreignObject></svg>')).toBe(false);
  });

  it('rejects SVG with inline event handler', () => {
    expect(isSvgSafe('<svg><path onclick="evil()"/></svg>')).toBe(false);
  });

  it('rejects SVG with javascript: href', () => {
    expect(isSvgSafe('<svg><a href="javascript:alert(1)"><path/></a></svg>')).toBe(false);
  });
});
