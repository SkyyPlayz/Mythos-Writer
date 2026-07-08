// Editor hot path (perf audit P3) — one memoized row per manuscript paragraph.
//
// Extracted from ManuscriptView's renderBlock so that view-level re-renders
// (agent comments arriving, reader-highlight ticks, width slider / edge drag,
// comment open/hover state, the DesktopShell suggestion poll) no longer touch
// every visible contentEditable paragraph. Before the extraction each render
// recomputed segmentsFor + findAutoLinkHints for up to WINDOW (120) rows and
// reconciled every paragraph's children — mid-edit, React could rip the text
// nodes out from under the caret (jump to start, dropped keystrokes).
//
// Two layers of protection:
//   1. React.memo with paragraphRowPropsEqual — a row re-renders only when
//      ITS inputs change (content, its scene's comment slice, reading /
//      dropline flags, paraStyle, auto-link terms, handler identities).
//   2. Per-row useMemo for the comment segments, auto-link hints, and the
//      rendered children — so even a legitimate row re-render (e.g. the
//      reading flag flipping) reuses the exact same child elements and React
//      bails out of reconciling the contentEditable's children.
//
// The DOM this component produces is byte-for-byte the markup renderBlock
// used to emit — e2e and visual baselines depend on the class names and
// data-testids (msv-para-*, msv-grip-*, msv-anchor-*, msv-wl-hint-*,
// msv-dropline) staying exactly as they are.

