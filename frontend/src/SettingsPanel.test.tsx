import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsPanel from './SettingsPanel';

const defaultSettings: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: { enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30 },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6' },
    archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60 },
  },
  theme: 'dark',
};

const mockSettingsGet = vi.fn();
const mockSettingsSet = vi.fn();
const mockOnClose = vi.fn();
const mockOnSaved = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  mockSettingsGet.mockResolvedValue(defaultSettings);
  mockSettingsSet.mockResolvedValue({ saved: true });
  (window as unknown as { api: unknown }).api = {
    settingsGet: mockSettingsGet,
    settingsSet: mockSettingsSet,
  };
});

describe('SettingsPanel', () => {
  it('renders all sections after loading', async () => {
    render(<SettingsPanel onClose={mockOnClose} />);
    await waitFor(() => expect(screen.getByLabelText(/anthropic api key/i)).toBeInTheDocument());
    expect(screen.getByText(/writing assistant/i)).toBeInTheDocument();
    expect(screen.getByText(/brainstorm agent/i)).toBeInTheDocument();
    expect(screen.getByText(/archive agent/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^theme$/i })).toBeInTheDocument();
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
});
