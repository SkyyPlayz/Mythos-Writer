/**
 * FD-1 (PLAN-058 L5 / PR #1687 H1): live [[wiki-links]] in manuscript ParagraphRow.
 *
 * Mutant pins (red-on-revert):
 *   M1 — wiki button children are display-only (no `[[` in DOM) → blur commit loses brackets.
 *   M2 — wiki split gated on `hints.length > 0` → bare `[[Harbor]]` never renders a link.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ParagraphRowBase, type ParagraphRowProps } from './ParagraphRow';
import ManuscriptView from './ManuscriptView';
import type { Block, Chapter, Scene, Story } from '../types';
import type { ManuscriptCursor } from './manuscriptModel';

const NOW = '2026-07-08T00:00:00.000Z';
const PARA_STYLE = { textAlign: 'left' as const };

function rowProps(blockId: string, over: Partial<ParagraphRowProps> = {}): ParagraphRowProps {
  return {
    sceneId: 's1',
    blockId,
    content: 'Plain.',
    comments: [],
    autoLinkTerms: [],
    reading: false,
    dropGap: null,
    dropGapHeight: 0,
    dragging: false,
    dropCap: false,
    paraStyle: PARA_STYLE,
    onCommit: () => {},
    onGripDown: () => {},
    onParaOver: () => {},
    onParaMove: () => {},
    onParaDrop: () => {},
    onOpenComment: () => {},
    onApplyAutoLink: () => {},
    ...over,
  };
}

function mkBlock(id: string, content: string): Block {
  return { id, type: 'prose', content, order: 0, updatedAt: NOW };
}

function mkStory(paragraph: string): Story {
  const scene: Scene = {
    id: 's1',
    title: 'Scene',
    path: 'scenes/s1.md',
    order: 0,
    blocks: [mkBlock('s1-b0', paragraph)],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const chapter: Chapter = {
    id: 'ch1',
    title: 'Chapter 1',
    path: 'chapters/ch1',
    order: 0,
    scenes: [scene],
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    id: 'story-1',
    title: 'Story',
    path: 'stories/story-1',
    chapters: [chapter],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const BOOK: ManuscriptCursor = { zoom: 'book', part: 0, chapter: 0, scene: 0 };

afterEach(() => cleanup());

describe('FD-1 wiki links in ParagraphRow (H1)', () => {
  it('M2: renders [[Harbor]] as msv-wl-link with zero auto-link hints', () => {
    const onWiki = vi.fn();
    render(
      <ParagraphRowBase
        {...rowProps('b1', {
          content: 'Ships moor at [[Harbor]] tonight.',
          autoLinkTerms: [],
          onWikiLinkClick: onWiki,
        })}
      />,
    );
    const link = screen.getByRole('button', { name: '[[Harbor]]' });
    expect(link).toHaveClass('msv-wl-link');
    expect(link).toHaveTextContent('[[Harbor]]');
    fireEvent.click(link);
    expect(onWiki).toHaveBeenCalledWith('Harbor');
  });

  it('M1: focus+blur commits full [[Harbor]] and [[Harbor|dock]] tokens from DOM', () => {
    const content = 'At [[Harbor]] near [[Harbor|dock]].';
    const onCommit = vi.fn();
    render(<ParagraphRowBase {...rowProps('b1', { content, onCommit })} />);
    const para = screen.getByTestId('msv-para-b1');
    act(() => para.focus());
    act(() => para.blur());
    expect(onCommit).toHaveBeenCalledTimes(1);
    const el = onCommit.mock.calls[0][3] as HTMLElement;
    expect(el.textContent).toBe(content);
  });
});

describe('FD-1 wiki links through ManuscriptView (integration)', () => {
  it('editable textContent stays bracketed; commit after edit keeps [[Harbor]]', () => {
    const text = 'The tide turned at [[Harbor]].';
    const onEditParagraph = vi.fn();
    render(
      <ManuscriptView
        story={mkStory(text)}
        cursor={BOOK}
        onCursorChange={() => {}}
        onEditParagraph={onEditParagraph}
        onCycleStatus={() => {}}
      />,
    );
    const para = screen.getByTestId('msv-para-s1-b0');
    expect(screen.getByRole('button', { name: '[[Harbor]]' })).toBeInTheDocument();
    expect(para.textContent).toBe(text);

    act(() => para.focus());
    para.textContent = `${text} `;
    act(() => para.blur());
    expect(onEditParagraph).toHaveBeenCalledWith('s1', 's1-b0', `${text} `);
  });
});
