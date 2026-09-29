import { describe, expect, it, vi } from 'vitest';
import {
  navigateEntityMention,
  setEntityMentionNavigateHandler,
} from './entityMentionNavigate';

describe('entityMentionNavigate (F2#2)', () => {
  it('invokes the registered shell handler', () => {
    const handler = vi.fn();
    setEntityMentionNavigateHandler(handler);
    navigateEntityMention('char-1');
    expect(handler).toHaveBeenCalledWith('char-1');
    setEntityMentionNavigateHandler(null);
    navigateEntityMention('char-1');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
