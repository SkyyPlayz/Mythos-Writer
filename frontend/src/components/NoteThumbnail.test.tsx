/**
 * SKY-11186 — NoteThumbnail: the four states, the no-broken-image guarantee,
 * accessibility per state, and the caption scrim (BOARDS-SPEC v2 §6/§9).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { NoteThumbnail } from './NoteThumbnail';
import { __resetThumbnailCachesForTests, type NoteThumbInfo } from '../lib/noteThumbnails';

const DATA_URL = 'data:image/webp;base64,UklGRg==';

const info = (extra: Partial<NoteThumbInfo> = {}): NoteThumbInfo => ({
  mode: 'auto',
  src: 'Notes/cover.png',
  version: 'v1',
  missing: false,
  caption: '',
  ...extra,
});

function installApi(notesThumbGet: (src: string) => Promise<unknown>) {
  const api = {
    notesThumbGet: vi.fn(notesThumbGet),
    notesThumbPut: vi.fn(async () => ({ ok: true })),
  };
  (window as unknown as { api: unknown }).api = api;
  return api;
}

const readyApi = () => installApi(async () => ({ status: 'ready', dataUrl: DATA_URL, version: 'v1' }));

beforeEach(() => {
  __resetThumbnailCachesForTests();
});

afterEach(() => {
  __resetThumbnailCachesForTests();
  delete (window as unknown as { api?: unknown }).api;
});

const thumb = (container: HTMLElement) => container.querySelector('.note-thumb') as HTMLElement;
const img = (container: HTMLElement) => container.querySelector('img.note-thumb__img');
const glyph = (container: HTMLElement) => container.querySelector('svg.note-thumb__glyph');

describe('NoteThumbnail', () => {
  it.each([
    ['no info', undefined],
    ['mode none', info({ mode: 'none', src: null, version: null })],
    ['mode off', info({ mode: 'off' })],
  ])('renders an empty, hidden wrapper for %s', (_label, value) => {
    const api = readyApi();
    const { container } = render(<NoteThumbnail info={value} alt="Cover" caption />);
    const wrapper = thumb(container);
    expect(wrapper).toHaveAttribute('data-thumb-state', 'none');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper).toBeEmptyDOMElement();
    expect(api.notesThumbGet).not.toHaveBeenCalled();
  });

  it('paints the placeholder with no <img> while the derivative loads', () => {
    installApi(() => new Promise(() => {}));
    const { container } = render(<NoteThumbnail info={info()} alt="Cover" />);
    const wrapper = thumb(container);
    expect(wrapper).toHaveAttribute('data-thumb-state', 'loading');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper).not.toHaveAttribute('role');
    expect(img(container)).toBeNull();
    expect(glyph(container)).toBeNull();
  });

  it('renders the derivative with the alt text once ready', async () => {
    readyApi();
    const { container } = render(<NoteThumbnail info={info()} alt="Cover" />);
    await waitFor(() => expect(img(container)).not.toBeNull());
    const wrapper = thumb(container);
    expect(wrapper).toHaveAttribute('data-thumb-state', 'ready');
    expect(wrapper).toHaveAttribute('role', 'img');
    expect(wrapper).toHaveAttribute('aria-label', 'Cover');
    expect(wrapper).not.toHaveAttribute('aria-hidden');
    const image = img(container) as HTMLImageElement;
    expect(image).toHaveAttribute('src', DATA_URL);
    expect(image).toHaveAttribute('alt', 'Cover');
    expect(image).toHaveAttribute('draggable', 'false');
    expect(image).toHaveAttribute('decoding', 'async');
  });

  it('falls back to the glyph, never a broken image, when the data URL fails to decode', async () => {
    readyApi();
    const { container } = render(<NoteThumbnail info={info()} alt="Cover" />);
    await waitFor(() => expect(img(container)).not.toBeNull());
    fireEvent.error(img(container) as Element);
    expect(thumb(container)).toHaveAttribute('data-thumb-state', 'unavailable');
    expect(thumb(container)).toHaveAttribute('aria-hidden', 'true');
    expect(img(container)).toBeNull();
    expect(glyph(container)).not.toBeNull();
    expect(glyph(container)).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the glyph without asking main when the image is not on disk', () => {
    const api = readyApi();
    const { container } = render(<NoteThumbnail info={info({ missing: true })} alt="Cover" />);
    expect(thumb(container)).toHaveAttribute('data-thumb-state', 'unavailable');
    expect(img(container)).toBeNull();
    expect(glyph(container)).not.toBeNull();
    expect(api.notesThumbGet).not.toHaveBeenCalled();
  });

  it('renders the glyph when main has no derivative to give', async () => {
    installApi(async () => ({ status: 'missing' }));
    const { container } = render(<NoteThumbnail info={info()} alt="Cover" />);
    await waitFor(() => expect(thumb(container)).toHaveAttribute('data-thumb-state', 'unavailable'));
    expect(img(container)).toBeNull();
    expect(glyph(container)).not.toBeNull();
  });

  it('renders the caption scrim only when asked for and non-empty', async () => {
    readyApi();
    const captioned = render(<NoteThumbnail info={info({ caption: 'Map of the north' })} alt="Cover" caption />);
    await waitFor(() => expect(img(captioned.container)).not.toBeNull());
    expect(captioned.container.querySelector('.note-thumb__caption')).toHaveTextContent('Map of the north');

    const notAsked = render(<NoteThumbnail info={info({ caption: 'Map of the north' })} alt="Cover" />);
    expect(notAsked.container.querySelector('.note-thumb__caption')).toBeNull();

    const empty = render(<NoteThumbnail info={info({ caption: '' })} alt="Cover" caption />);
    expect(empty.container.querySelector('.note-thumb__caption')).toBeNull();
  });

  it('keeps the caption over the placeholder states too', () => {
    readyApi();
    const { container } = render(<NoteThumbnail info={info({ missing: true, caption: 'cover.png' })} alt="Cover" caption />);
    expect(container.querySelector('.note-thumb__caption')).toHaveTextContent('cover.png');
  });

  it('lets the caller own size and radius through className', () => {
    installApi(() => new Promise(() => {}));
    const { container } = render(<NoteThumbnail info={info()} alt="Cover" className="board-card__thumb" />);
    expect(thumb(container)).toHaveClass('note-thumb', 'board-card__thumb');
  });

  it('turns the loading shimmer off under prefers-reduced-motion', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/NoteThumbnail.css'), 'utf-8');
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(reduced?.[1]).toContain("[data-thumb-state='loading']::after");
    expect(reduced?.[1]).toContain('animation: none');
  });
});
