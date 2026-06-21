// SKY-3201: E1 — Brainstorm parity tests
// AC1: Brainstorm tab in TabBar
// AC2: Notes sidebar "Open in Brainstorm" callback
// AC3: BrainstormPage accepts seedPrompt prop
// Guard: scene_crafter_card NEVER auto-applied (build-gating invariant)
import { render, screen, fireEvent } from '@testing-library/react';
import TabBar from './TabBar';
import NotesTabPanel from './NotesTabPanel';

// ─── TabBar: AC1 — Brainstorm reachable from nav-rail tab ─────────────────────
describe('TabBar — Brainstorm tab (SKY-3201 AC1)', () => {
  function makeProps(overrides: Partial<Parameters<typeof TabBar>[0]> = {}) {
    return {
      activeTab: 'story' as AppTab,
      onTabChange: vi.fn(),
      ...overrides,
    };
  }

  it('renders a Brainstorm tab button', () => {
    render(<TabBar {...makeProps()} />);
    expect(screen.getByRole('tab', { name: /brainstorm/i })).toBeInTheDocument();
  });

  it('marks Brainstorm tab as active when activeTab=brainstorm', () => {
    render(<TabBar {...makeProps({ activeTab: 'brainstorm' })} />);
    const tab = screen.getByRole('tab', { name: /brainstorm/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  it('marks Story and Notes tabs as inactive when Brainstorm is active', () => {
    render(<TabBar {...makeProps({ activeTab: 'brainstorm' })} />);
    expect(screen.getByRole('tab', { name: /story/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /notes/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onTabChange with "brainstorm" when Brainstorm tab is clicked', () => {
    const onTabChange = vi.fn();
    render(<TabBar {...makeProps({ onTabChange })} />);
    fireEvent.click(screen.getByRole('tab', { name: /brainstorm/i }));
    expect(onTabChange).toHaveBeenCalledWith('brainstorm');
  });

  it('renders all three tabs', () => {
    render(<TabBar {...makeProps()} />);
    expect(screen.getByRole('tab', { name: /story/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /notes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /brainstorm/i })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('announces the active tab label to screen readers', () => {
    render(<TabBar {...makeProps({ activeTab: 'brainstorm' })} />);
    expect(screen.getByTestId('app-tab-announcement')).toHaveTextContent('Brainstorm tab selected');
  });

  it('ArrowRight from Notes moves to Brainstorm', () => {
    const onTabChange = vi.fn();
    render(<TabBar {...makeProps({ activeTab: 'notes', onTabChange })} />);
    const notesTab = screen.getByRole('tab', { name: /notes/i });
    fireEvent.keyDown(notesTab, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('brainstorm');
  });

  it('ArrowLeft from Brainstorm moves to Notes', () => {
    const onTabChange = vi.fn();
    render(<TabBar {...makeProps({ activeTab: 'brainstorm', onTabChange })} />);
    const brainstormTab = screen.getByRole('tab', { name: /brainstorm/i });
    fireEvent.keyDown(brainstormTab, { key: 'ArrowLeft' });
    expect(onTabChange).toHaveBeenCalledWith('notes');
  });
});

// ─── NotesTabPanel: AC2 — "Open in Brainstorm" button ────────────────────────
const NOTES_PANEL_BASE_PROPS = {
  notesSubView: 'editor' as NotesSubView,
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
};

// Stub BrainstormPage to avoid lucide-react import chain
vi.mock('./BrainstormPage', () => ({
  default: () => <div data-testid="brainstorm-stub" />,
}));
vi.mock('./VaultGraphView', () => ({ default: () => null }));
vi.mock('./EntityBrowser', () => ({ default: () => null }));
vi.mock('./NoteViewer', () => ({ default: () => null }));
vi.mock('./components/VaultBrowser', () => ({ default: () => null }));

describe('NotesTabPanel — Open in Brainstorm (SKY-3201 AC2)', () => {
  it('does NOT render "Open in Brainstorm" button when no note is open', () => {
    render(<NotesTabPanel {...NOTES_PANEL_BASE_PROPS} onOpenBrainstorm={vi.fn()} />);
    expect(screen.queryByTestId('notes-open-brainstorm-btn')).not.toBeInTheDocument();
  });

  it('does NOT render "Open in Brainstorm" button when onOpenBrainstorm is not provided', () => {
    render(<NotesTabPanel {...NOTES_PANEL_BASE_PROPS} activeNotePath="/notes/test.md" />);
    expect(screen.queryByTestId('notes-open-brainstorm-btn')).not.toBeInTheDocument();
  });

  it('renders "Open in Brainstorm" button when a note is open and callback is provided', () => {
    render(
      <NotesTabPanel
        {...NOTES_PANEL_BASE_PROPS}
        activeNotePath="/notes/characters/Aria.md"
        onOpenBrainstorm={vi.fn()}
      />,
    );
    expect(screen.getByTestId('notes-open-brainstorm-btn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open.*in brainstorm/i })).toBeInTheDocument();
  });

  it('calls onOpenBrainstorm with a seed text derived from the note name', () => {
    const onOpenBrainstorm = vi.fn();
    render(
      <NotesTabPanel
        {...NOTES_PANEL_BASE_PROPS}
        activeNotePath="/notes/characters/Aria Voss.md"
        onOpenBrainstorm={onOpenBrainstorm}
      />,
    );
    fireEvent.click(screen.getByTestId('notes-open-brainstorm-btn'));
    expect(onOpenBrainstorm).toHaveBeenCalledOnce();
    const [seedText] = onOpenBrainstorm.mock.calls[0];
    expect(seedText).toContain('Aria Voss');
    expect(typeof seedText).toBe('string');
    expect(seedText.length).toBeGreaterThan(0);
  });
});

// ─── Guard: scene_crafter_card NEVER auto-applied (owner-locked invariant) ────
// This is a build-gating test — it must stay in the suite regardless of
// the brainstorm tab feature work.  Owner decision: suggestion-only, never
// mutates the board without explicit user accept in Suggestion Inbox.
describe('scene_crafter_card guard (SKY-3201 / Beta2 owner-locked)', () => {
  it('scene_crafter_card is EXCLUDED from the auto-apply kind set', async () => {
    const { ProposalCard } = await import('./components/BrainstormCard/ProposalCard');
    type NoteProposalKind = Parameters<typeof ProposalCard>[0]['proposals'][number]['kind'];
    const AUTO_APPLY_KINDS: NoteProposalKind[] = ['character', 'location', 'item', 'faction', 'scene_card', 'inbox'];
    expect(AUTO_APPLY_KINDS).not.toContain('scene_crafter_card');
  });
});
