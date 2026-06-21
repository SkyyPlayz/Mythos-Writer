import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import OnboardingWizard from './OnboardingWizard';

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

const BUNDLED_TEMPLATES = [
  { id: 'bundled:novel-3act', name: 'Novel (3-Act)', description: 'Three-act structure with chapter folders and scene notes.', story: [], notes: [], isUserTemplate: false },
  { id: 'bundled:short-story', name: 'Short Story', description: 'Focused single-arc with one POV, clean scene list.', story: [], notes: [], isUserTemplate: false },
  { id: 'bundled:worldbuilding-bible', name: 'World-building Bible', description: 'Lore, maps, factions, and character sheets.', story: [], notes: [], isUserTemplate: false },
  { id: 'bundled:series-bible', name: 'Series Bible', description: 'Multi-book structure with shared canon notes.', story: [], notes: [], isUserTemplate: false },
];

function resolvedInEffect<T>(value: T): Promise<T> {
  return {
    then(onFulfilled?: (resolvedValue: T) => unknown) {
      onFulfilled?.(value);
      return { catch: () => undefined };
    },
  } as unknown as Promise<T>;
}

function makeApi(overrides: Partial<{
  onboardingComplete: ReturnType<typeof vi.fn>;
  validatePath: ReturnType<typeof vi.fn>;
  chooseVaultFolder: ReturnType<typeof vi.fn>;
  templateList: ReturnType<typeof vi.fn>;
  templateRename: ReturnType<typeof vi.fn>;
  templateDelete: ReturnType<typeof vi.fn>;
  templateDuplicate: ReturnType<typeof vi.fn>;
  vaultGetPaths: ReturnType<typeof vi.fn>;
  vaultGetSystemPaths: ReturnType<typeof vi.fn>;
  settingsSet: ReturnType<typeof vi.fn>;
  importDocxToStoryVault: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    onboardingComplete: overrides.onboardingComplete ?? vi.fn().mockResolvedValue({ ok: true, firstSceneId: 'scene-1', firstScenePath: 'Manuscript/Chapter 1/chapter-1-scene-1.md' }),
    validatePath: overrides.validatePath ?? vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true }),
    chooseVaultFolder: overrides.chooseVaultFolder ?? vi.fn().mockResolvedValue({ path: '/home/user/Stories', cancelled: false }),
    templateList: overrides.templateList ?? vi.fn().mockResolvedValue({ templates: BUNDLED_TEMPLATES }),
    templateRename: overrides.templateRename ?? vi.fn().mockResolvedValue({ ok: true }),
    templateDelete: overrides.templateDelete ?? vi.fn().mockResolvedValue({ ok: true }),
    templateDuplicate: overrides.templateDuplicate ?? vi.fn().mockResolvedValue({ ok: true, id: 'user:copy' }),
    vaultGetPaths: overrides.vaultGetPaths ?? vi.fn(() => resolvedInEffect({ homeDir: '/home/user', pathSeparator: '/' })),
    vaultGetSystemPaths: overrides.vaultGetSystemPaths ?? vi.fn(() => resolvedInEffect({
      homeDir: '/home/user',
      documentsDir: '/home/user/Documents',
      desktopDir: '/home/user/Desktop',
      oneDriveDir: null,
      iCloudDir: null,
    })),
    settingsSet: overrides.settingsSet ?? vi.fn().mockResolvedValue({ saved: true }),
    importDocxToStoryVault: overrides.importDocxToStoryVault ?? vi.fn().mockResolvedValue({ ok: true, importedStories: [], errors: [] }),
  };
}

let mockApi: ReturnType<typeof makeApi>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

const BUNDLED_TEMPLATE = { id: 'bundled:novel-3act', name: 'Novel (3-Act)', description: 'Three-act novel', story: [{ name: 'Manuscript' }], notes: [{ name: 'Characters' }] };
const USER_TEMPLATE    = { id: 'user:my-template',  name: 'My Template',   description: 'My saved template', story: [], notes: [], isUserTemplate: true, savedAt: '2026-06-01' };

beforeEach(() => {
  mockApi = makeApi();
  (window as unknown as { api: unknown }).api = mockApi;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const actWarnings = consoleErrorSpy.mock.calls.filter((call: unknown[]) => {
    const [message] = call;
    return typeof message === 'string' && message.includes('not wrapped in act');
  });
  try {
    expect(actWarnings).toEqual([]);
  } finally {
    consoleErrorSpy.mockRestore();
  }
});

async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderWizard(ui: ReactElement) {
  const result = render(ui);
  await flushAsyncEffects();
  return result;
}

async function openCustomOptions() {
  fireEvent.click(screen.getByTestId('card-custom'));
  await flushAsyncEffects();
}

async function openBlankFlow() {
  await openCustomOptions();
  fireEvent.click(screen.getByTestId('card-blank'));
  await flushAsyncEffects();
}

async function openSampleFlow() {
  await openCustomOptions();
  fireEvent.click(screen.getByTestId('card-sample'));
  await flushAsyncEffects();
}

async function openTemplateGallery() {
  await openCustomOptions();
  fireEvent.click(screen.getByTestId('card-template'));
  await flushAsyncEffects();
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────

function readOnboardingCss() {
  return readFileSync(resolve(process.cwd(), 'src/OnboardingWizard.css'), 'utf-8');
}

function cssRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, 'm'));
  return match?.groups?.body ?? '';
}

