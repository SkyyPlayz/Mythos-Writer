import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RightSidebar from './RightSidebar';
import { createInitialGettingStartedProgress } from './gettingStartedReducer';
import type { Chapter, Scene, Story } from './types';

const mockWritingAssistantSetActiveScene = vi.fn();
const mockWritingAssistantScanNow = vi.fn();

function makeScene(id: string, title: string, content: string): Scene {
  return {
    id,
    title,
    path: `/${id}.md`,
    order: 0,
    blocks: [{ id: `${id}-block`, type: 'prose', order: 0, content, updatedAt: '' }],
    draftState: 'in-progress',
    createdAt: '',
    updatedAt: '',
  };
}

function makeChapter(scene: Scene): Chapter {
  return {
    id: `${scene.id}-chapter`,
    title: `${scene.title} Chapter`,
    path: `/${scene.id}-chapter`,
    order: 0,
    scenes: [scene],
    createdAt: '',
    updatedAt: '',
  };
}

function makeStory(chapter: Chapter): Story {
  return {
    id: `${chapter.id}-story`,
    title: `${chapter.title} Story`,
    path: `/${chapter.id}-story`,
    chapters: [chapter],
    createdAt: '',
    updatedAt: '',
  };
}

beforeEach(() => {
  mockWritingAssistantSetActiveScene.mockReset().mockResolvedValue({ ok: true });
  mockWritingAssistantScanNow.mockReset().mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() });
  (window as unknown as { api: unknown }).api = {
    writingScan: vi.fn().mockResolvedValue({ tips: [], scannedAt: new Date().toISOString() }),
    writingAssistantScanNow: mockWritingAssistantScanNow,
    writingAssistantSetActiveScene: mockWritingAssistantSetActiveScene,
    writingAssistantCadenceChange: vi.fn().mockResolvedValue({ saved: true, waScanInterval: 60 }),
    writingAssistantTipDecision: vi.fn().mockResolvedValue({ saved: true }),
    onWritingScanResult: vi.fn(),
    betaReadScan: vi.fn().mockResolvedValue({ comments: [], scannedAt: new Date().toISOString() }),
    betaReadDismiss: vi.fn().mockResolvedValue({ id: 'br-1', dismissed: true }),
    voiceSpeak: vi.fn().mockResolvedValue({ speakId: 'speak-1' }),
    voiceStop: vi.fn().mockResolvedValue({ stopped: true }),
    onVoiceSpeakDone: vi.fn().mockReturnValue(vi.fn()),
    onVoiceSpeakError: vi.fn().mockReturnValue(vi.fn()),
  };
});

describe('RightSidebar getting started slot', () => {
  it('renders Getting Started above the tab bar and routes actions', () => {
    const onGettingStartedAction = vi.fn();
    const progress = createInitialGettingStartedProgress();

    render(
      <RightSidebar
        activeTab="notes"
        onTabChange={vi.fn()}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
        gettingStartedProgress={progress}
        onGettingStartedAction={onGettingStartedAction}
        onDismissGettingStarted={vi.fn()}
        onToggleGsCollapsed={vi.fn()}
      />,
    );

    const panel = screen.getByRole('region', { name: /getting started/i });
    const tablist = screen.getByRole('tablist', { name: /sidebar panels/i });
    expect(panel.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /add a character/i }));
    expect(onGettingStartedAction).toHaveBeenCalledWith('add-character');
  });

  it('does not render the panel when progress is dismissed', () => {
    const progress = createInitialGettingStartedProgress();
    progress.dismissed = true;

    render(
      <RightSidebar
        activeTab="notes"
        onTabChange={vi.fn()}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
        gettingStartedProgress={progress}
        onGettingStartedAction={vi.fn()}
        onDismissGettingStarted={vi.fn()}
        onToggleGsCollapsed={vi.fn()}
      />,
    );

    expect(screen.queryByRole('region', { name: /getting started checklist/i })).not.toBeInTheDocument();
  });
});

describe('RightSidebar active scene threading', () => {
  it('passes selected scene changes through to WritingAssistantPanel', async () => {
    const sceneA = makeScene('scene-a', 'Scene A', 'First scene prose.');
    const chapterA = makeChapter(sceneA);
    const storyA = makeStory(chapterA);
    const sceneB = makeScene('scene-b', 'Scene B', 'Second scene prose.');
    const chapterB = makeChapter(sceneB);
    const storyB = makeStory(chapterB);

    const { rerender } = render(
      <RightSidebar
        activeTab="ai"
        onTabChange={vi.fn()}
        selectedScene={sceneA}
        selectedChapter={chapterA}
        selectedStory={storyA}
        isPageFocused
      />,
    );

    await waitFor(() => {
      expect(mockWritingAssistantSetActiveScene).toHaveBeenLastCalledWith({
        sceneId: 'scene-a',
        scenePath: '/scene-a.md',
      });
    });
    expect(screen.getByText(/context:/i)).toHaveTextContent('Scene A');

    rerender(
      <RightSidebar
        activeTab="ai"
        onTabChange={vi.fn()}
        selectedScene={sceneB}
        selectedChapter={chapterB}
        selectedStory={storyB}
        isPageFocused
      />,
    );

    await waitFor(() => {
      expect(mockWritingAssistantSetActiveScene).toHaveBeenLastCalledWith({
        sceneId: 'scene-b',
        scenePath: '/scene-b.md',
      });
    });
    expect(screen.getByText(/context:/i)).toHaveTextContent('Scene B');

    fireEvent.click(screen.getByRole('button', { name: /scan now/i }));

    await waitFor(() => {
      expect(mockWritingAssistantScanNow).toHaveBeenCalledWith({
        sceneId: 'scene-b',
        prose: 'Second scene prose.',
        scenePath: '/scene-b.md',
      });
    });
  });
});
