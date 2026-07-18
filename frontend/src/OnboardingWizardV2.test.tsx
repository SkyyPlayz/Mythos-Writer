// Beta 3 M25 — Welcome wizard v2 (prototype welcome/onboarding, HTML 2779–2855).
// Covers the prototype restyle surfaces (brand header, Recommended chip) and the
// guided-setup genre + theme steps: location → template → genre → neon theme,
// finishing with the picked preset applied through the real Liquid Neon v2
// engine and persisted on the completed settings.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import OnboardingWizard from './OnboardingWizard';
import { LIQUID_NEON_PRESETS } from './theme/presets';
import { resetLiquidNeonV2Tokens } from './theme/liquidNeonEngine';

const BASE_SETTINGS: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: {
      enabled: true,
      model: 'claude-sonnet-4-6',
      scanIntervalSeconds: 30,
      autoApply: false,
      confidenceThreshold: 0.8,
      maxTokensPerHour: 10000,
      maxSuggestionsPerHour: 20,
      heartbeatIntervalMinutes: 5,
      maxTokensPerDay: 100000,
    },
    brainstorm: {
      enabled: true,
      model: 'claude-sonnet-4-6',
      autoApply: false,
      confidenceThreshold: 0.8,
      maxTokensPerHour: 10000,
      maxSuggestionsPerHour: 20,
      heartbeatIntervalMinutes: 5,
      maxTokensPerDay: 100000,
    },
    archive: {
      enabled: true,
      model: 'claude-sonnet-4-6',
      continuityCheckIntervalSeconds: 60,
      autoApply: false,
      confidenceThreshold: 0.8,
      maxTokensPerHour: 10000,
      maxSuggestionsPerHour: 20,
      heartbeatIntervalMinutes: 5,
      maxTokensPerDay: 100000,
    },
  },
  theme: 'dark',
};

/** Promise-like that resolves synchronously inside the calling effect (matches
 *  the pattern used by OnboardingWizard.test.tsx for effect-time IPC). */
function resolvedInEffect<T>(value: T): Promise<T> {
  return {
    then(onFulfilled?: (resolvedValue: T) => unknown) {
      onFulfilled?.(value);
      return { catch: () => undefined };
    },
  } as unknown as Promise<T>;
}

function makeApi() {
  return {
    onboardingComplete: vi.fn().mockResolvedValue({ ok: true, firstSceneId: 'scene-1', firstScenePath: 'Manuscript/Chapter 1/chapter-1-scene-1.md' }),
    validatePath: vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true }),
    chooseVaultFolder: vi.fn().mockResolvedValue({ path: '/home/user/Stories', cancelled: false }),
    templateList: vi.fn().mockResolvedValue({ templates: [] }),
    templateRename: vi.fn().mockResolvedValue({ ok: true }),
    templateDelete: vi.fn().mockResolvedValue({ ok: true }),
    templateDuplicate: vi.fn().mockResolvedValue({ ok: true, id: 'user:copy' }),
    vaultGetPaths: vi.fn(() => resolvedInEffect({ homeDir: '/home/user', pathSeparator: '/' as const })),
    vaultGetSystemPaths: vi.fn(() => resolvedInEffect({
      homeDir: '/home/user',
      documentsDir: '/home/user/Documents',
      desktopDir: '/home/user/Desktop',
      oneDriveDir: null,
      iCloudDir: null,
    })),
    // Fresh on-disk settings AFTER onboarding:complete wrote its main-side
    // fields — the guided persist must patch over these, not clobber them.
    settingsGet: vi.fn().mockResolvedValue({
      ...BASE_SETTINGS,
      onboardingComplete: true,
      onboardingStartMode: 'blank',
      firstLaunchAt: '2026-07-07T00:00:00.000Z',
      gettingStartedProgress: { completedItems: [], dismissed: false },
    }),
    settingsSet: vi.fn().mockResolvedValue({ saved: true }),
    importDocxToStoryVault: vi.fn().mockResolvedValue({ ok: true, importedStories: [], errors: [] }),
    dryRunObsidianImport: vi.fn().mockResolvedValue({ preview: null }),
    importObsidianVault: vi.fn().mockResolvedValue({ ok: true }),
    onObsidianImportProgress: vi.fn().mockReturnValue(() => {}),
  };
}

let mockApi: ReturnType<typeof makeApi>;