function assertNoLiteralColorFallbacks(css: string) {
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(css).not.toMatch(/rgba?\(/i);
  expect(css).not.toMatch(/hsla?\(/i);
}

describe('OnboardingWizard — Step 1', () => {
  it('keeps starting point cards on Liquid Neon tokens without literal color fallbacks', () => {
    const css = readOnboardingCss();
    const cardRule = cssRule(css, '.gs-card');
    const hoverRule = cssRule(css, '.gs-card:hover');
    const focusRule = cssRule(css, '.gs-card:focus-visible');
    const titleRule = cssRule(css, '.gs-card__title');
    const descRule = cssRule(css, '.gs-card__desc');
    const ctaRule = cssRule(css, '.gs-card__cta');
    const cardStyles = [cardRule, hoverRule, focusRule, titleRule, descRule, ctaRule].join('\n');

    // Base card: elevated surface + subtle border + body text
    expect(cardRule).toContain('var(--bg-elevated)');
    expect(cardRule).toContain('var(--border-subtle)');
    expect(cardRule).toContain('var(--text-body)');
    // Hover: neon glow frame
    expect(hoverRule).toContain('var(--accent)');
    expect(hoverRule).toContain('var(--glow-md)');
    // Focus: focus-ring token
    expect(focusRule).toContain('var(--focus-ring)');
    // Typography hierarchy
    expect(titleRule).toContain('var(--text-header)');
    expect(descRule).toContain('var(--text-muted)');
    expect(ctaRule).toContain('var(--accent)');
    // No raw hex / rgba / hsl in any card rule
    assertNoLiteralColorFallbacks(cardStyles);
  });

  it('turns off card transitions and press transforms for reduced motion users', () => {
    const css = readOnboardingCss();

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.gs-card\s*\{[\s\S]*transition:\s*none/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.gs-card:active\s*\{[\s\S]*transform:\s*none/);
  });

  it('renders Step 1 with correct heading and subtitle', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
    expect(screen.getByText('Welcome to Mythos Writer')).toBeInTheDocument();
    expect(screen.getByText('How would you like to begin?')).toBeInTheDocument();
    await act(async () => {});
  });

  it('shows step indicator "Step 1 of 3"', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    await act(async () => {});
  });

  it('shows three top-level starting-point cards (SKY-2987 3-path spec)', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('card-quick-start')).toBeInTheDocument();
    expect(screen.getByTestId('card-custom')).toBeInTheDocument();
    expect(screen.getByTestId('card-import')).toBeInTheDocument();
    expect(screen.queryByTestId('card-blank')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-create-custom')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-open-existing')).not.toBeInTheDocument();
    await act(async () => {});
  });

  it('card labels match SKY-2970 spec copy (3-path redesign)', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('card-quick-start')).toHaveTextContent('Quick Start');
    expect(screen.getByTestId('card-custom')).toHaveTextContent('Custom');
    expect(screen.getByTestId('card-import')).toHaveTextContent('Import / Open Existing');
    await act(async () => {});
  });

  it('AC-L-05: first card (Quick Start) receives focus when Step 1 mounts', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByTestId('card-quick-start'));
    await act(async () => {});
  });

  it('AC-L-07: "Restart an existing project?" link is present on Step 1', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('gs-restart-link')).toBeInTheDocument();
    expect(screen.getByTestId('gs-restart-link').textContent).toMatch(/Restart an existing project/);
    await act(async () => {});
  });

  it('AC-L-08: "Learn more" link is present on Step 1', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('gs-learn-more')).toBeInTheDocument();
    expect(screen.getByTestId('gs-learn-more').textContent).toMatch(/Learn more/);
    await act(async () => {});
  });

  it('AC-L-01: Import card has secondary CSS modifier for visual distinction', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('card-import')).toHaveClass('gs-card--secondary');
    expect(screen.getByTestId('card-quick-start')).not.toHaveClass('gs-card--secondary');
    expect(screen.getByTestId('card-custom')).not.toHaveClass('gs-card--secondary');
    await act(async () => {});
  });

  // SKY-2220: one-click Quick Start bypasses step2 (no title, no save path picker).
  it('clicking Quick Start calls onboardingComplete with startMode=quick-start and bypasses Step 2', async () => {
    const onComplete = vi.fn();
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-quick-start'));
    await waitFor(() =>
      expect(mockApi.onboardingComplete).toHaveBeenCalledWith({ startMode: 'quick-start' }),
    );
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingComplete: true,
        lastOpenedScene: expect.objectContaining({ sceneId: 'scene-1' }),
      }),
    );
    // No detour through step2/step1b — we go straight to step3 (scaffolding) and exit.
    expect(screen.queryByTestId('screen-step2')).not.toBeInTheDocument();
  });

  it('shows scaffold error UI when Quick Start vault creation fails', async () => {
    mockApi = makeApi({
      onboardingComplete: vi.fn().mockResolvedValue({ ok: false, error: 'Disk full' }),
    });
    (window as unknown as { api: unknown }).api = mockApi;
    const onComplete = vi.fn();
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-quick-start'));
    await waitFor(() => expect(screen.getByTestId('gs-scaffold-error')).toBeInTheDocument());
    expect(screen.getByTestId('gs-scaffold-error').textContent).toContain('Disk full');
    expect(onComplete).not.toHaveBeenCalled();
    // The retry affordances surface so the user isn't stranded on step3.
    expect(screen.getByTestId('gs-try-again')).toBeInTheDocument();
  });

  it('Import card navigates to the import / open screen (SKY-2990)', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    await waitFor(() => expect(screen.getByTestId('screen-step-import')).toBeInTheDocument());
    expect(screen.queryByTestId('screen-step1')).not.toBeInTheDocument();
    expect(mockApi.chooseVaultFolder).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('"Restart an existing project?" link navigates to the import / open screen (SKY-2990)', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gs-restart-link'));
    await waitFor(() => expect(screen.getByTestId('screen-step-import')).toBeInTheDocument());
    expect(mockApi.chooseVaultFolder).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('Create Custom shows Blank Slate, Sample Project, and From Template choices', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openCustomOptions();
    expect(screen.getByTestId('screen-step1b-options')).toBeInTheDocument();
    expect(screen.getByTestId('card-blank')).toHaveTextContent('Blank Slate');
    expect(screen.getByTestId('card-sample')).toHaveTextContent('Sample Project');
    expect(screen.getByTestId('card-template')).toHaveTextContent('From Template');
  });

  it('Skip link is removed from Step 1 (replaced by Restart + Learn more — SKY-2987)', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.queryByTestId('gs-skip')).not.toBeInTheDocument();
    await act(async () => {});
  });

  it('Create Custom → Blank Slate advances to Step 2', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openBlankFlow();
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
    await act(async () => {});
  });

  it('Create Custom → Sample Project advances to Step 1c (genre picker)', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openSampleFlow();
    expect(screen.getByTestId('screen-step1c')).toBeInTheDocument();
    await act(async () => {});
  });

  it('Create Custom → From Template advances to the template gallery', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    expect(screen.getByTestId('screen-step1b')).toBeInTheDocument();
    // Flush the async templateList() call that fires when step1b mounts
    await act(async () => {});
  });

  /* Skip button removed from landing screen in SKY-2987 — AC-L-07/L-08 replace it */

  it('Escape on Step 1 shows cancel confirm dialog', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    await act(async () => {});
  });

  it('close button on Step 1 shows cancel confirm dialog', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gs-close-btn-step1'));
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    await act(async () => {});
  });
});

// ─── Cancel confirm dialog ────────────────────────────────────────────────────

