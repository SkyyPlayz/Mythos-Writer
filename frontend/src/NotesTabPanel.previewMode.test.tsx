// SKY-11444: the legacy Preview flag is shell-scoped (DesktopShell owns
// notePreviewMode) and reaches NoteViewer only through this panel's
// `activeNotePreview` prop — nothing previously asserted that wiring, so a
// broken pass-through would have shipped silently.
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotesTabPanel, { type NotesTabPanelProps } from './NotesTabPanel';
import { __resetAiEnabledForTests } from './hooks/useAiEnabled';

vi.mock('./components/VaultBrowser', () => ({
  default: () => <div data-testid="vault-browser-mock" />,
}));
vi.mock('./VaultGraphView', () => ({
  default: () => <div data-testid="vault-graph-view-mock" />,
}));
vi.mock('./EntityBrowser', () => ({
  default: () => <div data-testid="entity-browser-mock" />,
}));
vi.mock('./BrainstormPage', () => ({
  default: () => <div data-testid="brainstorm-page-mock" />,
}));
vi.mock('./ContinuityPanel', () => ({
  default: () => <div data-testid="continuity-panel-mock" />,
}));
vi.mock('./NoteViewer', () => ({
  default: ({ path, previewMode }: { path: string; previewMode?: boolean }) => (
    <div data-testid="note-viewer-mock" data-path={path} data-preview-mode={String(!!previewMode)} />
  ),
}));
vi.mock('./NoteProperties', () => ({
  default: () => <div data-testid="note-properties-mock" />,
}));
vi.mock('./Backlinks', () => ({
  default: () => <div data-testid="backlinks-mock" />,
}));

const BASE_PROPS: NotesTabPanelProps = {
  notesSubView: 'editor',
  onNotesSubViewChange: vi.fn(),
  notesSidebarWidth: 240,
  notesSidebarCollapsed: false,
  onNotesSidebarWidthChange: vi.fn(),
  onNotesSidebarCollapsedChange: vi.fn(),
  activeNotePath: 'Locations/The Sunken Gate.md',
  activeNotePreview: false,
  onActiveNotePreviewChange: vi.fn(),
  onActiveNoteWordCountChange: vi.fn(),
  onCloseActiveNote: vi.fn(),
  onWikiLinkClick: vi.fn(),
  brainstormCollapsed: false,
  onBrainstormCollapsedChange: vi.fn(),
  stories: [],
  selectedSceneId: null,
  onSelectScene: vi.fn(),
  onCreateStory: vi.fn(),
  onCreateChapter: vi.fn(),
  onCreateScene: vi.fn(),
  onSelectEntity: vi.fn(),
  selectedEntityId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetAiEnabledForTests();
});

describe('NotesTabPanel SKY-11444 previewMode wiring', () => {
  it('passes previewMode=false through to NoteViewer for default props', () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    expect(screen.getByTestId('note-viewer-mock')).toHaveAttribute('data-preview-mode', 'false');
  });

  it('passes previewMode=true through once activeNotePreview is armed', () => {
    const { rerender } = render(<NotesTabPanel {...BASE_PROPS} />);
    rerender(<NotesTabPanel {...BASE_PROPS} activeNotePreview />);
    expect(screen.getByTestId('note-viewer-mock')).toHaveAttribute('data-preview-mode', 'true');
  });
});
