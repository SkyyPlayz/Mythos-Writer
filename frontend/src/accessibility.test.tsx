/**
 * MYT-254 — WCAG 2.1 AA accessibility audit via axe-core.
 * Covers all five primary surfaces: Brainstorm chat, Writing Assistant sidebar,
 * Settings panel, Editor toolbar (BlockEditor draft-state), Vault browser (EntityBrowser).
 * Each describe block renders the component in isolation and asserts axe passes.
 */
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import { expect, describe, it, beforeEach, vi } from 'vitest';

// vitest-axe@0.1.0 ships a legacy `Vi.Assertion` augmentation that vitest 3 no
// longer reads for matcher typing, so register the matchers on vitest 3's
// `'vitest'` module interfaces explicitly.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

// ─── vitest-axe matcher ────────────────────────────────────────────────────
expect.extend(axeMatchers);

const axe = configureAxe({
  rules: {
    // colour-contrast requires computed styles unavailable in jsdom — skip
    'color-contrast': { enabled: false },
  },
});

// ─── window.api stubs ─────────────────────────────────────────────────────

function stubApi(overrides: Record<string, unknown> = {}) {
  (window as unknown as { api: unknown }).api = {
    streamStart: vi.fn().mockResolvedValue({ streamId: 'stub' }),
    streamCancel: vi.fn().mockResolvedValue({ cancelled: true }),
    streamAck: vi.fn(),
    entityCreate: vi.fn().mockResolvedValue({ id: 'e1' }),
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    entityDelete: vi.fn().mockResolvedValue({}),
    settingsGet: vi.fn().mockResolvedValue({
      apiKey: '',
      agents: {
        writingAssistant: { enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
        brainstorm: { enabled: true, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
        archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
      },
      theme: 'dark',
      snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    }),
    settingsSet: vi.fn().mockResolvedValue({}),
    settingsTestConnection: vi.fn().mockResolvedValue({ ok: true, latencyMs: 10 }),
    agentWritingAssistant: vi.fn().mockResolvedValue({ text: '' }),
    onWritingAssistantChunk: vi.fn().mockReturnValue(() => {}),
    onStreamToken: vi.fn().mockReturnValue(() => {}),
    onStreamEnd: vi.fn().mockReturnValue(() => {}),
    onStreamError: vi.fn().mockReturnValue(() => {}),
    onSttResult: vi.fn().mockReturnValue(() => {}),
    onVaultNotesUpdated: vi.fn().mockReturnValue(() => {}),
    sttStart: vi.fn(),
    sttStop: vi.fn(),
    voiceTranscribe: vi.fn().mockResolvedValue({ text: 'axe test transcript', confidence: 0.95 }),
    // TTS stubs — required by useTtsPlayer (SKY-1504)
    voiceSpeak: vi.fn().mockResolvedValue({ speakId: 'stub-speak' }),
    voiceSpeakCancel: vi.fn(),
    onVoiceSpeakDone: vi.fn().mockReturnValue(() => {}),
    onVoiceSpeakError: vi.fn().mockReturnValue(() => {}),
    onVoiceSpeakChunk: vi.fn().mockReturnValue(() => {}),
    listVault: vi.fn().mockResolvedValue({ items: [] }),
    startVaultWatch: vi.fn().mockResolvedValue({}),
    onVaultFileChanged: vi.fn().mockReturnValue(() => {}),
    // SKY-9: Settings panel now reads vault paths on mount.
    vaultGetPaths: vi.fn().mockResolvedValue({
      storyVaultPath: '/home/test/Mythos Vault/Story Vault',
      notesVaultPath: '/home/test/Mythos Vault/Notes Vault',
    }),
    vaultSetPaths: vi.fn().mockResolvedValue({
      storyVaultPath: '/home/test/Mythos Vault/Story Vault',
      notesVaultPath: '/home/test/Mythos Vault/Notes Vault',
      saved: true,
    }),
    chooseVaultFolder: vi.fn().mockResolvedValue({ path: null, cancelled: true }),
    listNotesVault: vi.fn().mockResolvedValue({ items: [] }),
    notesTagList: vi.fn().mockResolvedValue({ tags: [] }),
    notesTagRename: vi.fn().mockResolvedValue({ affectedFiles: 0 }),
    notesTagMerge: vi.fn().mockResolvedValue({ affectedFiles: 0 }),
    notesVaultReadIcons: vi.fn().mockResolvedValue({}),
    vaultReadIcons: vi.fn().mockResolvedValue({}),
    iconReadSvg: vi.fn().mockResolvedValue({ svg: null }),
    outline: {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({ saved: true }),
    },
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Surface 1 — Brainstorm chat
// ══════════════════════════════════════════════════════════════════════════════
import BrainstormPage from './BrainstormPage';

describe('Accessibility — BrainstormPage (Brainstorm chat)', () => {
  beforeEach(() => { stubApi(); vi.clearAllMocks(); });

  it('idle state has no axe violations', async () => {
    const { container } = render(<BrainstormPage onClose={() => {}} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('disabled state has no axe violations', async () => {
    const { container } = render(<BrainstormPage onClose={() => {}} enabled={false} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // ── Voice IO AC-V-10: live region structural assertions (SKY-1506) ─────────

  it('AC-V-10: sr-only live region is always present in idle state', () => {
    const { container } = render(<BrainstormPage onClose={() => {}} />);
    const liveRegion = container.querySelector('[role="status"][aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
  });

  it('AC-V-10: axe passes with live region in idle state', async () => {
    const { container } = render(<BrainstormPage onClose={() => {}} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // ── Voice IO AC-V-05: aria-pressed on mic toggle ─────────────────────────────
  // SKY-3187: voice now uses MediaRecorder + voice:transcribe IPC (getUserMedia is async).

  let mockMediaRecorder: typeof MediaRecorder | null = null;

  beforeEach(() => {
    class FakeMR {
      static isTypeSupported = vi.fn(() => false);
      state = 'inactive';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['audio']) });
        this.onstop?.();
      }
    }
    mockMediaRecorder = FakeMR as unknown as typeof MediaRecorder;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).MediaRecorder = FakeMR;
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
      writable: true, configurable: true,
    });
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (mockMediaRecorder) delete (global as any).MediaRecorder;
    mockMediaRecorder = null;
  });

  it('AC-V-05: mic button has aria-pressed=false in idle state', () => {
    const { container } = render(<BrainstormPage onClose={() => {}} voiceEnabled />);
    const micBtn = container.querySelector('.brainstorm-mic-btn');
    expect(micBtn).not.toBeNull();
    expect(micBtn?.getAttribute('aria-pressed')).toBe('false');
  });

  it('AC-V-05: mic button has aria-pressed=true while recording', async () => {
    const { getByRole } = render(<BrainstormPage onClose={() => {}} voiceEnabled />);
    const micBtn = getByRole('button', { name: /start voice input/i });
    fireEvent.click(micBtn);
    // getUserMedia is async; wait for listening state
    await waitFor(() => expect(micBtn.getAttribute('aria-pressed')).toBe('true'));
  });

  it('AC-V-05: axe passes on brainstorm mic in recording state', async () => {
    const { container, getByRole } = render(<BrainstormPage onClose={() => {}} voiceEnabled />);
    const micBtn = getByRole('button', { name: /start voice input/i });
    fireEvent.click(micBtn);
    await waitFor(() => expect(micBtn.getAttribute('aria-pressed')).toBe('true'));
    await act(async () => {});
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Surface 2 — Writing Assistant sidebar
// ══════════════════════════════════════════════════════════════════════════════
import WritingAssistantPanel from './WritingAssistantPanel';

describe('Accessibility — WritingAssistantPanel (Writing Assistant sidebar)', () => {
  beforeEach(() => { stubApi(); vi.clearAllMocks(); });

  it('idle/no-scene state has no axe violations', async () => {
    const { container } = render(<WritingAssistantPanel scene={null} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('disabled state has no axe violations', async () => {
    const { container } = render(<WritingAssistantPanel scene={null} enabled={false} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // AC-WA-23: Panel structural ARIA roles
  it('AC-WA-23: panel has role=complementary and aria-label="Writing Assistant"', () => {
    const { container } = render(<WritingAssistantPanel scene={null} />);
    const panel = container.querySelector('[role="complementary"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('aria-label')).toBe('Writing Assistant');
  });

  it('AC-WA-23: message list has role=list', () => {
    const { container } = render(<WritingAssistantPanel scene={null} />);
    const list = container.querySelector('.writing-assistant-messages[role="list"]');
    expect(list).not.toBeNull();
  });

  // AC-WA-24: focus indicators — live region is always present
  it('AC-WA-24: sr-only polite live region is always present', () => {
    const { container } = render(<WritingAssistantPanel scene={null} />);
    const liveRegion = container.querySelector('[role="status"][aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
  });

  // AC-WA-25: reduced-motion — axe passes in all states (no animation-only issues)
  it('AC-WA-25: axe passes with scene provided', async () => {
    const scene = {
      id: 'sc1',
      title: 'Test Scene',
      path: '/test/scene.md',
      order: 0,
      chapterId: 'ch1',
      storyId: 's1',
      blocks: [{ id: 'b1', type: 'prose' as const, content: 'Hello world', order: 0, updatedAt: '' }],
      draftState: 'in-progress' as const,
      createdAt: '',
      updatedAt: '',
    };
    const { container } = render(<WritingAssistantPanel scene={scene} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Surface 3 — Settings panel
// ══════════════════════════════════════════════════════════════════════════════
import SettingsPanel from './components/SettingsPanel';

describe('Accessibility — SettingsPanel (Settings)', () => {
  beforeEach(() => { stubApi(); vi.clearAllMocks(); });

  it('loaded state has no axe violations', async () => {
    const { container } = render(<SettingsPanel onClose={() => {}} />);
    // Wait for settingsGet promise to resolve so the panel renders fully
    await waitFor(() => expect(container.querySelector('.settings-body')).not.toBeNull());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Surface 4 — Vault browser (EntityBrowser)
// ══════════════════════════════════════════════════════════════════════════════
import EntityBrowser from './EntityBrowser';

describe('Accessibility — EntityBrowser (Vault browser / Entities)', () => {
  beforeEach(() => { stubApi(); vi.clearAllMocks(); });

  it('empty state has no axe violations', async () => {
    const { container } = render(
      <EntityBrowser onSelectEntity={() => {}} selectedEntityId={null} />,
    );
    await waitFor(() => expect(container.querySelector('.entity-browser')).not.toBeNull());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('populated state has no axe violations', async () => {
    (window as unknown as { api: { entityList: ReturnType<typeof vi.fn> } }).api.entityList =
      vi.fn().mockResolvedValue({
        entities: [
          { id: 'c1', name: 'Aria Voss', type: 'character', aliases: [], tags: [], prose: '', createdAt: '', updatedAt: '' },
          { id: 'l1', name: 'The Sunken City', type: 'location', aliases: [], tags: [], prose: '', createdAt: '', updatedAt: '' },
        ],
      });
    const { container } = render(
      <EntityBrowser onSelectEntity={() => {}} selectedEntityId={null} />,
    );
    await waitFor(() => expect(container.querySelector('.entity-group')).not.toBeNull());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('CreateDialog open state has no axe violations', async () => {
    // Pre-populate so the toolbar "+ New Entity" button is visible (toolbar hidden in empty state)
    (window as unknown as { api: { entityList: ReturnType<typeof vi.fn> } }).api.entityList =
      vi.fn().mockResolvedValue({
        entities: [{ id: 'c1', name: 'Aria Voss', type: 'character', aliases: [], tags: [], prose: '', createdAt: '', updatedAt: '' }],
      });
    const { container, getByRole } = render(
      <EntityBrowser onSelectEntity={() => {}} selectedEntityId={null} />,
    );
    await waitFor(() => expect(container.querySelector('.entity-group')).not.toBeNull());
    fireEvent.click(getByRole('button', { name: /new entity/i }));
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Surface 5 — Story Navigator (Editor left-rail tree)
// ══════════════════════════════════════════════════════════════════════════════
import StoryNavigator from './StoryNavigator';
import type { Story } from './types';

const STUB_STORIES: Story[] = [
  {
    id: 's1',
    title: 'The Amber Chronicle',
    path: 'stories/s1',
    createdAt: '',
    updatedAt: '',
    chapters: [
      {
        id: 'ch1',
        title: 'Chapter One',
        path: 'stories/s1/chapters/ch1',
        order: 0,
        createdAt: '',
        updatedAt: '',
        scenes: [
          { id: 'sc1', title: 'The Arrival', path: 'stories/s1/chapters/ch1/scenes/sc1.md', order: 0, chapterId: 'ch1', storyId: 's1', blocks: [], draftState: 'in-progress', createdAt: '', updatedAt: '' },
        ],
      },
    ],
  },
];

describe('Accessibility — StoryNavigator (Editor tree)', () => {
  it('empty state has no axe violations', async () => {
    const { container } = render(
      <StoryNavigator
        stories={[]}
        selectedSceneId={null}
        onSelectScene={() => {}}
        onCreateStory={() => {}}
        onCreateChapter={() => {}}
        onCreateScene={() => {}}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('populated tree has no axe violations', async () => {
    const { container } = render(
      <StoryNavigator
        stories={STUB_STORIES}
        selectedSceneId={null}
        onSelectScene={() => {}}
        onCreateStory={() => {}}
        onCreateChapter={() => {}}
        onCreateScene={() => {}}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Surface 6 — LeftRail nav zone + panel zone (SKY-1694 Wave 2a)
// ══════════════════════════════════════════════════════════════════════════════
import LeftRail, { DEFAULT_LEFT_SIDEBAR_LAYOUT } from './LeftRail';
import { PanelDragProvider } from './PanelDragContext';

const DEFAULT_LEFT_RAIL_PROPS = {
  leftSidebarLayout: DEFAULT_LEFT_SIDEBAR_LAYOUT,
  onLeftSidebarLayoutChange: () => {},
  renderPanelContent: (id: string) => <div data-testid={id}>{id}</div>,
  rightPanelCount: 3,
};

describe('Accessibility — LeftRail nav + panel zone (WCAG 4.1.2)', () => {
  beforeEach(() => { stubApi(); vi.clearAllMocks(); });

  it('default layout (entities panel) — no axe violations', async () => {
    const { container } = render(
      <PanelDragProvider onDrop={() => {}}><LeftRail {...DEFAULT_LEFT_RAIL_PROPS} /></PanelDragProvider>
    );
    await act(async () => {});
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('with stories panel — no axe violations', async () => {
    const layout: LeftSidebarLayout = {
      panels: [{ id: 'stories', collapsed: false }],
      sidebarCollapsed: false,
    };
    const { container } = render(
      <PanelDragProvider onDrop={() => {}}>
        <LeftRail {...DEFAULT_LEFT_RAIL_PROPS} leftSidebarLayout={layout} />
      </PanelDragProvider>,
    );
    await act(async () => {});
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('legacy nav zone is absent after tab/sub-view migration', async () => {
    const { container } = render(
      <PanelDragProvider onDrop={() => {}}><LeftRail {...DEFAULT_LEFT_RAIL_PROPS} /></PanelDragProvider>
    );
    await act(async () => {});
    expect(container.querySelector('[aria-label="Main navigation"]')).toBeNull();
    expect(container.querySelector('[data-no-drop="true"]')).toBeNull();
  });

  it('collapsed sidebar renders icon-only rail', async () => {
    const layout: LeftSidebarLayout = { ...DEFAULT_LEFT_SIDEBAR_LAYOUT, sidebarCollapsed: true };
    const { container } = render(
      <PanelDragProvider onDrop={() => {}}>
        <LeftRail {...DEFAULT_LEFT_RAIL_PROPS} leftSidebarLayout={layout} />
      </PanelDragProvider>,
    );
    await act(async () => {});
    expect(container.querySelector('.left-rail--collapsed')).not.toBeNull();
    expect(container.querySelector('.lr-panel-zone')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Surface 7 — GRS panel accessibility (SceneNotesPanel, ScenePropertiesPanel)
// ══════════════════════════════════════════════════════════════════════════════
import SceneNotesPanel from './SceneNotesPanel';
import ScenePropertiesPanel from './ScenePropertiesPanel';

describe('Accessibility — SceneNotesPanel (WCAG 4.1.2)', () => {
  beforeEach(() => { stubApi(); vi.clearAllMocks(); });

  it('empty state — no axe violations', async () => {
    const { container } = render(<SceneNotesPanel scene={null} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('with scene — textarea has accessible label', () => {
    const scene = {
      id: 'sc1', title: 'Scene 1', path: '/s/ch1/sc1', order: 0,
      chapterId: 'ch1', storyId: 's1', blocks: [], createdAt: '', updatedAt: '',
    };
    const { container } = render(<SceneNotesPanel scene={scene as any} />);
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea?.getAttribute('aria-label')).toBe('Scene notes');
  });

  it('with scene — no axe violations', async () => {
    const scene = {
      id: 'sc1', title: 'Scene 1', path: '/s/ch1/sc1', order: 0,
      chapterId: 'ch1', storyId: 's1', blocks: [], createdAt: '', updatedAt: '',
    };
    const { container } = render(<SceneNotesPanel scene={scene as any} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility — ScenePropertiesPanel (WCAG 4.1.2)', () => {
  beforeEach(() => { stubApi(); vi.clearAllMocks(); });

  it('empty state — no axe violations', async () => {
    const { container } = render(
      <ScenePropertiesPanel scene={null} chapter={null} story={null} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('with scene/chapter/story — no axe violations', async () => {
    const scene = {
      id: 'sc1', title: 'Scene 1', path: '/s/ch1/sc1', order: 0,
      chapterId: 'ch1', storyId: 's1', draftState: 'in-progress',
      blocks: [{ id: 'b1', type: 'paragraph', content: 'Hello world', order: 0 }],
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-02T00:00:00.000Z',
    };
    const chapter = { id: 'ch1', title: 'Chapter 1', path: '/s/ch1', order: 0, scenes: [], createdAt: '', updatedAt: '' };
    const story = { id: 's1', title: 'My Story', path: '/s', order: 0, chapters: [] };
    const { container } = render(
      <ScenePropertiesPanel scene={scene as any} chapter={chapter as any} story={story as any} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Surface 8 — SyncConflictModal
// ══════════════════════════════════════════════════════════════════════════════
import SyncConflictModal, {
  type LockfileConflictInfo,
  type ResolvedConflictInfo,
} from './SyncConflictModal';

const SYNC_CONFLICT_RESOLVED: ResolvedConflictInfo[] = [
  {
    conflictPath: 'Manuscript/Ch01/scene (conflicted copy).md',
    originalPath: 'Manuscript/Ch01/scene.md',
    provider: 'dropbox',
    keptPath: 'Manuscript/Ch01/scene.md',
    archivedPath: '.mythos/.archive/scene (conflicted copy).md',
    resolvedAt: '2024-01-15T12:00:00.000Z',
  },
];

const SYNC_LOCKFILE_CONFLICT: LockfileConflictInfo = {
  hostname: 'other-machine.local',
  pid: 12345,
  timestamp: '2024-01-15T12:00:00.000Z',
};

describe('Accessibility — SyncConflictModal', () => {
  it('resolved-conflicts state has no axe violations', async () => {
    const { container } = render(
      <SyncConflictModal
        resolved={SYNC_CONFLICT_RESOLVED}
        lockfileConflict={null}
        onContinue={() => {}}
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('lockfile-warning state has no axe violations', async () => {
    const { container } = render(
      <SyncConflictModal
        resolved={[]}
        lockfileConflict={SYNC_LOCKFILE_CONFLICT}
        onContinue={() => {}}
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Surface 9 — IdeaCard (SKY-1196 a11y)
// ══════════════════════════════════════════════════════════════════════════════
import { IdeaCard } from './components/BrainstormCard/IdeaCard';
import { IdeaDetailDrawer } from './components/BrainstormCard/IdeaDetailDrawer';

const SAMPLE_IDEA = {
  id: 'a11y-1',
  title: 'Aria Voss',
  type: 'character' as const,
  linkedEntities: [{ id: 'e1', name: 'Aria Voss', type: 'character' as const }],
  savedPath: 'Characters/Aria Voss.md',
  updatedAt: '2026-06-11T00:00:00.000Z',
};

describe('Accessibility — IdeaCard (SKY-1196)', () => {
  it('default state has no axe violations', async () => {
    const { container } = render(
      <div role="list">
        <IdeaCard idea={SAMPLE_IDEA} onOpenDetail={() => {}} />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('multi-select state has no axe violations', async () => {
    const { container } = render(
      <div role="list">
        <IdeaCard
          idea={SAMPLE_IDEA}
          onOpenDetail={() => {}}
          isMultiSelect
          isSelected={false}
          onToggleSelect={() => {}}
        />
      </div>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('renders as <li> (implicit listitem role)', () => {
    const { container } = render(
      <div role="list">
        <IdeaCard idea={SAMPLE_IDEA} onOpenDetail={() => {}} />
      </div>,
    );
    const card = container.querySelector('[data-testid="idea-card-a11y-1"]');
    expect(card?.tagName.toLowerCase()).toBe('li');
  });

  it('card is always keyboard-focusable (tabIndex=0)', () => {
    const { container } = render(
      <div role="list">
        <IdeaCard idea={SAMPLE_IDEA} onOpenDetail={() => {}} />
      </div>,
    );
    const card = container.querySelector('[data-testid="idea-card-a11y-1"]') as HTMLElement;
    expect(card?.tabIndex).toBe(0);
  });
});

describe('Accessibility — IdeaDetailDrawer (SKY-1196)', () => {
  beforeEach(() => { stubApi(); vi.clearAllMocks(); });

  it('default state has no axe violations', async () => {
    const { container } = render(
      <IdeaDetailDrawer idea={SAMPLE_IDEA} onClose={() => {}} onSave={() => {}} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// Surface 10 — WritingApp (vault loading / error states)
// ══════════════════════════════════════════════════════════════════════════════
import WritingApp from './WritingApp';

describe('Accessibility — WritingApp loading/error states (SKY-938)', () => {
  it('loading state has role="status"', () => {
    (window as unknown as { api: unknown }).api = {
      readManifest: () => new Promise(() => {}), // never resolves — stays in loading
    };
    const { container } = render(<WritingApp />);
    const loadingEl = container.querySelector('.writing-loading');
    expect(loadingEl).not.toBeNull();
    expect(loadingEl?.getAttribute('role')).toBe('status');
  });

  it('error state has role="alert"', async () => {
    (window as unknown as { api: unknown }).api = {
      readManifest: () => Promise.reject(new Error('disk read error')),
    };
    const { container } = render(<WritingApp />);
    const errorEl = await waitFor(() => {
      const el = container.querySelector('.writing-error');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(errorEl.getAttribute('role')).toBe('alert');
  });
});