beforeEach(() => {
  mockApi = makeApi();
  (window as unknown as { api: unknown }).api = mockApi;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
});

afterEach(() => {
  // The guided finish applies engine tokens to <html> and mounts a body-level
  // toast — clear both so tests stay isolated.
  resetLiquidNeonV2Tokens();
  document.querySelectorAll('[data-testid="ln-toast"]').forEach((el) => el.remove());
  vi.unstubAllGlobals();
});

async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderWizard(ui: ReactElement) {
  const result = render(ui);
  await flushAsyncEffects();
  return result;
}

async function click(testId: string) {
  fireEvent.click(screen.getByTestId(testId));
  await flushAsyncEffects();
}

const WIZARD_GENRES = [
  'Epic Fantasy', 'Dark Fantasy', 'Sci-Fi', 'Urban Fantasy',
  'Thriller', 'Romance', 'Literary', 'Historical',
];

// ─── Prototype restyle surfaces ───────────────────────────────────────────────

describe('OnboardingWizard v2 — prototype restyle (Beta 3 M25)', () => {
  it('renders the brand header (logo, name, tagline) above every step', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    const brand = screen.getByTestId('gs-brand');
    expect(brand).toBeInTheDocument();
    expect(brand.querySelector('img.gs-brand__logo')).not.toBeNull();
    expect(screen.getByText('Write the world before you write the book.')).toBeInTheDocument();
    await act(async () => {});
  });

  it('brand header persists on later steps (step-import)', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    expect(screen.getByTestId('gs-brand')).toBeInTheDocument();
    await act(async () => {});
  });

  it('Start Fresh card carries the prototype Recommended chip; step1 has exactly 4 cards (M29)', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    const startFresh = screen.getByTestId('card-start-fresh');
    expect(startFresh.querySelector('.gs-card__chip')).toHaveTextContent('Recommended');
    // M29: 4 top-level cards (start fresh / template / import / quick start)
    expect(screen.getAllByRole('button').filter((b) => b.dataset.testid?.startsWith('card-'))).toHaveLength(4);
    await act(async () => {});
  });

  it('ports the prototype welcome scrim and glass panel values into the CSS', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/OnboardingWizard.css'), 'utf-8');
    // Overlay: rgba(5,7,13,.72) scrim + 14px blur (prototype HTML 2781)
    expect(css).toMatch(/\.gs-overlay\s*\{[^}]*rgb\(5 7 13 \/ 0\.72\)/);
    expect(css).toMatch(/\.gs-overlay\s*\{[^}]*backdrop-filter: blur\(14px\)/);
    // Step panel: 18px radius + slot-1 glow (prototype HTML 2802)
    expect(css).toMatch(/\.gs-modal\s*\{[^}]*border-radius: 18px/);
    expect(css).toMatch(/\.gs-modal\s*\{[^}]*0 0 30px -8px var\(--g1\)/);
    // Path card: 16px radius + hover lift (prototype HTML 2789)
    expect(css).toMatch(/\.gs-card\s*\{[^}]*border-radius: 16px/);
    expect(css).toMatch(/\.gs-card:hover\s*\{[^}]*translateY\(-3px\)/);
    // SKY-7473 (M29 §7): Comfortable-tier --space-* pinned on the overlay so a
    // density=compact/cozy pick from a prior session can never shrink the
    // first-run/replay wizard when "Replay onboarding" reloads mid-document.
    expect(css).toMatch(/\.gs-overlay\s*\{[^}]*--space-4:\s*16px/);
    expect(css).toMatch(/\.gs-overlay\s*\{[^}]*--space-5:\s*20px/);
  });
});

// ─── Guided setup: navigation ─────────────────────────────────────────────────

