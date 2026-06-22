import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import SettingsPanel from './SettingsPanel';
import { DEFAULT_BG_GRADIENT } from './theme';

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
const mockProviderListModels = vi.fn();
const mockOnClose = vi.fn();
const mockOnSaved = vi.fn();

const defaultVaultPaths = {
  storyVaultPath: '/home/test/Mythos/Story Vault',
  notesVaultPath: '/home/test/Mythos/Notes Vault',
};


async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderSettings(ui: ReactElement) {
  const result = render(ui);
  await flushAsyncEffects();
  return result;
}

async function clickAndFlush(element: Element) {
  fireEvent.click(element);
  await flushAsyncEffects();
}

async function changeAndFlush(element: Element, value: string) {
  fireEvent.change(element, { target: { value } });
  await flushAsyncEffects();
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSettingsGet.mockResolvedValue(defaultSettings);
  mockSettingsSet.mockResolvedValue({ saved: true });
  mockVaultGetPaths.mockResolvedValue(defaultVaultPaths);
  mockVaultSetPaths.mockImplementation((storyVaultPath: string, notesVaultPath: string) =>
    Promise.resolve({ storyVaultPath, notesVaultPath, saved: true }),
  );
  mockChooseVaultFolder.mockResolvedValue({ path: null, cancelled: true });
  mockProviderListModels.mockResolvedValue({ ok: false, error: 'No models available' });
  (window as unknown as { api: unknown }).api = {
    settingsGet: mockSettingsGet,
    settingsSet: mockSettingsSet,
    vaultGetPaths: mockVaultGetPaths,
    vaultSetPaths: mockVaultSetPaths,
    chooseVaultFolder: mockChooseVaultFolder,
    providerListModels: mockProviderListModels,
  };
});

