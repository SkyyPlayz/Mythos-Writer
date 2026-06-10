import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsPanel from './SettingsPanel';
import type { FocusPrefs } from './types';

const ALL_CATS: Record<SuggestionCategory, boolean> = { punctuation: true, spelling: true, grammar: true, 'sentence-structure': true, 'style-tone': true, other: true };

const defaultSettings: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: { enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 10000, maxSuggestionsPerHour: 20, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000, autoApplyCategories: ALL_CATS },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 10000, maxSuggestionsPerHour: 20, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000, autoApplyCategories: ALL_CATS },
    archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 10000, maxSuggestionsPerHour: 20, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000, autoApplyCategories: ALL_CATS },
  },
  theme: 'dark',
};

const mockSettingsGet = vi.fn();
const mockSettingsSet = vi.fn();
const mockVaultGetPaths = vi.fn();
const mockVaultSetPaths = vi.fn();
const mockChooseVaultFolder = vi.fn();
const mockAgentPersonaRead = vi.fn();
const mockAgentPersonaReset = vi.fn();
const mockOnClose = vi.fn();
const mockOnSaved = vi.fn();

const defaultVaultPaths = {
  storyVaultPath: '/home/test/Mythos/Story Vault',
  notesVaultPath: '/home/test/Mythos/Notes Vault',
};

beforeEach(() => {
  vi.resetAllMocks();
  mockSettingsGet.mockResolvedValue(defaultSettings);
  mockSettingsSet.mockResolvedValue({ saved: true });
  mockVaultGetPaths.mockResolvedValue(defaultVaultPaths);
  mockVaultSetPaths.mockImplementation((storyVaultPath: string, notesVaultPath: string) =>
    Promise.resolve({ storyVaultPath, notesVaultPath, saved: true }),
  );
  mockChooseVaultFolder.mockResolvedValue({ path: null, cancelled: true });
  mockAgentPersonaRead.mockImplementation((agentName: string, key: string) =>
    Promise.resolve({ content: `${agentName} ${key} content`, isCustom: false }),
  );
  mockAgentPersonaReset.mockResolvedValue({ reset: true });
  (window as unknown as { api: unknown }).api = {
    settingsGet: mockSettingsGet,
    settingsSet: mockSettingsSet,
    vaultGetPaths: mockVaultGetPaths,
    vaultSetPaths: mockVaultSetPaths,
    chooseVaultFolder: mockChooseVaultFolder,
    agentPersonaRead: mockAgentPersonaRead,
    agentPersonaReset: mockAgentPersonaReset,
  };
});

