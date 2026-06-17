import { describe, expect, it } from 'vitest';
import { migrateV1Layout } from './WorkspaceLayoutManager';

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
});