describe('SettingsPanel', () => {
  it('renders all sections after loading', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => expect(screen.getByLabelText(/anthropic api key/i)).toBeInTheDocument());
    expect(screen.getAllByText(/writing assistant/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/brainstorm agent/i)).toBeInTheDocument();
    expect(screen.getAllByText(/archive agent/i)[0]).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^appearance$/i })).toBeInTheDocument();
  });

  it('offers dark and high-contrast appearance choices and applies on change', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => expect(screen.getByLabelText(/anthropic api key/i)).toBeInTheDocument());

    // Input must be empty — masked value must not appear in the writable field
    const input = screen.getByLabelText(/anthropic api key/i) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByTestId('key-configured-hint')).toBeInTheDocument();
    expect(mockSettingsGet).toHaveBeenCalledTimes(1);
  });

  // SKY-1902: regression — when the panel mounts in `loading` state the dialog
  // body (and dialogRef) does not exist yet, so the mount-time focus effect can
  // never find a focusable element. A follow-up effect must move focus into the
  // dialog once content has loaded, otherwise keyboard users stay outside the
  // dialog and Tab walks the underlying app DOM (TC-SKY-814-06 regression).
  it('moves focus into the dialog after loading completes', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));
    const closeButton = screen.getByRole('button', { name: /close settings/i });
    await waitFor(() => expect(document.activeElement).toBe(closeButton));
  });

  it('saves settings to IPC when Save is clicked', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} onSaved={mockOnSaved} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    expect(mockSettingsSet).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    expect(screen.getByText(/settings saved/i)).toBeInTheDocument();
    expect(mockOnSaved).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
  });

  it('shows inline validation error for bad API key', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), { target: { value: 'bad-key' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/must start with sk-ant-/i);
    expect(screen.getByRole('button', { name: /save settings/i })).toBeDisabled();
  });

  it('accepts a valid sk-ant- key and enables Save', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), { target: { value: 'sk-ant-validkey' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save settings/i })).not.toBeDisabled();
  });

  it('allows empty API key (falls back to env var)', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    // Empty key is valid — no error
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save settings/i })).not.toBeDisabled();
  });

  it('calls onClose when Cancel is clicked', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/close settings/i));

    fireEvent.click(screen.getByLabelText(/close settings/i));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('toggles API key visibility', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, apiKey: 'sk-ant-secret' });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const input = screen.getByLabelText(/anthropic api key/i) as HTMLInputElement;
    expect(input.type).toBe('password');

    fireEvent.click(screen.getByLabelText(/show api key/i));
    expect(input.type).toBe('text');

    fireEvent.click(screen.getByLabelText(/hide api key/i));
    expect(input.type).toBe('password');
  });

  it('persists per-agent toggle changes on save', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('button', { name: /save settings/i }));

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/disk full/i));
  });

  // ── MYT-146 acceptance criteria ──

  it('does not show configured hint when no key is set', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));
    expect(screen.queryByTestId('key-configured-hint')).not.toBeInTheDocument();
  });

  it('saving without touching the key sends the masked value so the backend guard preserves it', async () => {
    const masked = 'sk-ant-...9876';
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, apiKey: masked });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('button', { name: /save settings/i }));

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    expect(mockSettingsSet).toHaveBeenCalledWith(expect.objectContaining({ apiKey: masked }));
  });

  it('saving with a new key typed sends the typed value', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, apiKey: 'sk-ant-...9876' });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), { target: { value: 'sk-ant-brandnew' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    expect(mockSettingsSet).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-ant-brandnew' }));
  });

  it('clearing the key (type then delete all) sends empty string to clear stored key', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, apiKey: 'sk-ant-...9876' });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('key-configured-hint'));

    fireEvent.change(screen.getByLabelText(/anthropic api key/i), { target: { value: 'sk-ant-new' } });
    expect(screen.queryByTestId('key-configured-hint')).not.toBeInTheDocument();
  });

  // ── MYT-158: per-agent settings ──

  it('renders model selectors for all three agents', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant model/i));

    expect(screen.getByLabelText(/writing assistant model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/brainstorm agent model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/archive agent model/i)).toBeInTheDocument();
  });

  it('model selectors show the haiku/sonnet/opus options', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant model/i));

    const waSelect = screen.getByLabelText(/writing assistant model/i) as HTMLSelectElement;
    const options = Array.from(waSelect.options).map((o) => o.text);
    expect(options).toContain('claude-haiku');
    expect(options).toContain('claude-sonnet');
    expect(options).toContain('claude-opus');
  });

  it('model selector change is saved via IPC', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    expect(screen.getByLabelText(/heartbeat interval/i, { selector: '#wa-heartbeat' })).toBeInTheDocument();
    expect(screen.getByLabelText(/heartbeat interval/i, { selector: '#brainstorm-heartbeat' })).toBeInTheDocument();
    expect(screen.getByLabelText(/heartbeat interval/i, { selector: '#archive-heartbeat' })).toBeInTheDocument();
  });

  it('heartbeat interval change is saved via IPC', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const sliders = screen.getAllByRole('slider');
    expect(sliders.length).toBeGreaterThanOrEqual(3);
  });

  it('auto-apply threshold slider is disabled when autoApply is off', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant auto-apply threshold/i));

    const slider = screen.getByLabelText(/writing assistant auto-apply threshold/i) as HTMLInputElement;
    expect(slider.disabled).toBe(true);
  });

  it('auto-apply threshold slider becomes enabled when autoApply is toggled on', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    expect(document.getElementById('wa-max-tokens-day')).toBeInTheDocument();
    expect(document.getElementById('brainstorm-max-tokens-day')).toBeInTheDocument();
    expect(document.getElementById('archive-max-tokens-day')).toBeInTheDocument();
  });

  // ── SKY-2597: Brainstorm Agent voice toggle and mic selection ──

  it('renders voice toggle for Brainstorm Agent (AC-BST-13)', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    expect(screen.getByRole('checkbox', { name: /brainstorm agent voice/i })).toBeInTheDocument();
  });

  it('Brainstorm Agent voice toggle is off by default (AC-BST-12)', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const toggle = screen.getByRole('checkbox', { name: /brainstorm agent voice/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('mic selection is hidden when Brainstorm Agent voice is disabled (AC-BST-12)', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    expect(screen.queryByLabelText(/brainstorm agent microphone/i)).not.toBeInTheDocument();
  });

  it('mic selection appears when Brainstorm Agent voice is enabled (AC-BST-15)', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getByRole('checkbox', { name: /brainstorm agent voice/i }));

    expect(screen.getByLabelText(/brainstorm agent microphone/i)).toBeInTheDocument();
  });

  it('Brainstorm Agent voice toggle change is saved via IPC (AC-BST-13)', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getByRole('checkbox', { name: /brainstorm agent voice/i }));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.brainstorm.voiceEnabled).toBe(true);
  });

  it('Brainstorm Agent mic selection change is saved via IPC (AC-BST-15)', async () => {
    const mockEnumerate = vi.fn().mockResolvedValue([
      { kind: 'audioinput', deviceId: 'device-abc', label: 'Test Mic', groupId: '' },
    ]);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { enumerateDevices: mockEnumerate },
      writable: true,
      configurable: true,
    });

    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      agents: { ...defaultSettings.agents, brainstorm: { ...defaultSettings.agents.brainstorm, voiceEnabled: true } },
    });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/brainstorm agent microphone/i));

    fireEvent.change(screen.getByLabelText(/brainstorm agent microphone/i), {
      target: { value: 'device-abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.brainstorm.micDeviceId).toBe('device-abc');

    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, writable: true, configurable: true });
  });

  // ── MYT-200 acceptance criteria ──

  it('archive continuity-check interval input renders', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    expect(document.getElementById('archive-interval')).toBeInTheDocument();
  });

  it('archive continuity-check interval change is saved via IPC', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const input = document.getElementById('archive-interval') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '120' } });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.archive.continuityCheckIntervalSeconds).toBe(120);
  });

  it('max tokens per day change is saved via IPC', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const input = document.getElementById('archive-max-tokens-day') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2000000' } });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.archive.maxTokensPerDay).toBe(2000000);
  });

  it('full settings round-trip via IPC mock', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not close the main dialog when Escape is pressed while the Advanced popover is open', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    expect(screen.getByRole('dialog', { name: /advanced ui settings/i })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /advanced ui settings/i })).not.toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  // ── MYT-668: voice settings ──

  it('renders voice section with enable toggle', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));
    expect(screen.getByRole('heading', { name: /^voice$/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /enable voice input/i })).toBeInTheDocument();
  });

  it('voice toggle is off by default', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));
    const toggle = screen.getByRole('checkbox', { name: /enable voice input/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('voice toggle change is saved via IPC', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable voice input/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable voice input/i }));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.enabled).toBe(true);
  });

  // ── AC-V-09: voice settings panel (SKY-1505) ──

  it('renders input language selector with auto-detect default', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/stt input language/i));

    const select = screen.getByLabelText(/stt input language/i) as HTMLSelectElement;
    expect(select.value).toBe('');
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('');
    expect(options).toContain('en-US');
    expect(options).toContain('en-GB');
  });

  it('input language change is saved via IPC', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/stt input language/i));

    fireEvent.change(screen.getByLabelText(/stt input language/i), { target: { value: 'fr-FR' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.inputLanguage).toBe('fr-FR');
  });

  it('input language loaded from persisted settings', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      voice: { enabled: true, cloudFallback: false, inputLanguage: 'de-DE' },
    });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/stt input language/i));

    const select = screen.getByLabelText(/stt input language/i) as HTMLSelectElement;
    expect(select.value).toBe('de-DE');
  });

  it('renders TTS voice identifier input', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/tts voice identifier/i));
    expect(screen.getByLabelText(/tts voice identifier/i)).toBeInTheDocument();
  });

  it('TTS voice change is saved via IPC', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/tts voice identifier/i));

    fireEvent.change(screen.getByLabelText(/tts voice identifier/i), { target: { value: 'alloy' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.ttsVoiceId).toBe('alloy');
  });

  it('renders TTS volume slider defaulting to 100%', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/tts volume/i));

    const slider = screen.getByLabelText(/tts volume/i) as HTMLInputElement;
    expect(slider.value).toBe('1');
  });

  it('TTS volume change is saved via IPC', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/tts volume/i));

    fireEvent.change(screen.getByLabelText(/tts volume/i), { target: { value: '0.6' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.ttsVolume).toBeCloseTo(0.6);
  });

  it('renders TTS rate slider defaulting to 1.0×', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/tts speech rate/i));

    const slider = screen.getByLabelText(/tts speech rate/i) as HTMLInputElement;
    expect(slider.value).toBe('1');
  });

  it('TTS rate change is saved via IPC', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/tts speech rate/i));

    fireEvent.change(screen.getByLabelText(/tts speech rate/i), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.ttsRate).toBeCloseTo(1.5);
  });

  it('renders persistent mute toggle unchecked by default', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /start microphone muted/i }));

    const toggle = screen.getByRole('checkbox', { name: /start microphone muted/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('persistent mute toggle reflects persistentMute from loaded settings', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      voice: { enabled: false, cloudFallback: false, persistentMute: true },
    });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /start microphone muted/i }));

    const toggle = screen.getByRole('checkbox', { name: /start microphone muted/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('persistent mute toggle change is saved via IPC', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /start microphone muted/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /start microphone muted/i }));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.persistentMute).toBe(true);
  });

  it('voice settings round-trip — all new fields persist together', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/stt input language/i), { timeout: 15000 });

    fireEvent.click(screen.getByRole('checkbox', { name: /enable voice input/i }));
    fireEvent.change(screen.getByLabelText(/stt input language/i), { target: { value: 'ja-JP' } });
    fireEvent.change(screen.getByLabelText(/tts voice identifier/i), { target: { value: 'nova' } });
    fireEvent.change(screen.getByLabelText(/tts volume/i), { target: { value: '0.8' } });
    fireEvent.change(screen.getByLabelText(/tts speech rate/i), { target: { value: '1.2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /start microphone muted/i }));

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.voice?.enabled).toBe(true);
    expect(saved.voice?.inputLanguage).toBe('ja-JP');
    expect(saved.voice?.ttsVoiceId).toBe('nova');
    expect(saved.voice?.ttsVolume).toBeCloseTo(0.8);
    expect(saved.voice?.ttsRate).toBeCloseTo(1.2);
    expect(saved.voice?.persistentMute).toBe(true);
  }, 20000);

  // ── MYT-779: AI providers section ──

  it('renders AI Provider section with provider selector', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));
    expect(screen.getByRole('heading', { name: /^provider configuration$/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /ai provider/i })).toBeInTheDocument();
  });

  it('defaults provider selector to Anthropic', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));
    const select = screen.getByRole('combobox', { name: /ai provider/i }) as HTMLSelectElement;
    expect(select.value).toBe('anthropic');
  });

  it('shows all five provider options', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
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
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));
    expect(screen.getByRole('textbox', { name: /default model for this provider/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/provider api key/i)).toBeInTheDocument();
  });

  it('shows base URL field when switching to ollama', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    await changeAndFlush(screen.getByRole('combobox', { name: /ai provider/i }), 'ollama');
    expect(screen.getByLabelText(/provider base url/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ollama-not-running-hint')).toBeInTheDocument());
  });

  it('provider kind is included in saved settings', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    await changeAndFlush(screen.getByRole('combobox', { name: /ai provider/i }), 'openai');
    await clickAndFlush(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.provider?.kind).toBe('openai');
  });

  it('renders test connection button', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('button', { name: /test provider connection/i }));
    expect(screen.getByRole('button', { name: /test provider connection/i })).toBeInTheDocument();
  });

  // ── SKY-1512: model-list dropdown (AC-2, AC-3) ──

  it('AC-2: shows per-agent model <select> when provider:listModels returns a non-empty list', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      agents: {
        ...defaultSettings.agents,
        writingAssistant: {
          ...defaultSettings.agents.writingAssistant,
          provider: { kind: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
        },
      },
    });
    mockProviderListModels.mockResolvedValueOnce({ ok: true, models: ['llama3', 'mistral', 'phi3'] });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /model for writingAssistant/i })).toBeInTheDocument()
    );
    const select = screen.getByRole('combobox', { name: /model for writingAssistant/i }) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('llama3');
    expect(optionValues).toContain('mistral');
    expect(optionValues).toContain('phi3');
    expect(optionValues).toContain('__custom__');
  });

  it('AC-3: shows per-agent Ollama-specific hint when provider:listModels fails', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      agents: {
        ...defaultSettings.agents,
        writingAssistant: {
          ...defaultSettings.agents.writingAssistant,
          provider: { kind: 'ollama', baseUrl: 'http://localhost:11434/v1', model: '' },
        },
      },
    });
    mockProviderListModels.mockResolvedValueOnce({
      ok: false,
      error: 'Ollama is not running. Start it with ollama serve.',
    });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);

    await waitFor(() =>
      expect(screen.getByTestId('wa-model-list-error')).toHaveTextContent(/ollama is not running/i)
    );
    expect(screen.getByTestId('wa-model-list-error')).toHaveTextContent(/ollama serve/i);
    expect(screen.getByRole('textbox', { name: /model for writingAssistant/i })).toBeInTheDocument();
  });

  it('AC-2: shows model <select> when provider:listModels returns a non-empty list', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      provider: { kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3' },
    });
    mockProviderListModels.mockResolvedValueOnce({ ok: true, models: ['llama3', 'mistral', 'phi3'] });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /default model for this provider/i })).toBeInTheDocument()
    );
    const select = screen.getByRole('combobox', { name: /default model for this provider/i }) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('llama3');
    expect(optionValues).toContain('mistral');
    expect(optionValues).toContain('phi3');
    expect(optionValues).toContain('__custom__');
  });

  it('AC-3: shows Ollama-specific hint when provider:listModels returns a network error', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      provider: { kind: 'ollama', baseUrl: 'http://localhost:11434', model: '' },
    });
    mockProviderListModels.mockResolvedValueOnce({
      ok: false,
      error: 'Network error — check that the provider is running and reachable.',
    });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() =>
      expect(screen.getByTestId('ollama-not-running-hint')).toBeInTheDocument()
    );
    expect(screen.getByTestId('ollama-not-running-hint')).toHaveTextContent(/ollama is not running/i);
    expect(screen.getByTestId('ollama-not-running-hint')).toHaveTextContent(/ollama serve/i);
    expect(screen.getByRole('textbox', { name: /default model for this provider/i })).toBeInTheDocument();
  });

  it('AC-2: Refresh models button triggers a new listModels call', async () => {
    mockProviderListModels.mockResolvedValue({ ok: true, models: ['llama3'] });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'ollama' } });

    // Wait for auto-fetch to complete (button transitions from disabled to enabled)
    await waitFor(() => {
      expect((screen.getByTestId('refresh-models-btn') as HTMLButtonElement).disabled).toBe(false);
    });
    expect(mockProviderListModels).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('refresh-models-btn'));
    await waitFor(() => expect(mockProviderListModels).toHaveBeenCalledTimes(2));
  });

  it('AC-4: falls back to free-text input when listing fails for custom provider', async () => {
    mockProviderListModels.mockResolvedValueOnce({ ok: false, error: 'ECONNREFUSED' });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'custom' } });

    await waitFor(() => expect(mockProviderListModels).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox', { name: /default model for this provider/i })).toBeInTheDocument();
    expect(screen.queryByTestId('ollama-not-running-hint')).not.toBeInTheDocument();
  });

  it('AC-4: falls back to free-text input when listing returns an empty array', async () => {
    mockProviderListModels.mockResolvedValueOnce({ ok: true, models: [] });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /ai provider/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /ai provider/i }), { target: { value: 'openai' } });

    await waitFor(() => expect(mockProviderListModels).toHaveBeenCalledTimes(1));
    // Empty list → falls back to free-text, no dropdown
    expect(screen.queryByRole('combobox', { name: /default model for this provider/i })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /default model for this provider/i })).toBeInTheDocument();
  });

  // ── MYT-779: Telemetry section ──

  it('renders Telemetry section with opt-in toggle', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));
    expect(screen.getByRole('heading', { name: /^telemetry$/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /enable telemetry/i })).toBeInTheDocument();
  });

  it('telemetry toggle is off by default', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable telemetry/i }));
    const toggle = screen.getByRole('checkbox', { name: /enable telemetry/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('shows telemetry data list', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('list', { name: /telemetry data items/i }));
    expect(screen.getByRole('list', { name: /telemetry data items/i })).toBeInTheDocument();
  });

  it('telemetry toggle change is included in saved settings', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable telemetry/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable telemetry/i }));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.telemetry?.enabled).toBe(true);
  });

  it('telemetry restores enabled state from loaded settings', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, telemetry: { enabled: true, sessionId: 'abc' } });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable telemetry/i }));
    const toggle = screen.getByRole('checkbox', { name: /enable telemetry/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });
});