describe('OnboardingWizard — Cancel confirm dialog', () => {
  it('"Keep Going" dismisses dialog and returns to wizard', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('gs-keep-going'));
    expect(screen.queryByTestId('gs-cancel-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
    await act(async () => {});
  });

  it('"Cancel Setup" calls onCancel without calling onboardingComplete', async () => {
    const onCancel = vi.fn();
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('gs-cancel-setup'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockApi.onboardingComplete).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('dialog copy matches spec exactly', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByText('Cancel setup?')).toBeInTheDocument();
    expect(screen.getByText(/Your story hasn't been created yet/)).toBeInTheDocument();
    expect(screen.getByText(/If you close now, you'll start fresh next time/)).toBeInTheDocument();
    expect(screen.getByTestId('gs-keep-going')).toHaveTextContent('Keep Going');
    expect(screen.getByTestId('gs-cancel-setup')).toHaveTextContent('Cancel Setup');
    await act(async () => {});
  });
});

// ─── Step 1b: Template sub-picker ─────────────────────────────────────────────

describe('OnboardingWizard — Step 1b (template picker)', () => {
  it('shows "Choose a template" heading', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByText('Choose a template')).toBeInTheDocument());
  });

  it('loads and displays bundled template cards', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByText('Novel (3-Act)')).toBeInTheDocument());
    expect(screen.getByText('Short Story')).toBeInTheDocument();
    expect(screen.getByText('World-building Bible')).toBeInTheDocument();
    expect(screen.getByText('Series Bible')).toBeInTheDocument();
  });

  it('shows "Use this →" CTA on each template card', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getAllByText(/Use this/)).toHaveLength(4));
  });

  it('Back button returns to the custom-options step', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('gs-back-step1b'));
    fireEvent.click(screen.getByTestId('gs-back-step1b'));
    expect(screen.getByTestId('screen-step1b-options')).toBeInTheDocument();
  });

  it('selecting a template card shows preview without navigating', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    expect(screen.getByTestId('screen-step1b')).toBeInTheDocument();
    expect(screen.getByTestId('template-preview')).toBeInTheDocument();
  });

  it('sr-only live region announces selected template name (F-13)', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    expect(screen.getByTestId('template-announcement')).toHaveTextContent(
      'Preview for Novel (3-Act) is ready below.'
    );
  });

  it('selected card has aria-checked=true, others false', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    expect(screen.getByTestId('template-card-bundled:novel-3act')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('template-card-bundled:short-story')).toHaveAttribute('aria-checked', 'false');
  });

  it('switching selection updates live region and aria-checked', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:short-story'));
    expect(screen.getByTestId('template-announcement')).toHaveTextContent(
      'Preview for Short Story is ready below.'
    );
    expect(screen.getByTestId('template-card-bundled:short-story')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('template-card-bundled:novel-3act')).toHaveAttribute('aria-checked', 'false');
  });

  it('confirming preview advances to Step 2', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    await waitFor(() => screen.getByTestId('template-use-btn'));
    fireEvent.click(screen.getByTestId('template-use-btn'));
    await flushAsyncEffects();
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
  });

  it('shows user templates under "Your Templates" section when present', async () => {
    const userTemplate = { id: 'user:my-template', name: 'My Template', description: 'Custom', story: [], notes: [], isUserTemplate: true };
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [...BUNDLED_TEMPLATES, userTemplate] });
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByText('Your Templates')).toBeInTheDocument());
    expect(screen.getByText('My Template')).toBeInTheDocument();
  });

  it('shows empty hint under "Your Templates" when no custom templates saved', async () => {
    // mockApi returns BUNDLED_TEMPLATES only — no isUserTemplate entries
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByText('Your Templates')).toBeInTheDocument());
    const hint = screen.getByTestId('template-empty-hint');
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent('No saved templates yet.');
    expect(hint).not.toHaveStyle('font-style: italic');
    const sub = screen.getByTestId('template-empty-hint-sub');
    expect(sub).toHaveTextContent('Settings');
    expect(sub).toHaveTextContent('Templates');
  });

  // SKY-1358: ARIA radiogroup/radio pattern — axe aria-allowed-role + aria-allowed-attr
  it('template grid has role="radiogroup" labelled by the heading', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    const heading = screen.getByRole('heading', { name: 'Choose a template' });
    expect(heading).toHaveAttribute('id', 'template-picker-heading');
    const group = screen.getByRole('radiogroup', { name: 'Choose a template' });
    expect(group).toBeInTheDocument();
  });

  it('each template card has role="radio" with aria-checked=false before selection', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(4);
    radios.forEach((radio) => {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('hides empty hint once a user template is present', async () => {
    const userTemplate = { id: 'user:my-template', name: 'My Template', description: 'Custom', story: [], notes: [], isUserTemplate: true };
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [...BUNDLED_TEMPLATES, userTemplate] });
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByTestId('template-card-user:my-template')).toBeInTheDocument());
    expect(screen.queryByTestId('template-empty-hint')).not.toBeInTheDocument();
  });

  // SKY-1358: user-template grid gets its own radiogroup role
  it('user-template radiogroup is labelled by "Your Templates" heading', async () => {
    const userTemplate = { id: 'user:my-template', name: 'My Template', description: 'Custom', story: [], notes: [], isUserTemplate: true };
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [...BUNDLED_TEMPLATES, userTemplate] });
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByText('Your Templates'));
    const groups = screen.getAllByRole('radiogroup');
    expect(groups.length).toBe(2);
    expect(groups[1]).toHaveAttribute('aria-labelledby', 'template-picker-user-heading');
  });

  // SKY-1360: F-06 — loading indicator with aria-live while templateList() is in flight
  it('shows loading status with role=status and aria-live=polite while fetching', async () => {
    let resolveList!: (v: { templates: typeof BUNDLED_TEMPLATES }) => void;
    mockApi.templateList = vi.fn().mockReturnValue(new Promise((res) => { resolveList = res; }));
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    const status = await waitFor(() => screen.getByRole('status'));
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.textContent).toMatch(/Loading templates/);
    // resolve the fetch so the test cleans up without act() warnings
    await act(async () => { resolveList({ templates: BUNDLED_TEMPLATES }); });
  });

  // SKY-1360: F-05 — empty-state message with role=status when list resolves to 0 items
  it('shows empty-state status with role=status and aria-live=polite when list is empty', async () => {
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [] });
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    const status = await waitFor(() => {
      const el = screen.getByRole('status');
      expect(el.textContent).toMatch(/No templates available/);
      return el;
    });
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  // SKY-1360: no empty-grid flash — grid is not shown before fetch completes
  it('does not render the radiogroup while loading is in progress', async () => {
    let resolveList!: (v: { templates: typeof BUNDLED_TEMPLATES }) => void;
    mockApi.templateList = vi.fn().mockReturnValue(new Promise((res) => { resolveList = res; }));
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByRole('status'));
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-card-bundled:novel-3act')).not.toBeInTheDocument();
    await act(async () => { resolveList({ templates: BUNDLED_TEMPLATES }); });
  });

  // SKY-1362: F-12 — Back arrow on step1b wrapped in aria-hidden so SR hears "Back, button"
  it('step1b Back button arrow glyph is wrapped in aria-hidden span', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('gs-back-step1b'));
    const backBtn = screen.getByTestId('gs-back-step1b');
    const arrowSpan = backBtn.querySelector('span[aria-hidden="true"]');
    expect(arrowSpan).toBeInTheDocument();
    expect(arrowSpan!.textContent).toBe('\u2190');
  });

  // SKY-1412 AC-6: Esc with a selection clears it; a second Esc shows the cancel confirm
  it('Escape with a template selected clears the selection and stays on step1b', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    expect(screen.getByTestId('template-card-bundled:novel-3act')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('template-card-bundled:novel-3act')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('gs-cancel-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen-step1b')).toBeInTheDocument();
  });

  it('Escape with no template selected shows cancel confirm on step1b', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    // no card selected — Escape should show cancel confirm
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
  });

  // SKY-1362: F-14 — Back from template-picker restores focus to the "From Template" card
  it('Back from template-picker restores focus to the card that triggered navigation', async () => {
    // Capture the rAF callback; fire it after React commits the custom-options DOM so the trigger exists.
    // React unmounts/remounts the options screen on transition, so the implementation does a querySelector
    // on data-testid to find the fresh element rather than using the stale captured ref.
    const rafRef = { current: null as ((time: number) => void) | null };
    vi.stubGlobal('requestAnimationFrame', (fn: (time: number) => void) => { rafRef.current = fn; return 0; });
    try {
      await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      await openCustomOptions();
      const templateCard = screen.getByTestId('card-template');
      templateCard.focus();
      fireEvent.click(templateCard);
      await waitFor(() => screen.getByTestId('gs-back-step1b'));
      await act(async () => { fireEvent.click(screen.getByTestId('gs-back-step1b')); });
      // React committed the custom-options step; fire rAF — implementation finds the fresh card-template
      expect(screen.getByTestId('screen-step1b-options')).toBeInTheDocument();
      rafRef.current?.(0);
      // Check focus on the freshly-mounted card-template element (NOT the stale pre-nav ref)
      expect(document.activeElement).toBe(screen.getByTestId('card-template'));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ─── Step 1c: Genre picker (SKY-2008) ─────────────────────────────────────────

describe('OnboardingWizard — Step 1c (genre picker)', () => {
  async function renderAtStep1c() {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openSampleFlow();
  }

  it('shows genre picker screen on Sample Novel click', async () => {
    await renderAtStep1c();
    expect(screen.getByTestId('screen-step1c')).toBeInTheDocument();
    expect(screen.getByText('Pick a sample world')).toBeInTheDocument();
    await act(async () => {});
  });

  it('renders all three genre cards in a radiogroup', async () => {
    await renderAtStep1c();
    expect(screen.getByTestId('genre-radiogroup')).toBeInTheDocument();
    expect(screen.getByTestId('genre-card-cozy-fantasy')).toBeInTheDocument();
    expect(screen.getByTestId('genre-card-sci-fi-noir')).toBeInTheDocument();
    expect(screen.getByTestId('genre-card-mystery')).toBeInTheDocument();
    await act(async () => {});
  });

  it('Start button is disabled until a genre is selected', async () => {
    await renderAtStep1c();
    expect(screen.getByTestId('genre-start-btn')).toBeDisabled();
    await act(async () => {});
  });

  it('selecting a genre enables Start button with genre title', async () => {
    await renderAtStep1c();
    fireEvent.click(screen.getByTestId('genre-card-mystery'));
    const startBtn = screen.getByTestId('genre-start-btn');
    expect(startBtn).not.toBeDisabled();
    expect(startBtn).toHaveTextContent('The Last Wednesday Club');
    await act(async () => {});
  });

  it('genre card shows aria-checked=true when selected', async () => {
    await renderAtStep1c();
    fireEvent.click(screen.getByTestId('genre-card-cozy-fantasy'));
    expect(screen.getByTestId('genre-card-cozy-fantasy')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('genre-card-sci-fi-noir')).toHaveAttribute('aria-checked', 'false');
    await act(async () => {});
  });

  it('accordion expands on toggle and collapses others', async () => {
    await renderAtStep1c();
    const cozyBtn = screen.getByTestId('genre-accordion-btn-cozy-fantasy');
    fireEvent.click(cozyBtn);
    expect(cozyBtn).toHaveAttribute('aria-expanded', 'true');
    // Opening sci-fi accordion should close cozy one
    fireEvent.click(screen.getByTestId('genre-accordion-btn-sci-fi-noir'));
    expect(cozyBtn).toHaveAttribute('aria-expanded', 'false');
    await act(async () => {});
  });

  it('Back button returns to step1 and resets genre selection', async () => {
    await renderAtStep1c();
    fireEvent.click(screen.getByTestId('genre-card-sci-fi-noir'));
    fireEvent.click(screen.getByTestId('gs-back-step1c'));
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
    // Re-entering step1c should have no selection
    await openSampleFlow();
    expect(screen.getByTestId('genre-start-btn')).toBeDisabled();
    await act(async () => {});
  });

  it('Start triggers step3 and calls onboardingComplete with sampleGenre', async () => {
    await renderAtStep1c();
    fireEvent.click(screen.getByTestId('genre-card-cozy-fantasy'));
    fireEvent.click(screen.getByTestId('genre-start-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-step3')).toBeInTheDocument());
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ startMode: 'sample', sampleGenre: 'cozy-fantasy' })
    ));
  });

  it('error on onboardingComplete shows error card on step1c', async () => {
    mockApi.onboardingComplete = vi.fn().mockResolvedValue({ ok: false, error: 'Bundle not found' });
    await renderAtStep1c();
    fireEvent.click(screen.getByTestId('genre-card-mystery'));
    fireEvent.click(screen.getByTestId('genre-start-btn'));
    await waitFor(() => expect(screen.getByTestId('genre-sample-error')).toBeInTheDocument());
    expect(screen.getByTestId('genre-sample-error')).toHaveTextContent('Bundle not found');
  });
});

