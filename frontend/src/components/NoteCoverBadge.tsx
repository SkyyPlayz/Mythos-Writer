/**
 * SKY-11186 — the editor cover (BOARDS-SPEC v2 §9): "The cover also renders
 * in the Notes editor beside the title (badge reads `Thumbnail` when explicit,
 * `Auto` when derived from the first image), with an × that writes
 * `thumb: false`."
 *
 * Reads the same batched, memoised answer the Notes Board and Scene Crafter
 * cards use (`useNoteThumbInfo`) and paints the same ~256px derivative
 * through `NoteThumbnail`, so all three surfaces agree on which image a note
 * shows. Renders nothing at all — no empty box — unless the note has a cover
 * (`explicit` / `auto`); a missing source still gets the badge and the ×
 * around NoteThumbnail's fallback glyph (owner ruling 5f), never a broken
 * image.
 *
 * The × only asks; the OWNER of the note content (NoteViewer) writes
 * `thumb: false` through its normal frontmatter save path and invalidates
 * the memo once the write has landed.
 *
 * Geometry per the owner mockup (design report 2026-09-02, script 9591):
 * 176×104, radius 10; badge pill top-left on --n1; 18×18 × top-right.
 */
import { useNoteThumbInfo, type NoteThumbInfo } from '../lib/noteThumbnails';
import { NoteThumbnail } from './NoteThumbnail';
import './NoteCoverBadge.css';

export type NoteCoverMode = 'explicit' | 'auto';

export interface NoteCoverBadgeProps {
  /** Vault-relative POSIX path of the open note — the key `notesThumbResolve` answers under. */
  notePath: string;
  /** Accessible name for the derivative; the note title. */
  title: string;
  /** × pressed — the caller writes `thumb: false` and invalidates the memo. */
  onRemove: () => void;
}

/** Badge text per mode — spec §9 wording, verbatim. */
export const NOTE_COVER_BADGE_LABEL: Record<NoteCoverMode, string> = {
  explicit: 'Thumbnail',
  auto: 'Auto',
};

function coverModeOf(info: NoteThumbInfo | undefined): NoteCoverMode | null {
  if (info === undefined) return null;
  return info.mode === 'explicit' || info.mode === 'auto' ? info.mode : null;
}

export function NoteCoverBadge({ notePath, title, onRemove }: NoteCoverBadgeProps) {
  const info = useNoteThumbInfo(notePath);
  const mode = coverModeOf(info);
  if (mode === null || info === undefined) return null;

  return (
    <div className="note-cover" data-testid="note-cover" data-thumb-mode={mode}>
      <NoteThumbnail info={info} alt={title} caption className="note-cover__thumb" />
      <span className="note-cover__badge" data-testid="note-cover-badge">
        {NOTE_COVER_BADGE_LABEL[mode]}
      </span>
      <button
        type="button"
        className="note-cover__remove"
        data-testid="note-cover-remove"
        aria-label="Remove thumbnail"
        title="Remove thumbnail — writes thumb: false"
        onClick={onRemove}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" focusable="false">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
