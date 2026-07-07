// M16 (Beta 3): NotesTabPanel — note splits + right-panel Agent/Properties tabs.
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
  default: ({ path }: { path: string }) => <div data-testid="note-viewer-mock" data-path={path} />,
}));
vi.mock('./NoteProperties', () => ({
  default: ({ path }: { path: string }) => <div data-testid="note-properties-mock" data-path={path} />,
}));
vi.mock('./Backlinks', () => ({
  default: ({ notePath }: { notePath: string }) => <div data-testid="backlinks-mock" data-path={notePath} />,
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
  notePaths: ['Locations/The Sunken Gate.md', 'Characters/Mira.md', 'assets/image.png'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotesTabPanel — M16 note splits', () => {
  it('shows the split toggle only when a note is open in the editor sub-view', () => {
    const { rerender } = render(<NotesTabPanel {...BASE_PROPS} />);
    expect(screen.getByTestId('notes-split-toggle')).toBeInTheDocument();
    rerender(<NotesTabPanel {...BASE_PROPS} activeNotePath={null} />);
    expect(screen.queryByTestId('notes-split-toggle')).not.toBeInTheDocument();
    rerender(<NotesTabPanel {...BASE_PROPS} notesSubView="graph" />);
    expect(screen.queryByTestId('notes-split-toggle')).not.toBeInTheDocument();
  });

  it('opens a split defaulting to another note, and closes it again', () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    expect(screen.queryByTestId('notes-split-row')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('notes-split-toggle'));
    expect(screen.getByTestId('notes-split-row')).toBeInTheDocument();
    expect(screen.getByTestId('note-split-pane')).toBeInTheDocument();
    // Two NoteViewers: the active note + the split note (defaults to the other .md)
    const viewers = screen.getAllByTestId('note-viewer-mock');
    expect(viewers).toHaveLength(2);
    expect(viewers[0]).toHaveAttribute('data-path', 'Locations/The Sunken Gate.md');
    expect(viewers[1]).toHaveAttribute('data-path', 'Characters/Mira.md');

    fireEvent.click(screen.getByTestId('note-split-close'));
    expect(screen.queryByTestId('notes-split-row')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('note-viewer-mock')).toHaveLength(1);
  });

  it('switches the split note via the selector (md files only)', () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('notes-split-toggle'));
    const select = screen.getByTestId('note-split-select') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('Locations/The Sunken Gate.md');
    expect(options).toContain('Characters/Mira.md');
    expect(options).not.toContain('assets/image.png');

    fireEvent.change(select, { target: { value: 'Locations/The Sunken Gate.md' } });
    const viewers = screen.getAllByTestId('note-viewer-mock');
    expect(viewers[1]).toHaveAttribute('data-path', 'Locations/The Sunken Gate.md');
  });

  it('toggle button reflects the open split via aria-pressed', () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    const toggle = screen.getByTestId('notes-split-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('notes-split-row')).not.toBeInTheDocument();
  });
});

describe('NotesTabPanel — M16 right-panel tabs', () => {
  it('defaults to the Agent tab (Brainstorm chat) and keeps existing testids', () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    expect(screen.getByTestId('notes-brainstorm-panel')).toBeInTheDocument();
    expect(screen.getByTestId('notes-brainstorm-collapse')).toBeInTheDocument();
    expect(screen.getByTestId('notes-right-tab-agent')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('brainstorm-page-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('note-properties-mock')).not.toBeInTheDocument();
  });

  it('switches to Properties: renders NoteProperties + Backlinks for the active note', () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('notes-right-tab-props'));
    expect(screen.getByTestId('notes-right-tab-props')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('note-properties-mock')).toHaveAttribute('data-path', 'Locations/The Sunken Gate.md');
    expect(screen.getByTestId('backlinks-mock')).toHaveAttribute('data-path', 'Locations/The Sunken Gate.md');
    expect(screen.queryByTestId('brainstorm-page-mock')).not.toBeInTheDocument();
  });

  it('shows an empty state on the Properties tab when no note is open', () => {
    render(<NotesTabPanel {...BASE_PROPS} activeNotePath={null} />);
    fireEvent.click(screen.getByTestId('notes-right-tab-props'));
    expect(screen.getByTestId('notes-right-props-empty')).toBeInTheDocument();
  });

  it('collapse/expand still works with the tabs present', () => {
    const onBrainstormCollapsedChange = vi.fn();
    render(<NotesTabPanel {...BASE_PROPS} onBrainstormCollapsedChange={onBrainstormCollapsedChange} />);
    fireEvent.click(screen.getByTestId('notes-brainstorm-collapse'));
    expect(onBrainstormCollapsedChange).toHaveBeenCalledWith(true);
  });
});