describe('SettingsPanel', () => {
  it('renders all sections after loading', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => expect(screen.getByLabelText(/anthropic api key/i)).toBeInTheDocument());
    expect(screen.getByText(/writing assistant/i)).toBeInTheDocument();
    expect(screen.getByText(/brainstorm agent/i)).toBeInTheDocument();
    expect(screen.getByText(/archive agent/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^appearance$/i })).toBeInTheDocument();
  });

  it('exposes PersonaViewer tabpanel links with roving tabIndex', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getAllByRole('button', { name: /persona files/i })[0]);

    const agentsTab = await screen.findByRole('tab', { name: /agents\.md/i });
    const heartbeatTab = screen.getByRole('tab', { name: /heartbeat\.md/i });
    const soulTab = screen.getByRole('tab', { name: /soul\.md/i });
    const toolsTab = screen.getByRole('tab', { name: /tools\.md/i });
    const panel = screen.getByRole('tabpanel');

    expect(agentsTab).toHaveAttribute('id', 'persona-tab-writingAssistant-AGENTS');
    expect(agentsTab).toHaveAttribute('aria-controls', 'persona-panel-writingAssistant');
    expect(agentsTab).toHaveAttribute('aria-selected', 'true');
    expect(agentsTab).toHaveAttribute('tabIndex', '0');
    for (const inactiveTab of [heartbeatTab, soulTab, toolsTab]) {
      expect(inactiveTab).toHaveAttribute('tabIndex', '-1');
      expect(inactiveTab).toHaveAttribute('aria-controls', 'persona-panel-writingAssistant');
    }
    expect(panel).toHaveAttribute('id', 'persona-panel-writingAssistant');
    expect(panel).toHaveAttribute('aria-labelledby', 'persona-tab-writingAssistant-AGENTS');
  });

  it('moves PersonaViewer tab focus to the next tab with ArrowRight', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getAllByRole('button', { name: /persona files/i })[0]);

    const agentsTab = await screen.findByRole('tab', { name: /agents\.md/i });
    const heartbeatTab = screen.getByRole('tab', { name: /heartbeat\.md/i });
    agentsTab.focus();

    fireEvent.keyDown(agentsTab, { key: 'ArrowRight' });

    await waitFor(() => expect(heartbeatTab).toHaveAttribute('aria-selected', 'true'));
    expect(heartbeatTab).toHaveFocus();
    expect(heartbeatTab).toHaveAttribute('tabIndex', '0');
    expect(agentsTab).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'persona-tab-writingAssistant-HEARTBEAT',
    );
  });

  it('wraps PersonaViewer tab focus to the previous tab with ArrowLeft', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getAllByRole('button', { name: /persona files/i })[0]);

    const agentsTab = await screen.findByRole('tab', { name: /agents\.md/i });
    const toolsTab = screen.getByRole('tab', { name: /tools\.md/i });
    agentsTab.focus();

    fireEvent.keyDown(agentsTab, { key: 'ArrowLeft' });

    await waitFor(() => expect(toolsTab).toHaveAttribute('aria-selected', 'true'));
    expect(toolsTab).toHaveFocus();
    expect(toolsTab).toHaveAttribute('tabIndex', '0');
    expect(agentsTab).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'persona-tab-writingAssistant-TOOLS',
    );
  });

  it('offers dark and high-contrast appearance choices and applies on change', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const dark = screen.getByRole('radio', { name: /liquid neon/i }) as HTMLInputElement;
    const highContrast = screen.getByRole('radio', { name: /high contrast/i }) as HTMLInputElement;
    expect(dark.checked).toBe(true);

    fireEvent.click(highContrast);
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalled());
    expect(mockSettingsSet).toHaveBeenCalledWith(expect.objectContaining({ theme: 'high-contrast' }));
  });

  it('loads settings from IPC on mount', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, apiKey: 'sk-ant-...3456' });

    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => expect(screen.getByLabelText(/anthropic api key/i)).toBeInTheDocument());

    // Input must be empty — masked value must not appear in the writable field
    const input = screen.getByLabelText(/anthropic api key/i) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByTestId('key-configured-hint')).toBeInTheDocument();
    expect(mockSettingsGet).toHaveBeenCalledTimes(1);
  });

  it('saves settings to IPC when Save is clicked', async () => {
    render(<SettingsPanel onClose={mockOnClose} onSaved={mockOnSaved} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    expect(mockSettingsSet).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    expect(screen.getByText(/settings saved/i)).toBeInTheDocument();
    expect(mockOnSaved).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
  });

  it('shows inline validation error for bad API key', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), { target: { value: 'bad-key' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/must start with sk-ant-/i);
    expect(screen.getByRole('button', { name: /save settings/i })).toBeDisabled();
  });

  it('accepts a valid sk-ant- key and enables Save', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), { target: { value: 'sk-ant-validkey' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save settings/i })).not.toBeDisabled();
  });

  it('allows empty API key (falls back to env var)', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    // Empty key is valid — no error
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save settings/i })).not.toBeDisabled();
  });

  it('calls onClose when Cancel is clicked', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/close settings/i));

    fireEvent.click(screen.getByLabelText(/close settings/i));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('toggles API key visibility', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, apiKey: 'sk-ant-secret' });
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const input = screen.getByLabelText(/anthropic api key/i) as HTMLInputElement;
    expect(input.type).toBe('password');

    fireEvent.click(screen.getByLabelText(/show api key/i));
    expect(input.type).toBe('text');

    fireEvent.click(screen.getByLabelText(/hide api key/i));
    expect(input.type).toBe('password');
  });

  it('persists per-agent toggle changes on save', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/enable writing assistant/i));

    const toggle = screen.getByRole('checkbox', { name: /enable writing assistant/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalled());

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.writingAssistant.enabled).toBe(false);
  });

  it('shows error when save fails', async () => {
    mockSettingsSet.mockRejectedValueOnce(new Error('Disk full'));
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('button', { name: /save settings/i }));

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/disk full/i));
  });

  // ── MYT-146 acceptance criteria ──

  it('does not show configured hint when no key is set', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));
    expect(screen.queryByTestId('key-configured-hint')).not.toBeInTheDocument();
  });

  it('saving without touching the key sends the masked value so the backend guard preserves it', async () => {
    const masked = 'sk-ant-...9876';
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, apiKey: masked });
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('button', { name: /save settings/i }));

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    expect(mockSettingsSet).toHaveBeenCalledWith(expect.objectContaining({ apiKey: masked }));
  });

  it('saving with a new key typed sends the typed value', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, apiKey: 'sk-ant-...9876' });
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), { target: { value: 'sk-ant-brandnew' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    expect(mockSettingsSet).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-ant-brandnew' }));
  });

  it('clearing the key (type then delete all) sends empty string to clear stored key', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, apiKey: 'sk-ant-...9876' });
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    // Make input dirty by typing, then clear it
    const input = screen.getByLabelText(/anthropic api key/i);
    fireEvent.change(input, { target: { value: 'sk-ant-temp' } });
    fireEvent.change(input, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    expect(mockSettingsSet).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '' }));
  });

  it('hides configured hint once the user starts typing a new key', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, apiKey: 'sk-ant-...9876' });
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('key-configured-hint'));

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), { target: { value: 'sk-ant-new' } });
    expect(screen.queryByTestId('key-configured-hint')).not.toBeInTheDocument();
  });

  // ── MYT-158: per-agent settings ──

  it('renders model selectors for all three agents', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant model/i));

    expect(screen.getByLabelText(/writing assistant model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/brainstorm agent model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/archive agent model/i)).toBeInTheDocument();
  });

  it('model selectors show the haiku/sonnet/opus options', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant model/i));

    const waSelect = screen.getByLabelText(/writing assistant model/i) as HTMLSelectElement;
    const options = Array.from(waSelect.options).map((o) => o.text);
    expect(options).toContain('claude-haiku');
    expect(options).toContain('claude-sonnet');
    expect(options).toContain('claude-opus');
  });

  it('model selector change is saved via IPC', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant model/i));

    fireEvent.change(screen.getByLabelText(/writing assistant model/i), {
      target: { value: 'claude-haiku-4-5-20251001' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.writingAssistant.model).toBe('claude-haiku-4-5-20251001');
  });

  it('heartbeat interval inputs render for all three agents', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    expect(screen.getByLabelText(/heartbeat interval/i, { selector: '#wa-heartbeat' })).toBeInTheDocument();
    expect(screen.getByLabelText(/heartbeat interval/i, { selector: '#brainstorm-heartbeat' })).toBeInTheDocument();
    expect(screen.getByLabelText(/heartbeat interval/i, { selector: '#archive-heartbeat' })).toBeInTheDocument();
  });

  it('heartbeat interval change is saved via IPC', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.change(screen.getByLabelText(/heartbeat interval/i, { selector: '#brainstorm-heartbeat' }), {
      target: { value: '10' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.brainstorm.heartbeatIntervalMinutes).toBe(10);
  });

  it('auto-apply threshold sliders render for all three agents', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const sliders = screen.getAllByRole('slider');
    expect(sliders.length).toBeGreaterThanOrEqual(3);
  });

  it('auto-apply threshold slider is disabled when autoApply is off', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant auto-apply threshold/i));

    const slider = screen.getByLabelText(/writing assistant auto-apply threshold/i) as HTMLInputElement;
    expect(slider.disabled).toBe(true);
  });

  it('auto-apply threshold slider becomes enabled when autoApply is toggled on', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/auto-apply writing assistant suggestions/i));

    const autoApplyToggle = screen.getByRole('checkbox', { name: /auto-apply writing assistant suggestions/i });
    fireEvent.click(autoApplyToggle);

    const slider = screen.getByLabelText(/writing assistant auto-apply threshold/i) as HTMLInputElement;
    expect(slider.disabled).toBe(false);
  });

  it('auto-apply threshold slider change is saved via IPC', async () => {
    const settingsWithAutoApply = {
      ...defaultSettings,
      agents: {
        ...defaultSettings.agents,
        writingAssistant: { ...defaultSettings.agents.writingAssistant, autoApply: true, confidenceThreshold: 0.8 },
      },
    };
    mockSettingsGet.mockResolvedValueOnce(settingsWithAutoApply);
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant auto-apply threshold/i));

    fireEvent.change(screen.getByLabelText(/writing assistant auto-apply threshold/i), {
      target: { value: '0.6' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.writingAssistant.confidenceThreshold).toBeCloseTo(0.6);
  });

  it('max tokens per day inputs render for all three agents', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    expect(document.getElementById('wa-max-tokens-day')).toBeInTheDocument();
    expect(document.getElementById('brainstorm-max-tokens-day')).toBeInTheDocument();
    expect(document.getElementById('archive-max-tokens-day')).toBeInTheDocument();
  });

  // ── MYT-200 acceptance criteria ──

  it('archive continuity-check interval input renders', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    expect(document.getElementById('archive-interval')).toBeInTheDocument();
  });

  it('archive continuity-check interval change is saved via IPC', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const input = document.getElementById('archive-interval') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '120' } });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.archive.continuityCheckIntervalSeconds).toBe(120);
  });

  it('max tokens per day change is saved via IPC', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const input = document.getElementById('archive-max-tokens-day') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2000000' } });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.archive.maxTokensPerDay).toBe(2000000);
  });

  it('full settings round-trip via IPC mock', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant model/i));

    // Change model to haiku
    fireEvent.change(screen.getByLabelText(/writing assistant model/i), {
      target: { value: 'claude-haiku-4-5-20251001' },
    });

    // Change heartbeat interval
    fireEvent.change(document.getElementById('wa-heartbeat') as HTMLElement, {
      target: { value: '15' },
    });

    // Change max tokens/day
    fireEvent.change(document.getElementById('wa-max-tokens-day') as HTMLElement, {
      target: { value: '1000000' },
    });

    // Enable auto-apply then change threshold
    const autoApplyToggle = screen.getByRole('checkbox', { name: /auto-apply writing assistant suggestions/i });
    fireEvent.click(autoApplyToggle);
    fireEvent.change(screen.getByLabelText(/writing assistant auto-apply threshold/i), {
      target: { value: '0.75' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.writingAssistant.model).toBe('claude-haiku-4-5-20251001');
    expect(saved.agents.writingAssistant.heartbeatIntervalMinutes).toBe(15);
    expect(saved.agents.writingAssistant.maxTokensPerDay).toBe(1000000);
    expect(saved.agents.writingAssistant.autoApply).toBe(true);
    expect(saved.agents.writingAssistant.confidenceThreshold).toBeCloseTo(0.75);
  });

  // ── MYT-802: keyboard focus trap ──

  it('traps Tab focus within the dialog — Tab from last focusable cycles to first', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const dialog = document.querySelector('.settings-panel') as HTMLElement;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !(el as HTMLInputElement).disabled);

    expect(focusable.length).toBeGreaterThan(0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(first);
  });

  it('traps Tab focus within the dialog — Shift+Tab from first focusable cycles to last', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const dialog = document.querySelector('.settings-panel') as HTMLElement;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !(el as HTMLInputElement).disabled);

    expect(focusable.length).toBeGreaterThan(0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('does not trap focus for non-Tab keys', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const dialog = document.querySelector('.settings-panel') as HTMLElement;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !(el as HTMLInputElement).disabled);

    const last = focusable[focusable.length - 1];
    last.focus();

    fireEvent.keyDown(last, { key: 'Enter' });
    expect(document.activeElement).toBe(last);
  });

  // ── MYT-801: Escape key closes dialog ──

  it('closes the dialog when Escape is pressed', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not close the main dialog when Escape is pressed while the Advanced popover is open', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    expect(screen.getByRole('dialog', { name: /advanced ui settings/i })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /advanced ui settings/i })).not.toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  // ── MYT-668: voice settings ──

  it('renders voice section with enable toggle', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));
    expect(screen.getByRole('heading', { name: /^voice$/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /enable voice input/i })).toBeInTheDocument();
  });

  it('voice toggle is off by default', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));
    const toggle = screen.getByRole('checkbox', { name: /enable voice input/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('voice toggle change is saved via IPC', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable voice input/i }));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.enabled).toBe(true);
  });

  // ── SKY-322: voice device selector + capture mode ──

  it('shows capture mode and mic selector when voice is enabled', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));

    // Before enabling: capture mode UI should not be visible
    expect(screen.queryByRole('radiogroup', { name: /voice capture mode/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /enable voice input/i }));

    // After enabling: radio group and mic selector appear
    await waitFor(() =>
      expect(screen.getByRole('radiogroup', { name: /voice capture mode/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('radio', { name: /toggle/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /push-to-talk/i })).toBeInTheDocument();
    // Mic combobox always visible once voice enabled (even with no devices)
    expect(screen.getByRole('combobox', { name: /microphone selection/i })).toBeInTheDocument();
  });

  // ── SKY-896: push-to-talk mode + device selector ──

  it('renders push-to-talk toggle in voice section', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));
    expect(screen.getByRole('checkbox', { name: /push-to-talk mode/i })).toBeInTheDocument();
  });

  it('push-to-talk toggle is off by default', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /push-to-talk mode/i }));
    const toggle = screen.getByRole('checkbox', { name: /push-to-talk mode/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('push-to-talk mode change is saved via IPC', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /push-to-talk mode/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /push-to-talk mode/i }));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.pushToTalkMode).toBe(true);
  });

  it('enabling voice does not clear pushToTalkMode', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      voice: { enabled: false, cloudFallback: false, pushToTalkMode: true },
    });
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable voice input/i }));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.enabled).toBe(true);
    expect(saved.voice?.pushToTalkMode).toBe(true);
  });

  it('switching to push-to-talk mode is saved', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable voice input/i }));
    await waitFor(() => screen.getByRole('radio', { name: /push-to-talk/i }));

    fireEvent.click(screen.getByRole('radio', { name: /push-to-talk/i }));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.voiceMode).toBe('push-to-talk');
  });

  it('shows privacy statement in voice section', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));
    expect(screen.getByText(/voice is processed locally on your device/i)).toBeInTheDocument();
  });

  it('shows no microphone selector when no input devices are available', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));
    expect(screen.queryByRole('combobox', { name: /microphone selection/i })).not.toBeInTheDocument();
  });

  it('shows shortcut hint text in voice section', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));
    // The hint renders two kbd elements — one per mode description — so use getAllByText
    const kbds = screen.getAllByText(/ctrl\+shift\+m/i);
    expect(kbds.length).toBeGreaterThan(0);
  });

  // ── MYT-779: AI providers section ──

  it('renders Provider Configuration section with provider selector', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));
    expect(screen.getByRole('heading', { name: /^provider configuration$/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /ai provider/i })).toBeInTheDocument();
  });

  it('defaults provider selector to Anthropic', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));
    const select = screen.getByRole('combobox', { name: /ai provider/i }) as HTMLSelectElement;
    expect(select.value).toBe('anthropic');
  });

  it('shows all five provider options', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));
    const select = screen.getByRole('combobox', { name: /ai provider/i }) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('anthropic');
    expect(values).toContain('openai');
    expect(values).toContain('ollama');
    expect(values).toContain('lmstudio');
    expect(values).toContain('custom');
  });

  it('shows API key field for cloud providers', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));
    expect(screen.getByRole('textbox', { name: /default model for this provider/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/provider api key/i)).toBeInTheDocument();
  });

  it('shows base URL field when switching to ollama', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'ollama' } });
    expect(screen.getByLabelText(/provider base url/i)).toBeInTheDocument();
  });

  it('provider kind is included in saved settings', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'openai' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.provider?.kind).toBe('openai');
  });

  it('renders test connection button', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('button', { name: /test provider connection/i }));
    expect(screen.getByRole('button', { name: /test provider connection/i })).toBeInTheDocument();
  });

  // ── SKY-818: Voice-capable provider UI ──

  it('renders an accessible Voice badge for providers with STT or TTS capabilities', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      provider: { kind: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', capabilities: { transcribe: true } } as AppSettings['provider'],
    });

    render(<SettingsPanel onClose={mockOnClose} />);

    const badge = await screen.findByRole('status', { name: /supports voice input and\/or output/i });
    expect(badge).toHaveTextContent(/^voice$/i);
  });

  it('does not render a Voice badge for providers without voice capabilities', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      provider: { kind: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' },
    });

    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    expect(screen.queryByRole('status', { name: /supports voice input and\/or output/i })).not.toBeInTheDocument();
  });

  it('shows the voice provider selector only when cloud voice is enabled', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      provider: { kind: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', capabilities: { transcribe: true, speak: true } } as AppSettings['provider'],
      stt: { enabled: true, provider: 'cloud' },
      tts: { enabled: true, provider: 'local' },
    });

    render(<SettingsPanel onClose={mockOnClose} />);

    const selector = await screen.findByRole('combobox', { name: /voice provider/i });
    expect(selector).toBeInTheDocument();
    expect(screen.getByText(/only providers with voice capabilities/i)).toBeInTheDocument();
  });

  it('hides the voice provider selector when STT and TTS are fully local', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      provider: { kind: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', capabilities: { transcribe: true, speak: true } } as AppSettings['provider'],
      stt: { enabled: true, provider: 'local' },
      tts: { enabled: true, provider: 'local' },
    });

    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('heading', { name: /^voice$/i }));

    expect(screen.queryByRole('combobox', { name: /voice provider/i })).not.toBeInTheDocument();
  });

  it('persists selected voiceProviderId on save', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      provider: { kind: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', capabilities: { speak: true } } as AppSettings['provider'],
      stt: { enabled: true, provider: 'cloud' },
      tts: { enabled: true, provider: 'cloud' },
    });

    render(<SettingsPanel onClose={mockOnClose} />);

    fireEvent.change(await screen.findByRole('combobox', { name: /voice provider/i }), { target: { value: 'openai' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voiceProviderId).toBe('openai');
  });

  it('shows an empty state when cloud voice is enabled but no provider supports voice', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      provider: { kind: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' },
      stt: { enabled: true, provider: 'cloud' },
    });

    render(<SettingsPanel onClose={mockOnClose} />);

    const selector = await screen.findByRole('combobox', { name: /voice provider/i }) as HTMLSelectElement;
    expect(selector.options[0].textContent).toMatch(/no providers support voice/i);
  });

  it('lists a custom OpenAI-compatible provider with baseUrl as voice-capable', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      provider: { kind: 'custom', apiKey: 'sk-test', baseUrl: 'https://voice.example/v1', model: 'custom-voice' },
      stt: { enabled: true, provider: 'cloud' },
      tts: { enabled: true, provider: 'cloud' },
    });

    render(<SettingsPanel onClose={mockOnClose} />);

    const selector = await screen.findByRole('combobox', { name: /voice provider/i }) as HTMLSelectElement;
    expect(Array.from(selector.options).map((o) => o.textContent)).toContain('Custom (https://voice.example/v1)');
  });

  // ── MYT-779: Telemetry section ──

  it('renders Telemetry section with opt-in toggle', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));
    expect(screen.getByRole('heading', { name: /^telemetry$/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /enable telemetry/i })).toBeInTheDocument();
  });

  it('telemetry toggle is off by default', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable telemetry/i }));
    const toggle = screen.getByRole('checkbox', { name: /enable telemetry/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('shows telemetry data list', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('list', { name: /telemetry data items/i }));
    expect(screen.getByRole('list', { name: /telemetry data items/i })).toBeInTheDocument();
  });

  it('telemetry toggle change is included in saved settings', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable telemetry/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable telemetry/i }));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.telemetry?.enabled).toBe(true);
  });

  it('telemetry restores enabled state from loaded settings', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, telemetry: { enabled: true, sessionId: 'abc' } });
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable telemetry/i }));
    const toggle = screen.getByRole('checkbox', { name: /enable telemetry/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  // SKY-325: Focus Mode section
  it('does not render Focus Mode section when onFocusPrefsChange is not provided', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('heading', { name: /^appearance$/i }));
    expect(screen.queryByRole('heading', { name: /^focus mode$/i })).not.toBeInTheDocument();
  });

  it('renders Focus Mode section when onFocusPrefsChange is provided', async () => {
    const prefs: FocusPrefs = {
      showLeftSidebar: false, showRightSidebar: false, showBottomBar: false,
      showTitleBar: true, showStatusBar: true, showTabBar: true,
      showSidebarButtons: true, showScrollbars: true, showFileTreeArrows: true,
    };
    render(
      <SettingsPanel
        onClose={mockOnClose}
        focusPrefs={prefs}
        onFocusPrefsChange={vi.fn()}
      />
    );
    await waitFor(() => screen.getByRole('heading', { name: /^focus mode$/i }));
    expect(screen.getByRole('checkbox', { name: /show title bar/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /show status bar/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /show tabs/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /show sidebar collapse buttons/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /show scrollbars/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /show file tree toggle arrows/i })).toBeInTheDocument();
  });

  it('calls onFocusPrefsChange immediately when a Focus Mode toggle is clicked', async () => {
    const mockOnFocusPrefsChange = vi.fn();
    const prefs: FocusPrefs = {
      showLeftSidebar: false, showRightSidebar: false, showBottomBar: false,
      showTitleBar: true, showStatusBar: true, showTabBar: true,
      showSidebarButtons: true, showScrollbars: true, showFileTreeArrows: true,
    };
    render(
      <SettingsPanel
        onClose={mockOnClose}
        focusPrefs={prefs}
        onFocusPrefsChange={mockOnFocusPrefsChange}
      />
    );
    await waitFor(() => screen.getByRole('checkbox', { name: /show title bar/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /show title bar/i }));
    expect(mockOnFocusPrefsChange).toHaveBeenCalledWith({ ...prefs, showTitleBar: false });
  });

  it('Focus Mode "Reset to defaults" restores all toggles to true', async () => {
    const mockOnFocusPrefsChange = vi.fn();
    const prefs: FocusPrefs = {
      showLeftSidebar: false, showRightSidebar: false, showBottomBar: false,
      showTitleBar: false, showStatusBar: false, showTabBar: false,
      showSidebarButtons: false, showScrollbars: false, showFileTreeArrows: false,
    };
    render(
      <SettingsPanel
        onClose={mockOnClose}
        focusPrefs={prefs}
        onFocusPrefsChange={mockOnFocusPrefsChange}
      />
    );
    await waitFor(() => screen.getByRole('button', { name: /reset to defaults/i }));
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
    expect(mockOnFocusPrefsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        showTitleBar: true, showStatusBar: true, showTabBar: true,
        showSidebarButtons: true, showScrollbars: true, showFileTreeArrows: true,
      })
    );
  });

  // ── SKY-463: provider adapter guardrail ──

  it('per-agent model selectors are enabled when Anthropic provider is active', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant model/i));

    const waSelect = screen.getByLabelText(/writing assistant model/i) as HTMLSelectElement;
    const brainstormSelect = screen.getByLabelText(/brainstorm agent model/i) as HTMLSelectElement;
    const archiveSelect = screen.getByLabelText(/archive agent model/i) as HTMLSelectElement;
    expect(waSelect.disabled).toBe(false);
    expect(brainstormSelect.disabled).toBe(false);
    expect(archiveSelect.disabled).toBe(false);
  });

  // SKY-686: All providers now supported. Non-Anthropic providers use text inputs
  // instead of disabled dropdowns so users can enter model names freely (e.g. "llama3-70b").
  it('shows text inputs for per-agent model when a non-Anthropic provider is selected', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'openai' } });

    const waModel = screen.getByLabelText(/writing assistant model/i);
    const brainstormModel = screen.getByLabelText(/brainstorm agent model/i);
    const archiveModel = screen.getByLabelText(/archive agent model/i);
    expect(waModel.tagName).toBe('INPUT');
    expect((waModel as HTMLInputElement).type).toBe('text');
    expect(brainstormModel.tagName).toBe('INPUT');
    expect(archiveModel.tagName).toBe('INPUT');
    // All inputs are editable, not disabled
    expect((waModel as HTMLInputElement).disabled).toBe(false);
    expect((brainstormModel as HTMLInputElement).disabled).toBe(false);
    expect((archiveModel as HTMLInputElement).disabled).toBe(false);
  });

  it('shows text input for per-agent model with ollama provider', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'ollama' } });

    const waModel = screen.getByLabelText(/writing assistant model/i);
    expect(waModel.tagName).toBe('INPUT');
    expect((waModel as HTMLInputElement).type).toBe('text');
    expect((waModel as HTMLInputElement).disabled).toBe(false);
  });

  it('does not show adapter hint text for any provider (all providers now supported)', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'openai' } });

    // SKY-686: adapter hints removed — all providers support per-agent model config
    expect(screen.queryByTestId('wa-model-adapter-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm-model-adapter-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('archive-model-adapter-hint')).not.toBeInTheDocument();
  });

  it('does not show adapter hint when Anthropic provider is active', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant model/i));

    expect(screen.queryByTestId('wa-model-adapter-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm-model-adapter-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('archive-model-adapter-hint')).not.toBeInTheDocument();
  });

  it('switches back to model dropdowns when Anthropic provider is re-selected', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    // Switch to non-Anthropic: text input
    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'openai' } });
    expect(screen.getByLabelText(/writing assistant model/i).tagName).toBe('INPUT');

    // Switch back to Anthropic: dropdown
    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'anthropic' } });
    expect(screen.getByLabelText(/writing assistant model/i).tagName).toBe('SELECT');
  });

  // ── SKY-908 — per-category auto-apply toggles ──

  it('per-category toggle group is hidden when master autoApply is off', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/auto-apply writing assistant suggestions/i));

    expect(screen.queryByTestId('wa-category-toggles')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm-category-toggles')).not.toBeInTheDocument();
    expect(screen.queryByTestId('archive-category-toggles')).not.toBeInTheDocument();
  });

  it('per-category toggle group appears when master autoApply is toggled on', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/auto-apply writing assistant suggestions/i));

    fireEvent.click(screen.getByRole('checkbox', { name: /auto-apply writing assistant suggestions/i }));

    expect(screen.getByTestId('wa-category-toggles')).toBeInTheDocument();
    // Five named categories + 'other' = 6 toggles
    const punctuation = screen.getByRole('checkbox', { name: /writing assistant auto-apply punctuation/i });
    const spelling = screen.getByRole('checkbox', { name: /writing assistant auto-apply spelling/i });
    const grammar = screen.getByRole('checkbox', { name: /writing assistant auto-apply grammar/i });
    const structure = screen.getByRole('checkbox', { name: /writing assistant auto-apply sentence structure/i });
    const style = screen.getByRole('checkbox', { name: /writing assistant auto-apply style \/ tone/i });
    const other = screen.getByRole('checkbox', { name: /writing assistant auto-apply other/i });

    // All six default to enabled (back-compat: undefined map ⇒ all-on).
    for (const cb of [punctuation, spelling, grammar, structure, style, other]) {
      expect((cb as HTMLInputElement).checked).toBe(true);
    }
  });

  it('disabling a single category persists a full map via IPC', async () => {
    const settingsWithAutoApply = {
      ...defaultSettings,
      agents: {
        ...defaultSettings.agents,
        writingAssistant: { ...defaultSettings.agents.writingAssistant, autoApply: true },
      },
    };
    mockSettingsGet.mockResolvedValueOnce(settingsWithAutoApply);
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('wa-category-toggles'));

    fireEvent.click(screen.getByRole('checkbox', { name: /writing assistant auto-apply spelling/i }));

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    const map = saved.agents.writingAssistant.autoApplyCategories;
    expect(map).toBeDefined();
    expect(map?.['spelling']).toBe(false);
    // The other five materialise as enabled so the on-disk shape is unambiguous.
    expect(map?.['punctuation']).toBe(true);
    expect(map?.['grammar']).toBe(true);
    expect(map?.['sentence-structure']).toBe(true);
    expect(map?.['style-tone']).toBe(true);
    expect(map?.['other']).toBe(true);
  });

  it('restores per-category state from loaded settings', async () => {
    const loaded = {
      ...defaultSettings,
      agents: {
        ...defaultSettings.agents,
        writingAssistant: {
          ...defaultSettings.agents.writingAssistant,
          autoApply: true,
          autoApplyCategories: {
            'punctuation': true,
            'spelling': false,
            'grammar': true,
            'sentence-structure': false,
            'style-tone': true,
            'other': true,
          },
        },
      },
    };
    mockSettingsGet.mockResolvedValueOnce(loaded);
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('wa-category-toggles'));

    const spelling = screen.getByRole('checkbox', { name: /writing assistant auto-apply spelling/i }) as HTMLInputElement;
    const structure = screen.getByRole('checkbox', { name: /writing assistant auto-apply sentence structure/i }) as HTMLInputElement;
    const grammar = screen.getByRole('checkbox', { name: /writing assistant auto-apply grammar/i }) as HTMLInputElement;
    expect(spelling.checked).toBe(false);
    expect(structure.checked).toBe(false);
    expect(grammar.checked).toBe(true);
  });

  it('per-category toggles render for all three agents when their master is on', async () => {
    const allOn = {
      ...defaultSettings,
      agents: {
        writingAssistant: { ...defaultSettings.agents.writingAssistant, autoApply: true },
        brainstorm: { ...defaultSettings.agents.brainstorm, autoApply: true },
        archive: { ...defaultSettings.agents.archive, autoApply: true },
      },
    };
    mockSettingsGet.mockResolvedValueOnce(allOn);
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('wa-category-toggles'));

    expect(screen.getByTestId('wa-category-toggles')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-category-toggles')).toBeInTheDocument();
    expect(screen.getByTestId('archive-category-toggles')).toBeInTheDocument();
  });
});
