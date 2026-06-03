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
}> = {}) {
  return {
    onboardingComplete: overrides.onboardingComplete ?? vi.fn().mockResolvedValue({ ok: true, firstSceneId: 'scene-1', firstScenePath: 'Manuscript/Chapter 1/chapter-1-scene-1.md' }),
    validatePath: overrides.validatePath ?? vi.fn().mockResolvedValue({ exists: false, isEmpty: true, writable: true }),
    chooseVaultFolder: overrides.chooseVaultFolder ?? vi.fn().mockResolvedValue({ path: '/home/user/Stories', cancelled: false }),
    templateList: overrides.templateList ?? vi.fn().mockResolvedValue({ templates: BUNDLED_TEMPLATES }),
  };
}

let mockApi: ReturnType<typeof makeApi>;

beforeEach(() => {
  mockApi = makeApi();
  (window as unknown as { api: unknown }).api = mockApi;
});

// ─── Step 1 ───────────────────────────────────────────────────────────────────

describe('OnboardingWizard — Step 1', () => {
  it('renders Step 1 with correct heading and subtitle', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
    expect(screen.getByText('Welcome to Mythos Writer')).toBeInTheDocument();
    expect(screen.getByText('How would you like to begin?')).toBeInTheDocument();
  });

  it('shows step indicator "Step 1 of 3"', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('shows exactly three starting-point cards', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('card-blank')).toBeInTheDocument();
    expect(screen.getByTestId('card-sample')).toBeInTheDocument();
    expect(screen.getByTestId('card-template')).toBeInTheDocument();
  });

  it('card labels match spec copy exactly', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('card-blank')).toHaveTextContent('Blank Story');
    expect(screen.getByTestId('card-sample')).toHaveTextContent('Sample Novel');
    expect(screen.getByTestId('card-template')).toHaveTextContent('From Template');
  });

  it('shows Skip link on Step 1', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('gs-skip')).toBeInTheDocument();
    expect(screen.getByTestId('gs-skip').textContent).toMatch(/Skip/);
  });

  it('clicking Blank Story advances to Step 2', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
  });

  it('clicking Sample Novel advances to Step 2', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-sample'));
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
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

  it('Escape on Step 1 shows cancel confirm dialog', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
  });

  it('close button on Step 1 shows cancel confirm dialog', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('gs-close-btn-step1'));
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
  });
});

// ─── Cancel confirm dialog ────────────────────────────────────────────────────

