import { describe, it, expect, vi, beforeEach } from 'vitest';
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
}> = {}) {
  return {
    onboardingComplete: overrides.onboardingComplete ?? vi.fn().mockResolvedValue({ ok: true, firstSceneId: 'scene-1', firstScenePath: 'Manuscript/Chapter 1/chapter-1-scene-1.md' }),
    validatePath: overrides.validatePath ?? vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true }),
    chooseVaultFolder: overrides.chooseVaultFolder ?? vi.fn().mockResolvedValue({ path: '/home/user/Stories', cancelled: false }),
    templateList: overrides.templateList ?? vi.fn().mockResolvedValue({ templates: BUNDLED_TEMPLATES }),
    templateRename: overrides.templateRename ?? vi.fn().mockResolvedValue({ ok: true }),
    templateDelete: overrides.templateDelete ?? vi.fn().mockResolvedValue({ ok: true }),
    templateDuplicate: overrides.templateDuplicate ?? vi.fn().mockResolvedValue({ ok: true, id: 'user:copy' }),
    vaultGetPaths: overrides.vaultGetPaths ?? vi.fn().mockResolvedValue({ homeDir: '/home/user', pathSeparator: '/' }),
    vaultGetSystemPaths: overrides.vaultGetSystemPaths ?? vi.fn().mockResolvedValue({
      homeDir: '/home/user',
      documentsDir: '/home/user/Documents',
      desktopDir: '/home/user/Desktop',
      oneDriveDir: null,
      iCloudDir: null,
    }),
  };
}

let mockApi: ReturnType<typeof makeApi>;

const BUNDLED_TEMPLATE = { id: 'bundled:novel-3act', name: 'Novel (3-Act)', description: 'Three-act novel', story: [{ name: 'Manuscript' }], notes: [{ name: 'Characters' }] };
const USER_TEMPLATE    = { id: 'user:my-template',  name: 'My Template',   description: 'My saved template', story: [], notes: [], isUserTemplate: true, savedAt: '2026-06-01' };

beforeEach(() => {
  mockApi = makeApi();
  (window as unknown as { api: unknown }).api = mockApi;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
});

// ─── Step 1 ───────────────────────────────────────────────────────────────────

describe('OnboardingWizard — Step 1', () => {
  it('renders Step 1 with correct heading and subtitle', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
    expect(screen.getByText('Welcome to Mythos Writer')).toBeInTheDocument();
    expect(screen.getByText('How would you like to begin?')).toBeInTheDocument();
    await act(async () => {});
  });

  it('shows step indicator "Step 1 of 3"', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    await act(async () => {});
  });

  it('shows four starting-point cards (default-mythos-vault is the first/primary)', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('card-default-mythos-vault')).toBeInTheDocument();
    expect(screen.getByTestId('card-blank')).toBeInTheDocument();
    expect(screen.getByTestId('card-sample')).toBeInTheDocument();
    expect(screen.getByTestId('card-template')).toBeInTheDocument();
    await act(async () => {});
  });

  it('card labels match spec copy exactly', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('card-default-mythos-vault')).toHaveTextContent('Create default Mythos Vault');
    expect(screen.getByTestId('card-blank')).toHaveTextContent('Blank Story');
    expect(screen.getByTestId('card-sample')).toHaveTextContent('Sample Novel');
    expect(screen.getByTestId('card-template')).toHaveTextContent('From Template');
    await act(async () => {});
  });

  // SKY-906: one-click first-run path bypasses step2 (no title, no save path picker).
  it('clicking Create default Mythos Vault calls onboardingComplete with startMode=default-mythos-vault and bypasses Step 2', async () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-default-mythos-vault'));
    await waitFor(() =>
      expect(mockApi.onboardingComplete).toHaveBeenCalledWith({ startMode: 'default-mythos-vault' }),
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

  it('shows scaffold error UI when one-click default vault creation fails', async () => {
    mockApi = makeApi({
      onboardingComplete: vi.fn().mockResolvedValue({ ok: false, error: 'Disk full' }),
    });
    (window as unknown as { api: unknown }).api = mockApi;
    const onComplete = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-default-mythos-vault'));
    await waitFor(() => expect(screen.getByTestId('gs-scaffold-error')).toBeInTheDocument());
    expect(screen.getByTestId('gs-scaffold-error').textContent).toContain('Disk full');
    expect(onComplete).not.toHaveBeenCalled();
    // The retry affordances surface so the user isn't stranded on step3.
    expect(screen.getByTestId('gs-try-again')).toBeInTheDocument();
  });

  it('shows Skip link on Step 1', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('gs-skip')).toBeInTheDocument();
    expect(screen.getByTestId('gs-skip').textContent).toMatch(/Skip/);
    await act(async () => {});
  });

  it('clicking Blank Story advances to Step 2', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
    await act(async () => {});
  });

  it('clicking Sample Novel advances to Step 1c (genre picker)', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    expect(screen.getByTestId('screen-step1c')).toBeInTheDocument();
    await act(async () => {});
  });

  it('clicking From Template advances to Step 1b', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    expect(screen.getByTestId('screen-step1b')).toBeInTheDocument();
    // Flush the async templateList() call that fires when step1b mounts
    await act(async () => {});
  });

  it('Skip calls onboardingComplete with startMode=skip and fires onComplete', async () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('gs-skip'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith({ startMode: 'skip' }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true }));
  });

  it('Escape on Step 1 shows cancel confirm dialog', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    await act(async () => {});
  });

  it('close button on Step 1 shows cancel confirm dialog', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gs-close-btn-step1'));
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    await act(async () => {});
  });
});

