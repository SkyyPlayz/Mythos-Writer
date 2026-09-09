/**
 * SKY-11186 — the thumbnail slot on a note card (BOARDS-SPEC v2 §6/§9).
 *
 * Purely presentational over `useThumbnail`: the caller resolves WHICH image a
 * note shows (`useNoteThumbInfo`) and sizes/rounds the slot via `className`;
 * this component only decides what to paint in it. Four states, exposed as
 * `data-thumb-state` so callers and tests can key off them:
 *
 *   none        — nothing to show (mode none/off, or no info yet): paints nothing.
 *   loading     — the mockup's gradient block with a shimmer (none under reduced motion).
 *   ready       — the derivative, object-fit cover.
 *   unavailable — the source is gone, unsupported, or the data URL failed to
 *                 decode: the gradient block with a centred image glyph. Never
 *                 a broken-image icon — there is no <img> in this state.
 *
 * Geometry and colours follow the owner mockup's card thumb (owner report,
 * scripts 8086/9591): 150° slot-1→slot-2 gradient, slot-1 rim, 20px glyph at
 * 50% slot-1, and a bottom scrim caption.
 */
import { useCallback } from 'react';
import './NoteThumbnail.css';
import { markThumbnailUnavailable, useThumbnail, type NoteThumbInfo } from '../lib/noteThumbnails';

export type NoteThumbState = 'loading' | 'ready' | 'unavailable' | 'none';

export interface NoteThumbnailProps {
  info: NoteThumbInfo | undefined;
  /** Accessible name in the ready state; the caption is not a substitute. */
  alt: string;
  /** Caller-owned size and radius (the wrapper inherits border-radius). */
  className?: string;
  /** Show the caption scrim (board cards + editor cover). */
  caption?: boolean;
}

function hasThumb(info: NoteThumbInfo | undefined): info is NoteThumbInfo {
  return info !== undefined && info.mode !== 'none' && info.mode !== 'off';
}

export function NoteThumbnail({ info, alt, className, caption = false }: NoteThumbnailProps) {
  const usable = hasThumb(info);
  const src = usable && !info.missing ? info.src : null;
  const version = usable && !info.missing ? info.version : null;
  const load = useThumbnail(src, version);
  const onError = useCallback(() => {
    if (src !== null && version !== null) markThumbnailUnavailable(src, version);
  }, [src, version]);

  const cls = ['note-thumb', className].filter(Boolean).join(' ');
  if (!usable) return <div className={cls} data-thumb-state="none" aria-hidden="true" />;

  const state: NoteThumbState = info.missing ? 'unavailable' : load.status;
  const dataUrl = state === 'ready' && load.status === 'ready' ? load.dataUrl : null;
  const captionText = caption ? info.caption : '';

  return (
    <div
      className={cls}
      data-thumb-state={state}
      role={dataUrl !== null ? 'img' : undefined}
      aria-label={dataUrl !== null ? alt : undefined}
      aria-hidden={dataUrl !== null ? undefined : true}
    >
      {dataUrl !== null && (
        <img
          className="note-thumb__img"
          src={dataUrl}
          alt={alt}
          draggable={false}
          decoding="async"
          onError={onError}
        />
      )}
      {state === 'unavailable' && (
        <svg className="note-thumb__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="M4.5 17.5l4.5-4 3.5 3 3-2.5 4 3.5" />
        </svg>
      )}
      {captionText !== '' && <div className="note-thumb__caption">{captionText}</div>}
    </div>
  );
}