// ── Archive Agent Settings (SKY-1683 / AC-CC-09) ──

describe('Archive Agent settings section (AC-CC-09)', () => {
  it('renders the Archive Agent section heading', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('heading', { name: /archive agent/i }));
    expect(screen.getByRole('heading', { name: /archive agent/i })).toBeInTheDocument();
  });

  it('master toggle is enabled by default', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('archive-continuity-enabled'));
    const toggle = screen.getByTestId('archive-continuity-enabled') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('disabling master toggle disables sub-settings fieldset', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('archive-continuity-enabled'));
    fireEvent.click(screen.getByTestId('archive-continuity-enabled'));
    const fieldset = screen.getByTestId('archive-agent-subsettings') as HTMLFieldSetElement;
    expect(fieldset.disabled).toBe(true);
  });

  it('re-enabling master toggle re-enables sub-settings fieldset', async () => {
    mockSettingsGet.mockResolvedValueOnce({ ...defaultSettings, archiveContinuityEnabled: false });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('archive-continuity-enabled'));
    fireEvent.click(screen.getByTestId('archive-continuity-enabled'));
    const fieldset = screen.getByTestId('archive-agent-subsettings') as HTMLFieldSetElement;
    expect(fieldset.disabled).toBe(false);
  });

  it('persists archiveContinuityEnabled=false when saved', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('archive-continuity-enabled'));
    fireEvent.click(screen.getByTestId('archive-continuity-enabled'));
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.archiveContinuityEnabled).toBe(false);
  });

  it('shows full-manuscript+interval warning when both conditions met', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      archiveScanScope: 'full_manuscript',
      archiveScanInterval: 900,
    });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('archive-full-manuscript-warning'));
    expect(screen.getByTestId('archive-full-manuscript-warning')).toBeInTheDocument();
  });

  it('does not show full-manuscript+interval warning when interval is off', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      archiveScanScope: 'full_manuscript',
      archiveScanInterval: null,
    });
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('archive-agent-section'));
    expect(screen.queryByTestId('archive-full-manuscript-warning')).not.toBeInTheDocument();
  });

  it('archiveScanBudget change persists on save', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByTestId('archive-scan-budget'));
    fireEvent.change(screen.getByTestId('archive-scan-budget'), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.archiveScanBudget).toBe(12000);
  });
});

