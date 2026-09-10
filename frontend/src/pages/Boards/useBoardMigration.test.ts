/**
 * SKY-11192 AC 4 — converting the retired brainstorm board is a user decision.
 *
 * The sibling acceptance record to `ideaFiling.test.ts`. Filing one idea has
 * always demanded a click; this file is the same promise for the much larger
 * write next to it, which creates a note per card and renames the source. If
 * someone reinstates the mount effect that used to run this automatically, or
 * deletes the gesture check, these fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBoardMigration } from './useBoardMigration';
import { userGestureFrom } from './userGesture';

describe('SKY-11192 AC4 — the legacy board is only ever converted by a direct user click', () => {
  const migrateToNotes = vi.fn();
  const migrationPreview = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    migrationPreview.mockResolvedValue({ pending: 3, unreadable: false });
    migrateToNotes.mockResolvedValue({ migrated: true, created: ['Plot & Story/A.md'], skipped: [] });
    (window as unknown as { api: unknown }).api = { brainstormBoard: { migrateToNotes, migrationPreview } };
  });

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  /** See ideaFiling.test.ts for why a trusted event has to be built this way. */
  function trustedClick(): { nativeEvent: Event } {
    const native = Object.create(new MouseEvent('click'), {
      isTrusted: { value: true },
    }) as Event;
    return { nativeEvent: native };
  }

  it('LOOKS but does not WRITE when the board is shown', async () => {
    // The regression this whole file exists for: rendering the unified board
    // used to be enough to convert someone's vault.
    const { result } = renderHook(() => useBoardMigration(true));
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    expect(migrationPreview).toHaveBeenCalled();
    expect(migrateToNotes).not.toHaveBeenCalled();
    expect(result.current.offer).toEqual({ pending: 3, unreadable: false });
  });

  it('does not even look until the unified board is actually in use', () => {
    renderHook(() => useBoardMigration(false));
    expect(migrationPreview).not.toHaveBeenCalled();
    expect(migrateToNotes).not.toHaveBeenCalled();
  });

  it('offers nothing when there is no legacy board left', async () => {
    migrationPreview.mockResolvedValue({ pending: 0, unreadable: false });
    const { result } = renderHook(() => useBoardMigration(true));
    await waitFor(() => expect(migrationPreview).toHaveBeenCalled());
    expect(result.current.offer).toBeNull();
  });

  it('still offers a board that exists but cannot be parsed', async () => {
    // Nothing to convert, but parking it is a real outcome worth offering —
    // reporting "nothing to do" would strand the file forever.
    migrationPreview.mockResolvedValue({ pending: 0, unreadable: true });
    const { result } = renderHook(() => useBoardMigration(true));
    await waitFor(() => expect(result.current.offer).not.toBeNull());
    expect(result.current.offer).toEqual({ pending: 0, unreadable: true });
  });

  it('CONVERTS NOTHING when migrate is called without a gesture', async () => {
    const { result } = renderHook(() => useBoardMigration(true));
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    let res!: Awaited<ReturnType<typeof result.current.migrate>>;
    await act(async () => { res = await result.current.migrate(null); });

    expect(res).toMatchObject({ ok: false, reason: 'no-gesture' });
    expect(migrateToNotes).not.toHaveBeenCalled();
  });

  it('CONVERTS NOTHING for a gesture minted from an untrusted event', async () => {
    // element.click() from an agent path or a test helper lands here.
    const { result } = renderHook(() => useBoardMigration(true));
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    const gesture = userGestureFrom({ nativeEvent: new MouseEvent('click') });
    await act(async () => { await result.current.migrate(gesture); });

    expect(migrateToNotes).not.toHaveBeenCalled();
  });

  it('converts on a real click and reports what it did', async () => {
    migrateToNotes.mockResolvedValue({
      migrated: true,
      created: ['Plot & Story/A.md', 'Characters/B.md'],
      skipped: ['Worldbuilding/C.md'],
    });
    const { result } = renderHook(() => useBoardMigration(true));
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    let res!: Awaited<ReturnType<typeof result.current.migrate>>;
    await act(async () => { res = await result.current.migrate(userGestureFrom(trustedClick())); });

    expect(migrateToNotes).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true, created: 2, skipped: 1 });
    // The source is parked, so the offer is spent and must not ask again.
    expect(result.current.offer).toBeNull();
  });

  it('refuses re-entry so one click cannot become two passes', async () => {
    const { result } = renderHook(() => useBoardMigration(true));
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    let second!: Awaited<ReturnType<typeof result.current.migrate>>;
    await act(async () => {
      const first = result.current.migrate(userGestureFrom(trustedClick()));
      second = await result.current.migrate(userGestureFrom(trustedClick()));
      await first;
    });

    expect(second).toMatchObject({ ok: false, reason: 'busy' });
    expect(migrateToNotes).toHaveBeenCalledTimes(1);
  });

  it('keeps the offer when the migration fails, so the ideas are not stranded', async () => {
    migrateToNotes.mockResolvedValue({ migrated: false, created: [], skipped: [], error: 'disk full' });
    const { result } = renderHook(() => useBoardMigration(true));
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    let res!: Awaited<ReturnType<typeof result.current.migrate>>;
    await act(async () => { res = await result.current.migrate(userGestureFrom(trustedClick())); });

    expect(res).toMatchObject({ ok: false, reason: 'error', message: 'disk full' });
    expect(result.current.offer).not.toBeNull();
  });

  it('dismissing hides the offer without converting anything', async () => {
    const { result } = renderHook(() => useBoardMigration(true));
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    act(() => { result.current.dismiss(); });

    expect(result.current.offer).toBeNull();
    expect(migrateToNotes).not.toHaveBeenCalled();
  });
});
