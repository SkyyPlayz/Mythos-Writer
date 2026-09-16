// Beta 4 SKY-11615 — renders Timeline prose with clickable [[wiki links]].
//
// Two surfaces use it: the key-event card description on the axis and the
// Inspector's event summary. Both are plain strings, so the segments are
// parsed at render time by the shared resolver (crossTabLinkResolver) rather
// than by the editors' ProseMirror decorations.
//
// The resolve/open pair arrives by context because the consumers sit two and
// three levels below the shell that owns the vault state and every navigation
// handler. Without a provider the component degrades to plain text, which is
// what keeps standalone renders of TimelineRoot (and its tests) working.

import { createContext, useCallback, useContext, useMemo } from 'react';
import {
  parseWikiSegments,
  wikiLinkDisplayText,
  wikiLinkTargetStem,
  type CrossTabLinkMatch,
} from '../crossTabLinkResolver';
import { wikiLinkTone, wikiRefBadges, type WikiRefBadge } from './timelineWikiLinks';
import './TimelineWikiText.css';

export interface TimelineWikiLinkApi {
  /** Single navigable target for a raw `[[target]]`, or null when unresolved. */
  resolve: (target: string) => CrossTabLinkMatch | null;
  /** Navigate to it. An unresolved target creates the note, Obsidian-style. */
  open: (target: string) => void;
}

const TimelineWikiLinkContext = createContext<TimelineWikiLinkApi | null>(null);

export const TimelineWikiLinkProvider = TimelineWikiLinkContext.Provider;

export function useTimelineWikiLinks(): TimelineWikiLinkApi | null {
  return useContext(TimelineWikiLinkContext);
}

/** What clicking this link will do — the link's accessible name. */
function actionLabel(match: CrossTabLinkMatch | null, stem: string): string {
  if (!match) return `Create note “${stem}”`;
  switch (match.kind) {
    case 'scene': return `Open scene “${match.scene.title}”`;
    case 'chapter': return `Open chapter “${match.chapter.title}”`;
    case 'folder': return `Open board “${match.label}”`;
    case 'entity': return `Open note “${match.entity.name}”`;
  }
}

export interface TimelineWikiTextProps {
  text: string;
  /** Class for the wrapper, so callers keep their own layout styling. */
  className?: string;
  'data-testid'?: string;
}

/**
 * `[[Name]]`, `[[Name|display]]`, `[[Name#Heading]]` and `[[#Heading]]` all
 * parse; a bare heading anchor has no target of its own and renders
 * unresolved. Text with no links renders as text, no wrapper elements added.
 */
export function TimelineWikiText({ text, className, 'data-testid': testId }: TimelineWikiTextProps) {
  const api = useTimelineWikiLinks();
  const segments = useMemo(() => parseWikiSegments(text), [text]);

  const handleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>, target: string) => {
    // The event card is itself clickable and drag-initiating; a link click is
    // neither a card selection nor the start of a drag.
    event.preventDefault();
    event.stopPropagation();
    api?.open(target);
  }, [api]);

  const stopDrag = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  }, []);

  if (!api || segments.every((segment) => !segment.isLink)) {
    return <span className={className} data-testid={testId}>{text}</span>;
  }

  return (
    <span className={className} data-testid={testId}>
      {segments.map((segment, index) => {
        if (!segment.isLink) return <span key={index}>{segment.text}</span>;
        const match = api.resolve(segment.target);
        const tone = wikiLinkTone(match);
        const stem = wikiLinkTargetStem(segment.target) || segment.target;
        return (
          <button
            key={index}
            type="button"
            className={`tlw-link tlw-link--${tone}`}
            data-testid="tlw-link"
            data-tone={tone}
            data-target={segment.target}
            title={actionLabel(match, stem)}
            aria-label={actionLabel(match, stem)}
            onMouseDown={stopDrag}
            onClick={(event) => handleClick(event, segment.target)}
          >
            {wikiLinkDisplayText(segment.target)}
          </button>
        );
      })}
    </span>
  );
}

/**
 * Reference badges for one description — the mockup's `tlRefBadges` row.
 * Presentational: the caller counts (badges for a whole lane of cards are
 * derived in one pass, so this cannot own a hook).
 */
export function TimelineWikiRefBadges({ badges }: { badges: readonly WikiRefBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <div className="tlw-badges" data-testid="tlw-badges">
      {badges.map((badge) => (
        <span
          key={badge.kind}
          className={`tlw-badge tlw-badge--${badge.kind}`}
          data-testid={`tlw-badge-${badge.kind}`}
          data-count={badge.count}
          title={badge.title}
          aria-label={badge.title}
        >
          <span aria-hidden="true">{badge.glyph}</span>
          {badge.count > 1 && <span aria-hidden="true">{badge.count}</span>}
        </span>
      ))}
    </div>
  );
}

/** Badges for one piece of prose; empty when there is no provider or no link. */
export function wikiRefBadgesFor(text: string | undefined, api: TimelineWikiLinkApi | null): WikiRefBadge[] {
  if (!api || !text) return [];
  return wikiRefBadges(parseWikiSegments(text), api.resolve);
}
