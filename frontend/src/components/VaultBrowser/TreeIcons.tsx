// M8c (SKY-9335): drawn line icons for the Notes tree, ported 1:1 from the
// Liquid Neon prototype's `this.icons.folder` / `this.icons.file` glyphs
// (plans/design-handoff/v2/prototype — the rendered prototype is the spec).
// Replaces the emoji fallbacks (📂/📁/📄) the tree used before — R4/M8 §2.
import type { FC } from 'react';

const SHARED = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
} as const;

export const FolderIcon: FC = () => (
  <svg width={14} height={14} aria-hidden="true" {...SHARED}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </svg>
);

export const FileIcon: FC = () => (
  <svg width={13} height={13} aria-hidden="true" {...SHARED}>
    <path d="M7 3.5h7l4 4v13H7z" />
    <path d="M14 3.5v4h4" />
  </svg>
);

// Prototype's RECENT NOTES row icon — same file glyph, one notch smaller and
// no rounded joins on the corner point.
export const RecentNoteIcon: FC = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true" style={{ flex: 'none', opacity: 0.7 }}>
    <path d="M7 3h7l4 4v14H7z" />
    <path d="M14 3v4h4" />
  </svg>
);

// Prototype's toolbar "New folder" glyph (nToolNewFolder), replacing the
// 📁+ emoji button.
export const NewFolderIcon: FC = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <path d="M12 10v6M9 13h6" />
  </svg>
);
