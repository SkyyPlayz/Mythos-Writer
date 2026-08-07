// M16 (Beta 3): NotesTabPanel — note splits + right-panel Agent/Properties tabs.
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotesTabPanel, { type NotesTabPanelProps } from './NotesTabPanel';

vi.mock('./components/VaultBrowser', () => ({
  // SKY-9710: record newNoteRequestId so tests can assert the editor
  // pane's empty-state CTA reaches the vault tree's new-note dialog.
  default: (props: Record<string, unknown>) => (
    <div data-testid="vault-browser-mock" data-new-note-request-id={String(props.newNoteRequestId ?? 0)} />
  ),
}));
vi.mock('./VaultGraphView', () => ({
  default: () => <div data-testid="vault-graph-view-mock" />,
}));
vi.mock('./EntityBrowser', () => ({
  default: () => <div data-testid="entity-browser-mock" />,
}));
// SKY-6978 (Beta4/M18): mocks record the props they receive so the Notes
// right panel's Curator greeting / CONTINUITY FLAGS wiring can be asserted.
vi.mock('./BrainstormPage', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="brainstorm-page-mock" data-curator-greeting={String(!!props.curatorGreeting)} />
  ),
}));
vi.mock('./ContinuityPanel', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="continuity-panel-mock" data-flags-header={String(!!props.flagsHeader)} />
  ),
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
    rerender(<NotesTabPanel {...BASE_PROPS} activeTabIsEntityBrowser={true} />);
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

    // SKY-9784: split-pane close now lives behind the per-pane ⋮ menu
    // ("Close pane"), same as the Story split editor's pane strip.
    fireEvent.click(screen.getByTestId('notes-split-pane-2-pane-menu-btn'));
    fireEvent.click(screen.getByTestId('notes-split-pane-2-pane-menu-close'));
    expect(screen.queryByTestId('notes-split-row')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('note-viewer-mock')).toHaveLength(1);
  });

  it('SKY-9784: pane 2 is an Obsidian-parity tab strip — switching tabs changes the viewer', () => {
    const { rerender } = render(<NotesTabPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('notes-split-toggle'));
    // Defaults to the other note (Mira) active in pane 2.
    expect(screen.getAllByTestId('note-viewer-mock')[1]).toHaveAttribute('data-path', 'Characters/Mira.md');

    // A shell-driven split request (drag/"Open to the side") upserts a
    // second tab into pane 2 and focuses it.
    rerender(<NotesTabPanel {...BASE_PROPS} noteSplitRequest={{ path: 'Locations/The Sunken Gate.md', token: 1 }} />);

    const pane2Strip = screen.getByTestId('notes-split-pane-2-tab-strip');
    expect(within(pane2Strip).getByRole('tab', { name: 'The Sunken Gate' })).toBeInTheDocument();
    expect(screen.getAllByTestId('note-viewer-mock')[1]).toHaveAttribute('data-path', 'Locations/The Sunken Gate.md');

    // Clicking the Mira tab switches pane 2's active document back to it.
    fireEvent.click(within(pane2Strip).getByRole('tab', { name: 'Mira' }));
    expect(screen.getAllByTestId('note-viewer-mock')[1]).toHaveAttribute('data-path', 'Characters/Mira.md');
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

// SKY-9710 (M8f): the editor pane's empty state — prototype pattern
// (glyph + one-line hint + primary "New note" action) instead of a dead-end
// placeholder.
describe('NotesTabPanel — notes editor empty state (SKY-9710)', () => {
  it('renders a glyph, a one-line hint, and a primary "New note" action when no note is open', () => {
    render(<NotesTabPanel {...BASE_PROPS} activeNotePath={null} />);
    const placeholder = screen.getByTestId('notes-editor-placeholder');
    expect(placeholder.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText(/select a note from the sidebar, or create a new one/i)).toBeInTheDocument();
    expect(screen.getByTestId('notes-editor-placeholder-create')).toHaveTextContent('+ New note');
  });

  it('does not render the placeholder once a note is open', () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    expect(screen.queryByTestId('notes-editor-placeholder')).not.toBeInTheDocument();
  });

  it('clicking "New note" bumps the request id VaultBrowser uses to open its dialog', () => {
    render(<NotesTabPanel {...BASE_PROPS} activeNotePath={null} />);
    expect(screen.getByTestId('vault-browser-mock')).toHaveAttribute('data-new-note-request-id', '0');
    fireEvent.click(screen.getByTestId('notes-editor-placeholder-create'));
    expect(screen.getByTestId('vault-browser-mock')).toHaveAttribute('data-new-note-request-id', '1');
  });

  it('expands a collapsed sidebar before requesting a new note', () => {
    const onNotesSidebarCollapsedChange = vi.fn();
    render(
      <NotesTabPanel
        {...BASE_PROPS}
        activeNotePath={null}
        notesSidebarCollapsed
        onNotesSidebarCollapsedChange={onNotesSidebarCollapsedChange}
      />,
    );
    fireEvent.click(screen.getByTestId('notes-editor-placeholder-create'));
    expect(onNotesSidebarCollapsedChange).toHaveBeenCalledWith(false);
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

  it('docks the continuity flags above the chat when archive continuity is enabled', () => {
    const { rerender } = render(<NotesTabPanel {...BASE_PROPS} archiveContinuityEnabled />);
    expect(screen.getByTestId('notes-continuity-flags')).toBeInTheDocument();
    expect(screen.getByTestId('continuity-panel-mock')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-page-mock')).toBeInTheDocument();
    rerender(<NotesTabPanel {...BASE_PROPS} archiveContinuityEnabled={false} />);
    expect(screen.queryByTestId('notes-continuity-flags')).not.toBeInTheDocument();
  });

  // SKY-6978 (Beta4/M18): Agent tab wires the Curator greeting + CONTINUITY
  // FLAGS header variant — Notes-only, not the Story-side Brainstorm embeds.
  it('passes curatorGreeting to the chat widget and flagsHeader to the continuity panel', () => {
    render(<NotesTabPanel {...BASE_PROPS} archiveContinuityEnabled />);
    expect(screen.getByTestId('brainstorm-page-mock')).toHaveAttribute('data-curator-greeting', 'true');
    expect(screen.getByTestId('continuity-panel-mock')).toHaveAttribute('data-flags-header', 'true');
  });

  it('collapse/expand still works with the tabs present', () => {
    const onBrainstormCollapsedChange = vi.fn();
    render(<NotesTabPanel {...BASE_PROPS} onBrainstormCollapsedChange={onBrainstormCollapsedChange} />);
    fireEvent.click(screen.getByTestId('notes-brainstorm-collapse'));
    expect(onBrainstormCollapsedChange).toHaveBeenCalledWith(true);
  });
});
