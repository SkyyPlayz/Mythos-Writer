/**
 * F1#3 — SceneGrid empty-part render + chapter→part drop (Critic H3).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SceneGrid } from './SceneGrid';
import type { Story, Chapter, Part, Scene } from '../../types';
import { BEAT_TEMPLATES } from './BEAT_STRUCTURE';

const NOW = '2026-09-29T00:00:00.000Z';

function mkScene(id: string, title: string, order: number): Scene {
  return {
    id, title, path: `stories/s1/chapters/ch/scenes/${id}.md`, order,
    blocks: [{ id: `${id}-b`, type: 'prose', content: 'Hi', order: 0, updatedAt: NOW }],
    createdAt: NOW, updatedAt: NOW,
  };
}

function mkChapter(id: string, title: string, order: number, scenes: Scene[] = []): Chapter {
  return {
    id, title, path: `stories/s1/chapters/${id}`, order, scenes,
    createdAt: NOW, updatedAt: NOW,
  };
}

function mkPart(id: string, title: string, order: number, chapters: Chapter[]): Part {
  return { id, title, order, note: [], chapters, createdAt: NOW, updatedAt: NOW };
}

function mkStory(parts: Part[]): Story {
  const chapters = parts.flatMap((p) => p.chapters);
  return {
    id: 's1', title: 'Test', path: 'stories/s1',
    chapters, parts, createdAt: NOW, updatedAt: NOW,
  };
}

const noop = () => {};

function renderGrid(story: Story, extra: Partial<Parameters<typeof SceneGrid>[0]> = {}) {
  return render(
    <SceneGrid
      story={story}
      beatAssignments={{}}
      template={BEAT_TEMPLATES[0]}
      onSelectScene={noop}
      onReorderScenes={noop}
      onMoveScene={noop}
      onCreateScene={noop}
      onBeatAssign={noop}
      announce={noop}
      {...extra}
    />,
  );
}

describe('F1#3 SceneGrid empty parts + part drop', () => {
  it('renders an empty part header and + Add chapter', () => {
    const partA = mkPart('pA', 'Act One', 0, [mkChapter('ch1', 'Ch1', 0, [mkScene('sc1', 'S1', 0)])]);
    const partB = mkPart('pB', 'Act Two', 1, []);
    renderGrid(mkStory([partA, partB]), {
      onCreateChapterInPart: vi.fn(),
    });

    expect(screen.getByTestId('msv-struct-part-header-pB')).toBeTruthy();
    expect(screen.getByTestId('msv-struct-part-empty-pB')).toBeTruthy();
    expect(screen.getByTestId('msv-struct-add-chapter-pB')).toHaveTextContent('+ Add chapter');
  });

  it('dropping a chapter on a part header calls onMoveChapterToPart', () => {
    const onMove = vi.fn();
    const partA = mkPart('pA', 'Act One', 0, [
      mkChapter('ch1', 'Ch1', 0, [mkScene('sc1', 'S1', 0)]),
      mkChapter('ch2', 'Ch2', 1, [mkScene('sc2', 'S2', 0)]),
    ]);
    const partB = mkPart('pB', 'Act Two', 1, []);
    renderGrid(mkStory([partA, partB]), { onMoveChapterToPart: onMove });

    const chapterHeader = screen.getByText('Ch2').closest('.chapter-section__header');
    expect(chapterHeader).toBeTruthy();
    const dt = { setData: vi.fn(), getData: () => 'ch2', effectAllowed: 'move' };
    fireEvent.dragStart(chapterHeader!, { dataTransfer: dt });
    const partHeader = screen.getByTestId('msv-struct-part-header-pB');
    fireEvent.dragOver(partHeader, { dataTransfer: dt, preventDefault: vi.fn() });
    fireEvent.drop(partHeader, { dataTransfer: dt, preventDefault: vi.fn() });

    expect(onMove).toHaveBeenCalledWith('s1', 'ch2', 'pB');
  });
});
