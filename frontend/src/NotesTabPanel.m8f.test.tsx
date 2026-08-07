// M8f: Notes editor empty state — glyph + one-line hint + primary "Create
// note" action (prototype empty-state pattern, GAP-REPORT-v2 #12).
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NotesTabPanel, { type NotesTabPanelProps } from './NotesTabPanel';

const vaultBrowserProps = vi.fn();
vi.mock('./components/VaultBrowser', () => ({
  default: (props: Record<string, unknown>) => {
    vaultBrowserProps(props);
    return <div data-testid="vault-browser-mock" />;
  },
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
  activeNotePath: null,
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
  notePaths: [],
};

describe('NotesTabPanel — M8f empty state', () => {
  it('renders glyph + hint + primary "Create note" action when no note is open', () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    const placeholder = screen.getByTestId('notes-editor-placeholder');
    expect(placeholder).toHaveTextContent('Select a note from the sidebar to start editing.');
    expect(screen.getByTestId('notes-editor-placeholder-create')).toHaveTextContent('Create note');
  });

  it('bumps the VaultBrowser new-note request token when the CTA is clicked', () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    const initialToken = (vaultBrowserProps.mock.calls.at(-1)?.[0] as { newNoteRequest: { token: number } })
      .newNoteRequest.token;

    fireEvent.click(screen.getByTestId('notes-editor-placeholder-create'));

    const nextToken = (vaultBrowserProps.mock.calls.at(-1)?.[0] as { newNoteRequest: { token: number } })
      .newNoteRequest.token;
    expect(nextToken).toBe(initialToken + 1);
  });

  it('does not render the empty state once a note is active', () => {
    render(<NotesTabPanel {...BASE_PROPS} activeNotePath="Locations/The Sunken Gate.md" />);
    expect(screen.queryByTestId('notes-editor-placeholder')).not.toBeInTheDocument();
  });
});
