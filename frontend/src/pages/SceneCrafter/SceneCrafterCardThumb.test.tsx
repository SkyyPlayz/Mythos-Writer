/**
 * SKY-11186 — SceneCrafterCardThumb: a card's leading slot shows the shared
 * note thumbnail when the note has one and is ready, and the initials the
 * card always had otherwise (mode none/off, missing source, failed derivative).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { SceneCrafterCardThumb, notePathForNid } from './SceneCrafterCardThumb';
import { __resetThumbnailCachesForTests, type NoteThumbInfo } from '../../lib/noteThumbnails';

const DATA_URL = 'data:image/webp;base64,UklGRg==';
const NID = 'Characters/Mira Veynn';
const NOTE_PATH = 'Characters/Mira Veynn.md';

const info = (extra: Partial<NoteThumbInfo> = {}): NoteThumbInfo => ({
  mode: 'auto',
  src: 'Characters/mira.png',
  version: '1-2',
  missing: false,
  caption: '',
  ...extra,
});

function installApi(thumbs: Record<string, NoteThumbInfo>, get?: () => Promise<unknown>) {
  const api = {
    notesThumbResolve: vi.fn(async (paths: string[]) => ({
      thumbs: Object.fromEntries(paths.filter((p) => p in thumbs).map((p) => [p, thumbs[p]])),
    })),
    notesThumbGet: vi.fn(get ?? (async () => ({ status: 'ready', dataUrl: DATA_URL, version: '1-2' }))),
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

const slot = (container: HTMLElement) => container.querySelector('.sc-sugg-av') as HTMLElement;

describe('notePathForNid', () => {
  it('adds .md to a nid exactly once', () => {
    expect(notePathForNid('Characters/Mira Veynn')).toBe('Characters/Mira Veynn.md');
    expect(notePathForNid('Characters/Mira Veynn.md')).toBe('Characters/Mira Veynn.md');
    expect(notePathForNid('Loose Note')).toBe('Loose Note.md');
  });
});

describe('SceneCrafterCardThumb', () => {
  it('keeps the initials until the derivative is ready, then paints it in the same slot', async () => {
    const api = installApi({ [NOTE_PATH]: info() });
    const { container } = render(
      <SceneCrafterCardThumb nid={NID} alt="Mira Veynn" className="sc-sugg-av">MV</SceneCrafterCardThumb>,
    );

    // Initials first — never a shimmer in a 26px avatar.
    expect(slot(container)).toHaveTextContent('MV');
    expect(slot(container)).not.toHaveClass('sc-sugg-av--thumb');

    await waitFor(() => expect(api.notesThumbResolve).toHaveBeenCalledWith([NOTE_PATH]));
    await waitFor(() => expect(container.querySelector('img.note-thumb__img')).toHaveAttribute('src', DATA_URL));

    const painted = slot(container);
    expect(painted).toHaveClass('sc-sugg-av', 'sc-sugg-av--thumb');
    expect(painted).toHaveAttribute('aria-hidden', 'true');
    expect(painted).not.toHaveTextContent('MV');
    expect(painted.querySelector('.note-thumb')).toHaveClass('sc-card-thumb');
    expect(painted.querySelector('.note-thumb')).toHaveAttribute('data-thumb-state', 'ready');
  });

  it.each([
    ['none', info({ mode: 'none', src: null, version: null })],
    ['off', info({ mode: 'off' })],
  ])('keeps the initials for mode %s and never asks for a derivative', async (_label, value) => {
    const api = installApi({ [NOTE_PATH]: value });
    const { container } = render(
      <SceneCrafterCardThumb nid={NID} alt="Mira Veynn" className="sc-sugg-av">MV</SceneCrafterCardThumb>,
    );

    await waitFor(() => expect(api.notesThumbResolve).toHaveBeenCalledWith([NOTE_PATH]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(slot(container)).toHaveTextContent('MV');
    expect(slot(container)).not.toHaveClass('sc-sugg-av--thumb');
    expect(container.querySelector('.note-thumb')).toBeNull();
    expect(api.notesThumbGet).not.toHaveBeenCalled();
  });

  it('keeps the initials when the source is missing', async () => {
    const api = installApi({ [NOTE_PATH]: info({ missing: true }) });
    const { container } = render(
      <SceneCrafterCardThumb nid={NID} alt="Mira Veynn" className="sc-ref-band" aria-hidden="true">MV</SceneCrafterCardThumb>,
    );

    await waitFor(() => expect(api.notesThumbResolve).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    const band = container.querySelector('.sc-ref-band') as HTMLElement;
    expect(band).toHaveTextContent('MV');
    expect(band).toHaveAttribute('aria-hidden', 'true');
    expect(band).not.toHaveClass('sc-ref-band--thumb');
    expect(api.notesThumbGet).not.toHaveBeenCalled();
  });

  it('falls back to the initials when main has no derivative to give', async () => {
    const api = installApi({ [NOTE_PATH]: info() }, async () => ({ status: 'missing' }));
    const { container } = render(
      <SceneCrafterCardThumb nid={NID} alt="Mira Veynn" className="sc-sugg-av">MV</SceneCrafterCardThumb>,
    );

    await waitFor(() => expect(api.notesThumbGet).toHaveBeenCalledWith('Characters/mira.png'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(slot(container)).toHaveTextContent('MV');
    expect(slot(container)).not.toHaveClass('sc-sugg-av--thumb');
    expect(container.querySelector('img')).toBeNull();
  });
});