// ─── Cancel confirm dialog ────────────────────────────────────────────────────

describe('OnboardingWizard — Cancel confirm dialog', () => {
  it('"Keep Going" dismisses dialog and returns to wizard', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('gs-keep-going'));
    expect(screen.queryByTestId('gs-cancel-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
    await act(async () => {});
  });

  it('"Cancel Setup" calls onCancel without calling onboardingComplete', async () => {
    const onCancel = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('gs-cancel-setup'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockApi.onboardingComplete).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('dialog copy matches spec exactly', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(screen.getByText('Choose a template')).toBeInTheDocument());
  });

  it('loads and displays bundled template cards', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(screen.getByText('Novel (3-Act)')).toBeInTheDocument());
    expect(screen.getByText('Short Story')).toBeInTheDocument();
    expect(screen.getByText('World-building Bible')).toBeInTheDocument();
    expect(screen.getByText('Series Bible')).toBeInTheDocument();
  });

  it('shows "Use this →" CTA on each template card', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(screen.getAllByText(/Use this/)).toHaveLength(4));
  });

  it('Back button returns to Step 1', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('gs-back-step1b'));
    fireEvent.click(screen.getByTestId('gs-back-step1b'));
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
  });

  it('selecting a template card shows preview without navigating', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    expect(screen.getByTestId('screen-step1b')).toBeInTheDocument();
    expect(screen.getByTestId('template-preview')).toBeInTheDocument();
  });

  it('sr-only live region announces selected template name (F-13)', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    expect(screen.getByTestId('template-announcement')).toHaveTextContent(
      'Preview for Novel (3-Act) is ready below.'
    );
  });

  it('selected card has aria-checked=true, others false', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    expect(screen.getByTestId('template-card-bundled:novel-3act')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('template-card-bundled:short-story')).toHaveAttribute('aria-checked', 'false');
  });

  it('switching selection updates live region and aria-checked', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    await waitFor(() => screen.getByTestId('template-use-btn'));
    fireEvent.click(screen.getByTestId('template-use-btn'));
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
  });

  it('shows user templates under "Your Templates" section when present', async () => {
    const userTemplate = { id: 'user:my-template', name: 'My Template', description: 'Custom', story: [], notes: [], isUserTemplate: true };
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [...BUNDLED_TEMPLATES, userTemplate] });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(screen.getByText('Your Templates')).toBeInTheDocument());
    expect(screen.getByText('My Template')).toBeInTheDocument();
  });

  it('shows empty hint under "Your Templates" when no custom templates saved', async () => {
    // mockApi returns BUNDLED_TEMPLATES only — no isUserTemplate entries
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    const heading = screen.getByRole('heading', { name: 'Choose a template' });
    expect(heading).toHaveAttribute('id', 'template-picker-heading');
    const group = screen.getByRole('radiogroup', { name: 'Choose a template' });
    expect(group).toBeInTheDocument();
  });

  it('each template card has role="radio" with aria-checked=false before selection', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(screen.getByTestId('template-card-user:my-template')).toBeInTheDocument());
    expect(screen.queryByTestId('template-empty-hint')).not.toBeInTheDocument();
  });

  // SKY-1358: user-template grid gets its own radiogroup role
  it('user-template radiogroup is labelled by "Your Templates" heading', async () => {
    const userTemplate = { id: 'user:my-template', name: 'My Template', description: 'Custom', story: [], notes: [], isUserTemplate: true };
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [...BUNDLED_TEMPLATES, userTemplate] });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByText('Your Templates'));
    const groups = screen.getAllByRole('radiogroup');
    expect(groups.length).toBe(2);
    expect(groups[1]).toHaveAttribute('aria-labelledby', 'template-picker-user-heading');
  });

  // SKY-1360: F-06 — loading indicator with aria-live while templateList() is in flight
  it('shows loading status with role=status and aria-live=polite while fetching', async () => {
    let resolveList!: (v: { templates: typeof BUNDLED_TEMPLATES }) => void;
    mockApi.templateList = vi.fn().mockReturnValue(new Promise((res) => { resolveList = res; }));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    const status = await waitFor(() => screen.getByRole('status'));
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.textContent).toMatch(/Loading templates/);
    // resolve the fetch so the test cleans up without act() warnings
    await act(async () => { resolveList({ templates: BUNDLED_TEMPLATES }); });
  });

  // SKY-1360: F-05 — empty-state message with role=status when list resolves to 0 items
  it('shows empty-state status with role=status and aria-live=polite when list is empty', async () => {
    mockApi.templateList = vi.fn().mockResolvedValue({ templates: [] });
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByRole('status'));
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-card-bundled:novel-3act')).not.toBeInTheDocument();
    await act(async () => { resolveList({ templates: BUNDLED_TEMPLATES }); });
  });

  // SKY-1362: F-12 — Back arrow on step1b wrapped in aria-hidden so SR hears "Back, button"
  it('step1b Back button arrow glyph is wrapped in aria-hidden span', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('gs-back-step1b'));
    const backBtn = screen.getByTestId('gs-back-step1b');
    const arrowSpan = backBtn.querySelector('span[aria-hidden="true"]');
    expect(arrowSpan).toBeInTheDocument();
    expect(arrowSpan!.textContent).toBe('\u2190');
  });

  // SKY-1412 AC-6: Esc with a selection clears it; a second Esc shows the cancel confirm
  it('Escape with a template selected clears the selection and stays on step1b', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    expect(screen.getByTestId('template-card-bundled:novel-3act')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('template-card-bundled:novel-3act')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('gs-cancel-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen-step1b')).toBeInTheDocument();
  });

  it('Escape with no template selected shows cancel confirm on step1b', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    // no card selected — Escape should show cancel confirm
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
  });

  // SKY-1362: F-14 — Back from template-picker restores focus to the "From Template" card
  it('Back from template-picker restores focus to the card that triggered navigation', async () => {
    // Capture the rAF callback; fire it after React commits step1 DOM so step1 elements exist.
    // React unmounts/remounts step1 on transition, so the implementation does a querySelector
    // on data-testid to find the fresh element rather than using the stale captured ref.
    const rafRef = { current: null as ((time: number) => void) | null };
    vi.stubGlobal('requestAnimationFrame', (fn: (time: number) => void) => { rafRef.current = fn; return 0; });
    try {
      render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
      const templateCard = screen.getByTestId('card-template');
      templateCard.focus();
      fireEvent.click(templateCard);
      await waitFor(() => screen.getByTestId('gs-back-step1b'));
      await act(async () => { fireEvent.click(screen.getByTestId('gs-back-step1b')); });
      // React committed step1; fire rAF — implementation finds the fresh card-template
      expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
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
  function renderAtStep1c() {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
  }

  it('shows genre picker screen on Sample Novel click', async () => {
    renderAtStep1c();
    expect(screen.getByTestId('screen-step1c')).toBeInTheDocument();
    expect(screen.getByText('Pick a sample world')).toBeInTheDocument();
    await act(async () => {});
  });

  it('renders all three genre cards in a radiogroup', async () => {
    renderAtStep1c();
    expect(screen.getByTestId('genre-radiogroup')).toBeInTheDocument();
    expect(screen.getByTestId('genre-card-cozy-fantasy')).toBeInTheDocument();
    expect(screen.getByTestId('genre-card-sci-fi-noir')).toBeInTheDocument();
    expect(screen.getByTestId('genre-card-mystery')).toBeInTheDocument();
    await act(async () => {});
  });

  it('Start button is disabled until a genre is selected', async () => {
    renderAtStep1c();
    expect(screen.getByTestId('genre-start-btn')).toBeDisabled();
    await act(async () => {});
  });

  it('selecting a genre enables Start button with genre title', async () => {
    renderAtStep1c();
    fireEvent.click(screen.getByTestId('genre-card-mystery'));
    const startBtn = screen.getByTestId('genre-start-btn');
    expect(startBtn).not.toBeDisabled();
    expect(startBtn).toHaveTextContent('The Last Wednesday Club');
    await act(async () => {});
  });

  it('genre card shows aria-checked=true when selected', async () => {
    renderAtStep1c();
    fireEvent.click(screen.getByTestId('genre-card-cozy-fantasy'));
    expect(screen.getByTestId('genre-card-cozy-fantasy')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('genre-card-sci-fi-noir')).toHaveAttribute('aria-checked', 'false');
    await act(async () => {});
  });

  it('accordion expands on toggle and collapses others', async () => {
    renderAtStep1c();
    const cozyBtn = screen.getByTestId('genre-accordion-btn-cozy-fantasy');
    fireEvent.click(cozyBtn);
    expect(cozyBtn).toHaveAttribute('aria-expanded', 'true');
    // Opening sci-fi accordion should close cozy one
    fireEvent.click(screen.getByTestId('genre-accordion-btn-sci-fi-noir'));
    expect(cozyBtn).toHaveAttribute('aria-expanded', 'false');
    await act(async () => {});
  });

  it('Back button returns to step1 and resets genre selection', async () => {
    renderAtStep1c();
    fireEvent.click(screen.getByTestId('genre-card-sci-fi-noir'));
    fireEvent.click(screen.getByTestId('gs-back-step1c'));
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
    // Re-entering step1c should have no selection
    fireEvent.click(screen.getByTestId('card-sample'));
    expect(screen.getByTestId('genre-start-btn')).toBeDisabled();
    await act(async () => {});
  });

  it('Start triggers step3 and calls onboardingComplete with sampleGenre', async () => {
    renderAtStep1c();
    fireEvent.click(screen.getByTestId('genre-card-cozy-fantasy'));
    fireEvent.click(screen.getByTestId('genre-start-btn'));
    await waitFor(() => expect(screen.getByTestId('screen-step3')).toBeInTheDocument());
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ startMode: 'sample', sampleGenre: 'cozy-fantasy' })
    ));
  });

  it('error on onboardingComplete shows error card on step1c', async () => {
    mockApi.onboardingComplete = vi.fn().mockResolvedValue({ ok: false, error: 'Bundle not found' });
    renderAtStep1c();
    fireEvent.click(screen.getByTestId('genre-card-mystery'));
    fireEvent.click(screen.getByTestId('genre-start-btn'));
    await waitFor(() => expect(screen.getByTestId('genre-sample-error')).toBeInTheDocument());
    expect(screen.getByTestId('genre-sample-error')).toHaveTextContent('Bundle not found');
  });
});