// ─── Step 2: Name your story ──────────────────────────────────────────────────

describe('OnboardingWizard — Step 2', () => {
  async function renderAtStep2() {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openBlankFlow();
    await act(async () => {});
    return screen.getByTestId('screen-step2');
  }

  it('shows "What\'s your story called?" heading', async () => {
    await renderAtStep2();
    expect(screen.getByText("What's your story called?")).toBeInTheDocument();
  });

  it('shows step indicator "Step 2 of 3"', async () => {
    await renderAtStep2();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  });

  // SKY-1362: F-12 — step2 Back button arrow also wrapped in aria-hidden
  it('step2 Back button arrow glyph is wrapped in aria-hidden span', async () => {
    await renderAtStep2();
    const backBtn = screen.getByTestId('gs-back-step2');
    const arrowSpan = backBtn.querySelector('span[aria-hidden="true"]');
    expect(arrowSpan).toBeInTheDocument();
    expect(arrowSpan!.textContent).toBe('\u2190');
  });

  it('shows Story title field as required', async () => {
    await renderAtStep2();
    expect(screen.getByTestId('gs-title-input')).toBeInTheDocument();
    expect(screen.getByTestId('gs-title-input')).toHaveAttribute('aria-required', 'true');
  });

  it('shows Author name field (optional)', async () => {
    await renderAtStep2();
    expect(screen.getByTestId('gs-author-input')).toBeInTheDocument();
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
  });

  it('shows default save path ~/Documents/MythosWriter', async () => {
    await renderAtStep2();
    expect(screen.getByTestId('gs-save-path')).toHaveValue('~/Documents/MythosWriter');
  });

  it('shows "Browse…" button for save location', async () => {
    await renderAtStep2();
    expect(screen.getByTestId('gs-change-location')).toBeInTheDocument();
    expect(screen.getByTestId('gs-change-location').textContent).toMatch(/Browse/);
  });

  it('"Create Story →" button is present', async () => {
    await renderAtStep2();
    expect(screen.getByTestId('gs-create-story')).toBeInTheDocument();
  });

  it('Back button returns to the custom-options step', async () => {
    await renderAtStep2();
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    expect(screen.getByTestId('screen-step1b-options')).toBeInTheDocument();
  });

  it('Back from Step 2 (template path) returns to Step 1b', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    await waitFor(() => screen.getByTestId('template-use-btn'));
    fireEvent.click(screen.getByTestId('template-use-btn'));
    await flushAsyncEffects();
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    expect(screen.getByTestId('screen-step1b')).toBeInTheDocument();
    await act(async () => {});
  });

  it('title value is preserved when going back from Step 2', async () => {
    await renderAtStep2();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Saga' } });
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    await flushAsyncEffects();
    fireEvent.click(screen.getByTestId('card-blank'));
    await flushAsyncEffects();
    expect(screen.getByTestId('gs-title-input')).toHaveValue('My Saga');
  });
});

// ─── Step 2 validation ────────────────────────────────────────────────────────

describe('OnboardingWizard — Step 2 validation', () => {
  async function renderAtStep2() {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openBlankFlow();
  }

  it('empty title on submit shows exact error copy', async () => {
    await renderAtStep2();
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await flushAsyncEffects();
    await waitFor(() => expect(screen.getByTestId('gs-title-error')).toBeInTheDocument());
    expect(screen.getByTestId('gs-title-error').textContent).toBe(
      'Please give your story a title before continuing.'
    );
  });

  it('empty title on blur shows error', async () => {
    await renderAtStep2();
    const input = screen.getByTestId('gs-title-input');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByTestId('gs-title-error')).toBeInTheDocument());
  });

  it.each(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])(
    'invalid char "%s" in title shows exact error copy',
    async (char) => {
      await renderAtStep2();
      const input = screen.getByTestId('gs-title-input');
      fireEvent.change(input, { target: { value: `My${char}Story` } });
      fireEvent.blur(input);
      await waitFor(() => expect(screen.getByTestId('gs-title-error')).toBeInTheDocument());
      expect(screen.getByTestId('gs-title-error').textContent).toContain(
        "Story titles can't contain these characters:"
      );
    }
  );

  it('title conflict shows conflict error and blocks advancement', async () => {
    mockApi.validatePath = vi.fn()
      .mockResolvedValueOnce({ exists: true, isEmpty: true, writable: true }) // save path check
      .mockResolvedValueOnce({ exists: true, isEmpty: false, writable: true }); // story dir conflict
    await renderAtStep2();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'Existing Story' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await flushAsyncEffects();
    await waitFor(() => expect(screen.getByTestId('gs-title-error')).toBeInTheDocument());
    expect(screen.getByTestId('gs-title-error').textContent).toContain('already exists in that folder');
    expect(screen.queryByTestId('screen-step3')).not.toBeInTheDocument();
  });

  it('unwritable path shows path error', async () => {
    mockApi.validatePath = vi.fn().mockResolvedValue({ exists: true, isEmpty: false, writable: false });
    await renderAtStep2();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Story' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(screen.getByTestId('gs-path-error')).toBeInTheDocument());
    expect(screen.getByTestId('gs-path-error').textContent).toBe(
      "Can't save to that folder. Please choose a different location."
    );
  });

  it('"Browse…" updates save path display with tilde-prefixed value', async () => {
    await renderAtStep2();
    fireEvent.click(screen.getByTestId('gs-change-location'));
    await waitFor(() => expect(screen.getByTestId('gs-save-path')).toHaveValue('~/Stories'));
  });

  it('"Browse…" shows full tilde path in input (no truncation)', async () => {
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({
      path: '/home/user/Mythos/Vaults/Long Fantasy Saga With Many Books/Story Vault',
      cancelled: false,
    });

    await renderAtStep2();
    fireEvent.click(screen.getByTestId('gs-change-location'));

    await waitFor(() =>
      expect(screen.getByTestId('gs-save-path')).toHaveValue(
        '~/Mythos/Vaults/Long Fantasy Saga With Many Books/Story Vault',
      )
    );
  });

  it('"Browse…" cancelled keeps previous path', async () => {
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({ path: null, cancelled: true });
    await renderAtStep2();
    const pathBefore = (screen.getByTestId('gs-save-path') as HTMLInputElement).value;
    fireEvent.click(screen.getByTestId('gs-change-location'));
    await waitFor(() => {}); // wait for async
    expect(screen.getByTestId('gs-save-path')).toHaveValue(pathBefore);
  });
});

// ─── Step 2 → Step 3 submission ───────────────────────────────────────────────

