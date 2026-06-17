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

  // ── Voice IO AC-V-05: aria-pressed on mic toggle (SKY-1503 merged) ─────────
  // SKY-1503 landed via PR #457. In jsdom, getSpeechRecognitionCtor() returns null
  // so startVoice() takes the IPC fallback path → setVoiceState('listening') immediately.

  it('AC-V-05: mic button has aria-pressed=false in idle state', () => {
    const { container } = render(<BrainstormPage onClose={() => {}} />);
    const micBtn = container.querySelector('.brainstorm-mic-btn');
    expect(micBtn).not.toBeNull();
    expect(micBtn?.getAttribute('aria-pressed')).toBe('false');
  });

  it('AC-V-05: mic button has aria-pressed=true while recording', () => {
    const { getByRole } = render(<BrainstormPage onClose={() => {}} />);
    // MIC_ARIA_LABELS.idle = "Start voice input" (SKY-1503)
    const micBtn = getByRole('button', { name: /start voice input/i });
    fireEvent.click(micBtn);
    expect(micBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('AC-V-05: axe passes on brainstorm mic in recording state', async () => {
    const { container, getByRole } = render(<BrainstormPage onClose={() => {}} />);
    fireEvent.click(getByRole('button', { name: /start voice input/i }));
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
// Surface 7 — RightSidebar tab bar (MYT-803 ARIA tab pattern)
// ══════════════════════════════════════════════════════════════════════════════
import RightSidebar from './RightSidebar';

describe('Accessibility — RightSidebar tab bar (WCAG 4.1.2)', () => {
  beforeEach(() => { stubApi(); vi.clearAllMocks(); });

  it('notes tab active — no axe violations', async () => {
    const { container } = render(
      <RightSidebar
        activeTab="notes"
        onTabChange={() => {}}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('properties tab active — no axe violations', async () => {
    const { container } = render(
      <RightSidebar
        activeTab="properties"
        onTabChange={() => {}}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('ai tab active — no axe violations (includes AI sub-tabs)', async () => {
    const { container } = render(
      <RightSidebar
        activeTab="ai"
        onTabChange={() => {}}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('main tab elements carry correct ARIA roles and attributes', () => {
    const { container } = render(
      <RightSidebar
        activeTab="properties"
        onTabChange={() => {}}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
      />,
    );

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(tablist?.getAttribute('aria-label')).toBe('Sidebar panels');

    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(4); // notes, properties, ai, outline

    const activeTab = container.querySelector('[aria-selected="true"]');
    expect(activeTab?.id).toBe('rightsidebar-tab-properties');

    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('aria-labelledby')).toBe('rightsidebar-tab-properties');
  });

  it('roving tabIndex — active tab has tabIndex 0, others have -1', () => {
    const { container } = render(
      <RightSidebar
        activeTab="ai"
        onTabChange={() => {}}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
      />,
    );

    const allTabs = container.querySelectorAll('[role="tab"]');
    // Only main tabs here (ai tab is active)
    const mainTabs = Array.from(allTabs).filter((el) =>
      el.id.startsWith('rightsidebar-tab-'),
    );
    const activeMain = mainTabs.find((el) => el.getAttribute('aria-selected') === 'true');
    const inactiveMain = mainTabs.filter((el) => el.getAttribute('aria-selected') === 'false');

    expect(activeMain?.getAttribute('tabindex')).toBe('0');
    for (const tab of inactiveMain) {
      expect(tab.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('AI sub-tab elements carry correct ARIA roles and attributes', () => {
    const { container } = render(
      <RightSidebar
        activeTab="ai"
        onTabChange={() => {}}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
      />,
    );

    const subtablist = container.querySelector('.ai-subtabs[role="tablist"]');
    expect(subtablist).not.toBeNull();
    expect(subtablist?.getAttribute('aria-label')).toBe('AI assistant panels');

    const subTabs = container.querySelectorAll('[role="tab"][id^="ai-subtab-"]');
    expect(subTabs).toHaveLength(3);

    const activeSubTab = Array.from(subTabs).find(
      (el) => el.getAttribute('aria-selected') === 'true',
    );
    expect(activeSubTab?.id).toBe('ai-subtab-writing');

    const subPanel = container.querySelector('#ai-subtabpanel[role="tabpanel"]');
    expect(subPanel).not.toBeNull();
    expect(subPanel?.getAttribute('aria-labelledby')).toBe('ai-subtab-writing');
  });

  it('ArrowRight on main tabs moves focus and activates next tab', () => {
    const onTabChange = vi.fn();
    const { container } = render(
      <RightSidebar
        activeTab="notes"
        onTabChange={onTabChange}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
      />,
    );

    const notesTab = container.querySelector('#rightsidebar-tab-notes') as HTMLElement;
    fireEvent.keyDown(notesTab, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('properties');
  });

  it('ArrowLeft on main tabs wraps around to last tab', () => {
    const onTabChange = vi.fn();
    const { container } = render(
      <RightSidebar
        activeTab="notes"
        onTabChange={onTabChange}
        selectedScene={null}
        selectedChapter={null}
        selectedStory={null}
      />,
    );

    const notesTab = container.querySelector('#rightsidebar-tab-notes') as HTMLElement;
    fireEvent.keyDown(notesTab, { key: 'ArrowLeft' });
    expect(onTabChange).toHaveBeenCalledWith('outline'); // wraps to last tab
  });

  it('outline tab active — no axe violations', async () => {
    const story = {
      id: 's1', title: 'My Story', path: '/s', order: 0,
      chapters: [{
        id: 'ch1', title: 'Chapter 1', path: '/s/ch1', order: 0, createdAt: '', updatedAt: '',
        scenes: [
          { id: 'sc1', title: 'Scene 1', path: '/s/ch1/sc1', order: 0, chapterId: 'ch1', storyId: 's1', blocks: [], createdAt: '', updatedAt: '' },
          { id: 'sc2', title: 'Scene 2', path: '/s/ch1/sc2', order: 1, chapterId: 'ch1', storyId: 's1', blocks: [], createdAt: '', updatedAt: '' },
        ],
      }],
    };
    const { container } = render(
      <RightSidebar
        activeTab="outline"
        onTabChange={() => {}}
        selectedScene={{ id: 'sc1', title: 'Scene 1', path: '/s/ch1/sc1', order: 0, chapterId: 'ch1', storyId: 's1', blocks: [], createdAt: '', updatedAt: '' }}
        selectedChapter={{ id: 'ch1', title: 'Chapter 1', path: '/s/ch1', order: 0, scenes: story.chapters[0].scenes, createdAt: '', updatedAt: '' }}
        selectedStory={story as any}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('outline tab — active scene has aria-current="true"', () => {
    const scene1 = { id: 'sc1', title: 'Scene 1', path: '/s/ch1/sc1', order: 0, chapterId: 'ch1', storyId: 's1', blocks: [], createdAt: '', updatedAt: '' };
    const scene2 = { id: 'sc2', title: 'Scene 2', path: '/s/ch1/sc2', order: 1, chapterId: 'ch1', storyId: 's1', blocks: [], createdAt: '', updatedAt: '' };
    const chapter = { id: 'ch1', title: 'Chapter 1', path: '/s/ch1', order: 0, scenes: [scene1, scene2], createdAt: '', updatedAt: '' };
    const story = { id: 's1', title: 'My Story', path: '/s', order: 0, chapters: [chapter] };

    const { container } = render(
      <RightSidebar
        activeTab="outline"
        onTabChange={() => {}}
        selectedScene={scene1}
        selectedChapter={chapter}
        selectedStory={story as any}
      />,
    );

    const activeNode = container.querySelector('[aria-current="true"]');
    expect(activeNode).not.toBeNull();
    expect(activeNode?.textContent).toBe('Scene 1');

    const inactiveNode = container.querySelector('.outline-sidebar-scene:not(.active-scene)');
    expect(inactiveNode?.getAttribute('aria-current')).toBeNull();
  });

  it('outline tab — clicking a scene calls onSelectScene', () => {
    const scene1 = { id: 'sc1', title: 'Scene 1', path: '/s/ch1/sc1', order: 0, chapterId: 'ch1', storyId: 's1', blocks: [], createdAt: '', updatedAt: '' };
    const scene2 = { id: 'sc2', title: 'Scene 2', path: '/s/ch1/sc2', order: 1, chapterId: 'ch1', storyId: 's1', blocks: [], createdAt: '', updatedAt: '' };
    const chapter = { id: 'ch1', title: 'Chapter 1', path: '/s/ch1', order: 0, scenes: [scene1, scene2], createdAt: '', updatedAt: '' };
    const story = { id: 's1', title: 'My Story', path: '/s', order: 0, chapters: [chapter] };
    const onSelectScene = vi.fn();

    const { container } = render(
      <RightSidebar
        activeTab="outline"
        onTabChange={() => {}}
        selectedScene={scene1}
        selectedChapter={chapter}
        selectedStory={story as any}
        onSelectScene={onSelectScene}
      />,
    );

    const scene2Node = container.querySelector('.outline-sidebar-scene:not(.active-scene)') as HTMLElement;
    fireEvent.click(scene2Node);
    expect(onSelectScene).toHaveBeenCalledWith(scene2, chapter);
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
