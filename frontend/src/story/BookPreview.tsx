// Beta 4 M14 — Book view (FULL-SPEC §5.5): compiled read-only manuscript.
//
// Prototype: "Mythos Writer - Liquid Neon.dc.html" 812–871 (header row +
// book scroll) · buildBook 5533–5560 (block compile + comment segments) ·
// bookWrapSt 7156 (page width follows the editor's pageW setting).
//
// Refresh of the Beta 3 FullBookPreviewView (formerly inline in
// DesktopShell.tsx): adds the compiled-header row (READ-ONLY badge · word
// count/read time · Export…), the editor page-width binding, comment
// underlines with a read-only comment card, ◆ ◆ ◆ separators and the
// END OF DRAFT footer.

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Story } from '../types';
import { segmentsFor, useStoryComments, type StoryComment } from '../comments';
import { countWords } from '../wordStats';
import './BookPreview.css';

export interface BookPreviewProps {
  story: Story | null;
  /** Editor page width (Settings → manuscriptPageWidth); the compiled page follows it. */
  pageWidth: number;
  /** Open the export modal (gradient Export… button, prototype 818). */
  onExport: () => void;
  /** Jump to a scene in the editor (comment card "Open in editor"). */
  onOpenScene?: (sceneId: string) => void;
}

/** "102,451 words · ~6.5 hr read" (238 wpm, same engine as wordStats). */
export function formatBookMeta(words: number): string {
  const minutes = words / 238;
  const read =
    minutes < 1
      ? '<1 min read'
      : minutes < 60
        ? `~${Math.ceil(minutes)} min read`
        : `~${(minutes / 60).toFixed(1)} hr read`;
  return `${words.toLocaleString()} words · ${read}`;
}

interface CommentCardState {
  comment: StoryComment;
  x: number;
  y: number;
}

const KIND_AUTHOR_FALLBACK: Record<string, string> = {
  user: 'You',
  writing: 'Writing Coach',
  archive: 'Archive Agent',
  beta: 'Beta Reader',
};

