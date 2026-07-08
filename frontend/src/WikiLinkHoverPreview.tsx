// M16 (Beta 3 Liquid Neon): hover-preview card for [[wiki links]] in the notes
// editor. The prototype only glows on hover, but DESIGN-SPEC §5 calls for an
// Obsidian-style page preview — spec wins (see LIQUID-NEON-PROTOTYPE-MAP §D
// "Notes"). One instance is mounted per notes panel and listens, delegated, on
// the panel body: it covers rich-mode `[data-wiki-link]` spans and
// preview-mode `[data-wiki-target]` buttons in every pane, including splits.
import { useCallback, useEffect, useRef, useState } from 'react';
import './WikiLinkHoverPreview.css';

export interface WikiLinkPreviewData {
  kind: 'note' | 'scene';
  title: string;
  /** e.g. vault-relative path for notes, `Story › Chapter` for scenes. */
  subtitle?: string;
  markdown: string;
}

/** Resolves a raw [[target]] to preview data; null means unresolved. */
export type WikiLinkPreviewResolver = (target: string) => Promise<WikiLinkPreviewData | null>;

const HOVER_SELECTOR = '[data-wiki-link], [data-wiki-target]';
const CARD_WIDTH = 340;
const CARD_MARGIN = 10;

/**
 * Body excerpt for the card: frontmatter stripped, markdown syntax lightly
 * flattened, truncated on a word boundary. Exported for unit tests.
 */
export function extractPreviewExcerpt(markdown: string, maxChars = 420): string {
  let body = markdown;
  const fm = body.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
  if (fm) body = body.slice(fm[0].length);
  body = body
    .replace(/^#{1,6}[ \t]+/gm, '') // heading markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>[ \t]?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (body.length <= maxChars) return body;
  const cut = body.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > maxChars * 0.6 ? lastSpace : maxChars).trimEnd()}…`;
}

function hoverTargetOf(el: Element | null): { el: HTMLElement; target: string } | null {
  const link = el?.closest?.(HOVER_SELECTOR) as HTMLElement | null;
  if (!link) return null;
  const target = link.getAttribute('data-wiki-link') ?? link.getAttribute('data-wiki-target') ?? '';
  if (!target.trim()) return null;
  return { el: link, target };
}

interface CardState {
  target: string;
  anchor: DOMRect;
  status: 'loading' | 'ready' | 'unresolved';
  data: WikiLinkPreviewData | null;
}

interface Props {
  /** The element whose descendants' wiki links get hover previews. */
  containerRef: React.RefObject<HTMLElement | null>;
  resolvePreview: WikiLinkPreviewResolver;
  /** Hover intent delay before the card shows. */
  hoverDelayMs?: number;
}

export default function WikiLinkHoverPreview({ containerRef, resolvePreview, hoverDelayMs = 300 }: Props) {
  const [card, setCard] = useState<CardState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredElRef = useRef<HTMLElement | null>(null);
  const requestSeqRef = useRef(0);
  const cardElRef = useRef<HTMLDivElement | null>(null);
  const resolveRef = useRef(resolvePreview);
  resolveRef.current = resolvePreview;

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    hoveredElRef.current = null;
    requestSeqRef.current++;
    setCard(null);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseOver = (e: MouseEvent) => {
      const hit = hoverTargetOf(e.target as Element | null);
      if (!hit) return;
      if (hoveredElRef.current === hit.el) return;
      hoveredElRef.current = hit.el;
      if (timerRef.current) clearTimeout(timerRef.current);
      const seq = ++requestSeqRef.current;
      timerRef.current = setTimeout(() => {
        const anchor = hit.el.getBoundingClientRect();
        setCard({ target: hit.target, anchor, status: 'loading', data: null });
        resolveRef.current(hit.target).then((data) => {
          if (requestSeqRef.current !== seq) return; // superseded / hidden
          setCard((prev) => prev && prev.target === hit.target
            ? { ...prev, status: data ? 'ready' : 'unresolved', data }
            : prev);
        }).catch(() => {
          if (requestSeqRef.current !== seq) return;
          setCard((prev) => prev && prev.target === hit.target ? { ...prev, status: 'unresolved', data: null } : prev);
        });
      }, hoverDelayMs);
    };

    const onMouseOut = (e: MouseEvent) => {
      const link = hoveredElRef.current;
      if (!link) return;
      const to = e.relatedTarget as Node | null;
      // Staying inside the link, or moving onto the card itself, keeps it open.
      if (to && (link.contains(to) || cardElRef.current?.contains(to))) return;
      hide();
    };

    const onScrollOrClick = () => hide();

    container.addEventListener('mouseover', onMouseOver);
    container.addEventListener('mouseout', onMouseOut);
    container.addEventListener('mousedown', onScrollOrClick);
    window.addEventListener('scroll', onScrollOrClick, true);
    return () => {
      container.removeEventListener('mouseover', onMouseOver);
      container.removeEventListener('mouseout', onMouseOut);
      container.removeEventListener('mousedown', onScrollOrClick);
      window.removeEventListener('scroll', onScrollOrClick, true);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [containerRef, hoverDelayMs, hide]);

  if (!card || card.status === 'loading') return null;

  // Fixed-position under the link, clamped to the viewport.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(CARD_MARGIN, Math.min(card.anchor.left, vw - CARD_WIDTH - CARD_MARGIN));
  const below = card.anchor.bottom + 8;
  const flipUp = below > vh - 180;
  const style: React.CSSProperties = flipUp
    ? { left, bottom: Math.max(CARD_MARGIN, vh - card.anchor.top + 8), width: CARD_WIDTH }
    : { left, top: below, width: CARD_WIDTH };

  const stem = card.target.split('#')[0].split('|')[0].trim();

  return (
    <div
      ref={cardElRef}
      className="wlhp-card"
      style={style}
      role="tooltip"
      data-testid="wiki-link-hover-preview"
      onMouseLeave={hide}
    >
      {card.status === 'ready' && card.data ? (
        <>
          <div className="wlhp-head">
            <span className="wlhp-title">{card.data.title}</span>
            <span className={`wlhp-kind wlhp-kind--${card.data.kind}`} data-testid="wiki-link-hover-kind">
              {card.data.kind === 'scene' ? 'STORY' : 'NOTE'}
            </span>
          </div>
          {card.data.subtitle && <div className="wlhp-subtitle">{card.data.subtitle}</div>}
          <div className="wlhp-body" data-testid="wiki-link-hover-body">
            {extractPreviewExcerpt(card.data.markdown) || <span className="wlhp-empty">This note is empty.</span>}
          </div>
        </>
      ) : (
        <>
          <div className="wlhp-head">
            <span className="wlhp-title">{stem}</span>
            <span className="wlhp-kind wlhp-kind--new">NEW</span>
          </div>
          <div className="wlhp-body wlhp-body--unresolved" data-testid="wiki-link-hover-unresolved">
            Doesn’t exist yet — click to create it in the Notes Vault.
          </div>
        </>
      )}
    </div>
  );
}
