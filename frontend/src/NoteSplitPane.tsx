// M16 (Beta 3 Liquid Neon): notes split pane — prototype `toggleNSplit`
// (HTML 1281–1299): SPLIT badge, a note selector, a close button, and the
// second note rendered beside the active one. Where the prototype shows a
// read-only excerpt, this pane mounts a full NoteViewer (same mechanism as
// the story-side SplitEditorPane mounting a second BlockEditor), so both
// notes stay editable with the shared autosave contract.
import type { CSSProperties } from 'react';
import NoteViewer from './NoteViewer';
import type { WikiLinkCandidate } from './crossTabLinkResolver';
import './NoteSplitPane.css';

export interface NoteSplitPaneProps {
  /** Notes-Vault-relative path shown in this pane. */
  path: string;
  /** All linkable note paths (md files) for the selector. */
  notePaths: string[];
  onChangePath: (path: string) => void;
  onClose: () => void;
  // NoteViewer passthrough (same wiring as the primary pane).
  onWikiLinkClick?: (target: string) => void;
  resolvedWikiLinkTitles?: ReadonlySet<string>;
  sceneWikiLinkTitles?: ReadonlySet<string>;
  wikiLinkCandidates?: WikiLinkCandidate[];
  style?: CSSProperties;
}

function noteLabel(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ?? path;
}

export default function NoteSplitPane({
  path,
  notePaths,
  onChangePath,
  onClose,
  onWikiLinkClick,
  resolvedWikiLinkTitles,
  sceneWikiLinkTitles,
  wikiLinkCandidates,
  style,
}: NoteSplitPaneProps) {
  // The current path is always selectable even if the list is momentarily stale.
  const options = notePaths.includes(path) ? notePaths : [path, ...notePaths];

  return (
    <div className="nsp-pane" data-testid="note-split-pane" style={style}>
      <div className="nsp-header">
        <span className="nsp-badge">SPLIT</span>
        <select
          className="nsp-select"
          aria-label="Split note"
          data-testid="note-split-select"
          value={path}
          onChange={(e) => onChangePath(e.target.value)}
        >
          {options.map((p) => (
            <option key={p} value={p}>{noteLabel(p)}</option>
          ))}
        </select>
        <div className="nsp-spacer" />
        <button
          type="button"
          className="nsp-close"
          aria-label="Close split"
          data-testid="note-split-close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="nsp-body">
        <NoteViewer
          key={path}
          path={path}
          onWikiLinkClick={onWikiLinkClick}
          resolvedWikiLinkTitles={resolvedWikiLinkTitles}
          sceneWikiLinkTitles={sceneWikiLinkTitles}
          wikiLinkCandidates={wikiLinkCandidates}
        />
      </div>
    </div>
  );
}
