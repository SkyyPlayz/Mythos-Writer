// SKY-3626: N/F/E writing mode controls in NotesTabPanel — editor sub-view only.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotesTabPanel, { type NotesTabPanelProps } from './NotesTabPanel';

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
vi.mock('./NoteViewer', () => ({
  default: () => <div data-testid="note-viewer-mock" />,
}));

const BASE_PROPS: NotesTabPanelProps = {
  notesSubView: 'editor',
  onNotesSubViewChange: vi.fn(),
  notesSidebarWidth: 240,
  notesSidebarCollapsed: false,
  onNotesSidebarWidthChange: vi.fn(),
  onNotesSidebarCollapsedChange: vi.fn(),
  activeNotePath: null,
  activeNotePreview: false,
  onActiveNotePreviewChange: vi.fn(),
  onActiveNoteWordCountChange: vi.fn(),
  onCloseActiveNote: vi.fn(),
  onWikiLinkClick: vi.fn(),
  brainstormCollapsed: true,
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

describe('NotesTabPanel — SKY-3626 NFE writing mode controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders N/F/E buttons when editor sub-view is active and writingMode is provided', () => {
    render(
      <NotesTabPanel
        {...BASE_PROPS}
        notesSubView="editor"
        writingMode="normal"
        onSetWritingMode={vi.fn()}
      />
    );
    expect(screen.getByTestId('nfe-mode-group')).toBeInTheDocument();
    expect(screen.getByTestId('writing-mode-normal')).toBeInTheDocument();
    expect(screen.getByTestId('writing-mode-focus')).toBeInTheDocument();
    expect(screen.getByTestId('writing-mode-edit')).toBeInTheDocument();
  });

  it('marks the active writing mode button as pressed', () => {
    render(
      <NotesTabPanel
        {...BASE_PROPS}
        notesSubView="editor"
        writingMode="focus"
        onSetWritingMode={vi.fn()}
      />
    );
    expect(screen.getByTestId('writing-mode-focus')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('writing-mode-normal')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('writing-mode-edit')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onSetWritingMode when a mode button is clicked', () => {
    const onSetWritingMode = vi.fn();
    render(
      <NotesTabPanel
        {...BASE_PROPS}
        notesSubView="editor"
        writingMode="normal"
        onSetWritingMode={onSetWritingMode}
      />
    );
    fireEvent.click(screen.getByTestId('writing-mode-edit'));
    expect(onSetWritingMode).toHaveBeenCalledWith('edit');
  });

  it('does NOT render N/F/E buttons when sub-view is graph', () => {
    render(
      <NotesTabPanel
        {...BASE_PROPS}
        notesSubView="graph"
        writingMode="normal"
        onSetWritingMode={vi.fn()}
      />
    );
    expect(screen.queryByTestId('nfe-mode-group')).not.toBeInTheDocument();
  });

  it('does NOT render N/F/E buttons when sub-view is entities', () => {
    render(
      <NotesTabPanel
        {...BASE_PROPS}
        notesSubView="entities"
        writingMode="normal"
        onSetWritingMode={vi.fn()}
      />
    );
    expect(screen.queryByTestId('nfe-mode-group')).not.toBeInTheDocument();
  });

  it('does NOT render N/F/E buttons when writingMode prop is not provided', () => {
    render(<NotesTabPanel {...BASE_PROPS} notesSubView="editor" />);
    expect(screen.queryByTestId('nfe-mode-group')).not.toBeInTheDocument();
  });

  it('shows focus prefs button only in focus mode', () => {
    const onOpenFocusPrefs = vi.fn();
    const { rerender } = render(
      <NotesTabPanel
        {...BASE_PROPS}
        notesSubView="editor"
        writingMode="normal"
        onSetWritingMode={vi.fn()}
        onOpenFocusPrefs={onOpenFocusPrefs}
      />
    );
    expect(screen.queryByLabelText('Focus mode preferences')).not.toBeInTheDocument();

    rerender(
      <NotesTabPanel
        {...BASE_PROPS}
        notesSubView="editor"
        writingMode="focus"
        onSetWritingMode={vi.fn()}
        onOpenFocusPrefs={onOpenFocusPrefs}
      />
    );
    const prefsBtn = screen.getByLabelText('Focus mode preferences');
    expect(prefsBtn).toBeInTheDocument();
    fireEvent.click(prefsBtn);
    expect(onOpenFocusPrefs).toHaveBeenCalled();
  });
});
