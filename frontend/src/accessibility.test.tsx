/**
 * MYT-254 — WCAG 2.1 AA accessibility audit via axe-core.
 * Covers all five primary surfaces: Brainstorm chat, Writing Assistant sidebar,
 * Settings panel, Editor toolbar (BlockEditor draft-state), Vault browser (EntityBrowser).
 * Each describe block renders the component in isolation and asserts axe passes.
 */
import { render, fireEvent } from '@testing-library/react';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import 'vitest-axe/extend-expect';
import { expect, describe, it, beforeEach, vi } from 'vitest';

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
    agentWritingAssistant: vi.fn().mockResolvedValue({ text: '' }),
    onWritingAssistantChunk: vi.fn().mockReturnValue(() => {}),
    onStreamToken: vi.fn().mockReturnValue(() => {}),
    onStreamEnd: vi.fn().mockReturnValue(() => {}),
    onStreamError: vi.fn().mockReturnValue(() => {}),
    onSttResult: vi.fn().mockReturnValue(() => {}),
    onVaultNotesUpdated: vi.fn().mockReturnValue(() => {}),
    sttStart: vi.fn(),
    sttStop: vi.fn(),
    listVault: vi.fn().mockResolvedValue({ items: [] }),
    startVaultWatch: vi.fn().mockResolvedValue({}),
    onVaultFileChanged: vi.fn().mockReturnValue(() => {}),
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
import SettingsPanel from './SettingsPanel';
import { waitFor } from '@testing-library/react';

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
    const { container, getByRole } = render(
      <EntityBrowser onSelectEntity={() => {}} selectedEntityId={null} />,
    );
    await waitFor(() => expect(container.querySelector('.entity-browser')).not.toBeNull());
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
// Surface 6 — LeftRail tab bar (MYT-282 ARIA tab pattern)
// ══════════════════════════════════════════════════════════════════════════════
import LeftRail from './LeftRail';

describe('Accessibility — LeftRail tab bar (WCAG 4.1.2)', () => {
  beforeEach(() => { stubApi(); vi.clearAllMocks(); });

  it('stories tab active — no axe violations', async () => {
    const { container } = render(
      <LeftRail
        activeTab="stories"
        onTabChange={() => {}}
        stories={[]}
        selectedSceneId={null}
        selectedEntityId={null}
        onSelectScene={() => {}}
        onSelectEntity={() => {}}
        onCreateStory={() => {}}
        onCreateChapter={() => {}}
        onCreateScene={() => {}}
        onReorderScenes={() => {}}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('entities tab active — no axe violations', async () => {
    const { container } = render(
      <LeftRail
        activeTab="entities"
        onTabChange={() => {}}
        stories={[]}
        selectedSceneId={null}
        selectedEntityId={null}
        onSelectScene={() => {}}
        onSelectEntity={() => {}}
        onCreateStory={() => {}}
        onCreateChapter={() => {}}
        onCreateScene={() => {}}
        onReorderScenes={() => {}}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('tab elements carry correct ARIA roles and attributes', () => {
    const { container } = render(
      <LeftRail
        activeTab="vault"
        onTabChange={() => {}}
        stories={[]}
        selectedSceneId={null}
        selectedEntityId={null}
        onSelectScene={() => {}}
        onSelectEntity={() => {}}
        onCreateStory={() => {}}
        onCreateChapter={() => {}}
        onCreateScene={() => {}}
        onReorderScenes={() => {}}
      />,
    );
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();

    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(5);

    const activeTab = container.querySelector('[aria-selected="true"]');
    expect(activeTab?.id).toBe('leftrail-tab-vault');

    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('aria-labelledby')).toBe('leftrail-tab-vault');
  });
});