// ── SKY-2440: per-agent model picker + API key settings ──

describe('Per-agent provider override (SKY-2440)', () => {
  const mockSettingsTestConnection = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockSettingsGet.mockResolvedValue(defaultSettings);
    mockSettingsSet.mockResolvedValue({ saved: true });
    mockVaultGetPaths.mockResolvedValue(defaultVaultPaths);
    mockVaultSetPaths.mockImplementation((storyVaultPath: string, notesVaultPath: string) =>
      Promise.resolve({ storyVaultPath, notesVaultPath, saved: true }),
    );
    mockChooseVaultFolder.mockResolvedValue({ path: null, cancelled: true });
    mockProviderListModels.mockResolvedValue({ ok: false, error: 'No models available' });
    mockSettingsTestConnection.mockResolvedValue({ ok: true });
    (window as unknown as { api: unknown }).api = {
      settingsGet: mockSettingsGet,
      settingsSet: mockSettingsSet,
      vaultGetPaths: mockVaultGetPaths,
      vaultSetPaths: mockVaultSetPaths,
      chooseVaultFolder: mockChooseVaultFolder,
      providerListModels: mockProviderListModels,
      settingsTestConnection: mockSettingsTestConnection,
    };
  });

  // AC-MP-04 — override toggle renders for all three agents
  it('AC-MP-04: override toggle renders for all three agent cards', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    expect(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /enable brainstorm provider override/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /enable archive provider override/i })).toBeInTheDocument();
  });

  // AC-MP-04 — override toggle is off by default
  it('AC-MP-04: override toggles are unchecked by default', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const waToggle = screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }) as HTMLInputElement;
    const brainstormToggle = screen.getByRole('checkbox', { name: /enable brainstorm provider override/i }) as HTMLInputElement;
    const archiveToggle = screen.getByRole('checkbox', { name: /enable archive provider override/i }) as HTMLInputElement;
    expect(waToggle.checked).toBe(false);
    expect(brainstormToggle.checked).toBe(false);
    expect(archiveToggle.checked).toBe(false);
  });

  // AC-MP-13 — global provider hint when override is off
  it('AC-MP-13: shows "Using global provider" hint when override is off', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    // All three agents should show the hint
    const hints = screen.getAllByText(/using global provider/i);
    expect(hints.length).toBeGreaterThanOrEqual(3);
  });

  // AC-MP-05 — enabling override shows the full provider form
  it('AC-MP-05: enabling override shows provider kind, API key, and model fields', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    // The per-agent API key field should not exist yet
    expect(screen.queryByLabelText(/api key for writingAssistant/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    // Provider kind selector, API key (Anthropic needs key), and model selector appear
    expect(screen.getByLabelText(/provider for writingAssistant/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key for writingAssistant/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/model for writingAssistant/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /test provider connection for writingAssistant/i })).toBeInTheDocument();
  });

  // AC-MP-06 — disabling override hides the form
  it('AC-MP-06: disabling override hides the provider form', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    const toggle = screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i });
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/api key for writingAssistant/i)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByLabelText(/api key for writingAssistant/i)).not.toBeInTheDocument();
  });

  // AC-MP-03 — model selector hidden when override is enabled
  it('AC-MP-03: top-level model selector is hidden when per-agent override is enabled', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/writing assistant model/i));

    // Initially the top-level model selector is visible
    expect(screen.getByLabelText(/writing assistant model/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    // Top-level model selector should be gone; override form's model is present instead
    expect(screen.queryByLabelText(/writing assistant model/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/model for writingAssistant/i)).toBeInTheDocument();
  });

  // AC-MP-08 — per-agent override persists on Save (override enabled)
  it('AC-MP-08: enabled override with API key and model is included in saved settings', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    // Type an API key
    fireEvent.change(screen.getByLabelText(/api key for writingAssistant/i), {
      target: { value: 'sk-ant-agent-key' },
    });

    // Anthropic is default — select opus
    const modelSelect = screen.getByRole('combobox', { name: /model for writingAssistant/i }) as HTMLSelectElement;
    fireEvent.change(modelSelect, { target: { value: 'claude-opus-4-7' } });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.writingAssistant.provider).toBeDefined();
    expect(saved.agents.writingAssistant.provider?.kind).toBe('anthropic');
    expect(saved.agents.writingAssistant.provider?.apiKey).toBe('sk-ant-agent-key');
    expect(saved.agents.writingAssistant.provider?.model).toBe('claude-opus-4-7');
  });

  // AC-MP-08 — per-agent override undefined when disabled
  it('AC-MP-08: disabled override results in undefined provider in saved settings', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('button', { name: /save settings/i }));

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.writingAssistant.provider).toBeUndefined();
    expect(saved.agents.brainstorm.provider).toBeUndefined();
    expect(saved.agents.archive.provider).toBeUndefined();
  });

  // AC-MP-09 — per-agent override restored from loaded settings
  it('AC-MP-09: loaded settings with per-agent provider show override as enabled', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      agents: {
        ...defaultSettings.agents,
        brainstorm: {
          ...defaultSettings.agents.brainstorm,
          provider: { kind: 'anthropic', model: 'claude-opus-4-7', apiKey: 'sk-ant-...brainstorm' },
        },
      },
    });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable brainstorm provider override/i }));

    const toggle = screen.getByRole('checkbox', { name: /enable brainstorm provider override/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    // Override form should be visible with the saved provider kind
    const kindSelect = screen.getByLabelText(/provider for brainstorm/i) as HTMLSelectElement;
    expect(kindSelect.value).toBe('anthropic');
  });

  // AC-MP-09 — restored model value
  it('AC-MP-09: restored provider model matches saved settings', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      agents: {
        ...defaultSettings.agents,
        archive: {
          ...defaultSettings.agents.archive,
          provider: { kind: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: '' },
        },
      },
    });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('combobox', { name: /model for archive/i }));

    const modelSelect = screen.getByRole('combobox', { name: /model for archive/i }) as HTMLSelectElement;
    expect(modelSelect.value).toBe('claude-haiku-4-5-20251001');
  });

  // AC-MP-07 — per-agent API key shows configured hint when key previously set
  it('AC-MP-07: shows "Key is already configured" hint when saved API key exists', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      agents: {
        ...defaultSettings.agents,
        writingAssistant: {
          ...defaultSettings.agents.writingAssistant,
          provider: { kind: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-...saved' },
        },
      },
    });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    expect(screen.getByText(/key is already configured/i)).toBeInTheDocument();
  });

  // AC-MP-07 — key dirty state hides the hint
  it('AC-MP-07: typing a new key removes the "Key is already configured" hint', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      agents: {
        ...defaultSettings.agents,
        writingAssistant: {
          ...defaultSettings.agents.writingAssistant,
          provider: { kind: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-...saved' },
        },
      },
    });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByText(/key is already configured/i));

    fireEvent.change(screen.getByLabelText(/api key for writingAssistant/i), {
      target: { value: 'sk-ant-newkey' },
    });

    expect(screen.queryByText(/key is already configured/i)).not.toBeInTheDocument();
  });

  // AC-MP-07 — saving without touching the key sends the masked value
  it('AC-MP-07: saving without changing per-agent key preserves the stored masked value', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      ...defaultSettings,
      agents: {
        ...defaultSettings.agents,
        writingAssistant: {
          ...defaultSettings.agents.writingAssistant,
          provider: { kind: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-...preserved' },
        },
      },
    });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('button', { name: /save settings/i }));

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.writingAssistant.provider?.apiKey).toBe('sk-ant-...preserved');
  });

  // AC-MP-10 — test connection button calls settingsTestConnection for agent
  it('AC-MP-10: test connection button calls settingsTestConnection with agent config', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable brainstorm provider override/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable brainstorm provider override/i }));
    fireEvent.change(screen.getByLabelText(/api key for brainstorm/i), {
      target: { value: 'sk-ant-testkey' },
    });

    fireEvent.click(screen.getByRole('button', { name: /test provider connection for brainstorm/i }));

    await waitFor(() => expect(mockSettingsTestConnection).toHaveBeenCalledTimes(1));
    expect(mockSettingsTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'anthropic', apiKey: 'sk-ant-testkey' }),
    );
  });

  // AC-MP-10 — test connection success shows green status
  it('AC-MP-10: successful test connection shows "Connection successful" status', async () => {
    mockSettingsTestConnection.mockResolvedValueOnce({ ok: true });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable brainstorm provider override/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable brainstorm provider override/i }));
    fireEvent.click(screen.getByRole('button', { name: /test provider connection for brainstorm/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/connection successful/i));
  });

  // AC-MP-10 — test connection failure shows red alert
  it('AC-MP-10: failed test connection shows error alert', async () => {
    mockSettingsTestConnection.mockResolvedValueOnce({ ok: false, error: 'Invalid API key' });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));
    fireEvent.click(screen.getByRole('button', { name: /test provider connection for writingAssistant/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert', { name: '' })).toHaveTextContent(/invalid api key/i),
    );
  });

  // AC-MP-12 — remote endpoint security warning
  it('AC-MP-12: shows remote endpoint warning for non-localhost base URL', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    await clickAndFlush(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    // Switch to custom to get base URL field
    await changeAndFlush(screen.getByLabelText(/provider for writingAssistant/i), 'custom');

    await changeAndFlush(screen.getByLabelText(/base url for writingAssistant/i), 'https://remote.api.example.com/v1');

    expect(screen.getByRole('alert')).toHaveTextContent(/not on localhost/i);
    await waitFor(() => expect(screen.getByTestId('wa-model-list-error')).toBeInTheDocument());
  });

  // AC-MP-12 — no warning for localhost base URL
  it('AC-MP-12: no remote endpoint warning for localhost base URL', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    await clickAndFlush(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));
    await changeAndFlush(screen.getByLabelText(/provider for writingAssistant/i), 'ollama');

    // Default Ollama URL is localhost — no warning
    expect(screen.queryByText(/not on localhost/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('wa-model-list-error')).toBeInTheDocument());
  });

  // AC-MP-08 — full round-trip for all three agents with different providers
  it('AC-MP-08: all three agent overrides are included in saved settings', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    // Enable Writing Assistant override with Anthropic Haiku
    fireEvent.click(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));
    fireEvent.change(screen.getByRole('combobox', { name: /model for writingAssistant/i }), {
      target: { value: 'claude-haiku-4-5-20251001' },
    });

    // Enable Archive override with Anthropic Opus
    fireEvent.click(screen.getByRole('checkbox', { name: /enable archive provider override/i }));
    fireEvent.change(screen.getByRole('combobox', { name: /model for archive/i }), {
      target: { value: 'claude-opus-4-7' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));

    const saved: AppSettings = mockSettingsSet.mock.calls[0][0];
    expect(saved.agents.writingAssistant.provider?.model).toBe('claude-haiku-4-5-20251001');
    expect(saved.agents.archive.provider?.model).toBe('claude-opus-4-7');
    // Brainstorm override was not enabled
    expect(saved.agents.brainstorm.provider).toBeUndefined();
  });

  // AC-MP-11 — model list fetched when override enabled with listable provider
  it('AC-MP-11: enabling override with Ollama provider triggers providerListModels', async () => {
    mockProviderListModels.mockResolvedValue({ ok: true, models: ['llama3', 'mistral'] });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));
    fireEvent.change(screen.getByLabelText(/provider for writingAssistant/i), {
      target: { value: 'ollama' },
    });

    await waitFor(() => expect(mockProviderListModels).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ollama' }),
    ));
  });

  // AC-MP-11 — model dropdown renders when list succeeds
  it('AC-MP-11: shows model dropdown when providerListModels succeeds for Ollama override', async () => {
    mockProviderListModels.mockResolvedValue({ ok: true, models: ['llama3', 'mistral', 'phi3'] });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));
    fireEvent.change(screen.getByLabelText(/provider for writingAssistant/i), {
      target: { value: 'ollama' },
    });

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /model for writingAssistant/i })).toBeInTheDocument(),
    );
    const select = screen.getByRole('combobox', { name: /model for writingAssistant/i }) as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toContain('llama3');
    expect(opts).toContain('mistral');
    expect(opts).toContain('phi3');
  });

  // AC-MP-11 — error hint when model listing fails for Ollama override
  it('AC-MP-11: shows Ollama error hint when providerListModels fails for override', async () => {
    mockProviderListModels.mockResolvedValue({ ok: false, error: 'Ollama is not running. Start it with ollama serve.' });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: /enable writingAssistant provider override/i }));
    fireEvent.change(screen.getByLabelText(/provider for writingAssistant/i), {
      target: { value: 'ollama' },
    });

    await waitFor(() =>
      expect(screen.getByTestId('wa-model-list-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('wa-model-list-error')).toHaveTextContent(/ollama is not running/i);
  });
});

