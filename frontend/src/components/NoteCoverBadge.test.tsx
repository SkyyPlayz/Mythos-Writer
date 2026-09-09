/**
 * SKY-11186 — NoteCoverBadge: the editor cover beside the title (BOARDS-SPEC
 * v2 §9). Badge text per mode, nothing at all for off/none/unresolved, the
 * fallback glyph (never a broken image) for a missing source, and × → onRemove.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, fireEvent, screen, waitFor } from '@testing-library/react';
import { NoteCoverBadge } from './NoteCoverBadge';
import { __resetThumbnailCachesForTests, type NoteThumbInfo } from '../lib/noteThumbnails';

const DATA_URL = 'data:image/webp;base64,UklGRg==';
const PATH = 'Characters/Mira.md';

const info = (extra: Partial<NoteThumbInfo> = {}): NoteThumbInfo => ({
  mode: 'auto',
  src: 'Characters/portrait.png',
  version: '1-2',
  missing: false,
  caption: '',
  ...extra,
});

/** A bridge whose resolver answers from a fixed table (unknown paths → "none"). */
function installApi(thumbs: Record<string, NoteThumbInfo>, resolveOverride?: (paths: string[]) => Promise<unknown>) {
  const api = {
    notesThumbResolve: vi.fn(
      resolveOverride ??
        (async (paths: string[]) => ({
          thumbs: Object.fromEntries(paths.filter((p) => p in thumbs).map((p) => [p, thumbs[p]])),
        })),
    ),
    notesThumbGet: vi.fn(async () => ({ status: 'ready', dataUrl: DATA_URL, version: '1-2' })),
    notesThumbPut: vi.fn(async () => ({ ok: true })),
  };
  (window as unknown as { api: unknown }).api = api;
  return api;
}

beforeEach(() => {
  __resetThumbnailCachesForTests();
});

afterEach(() => {
  __resetThumbnailCachesForTests();
  delete (window as unknown as { api?: unknown }).api;
});

describe('NoteCoverBadge', () => {
  it.each([
    ['explicit', 'Thumbnail'],
    ['auto', 'Auto'],
  ] as const)('renders the cover for mode %s with a badge reading exactly "%s"', async (mode, label) => {
    installApi({ [PATH]: info({ mode, caption: 'portrait.png' }) });
    render(<NoteCoverBadge notePath={PATH} title="Mira" onRemove={vi.fn()} />);

    const cover = await screen.findByTestId('note-cover');
    expect(cover).toHaveAttribute('data-thumb-mode', mode);
    expect(screen.getByTestId('note-cover-badge')).toHaveTextContent(label);
    expect(screen.getByTestId('note-cover-badge').textContent).toBe(label);

    // The slot is the shared NoteThumbnail, sized by the cover's own class,
    // and it paints the derivative with the note title as its name.
    const thumb = cover.querySelector('.note-thumb');
    expect(thumb).toHaveClass('note-cover__thumb');
    await waitFor(() => expect(cover.querySelector('img.note-thumb__img')).toHaveAttribute('src', DATA_URL));
    expect(cover.querySelector('img.note-thumb__img')).toHaveAttribute('alt', 'Mira');
    expect(cover.querySelector('.note-thumb__caption')).toHaveTextContent('portrait.png');
  });

  it.each([
    ['off', info({ mode: 'off', src: null, version: null })],
    ['none', info({ mode: 'none', src: null, version: null })],
  ])('renders nothing at all — no empty box — for mode %s', async (_label, value) => {
    const api = installApi({ [PATH]: value });
    const { container } = render(<NoteCoverBadge notePath={PATH} title="Mira" onRemove={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(api.notesThumbResolve).toHaveBeenCalledWith([PATH]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('note-cover')).toBeNull();
    expect(api.notesThumbGet).not.toHaveBeenCalled();
  });

  it('renders nothing while the resolver has not answered yet', () => {
    installApi({}, () => new Promise(() => {}));
    const { container } = render(<NoteCoverBadge notePath={PATH} title="Mira" onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the badge and × around the fallback glyph when the source is missing — never a broken image', async () => {
    const api = installApi({ [PATH]: info({ mode: 'explicit', missing: true, caption: 'gone.png' }) });
    render(<NoteCoverBadge notePath={PATH} title="Mira" onRemove={vi.fn()} />);

    const cover = await screen.findByTestId('note-cover');
    expect(cover).toHaveAttribute('data-thumb-mode', 'explicit');
    expect(screen.getByTestId('note-cover-badge')).toHaveTextContent('Thumbnail');
    expect(cover.querySelector('.note-thumb')).toHaveAttribute('data-thumb-state', 'unavailable');
    expect(cover.querySelector('svg.note-thumb__glyph')).not.toBeNull();
    expect(cover.querySelector('img')).toBeNull();
    expect(screen.getByTestId('note-cover-remove')).toBeInTheDocument();
    expect(api.notesThumbGet).not.toHaveBeenCalled();
  });

  it('× is a real, labelled button that asks the owner to remove the thumbnail', async () => {
    installApi({ [PATH]: info() });
    const onRemove = vi.fn();
    render(<NoteCoverBadge notePath={PATH} title="Mira" onRemove={onRemove} />);

    await screen.findByTestId('note-cover');
    const remove = screen.getByRole('button', { name: 'Remove thumbnail' });
    expect(remove).toBe(screen.getByTestId('note-cover-remove'));
    expect(remove).toHaveAttribute('type', 'button');
    expect(remove).toHaveAttribute('title', 'Remove thumbnail — writes thumb: false');
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('follows the memo: once the note is re-resolved as off, the cover unmounts', async () => {
    let current: NoteThumbInfo = info();
    const api = installApi({}, async (paths: string[]) => ({ thumbs: Object.fromEntries(paths.map((p) => [p, current])) }));
    render(<NoteCoverBadge notePath={PATH} title="Mira" onRemove={vi.fn()} />);
    await screen.findByTestId('note-cover');

    current = info({ mode: 'off', src: null, version: null });
    const { invalidateNoteThumbs } = await import('../lib/noteThumbnails');
    act(() => invalidateNoteThumbs([PATH]));
    await waitFor(() => expect(screen.queryByTestId('note-cover')).toBeNull());
    expect(api.notesThumbResolve).toHaveBeenCalledTimes(2);
  });

  it('pins the mockup geometry: 176×104, radius 10, badge on --n1, 18×18 ×', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/NoteCoverBadge.css'), 'utf-8');
    const cover = css.match(/\.note-cover \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(cover).toContain('width: 176px');
    expect(cover).toContain('height: 104px');
    expect(cover).toContain('border-radius: 10px');
    const badge = css.match(/\.note-cover__badge \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(badge).toContain('background: var(--n1');
    expect(badge).toContain('color: #0b0d17');
    expect(badge).toContain('font-size: 8.5px');
    expect(badge).toContain('font-weight: 700');
    const remove = css.match(/\.note-cover__remove \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(remove).toContain('width: 18px');
    expect(remove).toContain('height: 18px');
    expect(remove).toContain('border-radius: 6px');
    expect(remove).toContain('rgb(8 10 18 / 0.62)');
    expect(remove).toContain('rgb(255 255 255 / 0.16)');
  });
});