describe('OnboardingWizard — Step 2 → Step 3', () => {
  it('valid submission advances to Step 3 (spinner shown)', async () => {
    mockApi.onboardingComplete = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100))
    );
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(screen.getByTestId('screen-step3')).toBeInTheDocument());
    expect(screen.getByTestId('gs-spinner')).toBeInTheDocument();
  });

  it('Step 3 close button is disabled during scaffolding (Escape does nothing)', async () => {
    mockApi.onboardingComplete = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 500))
    );
    const onCancel = vi.fn();
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} onCancel={onCancel} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => screen.getByTestId('screen-step3'));
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gs-cancel-confirm')).not.toBeInTheDocument();
  });

  it('successful scaffold calls onComplete with onboardingComplete=true', async () => {
    const onComplete = vi.fn();
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingComplete: true })
    ));
  });

  it('calls onboardingComplete with correct blank payload', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'The Iron Garden' } });
    fireEvent.change(screen.getByTestId('gs-author-input'), { target: { value: 'Alex Rivera' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith({
      startMode: 'blank',
      storyTitle: 'The Iron Garden',
      authorName: 'Alex Rivera',
      vaultParentPath: '~/Documents/MythosWriter',
      templateId: undefined,
    }));
  });

  it('author name trimmed whitespace — empty string becomes undefined', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Story' } });
    fireEvent.change(screen.getByTestId('gs-author-input'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ authorName: undefined })
    ));
  });

  it('calls onboardingComplete with correct sample payload', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openSampleFlow();
    // Step1c: select Sci-Fi Noir genre card
    fireEvent.click(screen.getByTestId('genre-card-sci-fi-noir'));
    fireEvent.click(screen.getByTestId('genre-start-btn'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ startMode: 'sample', sampleGenre: 'sci-fi-noir' })
    ));
  });

  it('calls onboardingComplete with correct template payload', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    await waitFor(() => screen.getByTestId('template-use-btn'));
    fireEvent.click(screen.getByTestId('template-use-btn'));
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'Epic Saga' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ startMode: 'template', templateId: 'bundled:novel-3act', storyTitle: 'Epic Saga' })
    ));
  });

  it('author name persisted to returned settings', async () => {
    const onComplete = vi.fn();
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.change(screen.getByTestId('gs-author-input'), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ authorName: 'Jane Doe' })
    ));
  });

  it('firstScene from response stored in lastOpenedScene', async () => {
    const onComplete = vi.fn();
    mockApi.onboardingComplete = vi.fn().mockResolvedValue({
      ok: true,
      firstSceneId: 'abc-123',
      firstScenePath: 'Manuscript/Chapter 1/chapter-1-scene-1.md',
    });
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        lastOpenedScene: expect.objectContaining({ sceneId: 'abc-123', scenePath: 'Manuscript/Chapter 1/chapter-1-scene-1.md' }),
      })
    ));
  });
});

// ─── Step 3 error handling ────────────────────────────────────────────────────

describe('OnboardingWizard — Step 3 error state', () => {
  it('shows error state when onboardingComplete returns error', async () => {
    mockApi.onboardingComplete = vi.fn().mockResolvedValue({ ok: false, error: 'Disk full' });
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(screen.getByTestId('gs-scaffold-error')).toBeInTheDocument());
    expect(screen.getByText('Something went wrong creating your story.')).toBeInTheDocument();
    expect(screen.getByTestId('gs-try-again')).toBeInTheDocument();
    expect(screen.getByTestId('gs-open-existing')).toBeInTheDocument();
  });

  it('shows error state when onboardingComplete throws', async () => {
    mockApi.onboardingComplete = vi.fn().mockRejectedValue(new Error('Network error'));
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(screen.getByTestId('gs-scaffold-error')).toBeInTheDocument());
  });

  it('"Try Again" retries onboardingComplete', async () => {
    mockApi.onboardingComplete = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'Disk full' })
      .mockResolvedValueOnce({ ok: true });
    const onComplete = vi.fn();
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => screen.getByTestId('gs-try-again'));
    fireEvent.click(screen.getByTestId('gs-try-again'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingComplete: true })
    ));
  });

  it('"Open Existing Story" calls onboardingComplete with skip and fires onComplete', async () => {
    mockApi.onboardingComplete = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'Failed' })
      .mockResolvedValueOnce({ ok: true });
    const onComplete = vi.fn();
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => screen.getByTestId('gs-open-existing'));
    fireEvent.click(screen.getByTestId('gs-open-existing'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenLastCalledWith({ startMode: 'skip' }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true }));
  });
});

// ─── SKY-1353: bundled-template fetch fallback ────────────────────────────────

describe('OnboardingWizard — SKY-1353 template fetch fallback', () => {
  it('shows inline error when templateList rejects', async () => {
    mockApi.templateList = vi.fn().mockRejectedValue(new Error('ENOENT: no such file'));
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByTestId('template-load-error')).toBeInTheDocument());
    expect(screen.getByTestId('template-load-error').textContent).toContain(
      "Bundled templates couldn't be loaded. You can still create a blank story."
    );
  });

  it('error is announced as an alert for screen readers', async () => {
    mockApi.templateList = vi.fn().mockRejectedValue(new Error('ENOENT: no such file'));
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('"Create blank story" CTA navigates to Step 2', async () => {
    mockApi.templateList = vi.fn().mockRejectedValue(new Error('ENOENT: no such file'));
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByTestId('template-error-blank-cta')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('template-error-blank-cta'));
    await flushAsyncEffects();
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
  });
});

// ─── AC coverage ──────────────────────────────────────────────────────────────

describe('OnboardingWizard — AC coverage', () => {
  it('AC1: wizard shown on first launch (onboardingComplete falsy)', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
    await act(async () => {});
  });

  it('AC2: Step 1 shows three top-level starting-point cards', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getAllByRole('button').filter((b) => b.dataset.testid?.startsWith('card-'))).toHaveLength(3);
    await act(async () => {});
  });

  it('AC3: From Template shows template sub-picker before Step 2', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByTestId('screen-step1b')).toBeInTheDocument());
    expect(screen.queryByTestId('screen-step2')).not.toBeInTheDocument();
  });

  /* AC16: Skip button removed from landing screen in SKY-2987; Restart link replaced it */

  it('AC17: Back on Step 2 preserves title and card selection', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openBlankFlow();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'Preserved Title' } });
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByTestId('gs-title-input')).toHaveValue('Preserved Title');
    await act(async () => {});
  });

  it('AC18: Escape on Step 2 shows cancel confirm', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openBlankFlow();
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    await act(async () => {});
  });

  it('AC19: Cancel Setup does not call onboardingComplete', async () => {
    const onCancel = vi.fn();
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('gs-cancel-setup'));
    expect(mockApi.onboardingComplete).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('AC22: all user-facing strings match spec copy', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    // Step 1 copy
    expect(screen.getByText('Welcome to Mythos Writer')).toBeInTheDocument();
    expect(screen.getByText('How would you like to begin?')).toBeInTheDocument();
    await openCustomOptions();
    expect(screen.getByTestId('card-blank')).toHaveTextContent('Blank Slate');
    expect(screen.getByTestId('card-sample')).toHaveTextContent('Sample Project');
    expect(screen.getByTestId('card-template')).toHaveTextContent('From Template');
    // Advance to Step 2 for step 2 copy
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByText("What's your story called?")).toBeInTheDocument();
    expect(screen.getByText('Create Story →', { exact: false })).toBeInTheDocument();
    await act(async () => {});
  });
});

// ─── SKY-1397: template counter ───────────────────────────────────────────────

