import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TitleRow from './TitleRow';
import type { ManuscriptCursor } from './manuscriptModel';
import type { Scene, Story } from '../types';

const NOW = '2026-08-04T00:00:00.000Z';

const scene = (id: string, title: string, order: number, draftState?: Scene['draftState']): Scene => ({
  id,
  title,
  path: `scenes/${id}.md`,
  order,
  blocks: [{ id: `${id}-b1`, type: 'prose', content: 'Hello world prose.', order: 0, updatedAt: NOW }],
  draftState,
  createdAt: NOW,
  updatedAt: NOW,
});

const story: Story = {
  id: 'st-1',
  title: 'The Last City of Veynn',
  path: 'stories/st-1',
  chapters: [
    {
      id: 'ch-1',
      title: 'The Quiet Before',
      path: 'chapters/ch-1',
      order: 0,
      scenes: [scene('sc-1', 'The Long Dusk', 0), scene('sc-2', 'Fractures', 1, 'review')],
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'ch-2',
      title: 'Embers',
      path: 'chapters/ch-2',
      order: 1,
      scenes: [scene('sc-3', 'The Gate', 0, 'final')],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

const cursorAt = (zoom: ManuscriptCursor['zoom'], chapter = 0, sc = 0): ManuscriptCursor => ({
  zoom,
  part: 0,
  chapter,
  scene: sc,
});

const DEFAULTS = {
  story,
  wordCount: 1234,
  commentCount: 3,
  commentsOpen: false,
  onToggleComments: vi.fn(),
  onCycleStatus: vi.fn(),
  focusActive: false,
  onToggleFocus: vi.fn(),
};

describe('TitleRow (M1 row 3)', () => {
  it('book depth: story title, no depth chip', () => {
    render(<TitleRow {...DEFAULTS} cursor={cursorAt('book')} scene={story.chapters[0].scenes[0]} />);
    expect(screen.queryByTestId('msv-depth-chip')).not.toBeInTheDocument();
    expect(screen.getByTestId('msv-scope-title')).toHaveTextContent('The Last City of Veynn');
  });

  it('part depth: "PART ONE" chip (implicit part shows the story title until M2)', () => {
    render(<TitleRow {...DEFAULTS} cursor={cursorAt('part')} scene={story.chapters[0].scenes[0]} />);
    expect(screen.getByTestId('msv-depth-chip')).toHaveTextContent('PART ONE');
    expect(screen.getByTestId('msv-scope-title')).toHaveTextContent('The Last City of Veynn');
  });

  it('chapter depth: "CHAPTER 2" chip + chapter title', () => {
    render(
      <TitleRow {...DEFAULTS} cursor={cursorAt('chapter', 1)} scene={story.chapters[1].scenes[0]} />
    );
    expect(screen.getByTestId('msv-depth-chip')).toHaveTextContent('CHAPTER 2');
    expect(screen.getByTestId('msv-scope-title')).toHaveTextContent('Embers');
  });

  it('scene depth: "SCENE 2" chip + scene title', () => {
    render(
      <TitleRow {...DEFAULTS} cursor={cursorAt('scene', 0, 1)} scene={story.chapters[0].scenes[1]} />
    );
    expect(screen.getByTestId('msv-depth-chip')).toHaveTextContent('SCENE 2');
    expect(screen.getByTestId('msv-scope-title')).toHaveTextContent('Fractures');
  });

  it('status chip shows the full draftState vocabulary and cycles on click', () => {
    const onCycleStatus = vi.fn();
    render(
      <TitleRow
        {...DEFAULTS}
        cursor={cursorAt('scene', 0, 1)}
        scene={story.chapters[0].scenes[1]}
        onCycleStatus={onCycleStatus}
      />
    );
    const chip = screen.getByTestId('msv-status-chip');
    expect(chip).toHaveTextContent('In review');
    fireEvent.click(chip);
    expect(onCycleStatus).toHaveBeenCalledWith('sc-2');
  });

  it('status chip reads "Planned" when the scene has no draftState', () => {
    render(<TitleRow {...DEFAULTS} cursor={cursorAt('scene')} scene={story.chapters[0].scenes[0]} />);
    expect(screen.getByTestId('msv-status-chip')).toHaveTextContent('Planned');
  });

  it('renders scope word count with locale separators', () => {
    render(
      <TitleRow
        {...DEFAULTS}
        cursor={cursorAt('book')}
        scene={story.chapters[0].scenes[0]}
        wordCount={45678}
      />
    );
    expect(screen.getByTestId('msv-title-words')).toHaveTextContent('45,678 words');
  });

  it('comment chip shows count, reflects open state, and toggles', () => {
    const onToggleComments = vi.fn();
    render(
      <TitleRow
        {...DEFAULTS}
        cursor={cursorAt('book')}
        scene={story.chapters[0].scenes[0]}
        commentsOpen={true}
        onToggleComments={onToggleComments}
      />
    );
    const chip = screen.getByTestId('msv-comments-chip');
    expect(chip).toHaveTextContent('3');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(onToggleComments).toHaveBeenCalledTimes(1);
  });

  it('Focus button reflects focus mode and toggles it', () => {
    const onToggleFocus = vi.fn();
    render(
      <TitleRow
        {...DEFAULTS}
        cursor={cursorAt('book')}
        scene={story.chapters[0].scenes[0]}
        focusActive={true}
        onToggleFocus={onToggleFocus}
      />
    );
    const btn = screen.getByTestId('msv-title-focus');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onToggleFocus).toHaveBeenCalledTimes(1);
  });

  it('hides the status chip when there is no scene in scope', () => {
    render(<TitleRow {...DEFAULTS} cursor={cursorAt('book')} scene={null} />);
    expect(screen.queryByTestId('msv-status-chip')).not.toBeInTheDocument();
  });
});