// ─── Step 2: Name your story ──────────────────────────────────────────────────

describe('OnboardingWizard — Step 2', () => {
  async function renderAtStep2() {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
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

  it('Back button returns to Step 1', async () => {
    await renderAtStep2();
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
  });

  it('Back from Step 2 (template path) returns to Step 1b', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    await waitFor(() => screen.getByTestId('template-use-btn'));
    fireEvent.click(screen.getByTestId('template-use-btn'));
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    expect(screen.getByTestId('screen-step1b')).toBeInTheDocument();
    await act(async () => {});
  });

  it('title value is preserved when going back from Step 2', async () => {
    await renderAtStep2();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Saga' } });
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByTestId('gs-title-input')).toHaveValue('My Saga');
  });
});

// ─── Step 2 validation ────────────────────────────────────────────────────────

describe('OnboardingWizard — Step 2 validation', () => {
  function renderAtStep2() {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
  }

  it('empty title on submit shows exact error copy', async () => {
    renderAtStep2();
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(screen.getByTestId('gs-title-error')).toBeInTheDocument());
    expect(screen.getByTestId('gs-title-error').textContent).toBe(
      'Please give your story a title before continuing.'
    );
  });

  it('empty title on blur shows error', async () => {
    renderAtStep2();
    const input = screen.getByTestId('gs-title-input');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByTestId('gs-title-error')).toBeInTheDocument());
  });

  it.each(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])(
    'invalid char "%s" in title shows exact error copy',
    async (char) => {
      renderAtStep2();
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
    renderAtStep2();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'Existing Story' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(screen.getByTestId('gs-title-error')).toBeInTheDocument());
    expect(screen.getByTestId('gs-title-error').textContent).toContain('already exists in that folder');
    expect(screen.queryByTestId('screen-step3')).not.toBeInTheDocument();
  });

  it('unwritable path shows path error', async () => {
    mockApi.validatePath = vi.fn().mockResolvedValue({ exists: true, isEmpty: false, writable: false });
    renderAtStep2();
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Story' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(screen.getByTestId('gs-path-error')).toBeInTheDocument());
    expect(screen.getByTestId('gs-path-error').textContent).toBe(
      "Can't save to that folder. Please choose a different location."
    );
  });

  it('"Browse…" updates save path display with tilde-prefixed value', async () => {
    renderAtStep2();
    fireEvent.click(screen.getByTestId('gs-change-location'));
    await waitFor(() => expect(screen.getByTestId('gs-save-path')).toHaveValue('~/Stories'));
  });

  it('"Browse…" shows full tilde path in input (no truncation)', async () => {
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({
      path: '/home/user/Mythos/Vaults/Long Fantasy Saga With Many Books/Story Vault',
      cancelled: false,
    });

    renderAtStep2();
    fireEvent.click(screen.getByTestId('gs-change-location'));

    await waitFor(() =>
      expect(screen.getByTestId('gs-save-path')).toHaveValue(
        '~/Mythos/Vaults/Long Fantasy Saga With Many Books/Story Vault',
      )
    );
  });

  it('"Browse…" cancelled keeps previous path', async () => {
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({ path: null, cancelled: true });
    renderAtStep2();
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => screen.getByTestId('screen-step3'));
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gs-cancel-confirm')).not.toBeInTheDocument();
  });

  it('successful scaffold calls onComplete with onboardingComplete=true', async () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingComplete: true })
    ));
  });

  it('calls onboardingComplete with correct blank payload', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Story' } });
    fireEvent.change(screen.getByTestId('gs-author-input'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ authorName: undefined })
    ));
  });

  it('calls onboardingComplete with correct sample payload', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    // Step1c: select Sci-Fi Noir genre card
    fireEvent.click(screen.getByTestId('genre-card-sci-fi-noir'));
    fireEvent.click(screen.getByTestId('genre-start-btn'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ startMode: 'sample', sampleGenre: 'sci-fi-noir' })
    ));
  });

  it('calls onboardingComplete with correct template payload', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-blank'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-blank'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(screen.getByTestId('gs-scaffold-error')).toBeInTheDocument());
    expect(screen.getByText('Something went wrong creating your story.')).toBeInTheDocument();
    expect(screen.getByTestId('gs-try-again')).toBeInTheDocument();
    expect(screen.getByTestId('gs-open-existing')).toBeInTheDocument();
  });

  it('shows error state when onboardingComplete throws', async () => {
    mockApi.onboardingComplete = vi.fn().mockRejectedValue(new Error('Network error'));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'My Novel' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(screen.getByTestId('gs-scaffold-error')).toBeInTheDocument());
  });

  it('"Try Again" retries onboardingComplete', async () => {
    mockApi.onboardingComplete = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'Disk full' })
      .mockResolvedValueOnce({ ok: true });
    const onComplete = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-blank'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('card-blank'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(screen.getByTestId('template-load-error')).toBeInTheDocument());
    expect(screen.getByTestId('template-load-error').textContent).toContain(
      "Bundled templates couldn't be loaded. You can still create a blank story."
    );
  });

  it('error is announced as an alert for screen readers', async () => {
    mockApi.templateList = vi.fn().mockRejectedValue(new Error('ENOENT: no such file'));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('"Create blank story" CTA navigates to Step 2', async () => {
    mockApi.templateList = vi.fn().mockRejectedValue(new Error('ENOENT: no such file'));
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(screen.getByTestId('template-error-blank-cta')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('template-error-blank-cta'));
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
  });
});