// ── SKY-1969: keyboard-only navigation through the Settings dialog ──

describe('Settings dialog keyboard navigation (SKY-1969)', () => {
  it('dialog is findable by its accessible heading name', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByRole('dialog', { name: /^settings$/i }));
  });

  it('every aria-labelledby attribute references an element that exists in the DOM', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const labelled = Array.from(document.querySelectorAll('[aria-labelledby]'));
    for (const el of labelled) {
      const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
      for (const id of ids) {
        expect(document.getElementById(id), `aria-labelledby="${id}" points to a missing element`).not.toBeNull();
      }
    }
  });

  it('provider select comes before API key input in tab order', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const dialog = document.querySelector('.settings-panel')!;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !(el as HTMLInputElement).disabled);

    const providerSelect = screen.getByRole('combobox', { name: /ai provider/i });
    const apiKeyInput = screen.getByLabelText(/provider api key/i);

    expect(focusable.indexOf(providerSelect)).toBeGreaterThan(-1);
    expect(focusable.indexOf(apiKeyInput)).toBeGreaterThan(-1);
    expect(focusable.indexOf(providerSelect)).toBeLessThan(focusable.indexOf(apiKeyInput));
  });

  it('Cancel button comes before Save button in tab order', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const dialog = document.querySelector('.settings-panel')!;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !(el as HTMLInputElement).disabled);

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    const saveBtn = screen.getByRole('button', { name: /save settings/i });

    expect(focusable.indexOf(cancelBtn)).toBeLessThan(focusable.indexOf(saveBtn));
  });

  it('all interactive controls in the dialog have accessible names', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => screen.getByLabelText(/anthropic api key/i));

    const dialog = document.querySelector('.settings-panel')!;
    const inputs = Array.from(
      dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input:not([type="radio"]):not([type="checkbox"]), select, textarea'
      )
    );

    for (const input of inputs) {
      const id = input.id;
      const ariaLabel = input.getAttribute('aria-label');
      const ariaLabelledBy = input.getAttribute('aria-labelledby');
      const associatedLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
      const wrappingLabel = input.closest('label');

      const hasAccessibleName =
        !!ariaLabel ||
        !!ariaLabelledBy ||
        !!associatedLabel ||
        (!!wrappingLabel && wrappingLabel.textContent!.trim().length > 0);

      expect(hasAccessibleName, `Input with id="${id}" has no accessible name`).toBe(true);
    }
  });
});