describe('OnboardingWizard — Template counter (SKY-1397)', () => {
  async function goToTemplatePicker() {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByTestId('screen-step1b')).toBeInTheDocument());
  }

  it('reloads templateList every time step1b is shown', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    // First visit
    await openTemplateGallery();
    await waitFor(() => expect(mockApi.templateList).toHaveBeenCalledTimes(1));
    // Navigate back and visit again
    fireEvent.click(screen.getByTestId('gs-back-step1b'));
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(mockApi.templateList).toHaveBeenCalledTimes(2));
  });

  it('shows "No saved templates yet" empty state when no user templates exist', async () => {
    await goToTemplatePicker();
    await waitFor(() => expect(screen.getByTestId('template-empty-hint')).toBeInTheDocument());
    expect(screen.getByTestId('template-empty-hint').textContent).toMatch(/No saved templates yet/);
    expect(screen.getByTestId('template-empty-hint-sub').textContent).toMatch(/Settings/);
  });

  it('does not show count badge when there are no user templates', async () => {
    await goToTemplatePicker();
    await waitFor(() => screen.getByTestId('user-templates-heading'));
    expect(screen.queryByTestId('user-template-count')).not.toBeInTheDocument();
  });

  it('shows count "(1)" in heading when one user template is present', async () => {
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [BUNDLED_TEMPLATE, USER_TEMPLATE] });
    await goToTemplatePicker();
    await waitFor(() => expect(screen.getByTestId('user-template-count')).toBeInTheDocument());
    expect(screen.getByTestId('user-template-count').textContent).toContain('1');
  });

  it('shows count "(2)" and excludes bundled templates from count', async () => {
    const user2 = { ...USER_TEMPLATE, id: 'user:second', name: 'Second Template' };
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [BUNDLED_TEMPLATE, USER_TEMPLATE, user2] });
    await goToTemplatePicker();
    await waitFor(() => expect(screen.getByTestId('user-template-count')).toBeInTheDocument());
    expect(screen.getByTestId('user-template-count').textContent).toContain('2');
  });

  it('user template cards appear in the Your Templates section', async () => {
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [BUNDLED_TEMPLATE, USER_TEMPLATE] });
    await goToTemplatePicker();
    await waitFor(() => expect(screen.getByTestId(`template-card-${USER_TEMPLATE.id}`)).toBeInTheDocument());
    expect(screen.getByTestId(`template-card-${BUNDLED_TEMPLATE.id}`)).toBeInTheDocument();
    expect(screen.getByTestId('user-templates-heading').textContent).toContain('Your Templates');
  });
});

// ─── SKY-1399: rename / delete / duplicate ────────────────────────────────────

