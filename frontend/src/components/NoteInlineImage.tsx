/**
 * PLAN-058 L6 (30:00 / 30:10): inline note body image with vault resolve +
 * broken-load fallback (no broken-image icon).
 */
import { useCallback, useEffect, useState } from 'react';
import { markThumbnailUnavailable, useThumbnail } from '../lib/noteThumbnails';
import { resolveNoteImageVaultPath } from '../lib/noteInlineImages';
import './NoteInlineImage.css';

export interface NoteInlineImageProps {
  notePath: string;
  src: string;
  alt: string;
  className?: string;
}

export function NoteInlineImage({ notePath, src, alt, className }: NoteInlineImageProps) {
  const vaultSrc = resolveNoteImageVaultPath(notePath, src);
  const external = /^(https?:|data:|file:|blob:)/i.test(vaultSrc);
  const [version, setVersion] = useState<string | null>(external ? null : 'inline');
  const loadSrc = external ? vaultSrc : vaultSrc;
  const thumb = useThumbnail(external ? null : loadSrc, version);

  useEffect(() => {
    if (external) return;
    let cancelled = false;
    void window.api?.notesThumbGet?.(vaultSrc).then((result) => {
      if (cancelled || !result) return;
      if (result.status === 'ready' || result.status === 'source') {
        setVersion(result.version);
      }
    });
    return () => { cancelled = true; };
  }, [vaultSrc, external]);

  const onError = useCallback(() => {
    if (!external && version) markThumbnailUnavailable(loadSrc, version);
  }, [external, loadSrc, version]);

  const cls = ['note-inline-image', className].filter(Boolean).join(' ');

  if (external) {
    return (
      <img
        className={cls}
        src={vaultSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={onError}
      />
    );
  }

  if (thumb.status === 'ready') {
    return (
      <img
        className={cls}
        src={thumb.dataUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        data-testid="note-inline-image"
      />
    );
  }

  if (thumb.status === 'unavailable') {
    return (
      <span className={`${cls} note-inline-image--missing`} role="img" aria-label={alt || 'Image unavailable'} data-testid="note-inline-image-missing">
        <svg className="note-inline-image__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="M4.5 17.5l4.5-4 3.5 3 3-2.5 4 3.5" />
        </svg>
      </span>
    );
  }

  return <span className={`${cls} note-inline-image--loading`} aria-hidden="true" data-testid="note-inline-image-loading" />;
}