describe('Background image persistence (SKY-2963)', () => {
  const bgPath = '/home/user/Pictures/background.jpg';
  const bgSettings: AppSettings = {
    ...defaultSettings,
    liquidNeon: {
      background: bgPath,
      bgMode: 'image',
    } as LiquidNeonPrefs,
  };

  const mockLoadBgImage = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockSettingsGet.mockResolvedValue(bgSettings);
    mockSettingsSet.mockResolvedValue({ saved: true });
    mockVaultGetPaths.mockResolvedValue(defaultVaultPaths);
    mockVaultSetPaths.mockImplementation((storyVaultPath: string, notesVaultPath: string) =>
      Promise.resolve({ storyVaultPath, notesVaultPath, saved: true }),
    );
    mockChooseVaultFolder.mockResolvedValue({ path: null, cancelled: true });
    mockProviderListModels.mockResolvedValue({ ok: false, error: 'No models available' });
    mockLoadBgImage.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,abc123' });
    (window as unknown as { api: unknown }).api = {
      settingsGet: mockSettingsGet,
      settingsSet: mockSettingsSet,
      vaultGetPaths: mockVaultGetPaths,
      vaultSetPaths: mockVaultSetPaths,
      chooseVaultFolder: mockChooseVaultFolder,
      providerListModels: mockProviderListModels,
      loadBgImage: mockLoadBgImage,
    };
  });

  it('preserves background image path in settingsSet payload after save', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => expect(mockLoadBgImage).toHaveBeenCalledWith(bgPath));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    });
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalled());

    const saved = mockSettingsSet.mock.calls[0][0] as AppSettings;
    expect(saved.liquidNeon?.background).toBe(bgPath);
    expect(saved.liquidNeon?.bgMode).toBe('image');
  });

  it('calls onSaved with background path intact', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} onSaved={mockOnSaved} />);
    await waitFor(() => expect(mockLoadBgImage).toHaveBeenCalledWith(bgPath));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    });
    await waitFor(() => expect(mockOnSaved).toHaveBeenCalled());

    const onSavedArg = mockOnSaved.mock.calls[0][0] as AppSettings;
    expect(onSavedArg.liquidNeon?.background).toBe(bgPath);
    expect(onSavedArg.liquidNeon?.bgMode).toBe('image');
  });
});

