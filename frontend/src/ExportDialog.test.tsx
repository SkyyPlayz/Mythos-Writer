import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExportDialog, { type ExportScope } from './ExportDialog';
import type { Story } from './types';

const mockExportMarkdown = vi.fn();
const mockExportPlaintext = vi.fn();
const mockExportDocx = vi.fn();
const mockExportEpub = vi.fn();
const mockOnClose = vi.fn();
const mockAlert = vi.fn();

const stories: Story[] = [
  {
    id: 'story-1',
    title: 'Moon Draft',
    path: 'stories/moon.md',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    chapters: [
      {
        id: 'chapter-1',
        title: 'Chapter One',
        path: 'stories/moon/chapter-one.md',
        order: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        scenes: [
          {
            id: 'scene-1',
            title: 'Opening',
            path: 'stories/moon/opening.md',
            order: 1,
            chapterId: 'chapter-1',
            storyId: 'story-1',
            blocks: [{ id: 'block-1', type: 'prose', content: 'Once upon a moon.', order: 1, updatedAt: '2026-01-01T00:00:00.000Z' }],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ],
  },
];

function renderDialog(scope: ExportScope) {
  render(<ExportDialog scope={scope} stories={stories} onClose={mockOnClose} />);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockExportMarkdown.mockResolvedValue({ path: '/tmp/story.md', cancelled: false });
  mockExportPlaintext.mockResolvedValue({ path: '/tmp/story.txt', cancelled: false });
  mockExportDocx.mockResolvedValue({ path: '/tmp/story.docx', cancelled: false });
  mockExportEpub.mockResolvedValue({ path: '/tmp/story.epub', cancelled: false });
  (window as unknown as { api: unknown }).api = {
    exportMarkdown: mockExportMarkdown,
    exportPlaintext: mockExportPlaintext,
    exportDocx: mockExportDocx,
    exportEpub: mockExportEpub,
  };
  vi.spyOn(window, 'alert').mockImplementation(mockAlert);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExportDialog EPUB format', () => {
  it('renders EPUB as an enabled option for story scope and dispatches exportEpub with the story id', async () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    const epubOption = screen.getByRole('radio', { name: /epub \(\.epub\)/i });
    expect(epubOption).toBeEnabled();

    fireEvent.click(epubOption);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await waitFor(() => expect(mockExportEpub).toHaveBeenCalledWith('story-1'));
    expect(mockExportDocx).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('Exported to:\n/tmp/story.epub');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('renders EPUB as an enabled option for vault scope', () => {
    renderDialog({ kind: 'vault' });

    expect(screen.getByRole('radio', { name: /epub \(\.epub\)/i })).toBeEnabled();
  });

  it('disables EPUB for scene and chapter scopes with a visible affordance', () => {
    renderDialog({ kind: 'scene', sceneId: 'scene-1' });

    const sceneEpubOption = screen.getByRole('radio', { name: /epub \(\.epub\)/i });
    expect(sceneEpubOption).toBeDisabled();
    expect(screen.getByText(/epub requires story scope/i)).toBeInTheDocument();

    mockOnClose.mockReset();
    document.body.innerHTML = '';

    renderDialog({ kind: 'chapter', storyId: 'story-1', chapterId: 'chapter-1' });

    const chapterEpubOption = screen.getByRole('radio', { name: /epub \(\.epub\)/i });
    expect(chapterEpubOption).toBeDisabled();
    expect(screen.getByText(/epub requires story scope/i)).toBeInTheDocument();
  });
});