describe('OnboardingWizard — Cancel confirm dialog', () => {
  it('"Keep Going" dismisses dialog and returns to wizard', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('gs-keep-going'));
    expect(screen.queryByTestId('gs-cancel-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
  });

  it('"Cancel Setup" calls onCancel without calling onboardingComplete', () => {
    const onCancel = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('gs-cancel-setup'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockApi.onboardingComplete).not.toHaveBeenCalled();
  });

  it('dialog copy matches spec exactly', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByText('Cancel setup?')).toBeInTheDocument();
    expect(screen.getByText(/Your story hasn't been created yet/)).toBeInTheDocument();
    expect(screen.getByText(/If you close now, you'll start fresh next time/)).toBeInTheDocument();
    expect(screen.getByTestId('gs-keep-going')).toHaveTextContent('Keep Going');
    expect(screen.getByTestId('gs-cancel-setup')).toHaveTextContent('Cancel Setup');
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

  it('selecting a template advances to Step 2', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
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
});

// ─── Step 2: Name your story ──────────────────────────────────────────────────

describe('OnboardingWizard — Step 2', () => {
  function renderAtStep2() {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    return screen.getByTestId('screen-step2');
  }

  it('shows "What\'s your story called?" heading', () => {
    renderAtStep2();
    expect(screen.getByText("What's your story called?")).toBeInTheDocument();
  });

  it('shows step indicator "Step 2 of 3"', () => {
    renderAtStep2();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  });

  it('shows Story title field as required', () => {
    renderAtStep2();
    expect(screen.getByTestId('gs-title-input')).toBeInTheDocument();
    expect(screen.getByTestId('gs-title-input')).toHaveAttribute('aria-required', 'true');
  });

  it('shows Author name field (optional)', () => {
    renderAtStep2();
    expect(screen.getByTestId('gs-author-input')).toBeInTheDocument();
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
  });

  it('shows default save path ~/Documents/MythosWriter', () => {
    renderAtStep2();
    expect(screen.getByTestId('gs-save-path').textContent).toBe('~/Documents/MythosWriter');
  });

  it('shows "Change…" button for save location', () => {
    renderAtStep2();
    expect(screen.getByTestId('gs-change-location')).toBeInTheDocument();
    expect(screen.getByTestId('gs-change-location').textContent).toMatch(/Change/);
  });

  it('"Create Story →" button is present', () => {
    renderAtStep2();
    expect(screen.getByTestId('gs-create-story')).toBeInTheDocument();
  });

  it('Back button returns to Step 1', () => {
    renderAtStep2();
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
  });

  it('Back from Step 2 (template path) returns to Step 1b', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
    expect(screen.getByTestId('screen-step2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    expect(screen.getByTestId('screen-step1b')).toBeInTheDocument();
  });

  it('title value is preserved when going back from Step 2', () => {
    renderAtStep2();
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

  it('"Change…" updates save path display', async () => {
    renderAtStep2();
    fireEvent.click(screen.getByTestId('gs-change-location'));
    await waitFor(() => expect(screen.getByTestId('gs-save-path').textContent).toBe('/home/user/Stories'));
  });

  it('"Change…" cancelled keeps previous path', async () => {
    mockApi.chooseVaultFolder = vi.fn().mockResolvedValue({ path: null, cancelled: true });
    renderAtStep2();
    const pathBefore = screen.getByTestId('gs-save-path').textContent;
    fireEvent.click(screen.getByTestId('gs-change-location'));
    await waitFor(() => {}); // wait for async
    expect(screen.getByTestId('gs-save-path').textContent).toBe(pathBefore);
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
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'Glass Library' } });
    fireEvent.click(screen.getByTestId('gs-create-story'));
    await waitFor(() => expect(mockApi.onboardingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ startMode: 'sample', storyTitle: 'Glass Library' })
    ));
  });

  it('calls onboardingComplete with correct template payload', async () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-template'));
    await waitFor(() => screen.getByTestId('template-card-bundled:novel-3act'));
    fireEvent.click(screen.getByTestId('template-card-bundled:novel-3act'));
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

// ─── AC coverage ──────────────────────────────────────────────────────────────

describe('OnboardingWizard — AC coverage', () => {
  it('AC1: wizard shown on first launch (onboardingComplete falsy)', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getByTestId('screen-step1')).toBeInTheDocument();
  });

  it('AC2: Step 1 shows exactly three selectable cards', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    expect(screen.getAllByRole('button').filter((b) => b.dataset.testid?.startsWith('card-'))).toHaveLength(3);
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

  it('AC17: Back on Step 2 preserves title and card selection', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.change(screen.getByTestId('gs-title-input'), { target: { value: 'Preserved Title' } });
    fireEvent.click(screen.getByTestId('gs-back-step2'));
    fireEvent.click(screen.getByTestId('card-blank'));
    expect(screen.getByTestId('gs-title-input')).toHaveValue('Preserved Title');
  });

  it('AC18: Escape on Step 2 shows cancel confirm', () => {
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId('card-blank'));
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    expect(screen.getByTestId('gs-cancel-confirm')).toBeInTheDocument();
  });

  it('AC19: Cancel Setup does not call onboardingComplete', () => {
    const onCancel = vi.fn();
    render(<OnboardingWizard initialSettings={BASE_SETTINGS} onComplete={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByTestId('gs-overlay'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('gs-cancel-setup'));
    expect(mockApi.onboardingComplete).not.toHaveBeenCalled();
  });

  it('AC22: all user-facing strings match spec copy', () => {
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
  });
});
