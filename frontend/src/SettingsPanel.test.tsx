import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsPanel from './SettingsPanel';
import type { FocusPrefs } from './types';

const defaultSettings: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: { enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 10000, maxSuggestionsPerHour: 20, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 10000, maxSuggestionsPerHour: 20, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.8, maxTokensPerHour: 10000, maxSuggestionsPerHour: 20, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
  },
  theme: 'dark',
};

const mockSettingsGet = vi.fn();
const mockSettingsSet = vi.fn();
const mockVaultGetPaths = vi.fn();
const mockVaultSetPaths = vi.fn();
const mockChooseVaultFolder = vi.fn();
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
  (window as unknown as { api: unknown }).api = {
    settingsGet: mockSettingsGet,
    settingsSet: mockSettingsSet,
    vaultGetPaths: mockVaultGetPaths,
    vaultSetPaths: mockVaultSetPaths,
    chooseVaultFolder: mockChooseVaultFolder,
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

  // ── MYT-779: AI providers section ──

  it('renders AI Provider section with provider selector', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));
    expect(screen.getByRole('heading', { name: /^ai provider$/i })).toBeInTheDocument();
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

  it('per-agent model selectors are disabled when a non-Anthropic provider is selected', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'openai' } });

    const waSelect = screen.getByLabelText(/writing assistant model/i) as HTMLSelectElement;
    const brainstormSelect = screen.getByLabelText(/brainstorm agent model/i) as HTMLSelectElement;
    const archiveSelect = screen.getByLabelText(/archive agent model/i) as HTMLSelectElement;
    expect(waSelect.disabled).toBe(true);
    expect(brainstormSelect.disabled).toBe(true);
    expect(archiveSelect.disabled).toBe(true);
  });

  it('per-agent model selectors are disabled for ollama provider', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'ollama' } });

    const waSelect = screen.getByLabelText(/writing assistant model/i) as HTMLSelectElement;
    expect(waSelect.disabled).toBe(true);
  });

  it('shows adapter hint text when a non-Anthropic provider is selected', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'openai' } });

    expect(screen.getByTestId('wa-model-adapter-hint')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-model-adapter-hint')).toBeInTheDocument();
    expect(screen.getByTestId('archive-model-adapter-hint')).toBeInTheDocument();
  });

  it('does not show adapter hint when Anthropic provider is active', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant model/i));

    expect(screen.queryByTestId('wa-model-adapter-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brainstorm-model-adapter-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('archive-model-adapter-hint')).not.toBeInTheDocument();
  });

  it('re-enables per-agent model selectors after switching back to Anthropic', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'openai' } });
    expect((screen.getByLabelText(/writing assistant model/i) as HTMLSelectElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'anthropic' } });
    expect((screen.getByLabelText(/writing assistant model/i) as HTMLSelectElement).disabled).toBe(false);
  });
});