import {
  memo,
  useMemo,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { segmentsFor, type StoryComment } from '../comments';
import {
  findAutoLinkHints,
  splitRunByHints,
  type EntityMatch,
  type EntityTerm,
} from './autoLinkText';

const GRIP_ICON = (
  <svg width="9" height="14" viewBox="0 0 12 20" fill="currentColor" aria-hidden="true">
    <circle cx="4" cy="4" r="1.5" />
    <circle cx="8" cy="4" r="1.5" />
    <circle cx="4" cy="10" r="1.5" />
    <circle cx="8" cy="10" r="1.5" />
    <circle cx="4" cy="16" r="1.5" />
    <circle cx="8" cy="16" r="1.5" />
  </svg>
);

export interface ParagraphRowProps {
  sceneId: string;
  blockId: string;
  /** Last committed paragraph text — the contentEditable's children source. */
  content: string;
  /**
   * Comments for this row's scene (a shared empty constant while comments are
   * hidden). Compared element-wise, so the parent may rebuild the per-scene
   * arrays as long as unchanged scenes keep the same comment objects.
   */
  comments: readonly StoryComment[];
  /** Reference-stable auto-link terms (memoized by the parent). */
  autoLinkTerms: EntityTerm[];
  /** M13 reader — true only for the paragraph currently being read aloud. */
  reading: boolean;
  /** M10 grip drag — true while this row is the hovered drop target. */
  showDropLine: boolean;
  /** Toolbar-driven paragraph style (memoized by the parent). */
  paraStyle: CSSProperties;
  onCommit: (sceneId: string, blockId: string, original: string, el: HTMLElement) => void;
  onGripDown: (sceneId: string, blockId: string, e: ReactMouseEvent) => void;
  onParaOver: (blockId: string) => void;
  onParaDrop: (sceneId: string, blockId: string) => void;
  onOpenComment: (id: string | null) => void;
  onApplyAutoLink: (sceneId: string, blockId: string, content: string, hint: EntityMatch) => void;
}

function sameCommentList(a: readonly StoryComment[], b: readonly StoryComment[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** True while this row's contentEditable owns the focus (the user is typing). */
function rowHoldsFocus(blockId: string): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!active || !(active instanceof HTMLElement)) return false;
  const editable = active.closest('[data-testid^="msv-para-"]');
  return editable !== null && editable.getAttribute('data-testid') === `msv-para-${blockId}`;
}

/**
 * Memo gate for ParagraphRow (exported for unit tests).
 *
 * Standard shallow comparison, with two deliberate differences:
 *   - `comments` is compared element-wise (see ParagraphRowProps.comments);
 *   - a change to `content` ALONE is ignored while this row's contentEditable
 *     holds focus. That content change is the row's own last commit echoing
 *     back through state (the DOM already holds the newer text) — re-rendering
 *     would reconcile the children against the stale committed VDOM and rip
 *     the text nodes out from under the caret. The new text re-syncs on the
 *     first re-render after focus leaves the row; commits stay correct either
 *     way because commitParagraph compares against committedRef, not VDOM.
 */
export function paragraphRowPropsEqual(
  prev: ParagraphRowProps,
  next: ParagraphRowProps
): boolean {
  if (
    prev.sceneId !== next.sceneId ||
    prev.blockId !== next.blockId ||
    prev.reading !== next.reading ||
    prev.showDropLine !== next.showDropLine ||
    prev.paraStyle !== next.paraStyle ||
    prev.autoLinkTerms !== next.autoLinkTerms ||
    prev.onCommit !== next.onCommit ||
    prev.onGripDown !== next.onGripDown ||
    prev.onParaOver !== next.onParaOver ||
    prev.onParaDrop !== next.onParaDrop ||
    prev.onOpenComment !== next.onOpenComment ||
    prev.onApplyAutoLink !== next.onApplyAutoLink ||
    !sameCommentList(prev.comments, next.comments)
  ) {
    return false;
  }
  if (prev.content === next.content) return true;
  return rowHoldsFocus(next.blockId);
}

/** Unmemoized row — exported ONLY for render-count probes in unit tests. */
export function ParagraphRowBase({
  sceneId,
  blockId,
  content,
  comments,
  autoLinkTerms,
  reading,
  showDropLine,
  paraStyle,
  onCommit,
  onGripDown,
  onParaOver,
  onParaDrop,
  onOpenComment,
  onApplyAutoLink,
}: ParagraphRowProps) {
  // M11: underline comment anchors (prototype segsFor 3601–3615). The
  // joined segment text always equals `content`, so contentEditable
  // commits (textContent reads) are unaffected.
  const segs = useMemo(
    () => (comments.length > 0 ? segmentsFor(content, comments) : null),
    [content, comments]
  );
  // M23: entity mentions not already [[linked]] render as clickable
  // hints inside the plain runs (comment anchors win on overlap).
  const hints = useMemo(
    () => (autoLinkTerms.length > 0 ? findAutoLinkHints(content, autoLinkTerms) : []),
    [content, autoLinkTerms]
  );

  // Reference-stable children: while none of the inputs change, React sees
  // the exact same elements and never touches the contentEditable's DOM —
  // even when the row itself re-renders (reading/dropline/style flips).
  const renderedChildren = useMemo<ReactNode>(() => {
    const renderPlainRun = (text: string, start: number, keyBase: string) => {
      const runs = hints.length > 0 ? splitRunByHints(text, start, hints) : null;
      if (!runs) return <span key={keyBase}>{text}</span>;
      return runs.map((r, j) =>
        r.hint ? (
          <span
            // eslint-disable-next-line react/no-array-index-key -- runs are recomputed wholesale; offsets are positional
            key={`${keyBase}-h${j}`}
            className="msv-wl-hint"
            data-testid={`msv-wl-hint-${blockId}-${r.hint.from}`}
            title={`Link to [[${r.hint.canonicalName}]]`}
            onClick={() => {
              if (r.hint) onApplyAutoLink(sceneId, blockId, content, r.hint);
            }}
          >
            {r.text}
          </span>
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- positional plain runs
          <span key={`${keyBase}-t${j}`}>{r.text}</span>
        )
      );
    };

    if (segs) {
      let offset = 0;
      return segs.map((s, i) => {
        const start = offset;
        offset += s.text.length;
        return s.comment ? (
          <span
            // eslint-disable-next-line react/no-array-index-key -- segments are recomputed wholesale; offsets are positional
            key={`${s.comment.id}-${i}`}
            className={`msv-anchor msv-anchor--${s.comment.kind}`}
            data-testid={`msv-anchor-${s.comment.id}`}
            title="Open comment"
            onClick={() => onOpenComment(s.comment ? s.comment.id : null)}
          >
            {s.text}
          </span>
        ) : (
          renderPlainRun(s.text, start, `t-${i}`)
        );
      });
    }
    if (hints.length > 0) return renderPlainRun(content, 0, 'p');
    return content;
  }, [segs, hints, content, sceneId, blockId, onOpenComment, onApplyAutoLink]);

  return (
    <div>
      {showDropLine && <div className="msv-dropline" data-testid="msv-dropline" aria-hidden="true" />}
      <div
        className="msv-para"
        onMouseEnter={() => onParaOver(blockId)}
        onMouseUp={() => onParaDrop(sceneId, blockId)}
      >
        <span
          className="msv-grip"
          data-testid={`msv-grip-${blockId}`}
          title="Drag block to move it"
          aria-hidden="true"
          onMouseDown={(e) => onGripDown(sceneId, blockId, e)}
        >
          {GRIP_ICON}
        </span>
        <div
          className={`msv-para-text${reading ? ' msv-para-text--reading' : ''}`}
          style={paraStyle}
          data-testid={`msv-para-${blockId}`}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="false"
          onBlur={(e) => onCommit(sceneId, blockId, content, e.currentTarget)}
          onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommit(sceneId, blockId, content, e.currentTarget);
              e.currentTarget.blur();
            }
          }}
        >
          {renderedChildren}
        </div>
      </div>
    </div>
  );
}

const ParagraphRow = memo(ParagraphRowBase, paragraphRowPropsEqual);
export default ParagraphRow;
