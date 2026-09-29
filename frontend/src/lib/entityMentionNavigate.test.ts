import { describe, expect, it, vi } from 'vitest';
import {
  isSafeEntityMentionId,
  navigateEntityMention,
  setEntityMentionNavigateHandler,
} from './entityMentionNavigate';

describe('entityMentionNavigate (F2#2 / Shield N4)', () => {
  it('invokes the registered shell handler for safe ids', () => {
    const handler = vi.fn();
    setEntityMentionNavigateHandler(handler);
    navigateEntityMention('char-1');
    expect(handler).toHaveBeenCalledWith('char-1');
    setEntityMentionNavigateHandler(null);
    navigateEntityMention('char-1');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('accepts opaque in-app entity ids', () => {
    expect(isSafeEntityMentionId('char-elara')).toBe(true);
    expect(isSafeEntityMentionId('ent_001')).toBe(true);
    expect(isSafeEntityMentionId('a')).toBe(true);
  });

  it('Shield N4: forged chips with URL / scheme / unknown shape do nothing', () => {
    const handler = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    setEntityMentionNavigateHandler(handler);

    for (const forged of [
      'https://evil.example/x',
      'http://evil.example',
      'javascript:alert(1)',
      'entity://ent_001',
      'file:///etc/passwd',
      '../escape',
      'char/with/slash',
      'has space',
      '',
    ]) {
      expect(isSafeEntityMentionId(forged)).toBe(false);
      navigateEntityMention(forged);
    }

    expect(handler).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
    setEntityMentionNavigateHandler(null);
  });
});