describe('Save preserves background image — legacy no-bgMode migration (SKY-3219 / GH#612)', () => {
  const bgPath = '/home/user/Pictures/legacy-wallpaper.png';
  const legacyBgSettings: AppSettings = {
    ...defaultSettings,
    liquidNeon: {
      background: bgPath,
      // bgMode intentionally absent — simulates settings saved before bgMode was introduced
    } as LiquidNeonPrefs,
  };

  const mockLoadBgImage = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockSettingsGet.mockResolvedValue(legacyBgSettings);
    mockSettingsSet.mockResolvedValue({ saved: true });
    mockVaultGetPaths.mockResolvedValue(defaultVaultPaths);
    mockVaultSetPaths.mockImplementation((storyVaultPath: string, notesVaultPath: string) =>
      Promise.resolve({ storyVaultPath, notesVaultPath, saved: true }),
    );
    mockChooseVaultFolder.mockResolvedValue({ path: null, cancelled: true });
    mockProviderListModels.mockResolvedValue({ ok: false, error: 'No models available' });
    mockLoadBgImage.mockResolvedValue({ dataUrl: null });
    (window as unknown as { api: unknown }).api = {
      settingsGet: mockSettingsGet,
      settingsSet: mockSettingsSet,
      vaultGetPaths: mockVaultGetPaths,
      vaultSetPaths: mockVaultSetPaths,
      chooseVaultFolder: mockChooseVaultFolder,
      providerListModels: mockProviderListModels,
      loadBgImage: mockLoadBgImage,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('migrates missing bgMode to image so Save persists background correctly', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} onSaved={mockOnSaved} />);
    await waitFor(() => expect(mockLoadBgImage).toHaveBeenCalledWith(bgPath));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    });
    await waitFor(() => expect(mockOnSaved).toHaveBeenCalled());

    const saved = mockOnSaved.mock.calls[0][0] as AppSettings;
    expect(saved.liquidNeon?.background).toBe(bgPath);
    expect(saved.liquidNeon?.bgMode).toBe('image');
  });

  it('does not reset --bg-app-image when legacy settings have no bgMode and loadBgImage returns null', async () => {
    const previousUrl = 'url("/cached/image.jpg")';
    document.documentElement.style.setProperty('--bg-app-image', previousUrl);

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => expect(mockLoadBgImage).toHaveBeenCalledWith(bgPath));

    // --bg-app-image should NOT have been reset to the gradient
    expect(document.documentElement.style.getPropertyValue('--bg-app-image')).not.toBe(DEFAULT_BG_GRADIENT);
    expect(document.documentElement.style.getPropertyValue('--bg-app-image')).toBe(previousUrl);

    document.documentElement.style.removeProperty('--bg-app-image');
  });
});