export default function BookPreview({ story, pageWidth, onExport, onOpenScene }: BookPreviewProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLHeadingElement | null>(null);
  const [card, setCard] = useState<CommentCardState | null>(null);

  const { comments } = useStoryComments(story);

  useEffect(() => {
    headerRef.current?.focus({ preventScroll: true });
    setCard(null);
  }, [story?.id]);

  const chapters = useMemo(
    () => (story ? [...story.chapters].sort((a, b) => a.order - b.order) : []),
    [story],
  );

  const chapterSections = useMemo(
    () =>
      chapters.map((ch) => ({
        chapter: ch,
        scenes: [...ch.scenes]
          .sort((a, b) => a.order - b.order)
          .filter((sc) => sc.blocks.some((b) => b.content.trim())),
      })),
    [chapters],
  );

  const totalWords = useMemo(
    () =>
      chapterSections.reduce(
        (sum, { scenes }) =>
          sum +
          scenes.reduce(
            (s, sc) => s + sc.blocks.reduce((t, b) => t + countWords(b.content), 0),
            0,
          ),
        0,
      ),
    [chapterSections],
  );

  if (!story) {
    return (
      <div className="book-preview-empty" role="status" aria-live="polite">
        <span className="book-preview-empty__icon" aria-hidden="true">📖</span>
        <p className="book-preview-empty__title">No story selected</p>
        <p className="book-preview-empty__hint">Select a story from the Editor view to read the full book.</p>
      </div>
    );
  }

  if (chapters.length === 0) {
    return (
      <div className="book-preview-empty" role="status">
        <span className="book-preview-empty__icon" aria-hidden="true">📖</span>
        <p className="book-preview-empty__title">{story.title}</p>
        <p className="book-preview-empty__hint">No chapters yet. Add chapters and scenes in the Editor view.</p>
      </div>
    );
  }

  return (
    <div className="book-preview" onClick={() => setCard(null)}>
      {/* ── Header row (prototype 814–820) ── */}
      <div className="book-preview__header">
        <span className="book-preview__readonly" role="note">READ-ONLY</span>
        <span className="book-preview__meta">Compiled just now · {formatBookMeta(totalWords)}</span>
        <div className="book-preview__spacer" />
        <button className="book-preview__export" onClick={onExport}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V4M8 7.5L12 3.5l4 4" /><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>
          Export…
        </button>
      </div>

      {/* ── Compiled page (bookWrapSt: maxWidth follows editor pageW) ── */}
      <div ref={scrollRef} className="book-preview__scroll" role="document" aria-label={`Full book preview: ${story.title}`}>
        <div className="book-preview__page" style={{ maxWidth: `${pageWidth}px` }}>
          <header className="book-preview__title-block">
            <h1 ref={headerRef} className="book-preview__story-title" tabIndex={-1}>
              {story.title}
            </h1>
            {story.synopsis && <p className="book-preview__synopsis">{story.synopsis}</p>}
          </header>

          {chapterSections.map(({ chapter, scenes }, ci) => (
            <section key={chapter.id} className="book-preview__chapter" aria-labelledby={`bp-ch-${chapter.id}`}>
              <div className="book-preview__chapter-head">
                <div className="book-preview__chapter-kicker" aria-hidden="true">CHAPTER {ci + 1}</div>
                <h2 className="book-preview__chapter-title" id={`bp-ch-${chapter.id}`}>{chapter.title}</h2>
              </div>
              {scenes.length === 0 ? (
                <p className="book-preview__no-content">— no written scenes in this chapter —</p>
              ) : (
                scenes.map((scene, si) => {
                  const sceneComments = comments.filter((c) => c.sceneId === scene.id);
                  const sortedBlocks = [...scene.blocks]
                    .sort((a, b) => a.order - b.order)
                    .filter((b) => b.content.trim());
                  return (
                    <article key={scene.id} className="book-preview__scene">
                      {si > 0 && (
                        <div className="book-preview__scene-sep" aria-hidden="true">◆ ◆ ◆</div>
                      )}
                      {sortedBlocks.map((block) => {
                        const segs = sceneComments.length > 0 ? segmentsFor(block.content, sceneComments) : null;
                        return (
                          <p key={block.id} className="book-preview__para">
                            {segs
                              ? segs.map((s, i) =>
                                  s.comment ? (
                                    <span
                                      // eslint-disable-next-line react/no-array-index-key -- segments are recomputed wholesale; offsets are positional
                                      key={`${s.comment.id}-${i}`}
                                      className={`book-anchor book-anchor--${s.comment.kind}`}
                                      data-testid={`book-anchor-${s.comment.id}`}
                                      title="Open comment"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const full = sceneComments.find((c) => c.id === s.comment?.id);
                                        if (full) setCard({ comment: full, x: e.clientX, y: e.clientY });
                                      }}
                                    >
                                      {s.text}
                                    </span>
                                  ) : (
                                    // eslint-disable-next-line react/no-array-index-key -- positional plain runs
                                    <span key={`t-${i}`}>{s.text}</span>
                                  ),
                                )
                              : block.content}
                          </p>
                        );
                      })}
                    </article>
                  );
                })
              )}
            </section>
          ))}

          <div className="book-preview__end" aria-hidden="true">— END OF DRAFT —</div>
        </div>
      </div>

      {/* ── Read-only comment card (prototype: seg click opens the comment) ── */}
      {card && (
        <div
          className="book-preview__comment-card"
          role="dialog"
          aria-label={`Comment by ${card.comment.author || KIND_AUTHOR_FALLBACK[card.comment.kind] || 'Unknown'}`}
          style={{
            left: Math.min(card.x, window.innerWidth - 300),
            top: Math.min(card.y + 12, window.innerHeight - 180),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="book-preview__comment-head">
            <span className={`book-preview__comment-dot book-preview__comment-dot--${card.comment.kind}`} aria-hidden="true" />
            <span className="book-preview__comment-author">
              {card.comment.author || KIND_AUTHOR_FALLBACK[card.comment.kind] || 'Unknown'}
            </span>
            <button className="book-preview__comment-close" aria-label="Close comment" onClick={() => setCard(null)}>
              <svg width="9" height="9" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
            </button>
          </div>
          <blockquote className="book-preview__comment-quote">“{card.comment.anchor}”</blockquote>
          <p className="book-preview__comment-text">{card.comment.text}</p>
          {onOpenScene && (
            <button
              className="book-preview__comment-open"
              onClick={() => { onOpenScene(card.comment.sceneId); setCard(null); }}
            >
              Open in editor
            </button>
          )}
        </div>
      )}
    </div>
  );
}
