import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExportDialog, { type ExportScope } from './ExportDialog';
import type { Story } from './types';

const mockExportMarkdown = vi.fn();
const mockExportPlaintext = vi.fn();
const mockExportDocx = vi.fn();
const mockExportEpub = vi.fn();
const mockExportPdf = vi.fn();
const mockExportRevealLast = vi.fn();
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

const DEFAULT_OPTS = { includeSynopsis: false, sceneSeparators: true };

function renderDialog(scope: ExportScope, currentChapterId?: string | null) {
  render(
    <ExportDialog
      scope={scope}
      stories={stories}
      onClose={mockOnClose}
      currentChapterId={currentChapterId}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  mockExportMarkdown.mockResolvedValue({ path: '/tmp/story.md', cancelled: false, bytes: 512 });
  mockExportPlaintext.mockResolvedValue({ path: '/tmp/story.txt', cancelled: false, bytes: 512 });
  mockExportDocx.mockResolvedValue({ path: '/tmp/story.docx', cancelled: false, bytes: 2048 });
  mockExportEpub.mockResolvedValue({ path: '/tmp/story.epub', cancelled: false, bytes: 4096 });
  mockExportPdf.mockResolvedValue({ path: '/tmp/story.pdf', cancelled: false, bytes: 8192 });
  mockExportRevealLast.mockResolvedValue({ opened: true });
  (window as unknown as { api: unknown }).api = {
    exportMarkdown: mockExportMarkdown,
    exportPlaintext: mockExportPlaintext,
    exportDocx: mockExportDocx,
    exportEpub: mockExportEpub,
    exportPdf: mockExportPdf,
    exportRevealLast: mockExportRevealLast,
  };
  vi.spyOn(window, 'alert').mockImplementation(mockAlert);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

// ─── Beta 4 M14 — format cards (prototype exportFmts: DOCX default) ───

describe('ExportDialog format cards (M14)', () => {
  it('marks DOCX as the default selected format card', () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    const docxRadio = screen.getByRole('radio', { name: /word document \(\.docx\)/i });
    expect(docxRadio).toBeChecked();
    expect(docxRadio.closest('label')).toHaveClass('export-fmt-card--selected');
    expect(screen.getByRole('button', { name: /export docx/i })).toBeEnabled();
  });

  it('renders all five format cards (DOCX, PDF, EPUB, MD, TXT)', () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    expect(screen.getByRole('radio', { name: /word document \(\.docx\)/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /pdf \(\.pdf\)/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /epub \(\.epub\)/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /markdown \(\.md\)/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /plain text \(\.txt\)/i })).toBeInTheDocument();
  });

  it('PDF is an enabled option and dispatches exportPdf with scope + options', async () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    const pdfRadio = screen.getByRole('radio', { name: /pdf \(\.pdf\)/i });
    expect(pdfRadio).toBeEnabled();
    fireEvent.click(pdfRadio);
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }));

    await waitFor(() =>
      expect(mockExportPdf).toHaveBeenCalledWith({ kind: 'story', storyId: 'story-1' }, DEFAULT_OPTS),
    );
  });

  it('dispatches exportDocx with the scope and options when DOCX is selected', async () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));

    await waitFor(() =>
      expect(mockExportDocx).toHaveBeenCalledWith(undefined, { kind: 'story', storyId: 'story-1' }, DEFAULT_OPTS),
    );
  });
});

// ─── EPUB scope gating ───

