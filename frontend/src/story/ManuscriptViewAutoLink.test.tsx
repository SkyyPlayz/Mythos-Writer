// Beta 3 M23 — auto-[[link]]ing inside the heading-zoom manuscript:
// suggest-mode hint spans, click-to-link, coexistence with comment anchors,
// 'auto' mode commit transform, and the 'off' mode no-op.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Block, Chapter, Scene, Story } from '../types';
import ManuscriptView from './ManuscriptView';
import { commentsStore } from '../comments';
import type { ManuscriptCursor } from './manuscriptModel';

const NOW = '2026-07-07T00:00:00.000Z';

function mkBlock(id: string, content: string, order: number): Block {
  return { id, type: 'prose', content, order, updatedAt: NOW };
}

function mkScene(id: string, title: string, order: number, paras: string[]): Scene {
  return {
    id,
    title,
    path: `scenes/${id}.md`,
    order,
    blocks: paras.map((p, i) => mkBlock(`${id}-b${i}`, p, i)),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkChapter(id: string, title: string, order: number, scenes: Scene[]): Chapter {
  return { id, title, path: `chapters/${id}`, order, scenes, createdAt: NOW, updatedAt: NOW };
}

function mkStory(paras: string[]): Story {
  return {
    id: 'story-1',
    title: 'The Last City of Veynn',
    path: 'stories/story-1',
    chapters: [mkChapter('ch1', 'The Quiet Before', 0, [mkScene('s1', 'Opening', 0, paras)])],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mkEntity(name: string, aliases: string[] = []): EntityEntry {
  return {
    id: `ent-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type: 'character',
    aliases,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as EntityEntry;
}

const BOOK: ManuscriptCursor = { zoom: 'book', part: 0, chapter: 0, scene: 0 };
const ENTITIES = [mkEntity('Mira'), mkEntity('Duskwatch Keep', ['the Keep'])];

function renderView(over: Partial<Parameters<typeof ManuscriptView>[0]> = {}) {
  const props = {
    story: mkStory(['Mira counted the bells near Duskwatch Keep.']),
    cursor: BOOK,
    onCursorChange: vi.fn(),
    onEditParagraph: vi.fn(),
    onCycleStatus: vi.fn(),
    autoLinkEntities: ENTITIES,
    autoLinkMode: 'suggest' as const,
    ...over,
  };
  return { ...render(<ManuscriptView {...props} />), props };
}

beforeEach(() => {
  commentsStore.reset();
});

afterEach(() => {
  cleanup();
  commentsStore.reset();
  document.querySelectorAll('[data-testid="ln-toast"]').forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe('suggest mode', () => {
  it('underlines entity mentions as clickable hints', () => {
    renderView();
    expect(screen.getByTestId('msv-wl-hint-s1-b0-0')).toHaveTextContent('Mira');
    expect(screen.getByTestId('msv-wl-hint-s1-b0-28')).toHaveTextContent('Duskwatch Keep');
    // Paragraph text is unchanged (contentEditable commit safety).
    expect(screen.getByTestId('msv-para-s1-b0')).toHaveTextContent(
      'Mira counted the bells near Duskwatch Keep.'
    );
  });

  it('clicking a hint commits the paragraph with the [[wiki link]] applied', () => {
    const { props } = renderView();
    fireEvent.click(screen.getByTestId('msv-wl-hint-s1-b0-0'));
    expect(props.onEditParagraph).toHaveBeenCalledWith(
      's1',
      's1-b0',
      '[[Mira]] counted the bells near Duskwatch Keep.'
    );
  });

  it('does not hint mentions that are already linked', () => {
    renderView({ story: mkStory(['[[Mira]] counted the bells.']) });
    expect(screen.queryAllByTestId(/msv-wl-hint-/)).toHaveLength(0);
  });

  it('coexists with comment anchors — the comment anchor wins the overlap', () => {
    commentsStore.create({
      storyId: 'story-1',
      sceneId: 's1',
      anchor: 'Mira counted the bells',
      text: 'Check the bell count',
    });
    renderView();
    // The comment anchor covers the "Mira" mention: only the Keep hint stays.
    expect(screen.queryByTestId('msv-wl-hint-s1-b0-0')).toBeNull();
    expect(screen.getByTestId('msv-wl-hint-s1-b0-28')).toHaveTextContent('Duskwatch Keep');
    expect(screen.getByTestId('msv-para-s1-b0')).toHaveTextContent(
      'Mira counted the bells near Duskwatch Keep.'
    );
  });
});

describe('auto mode', () => {
  it('applies every link on paragraph commit', () => {
    const { props } = renderView({ autoLinkMode: 'auto' });
    const para = screen.getByTestId('msv-para-s1-b0');
    para.textContent = 'Mira slipped out toward the Keep.';
    fireEvent.blur(para);
    expect(props.onEditParagraph).toHaveBeenCalledWith(
      's1',
      's1-b0',
      '[[Mira]] slipped out toward [[Duskwatch Keep|the Keep]].'
    );
  });
});

describe('off mode', () => {
  it('renders no hints and leaves commits untouched', () => {
    const { props } = renderView({ autoLinkMode: 'off' });
    expect(screen.queryAllByTestId(/msv-wl-hint-/)).toHaveLength(0);
    const para = screen.getByTestId('msv-para-s1-b0');
    para.textContent = 'Mira slipped away.';
    fireEvent.blur(para);
    expect(props.onEditParagraph).toHaveBeenCalledWith('s1', 's1-b0', 'Mira slipped away.');
  });
});