describe('OnboardingWizard — Template management (SKY-1399)', () => {
  async function goToPickerWithUserTemplate() {
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [BUNDLED_TEMPLATE, USER_TEMPLATE] });
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    await openTemplateGallery();
    await waitFor(() => expect(screen.getByTestId(`template-card-${USER_TEMPLATE.id}`)).toBeInTheDocument());
  }

  it('shows rename/delete/duplicate action buttons for user templates', async () => {
    await goToPickerWithUserTemplate();
    expect(screen.getByTestId(`template-rename-btn-${USER_TEMPLATE.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`template-duplicate-btn-${USER_TEMPLATE.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`template-delete-btn-${USER_TEMPLATE.id}`)).toBeInTheDocument();
  });

  it('clicking rename shows inline input pre-filled with current name', async () => {
    await goToPickerWithUserTemplate();
    fireEvent.click(screen.getByTestId(`template-rename-btn-${USER_TEMPLATE.id}`));
    const input = screen.getByTestId(`template-rename-input-${USER_TEMPLATE.id}`);
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe(USER_TEMPLATE.name);
  });

  it('confirms rename on Enter and reloads templates', async () => {
    await goToPickerWithUserTemplate();
    fireEvent.click(screen.getByTestId(`template-rename-btn-${USER_TEMPLATE.id}`));
    const input = screen.getByTestId(`template-rename-input-${USER_TEMPLATE.id}`);
    fireEvent.change(input, { target: { value: 'Renamed Template' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockApi.templateRename).toHaveBeenCalledWith(USER_TEMPLATE.id, 'Renamed Template'));
    await waitFor(() => expect(mockApi.templateList).toHaveBeenCalledTimes(2));
  });

  it('Enter rename does not call templateRename a second time when input blurs on unmount', async () => {
    await goToPickerWithUserTemplate();
    fireEvent.click(screen.getByTestId(`template-rename-btn-${USER_TEMPLATE.id}`));
    const input = screen.getByTestId(`template-rename-input-${USER_TEMPLATE.id}`);
    fireEvent.change(input, { target: { value: 'Renamed Template' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => expect(mockApi.templateRename).toHaveBeenCalledTimes(1));
  });

  it('cancels rename on Escape', async () => {
    await goToPickerWithUserTemplate();
    fireEvent.click(screen.getByTestId(`template-rename-btn-${USER_TEMPLATE.id}`));
    const input = screen.getByTestId(`template-rename-input-${USER_TEMPLATE.id}`);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId(`template-rename-input-${USER_TEMPLATE.id}`)).not.toBeInTheDocument();
    expect(mockApi.templateRename).not.toHaveBeenCalled();
  });

  it('clicking duplicate calls templateDuplicate and reloads', async () => {
    await goToPickerWithUserTemplate();
    fireEvent.click(screen.getByTestId(`template-duplicate-btn-${USER_TEMPLATE.id}`));
    await waitFor(() => expect(mockApi.templateDuplicate).toHaveBeenCalledWith(USER_TEMPLATE.id));
    await waitFor(() => expect(mockApi.templateList).toHaveBeenCalledTimes(2));
  });

  it('clicking delete shows confirm dialog', async () => {
    await goToPickerWithUserTemplate();
    fireEvent.click(screen.getByTestId(`template-delete-btn-${USER_TEMPLATE.id}`));
    expect(screen.getByTestId('template-delete-confirm-dialog')).toBeInTheDocument();
  });

  it('confirming delete calls templateDelete and reloads', async () => {
    await goToPickerWithUserTemplate();
    fireEvent.click(screen.getByTestId(`template-delete-btn-${USER_TEMPLATE.id}`));
    fireEvent.click(screen.getByTestId('template-delete-confirm'));
    await waitFor(() => expect(mockApi.templateDelete).toHaveBeenCalledWith(USER_TEMPLATE.id));
    await waitFor(() => expect(mockApi.templateList).toHaveBeenCalledTimes(2));
  });

  it('cancelling delete does not call templateDelete', async () => {
    await goToPickerWithUserTemplate();
    fireEvent.click(screen.getByTestId(`template-delete-btn-${USER_TEMPLATE.id}`));
    fireEvent.click(screen.getByTestId('template-delete-cancel'));
    expect(screen.queryByTestId('template-delete-confirm-dialog')).not.toBeInTheDocument();
    expect(mockApi.templateDelete).not.toHaveBeenCalled();
  });
});

describe('OnboardingWizard — Migration dialog (AC-OB-18–21)', () => {
  const LEGACY_SETTINGS: AppSettings = {
    ...BASE_SETTINGS,
    legacyVaultDetected: true,
    legacyVaultDismissed: false,
    legacyVaultPath: '/home/user/Mythos',
  };

  it('shows migration dialog when legacyVaultDetected=true and legacyVaultDismissed=false', async () => {
    await renderWizard(<OnboardingWizard initialSettings={LEGACY_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('gs-migration-dialog')).toBeInTheDocument();
  });

  it('does not show migration dialog when legacyVaultDismissed=true', async () => {
    await renderWizard(<OnboardingWizard initialSettings={{ ...LEGACY_SETTINGS, legacyVaultDismissed: true }} onComplete={vi.fn()} />);
    expect(screen.queryByTestId('gs-migration-dialog')).not.toBeInTheDocument();
  });

  it('does not show migration dialog when legacyVaultDetected=false', async () => {
    await renderWizard(<OnboardingWizard initialSettings={{ ...BASE_SETTINGS, legacyVaultDetected: false }} onComplete={vi.fn()} />);
    expect(screen.queryByTestId('gs-migration-dialog')).not.toBeInTheDocument();
  });

  it('"Use them" dismisses dialog and opens the legacy vault path', async () => {
    mockApi = makeApi({ chooseVaultFolder: vi.fn().mockResolvedValue({ path: null, cancelled: true }) });
    (window as unknown as { api: unknown }).api = mockApi;
    await renderWizard(<OnboardingWizard initialSettings={LEGACY_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gs-migration-use'));
    expect(screen.queryByTestId('gs-migration-dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith({
      startMode: 'open-existing',
      vaultParentPath: '/home/user/Mythos',
    }));
  });

  it('"Start fresh" dismisses dialog and leaves wizard on step1', async () => {
    await renderWizard(<OnboardingWizard initialSettings={LEGACY_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gs-migration-start-fresh'));
    expect(screen.queryByTestId('gs-migration-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
  });

  it('"Never show again" dismisses dialog, calls settingsSet with legacyVaultDismissed=true', async () => {
    await renderWizard(<OnboardingWizard initialSettings={LEGACY_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gs-migration-never'));
    expect(screen.queryByTestId('gs-migration-dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(mockApi.settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ legacyVaultDismissed: true }),
    ));
  });
});

// ─── Import / Open screen (SKY-2990) ───────────────────────────────────────────

describe('OnboardingWizard — Import / Open screen (SKY-2990)', () => {
  it('AC-I-01: card-import navigates to import screen', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-import'));
    await waitFor(() => expect(screen.getByTestId('screen-step-import')).toBeInTheDocument());
    expect(screen.queryByTestId('screen-step1')).not.toBeInTheDocument();
    await act(async () => {});
  });

  it('AC-I-01b: gs-restart-link navigates to import screen', async () => {
    await renderWizard(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gs-restart-link'));
    await waitFor(() => expect(screen.getByTestId('screen-step-import')).toBeInTheDocument());
    await act(async () => {});
  });

  it('AC-I-02: import screen has all three sections', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    expect(screen.getByTestId('import-section-mw')).toBeInTheDocument();
    expect(screen.getByTestId('import-section-obs')).toBeInTheDocument();
    expect(screen.getByTestId('import-section-docx')).toBeInTheDocument();
    await act(async () => {});
  });

  it('AC-I-03: Import/Open button disabled until a field is filled', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    expect(screen.getByTestId('import-action-btn')).toBeDisabled();
    await act(async () => {});
  });

  it('AC-I-04: Import/Open button enabled after MW path is typed', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    fireEvent.change(screen.getByTestId('import-mw-path'), { target: { value: '/home/user/MyVault' } });
    expect(screen.getByTestId('import-action-btn')).not.toBeDisabled();
    await act(async () => {});
  });

  it('AC-I-05: MW Browse button calls chooseVaultFolder and fills in path', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    fireEvent.click(screen.getByTestId('import-mw-browse'));
    await waitFor(() => expect(mockApi.chooseVaultFolder).toHaveBeenCalledWith('Open existing Mythos vault'));
    await waitFor(() => expect(screen.getByTestId('import-mw-path')).toHaveValue('/home/user/Stories'));
    expect(screen.getByTestId('import-action-btn')).not.toBeDisabled();
    await act(async () => {});
  });

  it('AC-I-06: Obsidian notes Browse sets the notes path display', async () => {
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({ path: '/home/user/ObsNotes', cancelled: false });
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    fireEvent.click(screen.getByTestId('import-obs-notes-browse'));
    await waitFor(() => expect(mockApi.chooseVaultFolder).toHaveBeenCalledWith('Select Obsidian notes folder'));
    await waitFor(() => expect(screen.getByTestId('import-obs-notes-path')).toHaveValue('/home/user/ObsNotes'));
    await act(async () => {});
  });

  it('AC-I-07: Obsidian story Browse sets the story path display', async () => {
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({ path: '/home/user/ObsStory', cancelled: false });
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    fireEvent.click(screen.getByTestId('import-obs-story-browse'));
    await waitFor(() => expect(mockApi.chooseVaultFolder).toHaveBeenCalledWith('Select Obsidian story folder'));
    await waitFor(() => expect(screen.getByTestId('import-obs-story-path')).toHaveValue('/home/user/ObsStory'));
    await act(async () => {});
  });

  it('AC-I-08: tip text is shown', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    expect(screen.getByTestId('import-tip')).toBeInTheDocument();
    await act(async () => {});
  });

  it('AC-I-09: MW Browse cancelled leaves path empty and button disabled', async () => {
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({ path: null, cancelled: true });
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    fireEvent.click(screen.getByTestId('import-mw-browse'));
    await act(async () => {});
    expect(screen.getByTestId('import-mw-path')).toHaveValue('');
    expect(screen.getByTestId('import-action-btn')).toBeDisabled();
  });

  it('AC-I-10: Import MW vault calls onboardingComplete with open-existing startMode', async () => {
    const onComplete = vi.fn();
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} _testInitialStep="step-import" />,
    );
    fireEvent.change(screen.getByTestId('import-mw-path'), { target: { value: '/home/user/MyVault' } });
    fireEvent.click(screen.getByTestId('import-action-btn'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith({
      startMode: 'open-existing',
      vaultParentPath: '/home/user/MyVault',
    }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true })));
  });

  it('AC-I-11: MW import failure shows error modal, does not call onComplete', async () => {
    const onComplete = vi.fn();
    mockApi.onboardingComplete = vi.fn().mockResolvedValue({ ok: false, error: 'Not a Mythos vault' });
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} _testInitialStep="step-import" />,
    );
    fireEvent.change(screen.getByTestId('import-mw-path'), { target: { value: '/home/user/Bad' } });
    fireEvent.click(screen.getByTestId('import-action-btn'));
    await waitFor(() => expect(screen.getByTestId('import-error-modal')).toBeInTheDocument());
    expect(screen.getByTestId('import-error-modal')).toHaveTextContent('Not a Mythos vault');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('AC-E-01: error modal dismiss hides the modal', async () => {
    mockApi.onboardingComplete = vi.fn().mockResolvedValue({ ok: false, error: 'Fail' });
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    fireEvent.change(screen.getByTestId('import-mw-path'), { target: { value: '/bad' } });
    fireEvent.click(screen.getByTestId('import-action-btn'));
    await waitFor(() => expect(screen.getByTestId('import-error-modal')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('import-error-dismiss'));
    expect(screen.queryByTestId('import-error-modal')).not.toBeInTheDocument();
    await act(async () => {});
  });

  it('AC-E-02: Obsidian import stub shows "coming soon" modal', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({ path: '/obs/notes', cancelled: false });
    fireEvent.click(screen.getByTestId('import-obs-notes-browse'));
    await waitFor(() => expect(screen.getByTestId('import-obs-notes-path')).toHaveValue('/obs/notes'));
    fireEvent.click(screen.getByTestId('import-action-btn'));
    await waitFor(() => expect(screen.getByTestId('import-error-modal')).toBeInTheDocument());
    expect(screen.getByTestId('import-error-modal')).toHaveTextContent('coming soon');
    await act(async () => {});
  });

  it('AC-E-03: Word import calls importDocxToStoryVault and fires onComplete', async () => {
    const onComplete = vi.fn();
    const importDocxMock = vi.fn().mockResolvedValue({
      ok: true,
      importedStories: [{ filePath: '/docs/story.docx', storyId: 's1', storyTitle: 'Story', sceneCount: 2, warnings: [] }],
      errors: [],
    });
    (window as unknown as { api: unknown }).api = { ...mockApi, importDocxToStoryVault: importDocxMock };
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} _testInitialStep="step-import" />,
    );
    const fileInput = screen.getByTestId('import-docx-input');
    const file = new File(['content'], 'story.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);
    await waitFor(() => expect(screen.getByText('story.docx')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('import-action-btn'));
    await waitFor(() => expect(importDocxMock).toHaveBeenCalled());
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true })));
  });

  it('AC-E-04: Back button on import screen returns to step1', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    fireEvent.click(screen.getByTestId('gs-back-step-import'));
    await waitFor(() => expect(screen.getByTestId('screen-step1')).toBeInTheDocument());
    await act(async () => {});
  });

  it('AC-E-05: Escape on import screen shows cancel confirm', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="step-import" />,
    );
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument());
    await act(async () => {});
  });
});



// ─── Custom Setup path (SKY-2988) ────────────────────────────────────────────

