// SKY-11615 — Timeline [[wiki link]] rendering, badge counting and the
// card ring, against the design authority's rules (2026-09-09 design-liquid-
// neon.dc.html: `wikiSeg` 7513, `tlRefBadges` / `tlRefRing` 7498).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrossTabLinkMatch } from '../crossTabLinkResolver';
import { parseWikiSegments } from '../crossTabLinkResolver';
import {
  TimelineWikiLinkProvider,
  TimelineWikiRefBadges,
  TimelineWikiText,
  wikiRefBadgesFor,
  type TimelineWikiLinkApi,
} from './TimelineWikiText';
import { wikiRefBadges, wikiRefRingTone } from './timelineWikiLinks';

/** Stand-in matches — only the fields the presentation layer reads. */
const MATCHES: Record<string, CrossTabLinkMatch> = {
  scene: { kind: 'scene', label: 'Ch1 / Opening', storyId: 's', chapterId: 'c', sceneId: 'sc-1',
    scene: { title: 'Opening Scene' }, chapter: { title: 'Chapter One' }, story: { title: 'Book' } } as never,
  chapter: { kind: 'chapter', label: 'Chapter One', storyId: 's', chapterId: 'c',
    chapter: { title: 'Chapter One' }, story: { title: 'Book' } } as never,
  note: { kind: 'entity', label: 'Elara Voss', entityId: 'e-1', entityPath: 'Characters/Elara Voss.md',
    entity: { name: 'Elara Voss' } } as never,
  folder: { kind: 'folder', label: 'Relics', folderPath: 'Lore/Relics' },
};

const TABLE: Record<string, CrossTabLinkMatch | null> = {
  'Opening Scene': MATCHES.scene,
  'Chapter One': MATCHES.chapter,
  'Elara Voss': MATCHES.note,
  Relics: MATCHES.folder,
};

function api(open = vi.fn()): TimelineWikiLinkApi {
  return {
    resolve: (target) => TABLE[target.split('#')[0].split('|')[0].trim()] ?? null,
    open,
  };
}

function renderText(text: string, linkApi: TimelineWikiLinkApi = api()) {
  return render(
    <TimelineWikiLinkProvider value={linkApi}>
      <TimelineWikiText text={text} />
    </TimelineWikiLinkProvider>,
  );
}

describe('TimelineWikiText', () => {
  it('colours each kind the way the mockup does', () => {
    renderText('[[Opening Scene]] [[Chapter One]] [[Elara Voss]] [[Relics]] [[Ghost]]');
    expect(screen.getAllByTestId('tlw-link').map((el) => el.dataset.tone))
      .toEqual(['story', 'story', 'note', 'folder', 'unresolved']);
  });

  it('renders every supported link form, and an unresolved link never blanks', () => {
    renderText('[[Opening Scene]] · [[Elara Voss|her]] · [[Elara Voss#Backstory]] · [[#Later]]');
    const links = screen.getAllByTestId('tlw-link');
    expect(links.map((el) => el.textContent)).toEqual([
      'Opening Scene', 'her', 'Elara Voss › Backstory', 'Later',
    ]);
    // A bare heading anchor has no target of its own — pink, not blank.
    expect(links[3].dataset.tone).toBe('unresolved');
  });

  it('keeps the surrounding prose intact', () => {
    const { container } = renderText('Mira meets [[Elara Voss]] at the gate.');
    expect(container.textContent).toBe('Mira meets Elara Voss at the gate.');
  });

  it('names each link by what clicking it will do', () => {
    renderText('[[Opening Scene]] [[Relics]] [[Ghost]]');
    expect(screen.getByRole('button', { name: 'Open scene “Opening Scene”' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open board “Relics”' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create note “Ghost”' })).toBeTruthy();
  });

  it('opens the raw target on click and does not bubble to the card underneath', async () => {
    const open = vi.fn();
    const onCardClick = vi.fn();
    render(
      <TimelineWikiLinkProvider value={api(open)}>
        <div onClick={onCardClick}>
          <TimelineWikiText text="see [[Elara Voss|her]]" />
        </div>
      </TimelineWikiLinkProvider>,
    );
    await userEvent.click(screen.getByTestId('tlw-link'));
    expect(open).toHaveBeenCalledWith('Elara Voss|her');
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('degrades to plain text with no provider, so the Timeline still renders standalone', () => {
    const { container } = render(<TimelineWikiText text="see [[Elara Voss]]" />);
    expect(container.textContent).toBe('see [[Elara Voss]]');
    expect(container.querySelector('[data-testid="tlw-link"]')).toBeNull();
  });
});

describe('reference badges and card ring', () => {
  const badgesFor = (text: string) => wikiRefBadges(parseWikiSegments(text), api().resolve);

  it('counts story targets separately from everything else', () => {
    const badges = badgesFor('[[Opening Scene]] [[Chapter One]] [[Elara Voss]]');
    expect(badges).toEqual([
      { kind: 'note', glyph: '◇', count: 1, title: '1 note linked in this description' },
      { kind: 'story', glyph: '▭', count: 2, title: '2 chapters linked in this description' },
    ]);
  });

  it('counts a folder and an unresolved link toward the note badge, per the mockup', () => {
    expect(badgesFor('[[Relics]] [[Ghost]]')).toEqual([
      { kind: 'note', glyph: '◇', count: 2, title: '2 notes linked in this description' },
    ]);
  });

  it('shows no badges for prose with no links', () => {
    expect(badgesFor('just prose')).toEqual([]);
    expect(wikiRefBadgesFor(undefined, api())).toEqual([]);
    expect(wikiRefBadgesFor('[[Relics]]', null)).toEqual([]);
  });

  it('rings gold only while every reference is a story target', () => {
    expect(wikiRefRingTone(badgesFor('[[Opening Scene]] [[Chapter One]]'))).toBe('story');
    expect(wikiRefRingTone(badgesFor('[[Opening Scene]] [[Elara Voss]]'))).toBe('mixed');
    expect(wikiRefRingTone(badgesFor('[[Relics]]'))).toBe('mixed');
    expect(wikiRefRingTone(badgesFor('no links'))).toBeNull();
  });

  it('renders the count only once a badge is worth more than one', () => {
    render(<TimelineWikiRefBadges badges={badgesFor('[[Opening Scene]] [[Chapter One]] [[Relics]]')} />);
    expect(screen.getByTestId('tlw-badge-story').textContent).toBe('▭2');
    expect(screen.getByTestId('tlw-badge-note').textContent).toBe('◇');
    expect(screen.getByLabelText('1 note linked in this description')).toBeTruthy();
  });

  it('renders nothing at all when there is nothing to badge', () => {
    const { container } = render(<TimelineWikiRefBadges badges={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
