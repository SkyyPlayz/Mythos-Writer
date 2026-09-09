/**
 * SKY-11186 — the leading slot on a Scene Crafter card (suggested-rail
 * avatar, reference-card band): the note's thumbnail when it has one,
 * otherwise the initials the card always showed.
 *
 * Owner ruling on SKY-10724: thumbnails render in BOTH the Notes Board and
 * the Scene Crafter cards from the SAME cached ~256px derivative. So this
 * reads the shared `useNoteThumbInfo` memo (one batched IPC per macrotask,
 * however many cards mount) and paints through `NoteThumbnail`. The gallery
 * is not redesigned: the derivative simply replaces the initials fill inside
 * the caller's existing box — `className` is the slot the card already had
 * (`sc-sugg-av` / `sc-ref-band`), which owns size and radius.
 *
 * The initials stay up until the derivative is actually ready, and come back
 * whenever it can't be shown (mode none/off, source missing, decode failed):
 * a 26px avatar is too small for a shimmer or a placeholder glyph to read as
 * anything but a glitch.
 */
import type { ReactNode } from 'react';
import { useNoteThumbInfo, useThumbnail } from '../../lib/noteThumbnails';
import { NoteThumbnail } from '../../components/NoteThumbnail';

export interface SceneCrafterCardThumbProps {
  /** `SuggestedCard.nid` — the vault-relative note path without `.md`. */
  nid: string;
  /** Accessible name for the derivative; the card title. */
  alt: string;
  /** The card's existing slot class (`sc-sugg-av` / `sc-ref-band`); owns size + radius. */
  className: string;
  /** The initials fallback. */
  children: ReactNode;
  /** Mirrors the caller's decorative marking on the fallback slot. */
  'aria-hidden'?: 'true';
}

/** `crafterState.suggestedFromVault` strips `.md`; the resolver keys on the full path. */
export function notePathForNid(nid: string): string {
  return /\.md$/i.test(nid) ? nid : `${nid}.md`;
}

export function SceneCrafterCardThumb({ nid, alt, className, children, 'aria-hidden': ariaHidden }: SceneCrafterCardThumbProps) {
  const info = useNoteThumbInfo(notePathForNid(nid));
  const usable = info !== undefined && (info.mode === 'explicit' || info.mode === 'auto') && !info.missing;
  const load = useThumbnail(usable ? info.src : null, usable ? info.version : null);

  if (!usable || load.status !== 'ready') {
    return <span className={className} aria-hidden={ariaHidden}>{children}</span>;
  }
  // The text beside the slot already names the note; the image is decorative here.
  return (
    <span className={`${className} ${className}--thumb`} aria-hidden="true">
      <NoteThumbnail info={info} alt={alt} className="sc-card-thumb" />
    </span>
  );
}