// ─── AC coverage ──────────────────────────────────────────────────────────────

describe('OnboardingWizard — AC coverage', () => {
  it('AC1: wizard shown on first launch (onboardingComplete falsy)', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
    await act(async () => {});
  });

  it('AC2: Step 1 shows four selectable cards (SKY-906 added the one-click default vault as the primary)', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getAllByRole('button').filter((b) => b.dataset.testid?.startsWith('card-'))).toHaveLength(4);
    await act(async () => {});
  });

  it('AC3: From Template shows template sub-picker before Step 2', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(screen.getByTestId('screen-step1b')).toBeInTheDocument());
    expect(screen.queryByTestId('screen-step2')).not.toBeInTheDocument();
  });

  it('AC16: Skip bypasses setup — no onboardingComplete call needed before skip fires', async () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('gs-skip'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // Wizard is gone — DesktopShell would render
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ onboardingComplete: true }));
  });

  it('AC17: Back on Step 2 preserves title and card selection', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'Preserved Title' } });
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByTestId('gs-title-input')).toHaveValue('Preserved Title');
    await act(async () => {});
  });

  it('AC18: Escape on Step 2 shows cancel confirm', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    await act(async () => {});
  });

  it('AC19: Cancel Setup does not call onboardingComplete', async () => {
    const onCancel = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('gs-cancel-setup'));
    expect(mockApi.onboardingComplete).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('AC22: all user-facing strings match spec copy', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    // Step 1 copy
    expect(screen.getByText('Welcome to Mythos Writer')).toBeInTheDocument();
    expect(screen.getByText('How would you like to begin?')).toBeInTheDocument();
    expect(screen.getByTestId('card-blank')).toHaveTextContent('Blank Story');
    expect(screen.getByTestId('card-sample')).toHaveTextContent('Sample Novel');
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => expect(screen.getByTestId('screen-step1b')).toBeInTheDocument());
  }

  it('reloads templateList every time step1b is shown', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    // First visit
    fireEvent.click(screen.getByTestId('card-template'));
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
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
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