describe('SKY-3218 nav-bar configuration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSettingsGet.mockResolvedValue({ ...defaultSettings });
    mockSettingsSet.mockResolvedValue({ saved: true });
    mockVaultGetPaths.mockResolvedValue(defaultVaultPaths);
    mockVaultSetPaths.mockImplementation((storyVaultPath: string, notesVaultPath: string) =>
      Promise.resolve({ storyVaultPath, notesVaultPath, saved: true }),
    );
    mockChooseVaultFolder.mockResolvedValue({ path: null, cancelled: true });
    mockProviderListModels.mockResolvedValue({ ok: false, error: 'No models available' });
    (window as unknown as { api: unknown }).api = {
      settingsGet: mockSettingsGet,
      settingsSet: mockSettingsSet,
      vaultGetPaths: mockVaultGetPaths,
      vaultSetPaths: mockVaultSetPaths,
      chooseVaultFolder: mockChooseVaultFolder,
      providerListModels: mockProviderListModels,
    };
  });

  it('renders Nav-bar section with Story and Notes toggles', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('heading', { name: /nav-bar/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/enable story/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/enable notes/i)).toBeInTheDocument();
  });

  it('renders start-collapsed, show-labels, show-icons toggles', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} />);
    expect(screen.getByRole('checkbox', { name: /start collapsed/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /show.*labels/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /show.*icons/i })).toBeInTheDocument();
  });

  it('persists navConfig with defaults when saved without changes', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} onSaved={mockOnSaved} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    });
    await waitFor(() => expect(mockOnSaved).toHaveBeenCalled());

    const saved = mockOnSaved.mock.calls[0][0] as AppSettings;
    expect(saved.navConfig).toBeDefined();
    expect(saved.navConfig?.items).toHaveLength(2);
    expect(saved.navConfig?.items[0].id).toBe('story');
    expect(saved.navConfig?.items[1].id).toBe('notes');
    expect(saved.navConfig?.showLabels).toBe(true);
    expect(saved.navConfig?.showIcons).toBe(true);
    expect(saved.navConfig?.collapsedDefault).toBe(false);
  });

  it('loads and displays saved navConfig from settings', async () => {
    const savedNavConfig: NavRailConfig = {
      items: [
        { id: 'notes', enabled: true, label: 'Notes', icon: '\u{1F4DD}', order: 0 },
        { id: 'story', enabled: false, label: 'Story', icon: '\u270D', order: 1 },
      ],
      collapsedDefault: true,
      showLabels: false,
      showIcons: true,
    };
    mockSettingsGet.mockResolvedValue({ ...defaultSettings, navConfig: savedNavConfig });

    await renderSettings(<SettingsPanel onClose={mockOnClose} />);

    expect(screen.getByRole('checkbox', { name: /start collapsed/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /show.*labels/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /enable story/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /enable notes/i })).toBeChecked();
  });

  it('persists toggled item state on save', async () => {
    await renderSettings(<SettingsPanel onClose={mockOnClose} onSaved={mockOnSaved} />);

    const notesToggle = screen.getByLabelText(/enable notes/i);
    fireEvent.click(notesToggle);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    });
    await waitFor(() => expect(mockOnSaved).toHaveBeenCalled());

    const saved = mockOnSaved.mock.calls[0][0] as AppSettings;
    const notesItem = saved.navConfig?.items.find((i) => i.id === 'notes');
    expect(notesItem?.enabled).toBe(false);
  });
});

