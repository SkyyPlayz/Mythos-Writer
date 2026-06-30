import { describe, expect, it } from 'vitest';
import { migrateV1Layout, BUILTIN_LAYOUTS } from './WorkspaceLayoutManager';

function budget(): AgentBudgetSettings {
  return {
    autoApply: false,
    confidenceThreshold: 0.8,
    maxTokensPerHour: 0,
    maxSuggestionsPerHour: 0,
    heartbeatIntervalMinutes: 0,
    maxTokensPerDay: 0,
  };
}

function settingsFixture(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    apiKey: '',
    agents: {
      writingAssistant: { enabled: true, model: 'claude', scanIntervalSeconds: 30, ...budget() },
      brainstorm: { enabled: true, model: 'claude', ...budget() },
      archive: { enabled: true, model: 'claude', continuityCheckIntervalSeconds: 60, ...budget() },
    },
    theme: 'dark',
    onboardingComplete: true,
    ...overrides,
  };
}

describe('migrateV1Layout', () => {
  it('seeds the two-tab shell from legacy sidebar widths', () => {
    const migrated = migrateV1Layout(settingsFixture({
      activeLayout: {
        leftSidebar: { panels: [{ id: 'stories', collapsed: false }], sidebarCollapsed: false },
      },
      rightSidebarWidth: 344,
    }));

    expect(migrated.activeLayout?.tabShell).toEqual({
      activeTab: 'story',
      storySubView: 'editor',
      notesSubView: 'editor',
      storySidebarWidth: 240,
      notesSidebarWidth: 344,
      storySidebarCollapsed: false,
      notesSidebarCollapsed: false,
    });
  });

  it('is idempotent when a tab shell has already been migrated', () => {
    const existing: AppTabShellState = {
      activeTab: 'notes',
      storySubView: 'timeline',
      notesSubView: 'editor',
      storySidebarWidth: 301,
      notesSidebarWidth: 302,
      storySidebarCollapsed: true,
      notesSidebarCollapsed: false,
    };

    const migrated = migrateV1Layout(settingsFixture({
      activeLayout: {
        leftSidebar: { panels: [{ id: 'stories', collapsed: false }], sidebarCollapsed: true },
        tabShell: existing,
      },
      rightSidebarWidth: 500,
    }));

    expect(migrated.activeLayout?.tabShell).toEqual(existing);
  });

  it('migrates rightSidebarVisible=true to activeLayout.rightSidebar.visible=true', () => {
    const migrated = migrateV1Layout(settingsFixture({
      rightSidebarVisible: true,
      rightSidebarWidth: 320,
    }));

    expect(migrated.activeLayout?.rightSidebar?.visible).toBe(true);
    expect(migrated.activeLayout?.rightSidebar?.width).toBe(320);
  });

  it('migrates undefined rightSidebarVisible to visible=false (safe default)', () => {
    const migrated = migrateV1Layout(settingsFixture({
      rightSidebarVisible: undefined,
    }));

    expect(migrated.activeLayout?.rightSidebar?.visible).toBe(false);
  });

  it('sets layoutMigrationDone=true', () => {
    const migrated = migrateV1Layout(settingsFixture());

    expect(migrated.layoutMigrationDone).toBe(true);
  });

  it('seeds BUILTIN_LAYOUTS into workspaceLayouts', () => {
    const migrated = migrateV1Layout(settingsFixture());

    expect(migrated.workspaceLayouts).toEqual(BUILTIN_LAYOUTS);
    expect(migrated.workspaceLayouts?.length).toBeGreaterThan(0);
  });

  it('preserves existing rightSidebarPanels when provided', () => {
    const panels = [{ id: 'writing-assistant' as SidebarPanelId, collapsed: false }];
    const migrated = migrateV1Layout(settingsFixture({
      rightSidebarPanels: panels,
    }));

    expect(migrated.activeLayout?.rightSidebar?.panels).toEqual(panels);
  });
});