describe('OnboardingWizard v2 — guided setup navigation (Beta 3 M25)', () => {
  it('step1 offers a Start Fresh card that opens the custom-location step (M29)', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await click('card-start-fresh');
    expect(screen.getByTestId('screen-custom-location')).toBeInTheDocument();
    expect(screen.getByText('Start Fresh · 1 of 4')).toBeInTheDocument();
  });

  it('shows 4 progress dots with the current step filled', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-genre" />,
    );
    const dots = screen.getByTestId('wiz-dots');
    expect(dots.querySelectorAll('.wiz-dot')).toHaveLength(4);
    expect(dots.querySelectorAll('.wiz-dot--on')).toHaveLength(3);
    await act(async () => {});
  });

  it('template step: Continue advances to the genre step; Back returns to template', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-template" />,
    );
    await click('custom-template-continue');
    expect(screen.getByTestId('screen-custom-genre')).toBeInTheDocument();
    expect(screen.getByText('Start Fresh · 3 of 4')).toBeInTheDocument();
    await click('custom-genre-back');
    expect(screen.getByTestId('screen-custom-template')).toBeInTheDocument();
  });

  it('genre step: Continue advances to the theme step; Back returns to genre', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-genre" />,
    );
    await click('custom-genre-continue');
    expect(screen.getByTestId('screen-custom-theme')).toBeInTheDocument();
    expect(screen.getByText('Start Fresh · 4 of 4')).toBeInTheDocument();
    await click('custom-theme-back');
    expect(screen.getByTestId('screen-custom-genre')).toBeInTheDocument();
  });

  it('Escape on the genre and theme steps opens the cancel confirm', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-genre" />,
    );
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('gs-keep-going'));
    await click('custom-genre-continue');
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    await act(async () => {});
  });
});

// ─── Guided setup: genre step ─────────────────────────────────────────────────

describe('OnboardingWizard v2 — genre step (Beta 3 M25)', () => {
  it('renders the 8 prototype genre presets with Epic Fantasy selected by default', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-genre" />,
    );
    const grid = screen.getByTestId('wiz-genre-grid');
    const chips = grid.querySelectorAll('[role="radio"]');
    expect(chips).toHaveLength(8);
    for (const genre of WIZARD_GENRES) {
      expect(screen.getByText(genre)).toBeInTheDocument();
    }
    expect(screen.getByTestId('wiz-genre-epic-fantasy')).toHaveAttribute('aria-checked', 'true');
    await act(async () => {});
  });

  it('clicking a genre chip selects it and deselects the previous one', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-genre" />,
    );
    await click('wiz-genre-dark-fantasy');
    expect(screen.getByTestId('wiz-genre-dark-fantasy')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('wiz-genre-epic-fantasy')).toHaveAttribute('aria-checked', 'false');
  });
});

// ─── Guided setup: theme step ─────────────────────────────────────────────────

describe('OnboardingWizard v2 — theme step (Beta 3 M25 / M29 SKY-7473)', () => {
  it('renders all 10 Liquid Neon presets from the real preset engine', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-theme" />,
    );
    // Names come from LIQUID_NEON_PRESETS — the M2 preset engine, not copies.
    for (const key of Object.keys(LIQUID_NEON_PRESETS) as Array<keyof typeof LIQUID_NEON_PRESETS>) {
      expect(screen.getByTestId(`wiz-theme-${key}`)).toBeInTheDocument();
      expect(screen.getByText(LIQUID_NEON_PRESETS[key].name)).toBeInTheDocument();
    }
    expect(screen.getByTestId('wiz-theme-classic')).toHaveAttribute('aria-checked', 'true');
    // Each card carries a 6-segment colour strip, one solid block per preset slot.
    // jsdom normalizes inline hex colors to rgb() — round-trip the expected
    // value through a probe element so the comparison isn't format-sensitive.
    const probe = document.createElement('span');
    const toRgb = (hex: string) => { probe.style.background = hex; return probe.style.background; };
    const segs = screen.getByTestId('wiz-theme-cyber-strip').querySelectorAll('.wiz-theme-strip__seg');
    expect(segs).toHaveLength(6);
    segs.forEach((seg, i) => {
      expect((seg as HTMLElement).style.background).toBe(toRgb(LIQUID_NEON_PRESETS.cyber.c[i]));
    });
    // Selected card shows a redundant checkmark (not colour alone — WCAG).
    expect(screen.getByTestId('wiz-theme-classic').querySelector('.wiz-theme-card__check')).toBeInTheDocument();
    expect(screen.getByTestId('wiz-theme-cyber').querySelector('.wiz-theme-card__check')).not.toBeInTheDocument();
    await act(async () => {});
  });

  it('selecting a theme card updates the radio state', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-theme" />,
    );
    await click('wiz-theme-cyber');
    expect(screen.getByTestId('wiz-theme-cyber')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('wiz-theme-classic')).toHaveAttribute('aria-checked', 'false');
  });
});

