import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BookSyncNotice, manifestSaveOutcome } from './BookSyncNotice';

describe('manifest save outcome', () => {
  it('treats an { error } object as a failed save and does not echo its text', () => {
    const leaked = { error: '/tmp/secret/book.md Trade paperback EACCES' };
    const outcome = manifestSaveOutcome(leaked);
    expect(outcome.ok).toBe(false);
    render(<BookSyncNotice outcome={outcome} />);
    expect(screen.getByTestId('book-sync-warning').textContent).toBe('The save did not finish.');
    expect(screen.getByTestId('book-sync-warning').textContent).not.toContain('/tmp/secret');
    expect(screen.getByTestId('book-sync-warning').textContent).not.toContain('Trade paperback');
    expect(screen.getByTestId('book-sync-warning').textContent).not.toContain('EACCES');
  });

  it('accepts a typed ok result whose warnings are event code and story id', () => {
    const outcome = manifestSaveOutcome({
      ok: true,
      path: '/tmp/vault/manifest-cache.json',
      bytes: 12,
      warnings: [{ event: 'book-file-cas-exhausted', storyId: 'profiled-story' }],
    });
    expect(outcome).toEqual({
      ok: true,
      warnings: [{ event: 'book-file-cas-exhausted', storyId: 'profiled-story' }],
    });
    render(<BookSyncNotice outcome={outcome} />);
    const text = screen.getByTestId('book-sync-warning').textContent ?? '';
    expect(text).toContain('profiled-story');
    expect(text).toContain('next save');
    expect(text).not.toContain('/tmp/vault');
  });
});
