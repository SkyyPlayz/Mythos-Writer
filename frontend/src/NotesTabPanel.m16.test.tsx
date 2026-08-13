// M16 (Beta 3): NotesTabPanel — note splits + right-panel Agent/Properties tabs.
// M9e (SKY-9826): agent-panel chat input placeholder + R11 master-AI gating.
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotesTabPanel, { type NotesTabPanelProps } from './NotesTabPanel';
import { __resetAiEnabledForTests, setAiEnabled } from './hooks/useAiEnabled';

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
    <div
      data-testid="brainstorm-page-mock"
      data-curator-greeting={String(!!props.curatorGreeting)}
      data-input-placeholder={String(props.inputPlaceholder ?? '')}
    />
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
  __resetAiEnabledForTests();
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

  // SKY-9920: opening Entity Browser in pane 1 while a split is already
  // active must NOT collapse the split — it previously took pane 2, both
  // panes' tab strips, and the split-toggle button down with it, since they
  // were all gated on `!activeTabIsEntityBrowser`.
  it('SKY-9920: pane 1 switching to Entity Browser mid-split keeps pane 2 and both strips visible', () => {
    const { rerender } = render(<NotesTabPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('notes-split-toggle'));
    expect(screen.getByTestId('notes-split-row')).toBeInTheDocument();

    // Mirrors what the shell does when pane 1's + picker opens Entity
    // Browser: openedNotePath (activeNotePath) clears, activeTabIsEntityBrowser flips true.
    rerender(<NotesTabPanel {...BASE_PROPS} activeTabIsEntityBrowser activeNotePath={null} />);

    expect(screen.getByTestId('notes-split-row')).toBeInTheDocument();
    expect(screen.getByTestId('note-split-pane')).toBeInTheDocument();
    expect(screen.getByTestId('entity-browser-mock')).toBeInTheDocument();
    // Pane 2's own note survives untouched — only pane 1's content changed.
    const viewers = screen.getAllByTestId('note-viewer-mock');
    expect(viewers).toHaveLength(1);
    expect(viewers[0]).toHaveAttribute('data-path', 'Characters/Mira.md');
    // The toggle stays reachable so the user can still collapse the split.
    expect(screen.getByTestId('notes-split-toggle')).toBeInTheDocument();
  });

  // SKY-10081: closing pane 1's LAST note tab while a split is active (and
  // pane 1 isn't Entity Browser) must NOT collapse the split either — same
  // failure mode as SKY-9920 above, but reached via activeNotePath going
  // null on its own instead of via activeTabIsEntityBrowser.
  it('SKY-10081: pane 1 losing its last note tab mid-split keeps pane 2 and both strips visible', () => {
    const { rerender } = render(<NotesTabPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('notes-split-toggle'));
    expect(screen.getByTestId('notes-split-row')).toBeInTheDocument();

    // Mirrors what the shell does when pane 1's sole note tab is closed:
    // openedNotePath (activeNotePath) clears, activeTabIsEntityBrowser stays false.
    rerender(<NotesTabPanel {...BASE_PROPS} activeNotePath={null} />);

    expect(screen.getByTestId('notes-split-row')).toBeInTheDocument();
    expect(screen.getByTestId('note-split-pane')).toBeInTheDocument();
    expect(screen.getByTestId('notes-split-pane-1-tab-strip')).toBeInTheDocument();
    expect(screen.getByTestId('notes-split-pane-2-tab-strip')).toBeInTheDocument();
    // Pane 2's own note survives untouched — only pane 1 lost its content.
    const viewers = screen.getAllByTestId('note-viewer-mock');
    expect(viewers).toHaveLength(1);
    expect(viewers[0]).toHaveAttribute('data-path', 'Characters/Mira.md');
    // The toggle stays reachable so the user can still collapse the split.
    expect(screen.getByTestId('notes-split-toggle')).toBeInTheDocument();
    // The dead-end empty-state placeholder must NOT also render underneath.
    expect(screen.queryByTestId('notes-editor-placeholder')).not.toBeInTheDocument();
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

// M9e (SKY-9826): notes-side agent panel chat input — prototype placeholder
// (line 3221) with AI on; with the master switch off the M11b contract says
// the agent panel (flags + chat) is gone and Properties is all that remains.
describe('NotesTabPanel — M9e agent chat input + R11 master-AI gating', () => {
  it("passes the prototype curator placeholder to the agent chat input", () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    expect(screen.getByTestId('brainstorm-page-mock')).toHaveAttribute(
      'data-input-placeholder',
      "Tell me about your world — I'll file it…",
    );
  });

  it('AI off: tab strip, chat, and flags are gone; Properties content renders directly', () => {
    setAiEnabled(false);
    render(<NotesTabPanel {...BASE_PROPS} archiveContinuityEnabled />);
    // Prototype manual mode drops the whole strip — no lone Properties tab.
    expect(screen.queryByRole('tablist', { name: 'Notes side panel' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('notes-right-tab-agent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notes-right-tab-props')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm-page-mock')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notes-continuity-flags')).not.toBeInTheDocument();
    expect(screen.getByTestId('note-properties-mock')).toBeInTheDocument();
    expect(screen.getByTestId('backlinks-mock')).toBeInTheDocument();
  });

  it('toggling AI off while the Agent tab is active falls back to Properties, and back on restores it', () => {
    render(<NotesTabPanel {...BASE_PROPS} />);
    expect(screen.getByTestId('notes-right-tab-agent')).toHaveAttribute('aria-selected', 'true');

    act(() => setAiEnabled(false));
    expect(screen.queryByRole('tablist', { name: 'Notes side panel' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm-page-mock')).not.toBeInTheDocument();
    expect(screen.getByTestId('note-properties-mock')).toBeInTheDocument();

    // The user's tab choice survives the round-trip (M11b: hidden, not reset).
    act(() => setAiEnabled(true));
    expect(screen.getByTestId('notes-right-tab-agent')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('brainstorm-page-mock')).toBeInTheDocument();
  });
});