// ─── Guided setup: finish + persistence ───────────────────────────────────────

describe('OnboardingWizard v2 — guided finish persists genre + theme (Beta 3 M25)', () => {
  type OnCompleteMock = ReturnType<typeof vi.fn<(settings: AppSettings) => void>>;

  async function runGuidedFlow(onComplete: OnCompleteMock) {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} _testInitialStep="custom-template" />,
    );
    await click('custom-template-continue');
    await click('wiz-genre-dark-fantasy');
    await click('custom-genre-continue');
    await click('wiz-theme-cyber');
    await click('custom-theme-finish');
  }

  it('"Open my vault ✦" completes onboarding with the custom-vault payload', async () => {
    const onComplete = vi.fn<(settings: AppSettings) => void>();
    await runGuidedFlow(onComplete);
    expect(mockApi.onboardingComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: 'start-fresh',
        customTemplate: 'recommended',
        vaultName: 'MythosWriter',
      }),
    );
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('completed settings carry liquidNeonV2 (picked preset) + onboardingGenre', async () => {
    const onComplete = vi.fn<(settings: AppSettings) => void>();
    await runGuidedFlow(onComplete);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const settings = onComplete.mock.calls[0][0] as AppSettings;
    expect(settings.onboardingComplete).toBe(true);
    expect(settings.onboardingGenre).toBe('Dark Fantasy');
    expect(settings.liquidNeonV2?.setKey).toBe('cyber');
    expect(settings.liquidNeonV2?.slots).toEqual([...LIQUID_NEON_PRESETS.cyber.c]);
  });

  it('persists genre + theme as a patch over the fresh on-disk settings', async () => {
    const onComplete = vi.fn<(settings: AppSettings) => void>();
    await runGuidedFlow(onComplete);
    await waitFor(() => expect(mockApi.settingsSet).toHaveBeenCalled());
    const persisted = mockApi.settingsSet.mock.calls[0][0] as AppSettings;
    expect(persisted.liquidNeonV2?.setKey).toBe('cyber');
    expect(persisted.onboardingGenre).toBe('Dark Fantasy');
    // Main-side fields written by onboarding:complete must survive the persist.
    expect(persisted.firstLaunchAt).toBe('2026-07-07T00:00:00.000Z');
    expect(persisted.gettingStartedProgress).toEqual({ completedItems: [], dismissed: false });
  });

  it('applies the picked preset through the Liquid Neon v2 engine immediately', async () => {
    const onComplete = vi.fn<(settings: AppSettings) => void>();
    await runGuidedFlow(onComplete);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // applyLiquidNeonV2Tokens writes the slot tokens onto <html>.
    expect(document.documentElement.style.getPropertyValue('--n1')).toBe(LIQUID_NEON_PRESETS.cyber.c[0]);
  });

  it('shows the prototype "Vault ready" toast on finish', async () => {
    const onComplete = vi.fn<(settings: AppSettings) => void>();
    await runGuidedFlow(onComplete);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(document.querySelector('[data-testid="ln-toast"]')?.textContent).toContain('Vault ready');
  });

  it('Try Again after a failed guided finish keeps the personalization', async () => {
    mockApi.onboardingComplete = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'Disk full' })
      .mockResolvedValueOnce({ ok: true, firstSceneId: 'scene-1', firstScenePath: 'Manuscript/s1.md' });
    const onComplete = vi.fn<(settings: AppSettings) => void>();
    await runGuidedFlow(onComplete);
    await waitFor(() => expect(screen.getByTestId('gs-try-again')).toBeInTheDocument());
    await click('gs-try-again');
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const settings = onComplete.mock.calls[0][0] as AppSettings;
    expect(settings.liquidNeonV2?.setKey).toBe('cyber');
    expect(settings.onboardingGenre).toBe('Dark Fantasy');
  });

  it('skip path (custom-template-finish) completes WITHOUT genre/theme personalization', async () => {
    const onComplete = vi.fn<(settings: AppSettings) => void>();
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} _testInitialStep="custom-template" />,
    );
    await click('custom-template-finish');
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const settings = onComplete.mock.calls[0][0] as AppSettings;
    expect(settings.onboardingComplete).toBe(true);
    expect(settings.liquidNeonV2).toBeUndefined();
    expect(settings.onboardingGenre).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--n1')).toBe('');
  });
});