describe('ExportDialog EPUB format', () => {
  it('renders EPUB as an enabled option for story scope and dispatches exportEpub with options', async () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    const epubOption = screen.getByRole('radio', { name: /epub \(\.epub\)/i });
    expect(epubOption).toBeEnabled();

    fireEvent.click(epubOption);
    fireEvent.click(screen.getByRole('button', { name: /export epub/i }));

    await waitFor(() =>
      expect(mockExportEpub).toHaveBeenCalledWith('story-1', undefined, undefined, DEFAULT_OPTS),
    );
    expect(mockExportDocx).not.toHaveBeenCalled();
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

// ─── Beta 4 M14 — scope segmented control ───

describe('ExportDialog scope segment (M14)', () => {
  it('story-scoped open shows the seg with Full book active and Current part disabled', () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    const fullBook = screen.getByRole('button', { name: /full book/i });
    expect(fullBook).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /current part/i })).toBeDisabled();
  });

  it('Current chapter is disabled without an open chapter, enabled with one', () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });
    expect(screen.getByRole('button', { name: /current chapter/i })).toBeDisabled();

    document.body.innerHTML = '';
    renderDialog({ kind: 'story', storyId: 'story-1' }, 'chapter-1');
    expect(screen.getByRole('button', { name: /current chapter/i })).toBeEnabled();
  });

  it('switching to Current chapter exports the chapter scope', async () => {
    renderDialog({ kind: 'story', storyId: 'story-1' }, 'chapter-1');

    fireEvent.click(screen.getByRole('button', { name: /current chapter/i }));
    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));

    await waitFor(() =>
      expect(mockExportDocx).toHaveBeenCalledWith(
        undefined,
        { kind: 'chapter', chapterId: 'chapter-1', storyId: 'story-1' },
        DEFAULT_OPTS,
      ),
    );
  });

  it('chapter-scoped open defaults the seg to Current chapter', () => {
    renderDialog({ kind: 'chapter', storyId: 'story-1', chapterId: 'chapter-1' });

    expect(screen.getByRole('button', { name: /current chapter/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('scene-scoped open shows the static scope label instead of the seg', () => {
    renderDialog({ kind: 'scene', sceneId: 'scene-1' });

    expect(screen.queryByRole('button', { name: /full book/i })).not.toBeInTheDocument();
    expect(screen.getByText('Opening')).toBeInTheDocument();
  });
});

// ─── Beta 4 M14 — compile-option toggles (live) ───

describe('ExportDialog compile options (M14)', () => {
  it('defaults: synopsis off, separators on (prototype defaults)', () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    expect(screen.getByRole('switch', { name: /include synopsis page/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /scene separators/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles are live and their state is passed to the exporter', async () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('switch', { name: /include synopsis page/i }));
    fireEvent.click(screen.getByRole('switch', { name: /scene separators/i }));

    expect(screen.getByRole('switch', { name: /include synopsis page/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /scene separators/i })).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));
    await waitFor(() =>
      expect(mockExportDocx).toHaveBeenCalledWith(
        undefined,
        { kind: 'story', storyId: 'story-1' },
        { includeSynopsis: true, sceneSeparators: false },
      ),
    );
  });

  it('persists toggle state to localStorage', () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('switch', { name: /include synopsis page/i }));

    const saved = JSON.parse(localStorage.getItem('mythos-export-options-v1')!);
    expect(saved).toEqual({ includeSynopsis: true, sceneSeparators: true });
  });
});

// ─── Beta 4 M14 — busy → done flow ───

describe('ExportDialog steps (M14)', () => {
  it('shows the compiling step while an export is in flight', async () => {
    let resolveExport!: (value: { path: string | null; cancelled: boolean }) => void;
    mockExportDocx.mockReturnValue(
      new Promise((resolve) => { resolveExport = resolve; }),
    );
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));

    expect(await screen.findByText(/compiling 1 scene · applying styles/i)).toBeInTheDocument();

    resolveExport({ path: '/tmp/story.docx', cancelled: false });
    await waitFor(() => expect(screen.getByText('Export complete')).toBeInTheDocument());
  });

  it('successful export shows the Done state with file name and size, then Done closes', async () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));

    expect(await screen.findByText('Export complete')).toBeInTheDocument();
    expect(screen.getByText('story.docx')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('Show in folder calls exportRevealLast', async () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));
    await screen.findByText('Export complete');

    fireEvent.click(screen.getByRole('button', { name: /show in folder/i }));
    expect(mockExportRevealLast).toHaveBeenCalledTimes(1);
  });

  it('a cancelled save dialog returns to the pick step without closing', async () => {
    mockExportDocx.mockResolvedValue({ path: null, cancelled: true });
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /export docx/i })).toBeInTheDocument(),
    );
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('a failed export alerts and returns to the pick step', async () => {
    mockExportDocx.mockRejectedValue(new Error('disk full'));
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Export failed: disk full'));
    expect(screen.getByRole('button', { name: /export docx/i })).toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});

// ─── SKY-7108 — missing scene .md file warning on the Done state ───

describe('ExportDialog missing scene warning (SKY-7108)', () => {
  it('a normal export with no missing scenes shows no warning', async () => {
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));

    expect(await screen.findByText('Export complete')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces missing scene ids resolved to their titles', async () => {
    mockExportDocx.mockResolvedValue({ path: '/tmp/story.docx', cancelled: false, bytes: 2048, missingSceneIds: ['scene-1'] });
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));

    expect(await screen.findByText('Export complete')).toBeInTheDocument();
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent('1 scene had no prose file and was exported empty: Opening');
  });

  it('falls back to the raw id for a missing scene not found in the loaded stories, and pluralizes for multiple', async () => {
    mockExportDocx.mockResolvedValue({
      path: '/tmp/story.docx',
      cancelled: false,
      bytes: 2048,
      missingSceneIds: ['scene-1', 'scene-deleted-id'],
    });
    renderDialog({ kind: 'story', storyId: 'story-1' });

    fireEvent.click(screen.getByRole('button', { name: /export docx/i }));

    expect(await screen.findByText('Export complete')).toBeInTheDocument();
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent('2 scenes had no prose file and were exported empty: Opening, scene-deleted-id');
  });
});
