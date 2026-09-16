/**
 * SKY-11186 — NoteViewer × the editor cover (BOARDS-SPEC v2 §9): the badge
 * follows the resolver's answer for the open note, and × writes
 * `thumb: false` — unquoted — through the note's normal save path
 * (`writeNotesVault`, i.e. the `notesVault:write` IPC), then invalidates the
 * shared memo so the cover leaves once main answers "off".
 */
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NoteViewer, { NOTES_DEFAULT_RICH_KEY, NOTES_MODE_BY_PATH_KEY } from './NoteViewer';
import { __resetThumbnailCachesForTests, type NoteThumbInfo } from './lib/noteThumbnails';

const PATH = 'Characters/Mira.md';
const BODY = '# Mira\n\nDread first, wonder second.\n\n![[portrait.png]]\n';
const DATA_URL = 'data:image/webp;base64,UklGRg==';

const AUTO: NoteThumbInfo = { mode: 'auto', src: 'Characters/portrait.png', version: '1-2', missing: false, caption: 'portrait.png' };
const EXPLICIT: NoteThumbInfo = { ...AUTO, mode: 'explicit', src: 'Characters/cover.png', caption: 'cover.png' };
const OFF: NoteThumbInfo = { mode: 'off', src: null, version: null, missing: false, caption: '' };

/** The "file on disk": read by the editor, rewritten by its saves, read by the resolver. */
let disk = BODY;

const readNotesVault = vi.fn(async () => ({ content: disk, path: PATH }));
const writeNotesVault = vi.fn(async (_path: string, content: string) => {
  disk = content;
  return { path: PATH, bytes: content.length };
});
/** Answers like main's resolver would, from whatever is on disk right now. */
const notesThumbResolve = vi.fn(async (paths: string[]) => ({
  thumbs: Object.fromEntries(
    paths.map((p) => [p, /^---\nthumb: false\n/.test(disk) ? OFF : /^---\nthumb: /.test(disk) ? EXPLICIT : AUTO]),
  ),
}));
const notesThumbGet = vi.fn(async () => ({ status: 'ready', dataUrl: DATA_URL, version: '1-2' }));
const notesThumbPut = vi.fn(async () => ({ ok: true }));

beforeEach(() => {
  disk = BODY;
  __resetThumbnailCachesForTests();
  for (const fn of [readNotesVault, writeNotesVault, notesThumbResolve, notesThumbGet, notesThumbPut]) fn.mockClear();
  (window as unknown as { api: unknown }).api = {
    readNotesVault,
    writeNotesVault,
    readVault: vi.fn().mockResolvedValue({ content: '' }),
    writeVault: vi.fn().mockResolvedValue({ path: 'x', bytes: 0 }),
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    noteBacklinks: vi.fn().mockResolvedValue({ backlinks: [] }),
    notesThumbResolve,
    notesThumbGet,
    notesThumbPut,
  };
});

afterEach(() => {
  cleanup();
  __resetThumbnailCachesForTests();
  window.localStorage.removeItem(NOTES_DEFAULT_RICH_KEY);
  window.localStorage.removeItem(NOTES_MODE_BY_PATH_KEY);
  delete (window as unknown as { api?: unknown }).api;
});

const sourceTextarea = () => screen.getByRole('textbox', { name: 'Edit note: Mira.md' }) as HTMLTextAreaElement;

describe('NoteViewer — editor cover (SKY-11186)', () => {
  it('shows the Auto badge in the header for a note whose first image is its cover', async () => {
    render(<NoteViewer path={PATH} mode="source" />);

    const cover = await screen.findByTestId('note-cover');
    expect(cover).toHaveAttribute('data-thumb-mode', 'auto');
    expect(screen.getByTestId('note-cover-badge').textContent).toBe('Auto');
    expect(screen.getByTestId('note-header')).toContainElement(cover);
    // The resolver is asked under the note's own vault-relative path …
    expect(notesThumbResolve).toHaveBeenCalledWith([PATH]);
    // … and the slot paints the shared derivative, named after the note.
    await waitFor(() => expect(cover.querySelector('img.note-thumb__img')).toHaveAttribute('src', DATA_URL));
    expect(cover.querySelector('img.note-thumb__img')).toHaveAttribute('alt', 'Mira');
    // The rest of the header is untouched.
    expect(screen.getByTestId('note-title')).toHaveTextContent('Mira');
    expect(screen.getByTestId('note-tags-row')).toBeInTheDocument();
  });

  it('reads "Thumbnail" when the note names its cover in frontmatter', async () => {
    disk = `---\nthumb: cover.png\n---\n${BODY}`;
    render(<NoteViewer path={PATH} mode="source" />);

    const cover = await screen.findByTestId('note-cover');
    expect(cover).toHaveAttribute('data-thumb-mode', 'explicit');
    expect(screen.getByTestId('note-cover-badge').textContent).toBe('Thumbnail');
  });

  it('renders no cover for a note with thumb: false', async () => {
    disk = `---\nthumb: false\n---\n${BODY}`;
    render(<NoteViewer path={PATH} mode="source" />);

    await screen.findByTestId('note-title');
    await waitFor(() => expect(notesThumbResolve).toHaveBeenCalledWith([PATH]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('note-cover')).toBeNull();
    expect(screen.queryByTestId('note-cover-badge')).toBeNull();
  });

  it('× writes an unquoted thumb: false through the save path, then invalidates so the cover leaves', async () => {
    render(<NoteViewer path={PATH} mode="source" />);
    await screen.findByTestId('note-cover');
    expect(notesThumbResolve).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Remove thumbnail' }));

    // The write goes through writeNotesVault (notesVault:write) with the
    // frontmatter block created and `thumb: false` as a bare YAML boolean —
    // the body is untouched.
    const expected = `---\nthumb: false\n---\n\n${BODY}`;
    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith(PATH, expected));
    expect(disk).toBe(expected);
    // The editor adopted the change (Source view shows the file as written).
    expect(sourceTextarea().value).toBe(expected);

    // Only after the write landed is main re-asked — and now it says "off".
    await waitFor(() => expect(notesThumbResolve).toHaveBeenCalledTimes(2));
    expect(writeNotesVault.mock.invocationCallOrder[0]).toBeLessThan(notesThumbResolve.mock.invocationCallOrder[1]);
    await waitFor(() => expect(screen.queryByTestId('note-cover')).toBeNull());
  });

  it('a failed save keeps the cover and does not re-ask main', async () => {
    writeNotesVault.mockImplementationOnce(async () => ({ error: 'disk full' }) as never);
    render(<NoteViewer path={PATH} mode="source" />);
    await screen.findByTestId('note-cover');

    fireEvent.click(screen.getByRole('button', { name: 'Remove thumbnail' }));
    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledTimes(1));
    await screen.findByRole('alert');
    await act(async () => {
      await Promise.resolve();
    });

    expect(notesThumbResolve).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('note-cover')).toBeInTheDocument();
    expect(disk).toBe(BODY);
  });
});