describe('OnboardingWizard — Custom Setup Screen 1: location picker (SKY-2988)', () => {
  // Safety net: always restore real timers even if a test times out
  afterEach(() => { vi.useRealTimers(); });

  it('AC-C-01: renders custom-location screen with all required elements', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
    );
    expect(screen.getByTestId('screen-custom-location')).toBeInTheDocument();
    expect(screen.getByTestId('custom-vault-path-input')).toBeInTheDocument();
    expect(screen.getByTestId('custom-vault-browse')).toBeInTheDocument();
    expect(screen.getByTestId('custom-vault-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('custom-location-next')).toBeInTheDocument();
    expect(screen.getByText('Custom Setup · 1 of 2')).toBeInTheDocument();
    await act(async () => {});
  });

  it('AC-C-01: Next button is initially disabled (default path not yet validated)', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
    );
    expect(screen.getByTestId('custom-location-next')).toBeDisabled();
    await act(async () => {});
  });

  it('AC-C-03: vault name is auto-derived from the default path', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
    );
    expect((screen.getByTestId('custom-vault-name-input') as HTMLInputElement).value).toBe('MythosWriter');
    await act(async () => {});
  });

  it('AC-C-03: typing in the path field auto-updates vault name', async () => {
    vi.useFakeTimers();
    try {
      await renderWizard(
        <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
      );
      fireEvent.change(screen.getByTestId('custom-vault-path-input'), {
        target: { value: '/home/user/Projects/MyNovel' },
      });
      expect((screen.getByTestId('custom-vault-name-input') as HTMLInputElement).value).toBe('MyNovel');
    } finally {
      vi.useRealTimers();
      await act(async () => {});
    }
  });

  it('AC-C-03: manual vault name edit prevents auto-update on subsequent path changes', async () => {
    vi.useFakeTimers();
    try {
      await renderWizard(
        <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
      );
      fireEvent.change(screen.getByTestId('custom-vault-name-input'), { target: { value: 'My Custom Name' } });
      fireEvent.change(screen.getByTestId('custom-vault-path-input'), {
        target: { value: '/home/user/SomethingElse' },
      });
      expect((screen.getByTestId('custom-vault-name-input') as HTMLInputElement).value).toBe('My Custom Name');
    } finally {
      vi.useRealTimers();
      await act(async () => {});
    }
  });

  it('AC-C-02: valid path (existing+writable) enables Next button after debounce', async () => {
    // validateCustomPathNow calls validatePath twice via Promise.all:
    // first for the base path (should exist+writable), second for Story Vault manifest (should not exist)
    mockApi.validatePath = vi.fn()
      .mockResolvedValueOnce({ exists: true, isEmpty: false, writable: true })  // existing dir
      .mockResolvedValueOnce({ exists: false, isEmpty: true, writable: true }); // no manifest
    vi.useFakeTimers();
    try {
      await renderWizard(
        <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
      );
      fireEvent.change(screen.getByTestId('custom-vault-path-input'), {
        target: { value: '/home/user/MyVault' },
      });
      await act(async () => { vi.advanceTimersByTime(600); });
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(screen.getByTestId('custom-location-next')).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
      await act(async () => {});
    }
  });

  it('AC-C-02: new-path (non-existent but valid parent) enables Next button', async () => {
    mockApi.validatePath = vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true });
    vi.useFakeTimers();
    try {
      await renderWizard(
        <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
      );
      fireEvent.change(screen.getByTestId('custom-vault-path-input'), {
        target: { value: '/home/user/NewVault' },
      });
      await act(async () => { vi.advanceTimersByTime(600); });
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(screen.getByTestId('custom-location-next')).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
      await act(async () => {});
    }
  });

  it('AC-C-02: not-writable path keeps Next disabled and shows validation hint', async () => {
    mockApi.validatePath = vi.fn().mockResolvedValue({ exists: true, isEmpty: false, writable: false });
    vi.useFakeTimers();
    try {
      await renderWizard(
        <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
      );
      fireEvent.change(screen.getByTestId('custom-vault-path-input'), {
        target: { value: '/root/protected' },
      });
      await act(async () => { vi.advanceTimersByTime(600); });
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(screen.getByTestId('custom-path-validation-hint')).toBeInTheDocument();
      expect(screen.getByTestId('custom-location-next')).toBeDisabled();
    } finally {
      vi.useRealTimers();
      await act(async () => {});
    }
  });

  it('AC-C-04: Browse button opens folder picker and updates path + vault name', async () => {
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({ path: '/home/user/WritingVault', cancelled: false });
    mockApi.validatePath = vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true });
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
    );
    fireEvent.click(screen.getByTestId('custom-vault-browse'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((screen.getByTestId('custom-vault-path-input') as HTMLInputElement).value).toBe('~/WritingVault');
    expect((screen.getByTestId('custom-vault-name-input') as HTMLInputElement).value).toBe('WritingVault');
  });

  it('AC-C-04: Browse cancelled keeps existing path', async () => {
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({ path: null, cancelled: true });
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
    );
    const pathBefore = (screen.getByTestId('custom-vault-path-input') as HTMLInputElement).value;
    fireEvent.click(screen.getByTestId('custom-vault-browse'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect((screen.getByTestId('custom-vault-path-input') as HTMLInputElement).value).toBe(pathBefore);
  });

  it('AC-C-05: suggestion pill updates path and triggers immediate validation', async () => {
    mockApi.validatePath = vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true });
    mockApi.vaultGetSystemPaths = vi.fn(() => resolvedInEffect({
      homeDir: '/home/user',
      documentsDir: '/home/user/Documents',
      desktopDir: '/home/user/Desktop',
      oneDriveDir: null,
      iCloudDir: null,
    }));
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
    );
    const pills = await screen.findAllByTestId('custom-suggestion-pill');
    fireEvent.click(pills[0]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('custom-location-next')).not.toBeDisabled();
  });

  it('AC-C-06: Back button returns to step1', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
    );
    fireEvent.click(screen.getByTestId('custom-location-back'));
    await act(async () => {});
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
  });

  it('AC-C-06: Next advances to custom-template when path is valid', async () => {
    mockApi.validatePath = vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true });
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({ path: '/home/user/MyVault', cancelled: false });
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-location" />,
    );
    // Use Browse to get a valid path (immediate validation, no debounce)
    fireEvent.click(screen.getByTestId('custom-vault-browse'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('custom-location-next')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('custom-location-next'));
    await act(async () => {});
    expect(screen.getByTestId('screen-custom-template')).toBeInTheDocument();
  });
});

describe('OnboardingWizard — Custom Setup Screen 2: template picker (SKY-2988)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('AC-C-07: renders custom-template screen with both radio cards', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-template" />,
    );
    expect(screen.getByTestId('screen-custom-template')).toBeInTheDocument();
    expect(screen.getByTestId('custom-template-recommended')).toBeInTheDocument();
    expect(screen.getByTestId('custom-template-blank')).toBeInTheDocument();
    expect(screen.getByTestId('custom-template-finish')).toBeInTheDocument();
    expect(screen.getByText('Custom Setup · 2 of 2')).toBeInTheDocument();
    await act(async () => {});
  });

  it('AC-C-07: Recommended card is selected by default', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-template" />,
    );
    expect(screen.getByTestId('custom-template-recommended')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('custom-template-blank')).toHaveAttribute('aria-checked', 'false');
    await act(async () => {});
  });

  it('AC-C-08: clicking Start Blank card selects it and deselects Recommended', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-template" />,
    );
    fireEvent.click(screen.getByTestId('custom-template-blank'));
    await act(async () => {});
    expect(screen.getByTestId('custom-template-blank')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('custom-template-recommended')).toHaveAttribute('aria-checked', 'false');
  });

  it('AC-C-10: Finish calls onboardingComplete with startMode=blank and vault info', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-template" />,
    );
    fireEvent.click(screen.getByTestId('custom-template-finish'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockApi.onboardingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ startMode: 'blank' }),
    );
  });

  it('AC-C-11: Back returns to custom-location preserving vault path state', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-template" />,
    );
    fireEvent.click(screen.getByTestId('custom-template-back'));
    await act(async () => {});
    expect(screen.getByTestId('screen-custom-location')).toBeInTheDocument();
    expect((screen.getByTestId('custom-vault-path-input') as HTMLInputElement).value).toBe(
      '~/Documents/MythosWriter',
    );
  });

  it('AC-C-11: Escape on custom-template shows cancel confirm', async () => {
    await renderWizard(
      <OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} _testInitialStep="custom-template" />,
    );
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    await act(async () => {});
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
  });
});
