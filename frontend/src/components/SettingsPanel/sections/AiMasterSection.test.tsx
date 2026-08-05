// M11a (SKY-9160) — master AI switch card. Covers: exact prototype copy,
// immediate persist on flip (settingsGet → settingsSet round-trip), toast
// messages, the "Manual mode is on" indicator, and revert on failed save.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AiMasterSection from './AiMasterSection';
import { DEFAULTS } from '../settingsPanelTypes';
import { __resetAiEnabledForTests, getAiEnabled } from '../../../hooks/useAiEnabled';

const DESCRIPTION_COPY =
  'Turn this off and every AI surface disappears — the Coach, the agent panels, Brainstorm chat, continuity flags, beta reads and AI suggestions. Nothing is sent anywhere. Every tool stays fully usable by hand.';
const MANUAL_NOTE_COPY =
  'Wiki-links and backlinks still auto-build as you type — that is plain text matching, not AI. Timeline, Vault Graph, Scene Crafter beats, drafts, export and the reader all work exactly as before.';

const mockSettingsGet = vi.fn();
const mockSettingsSet = vi.fn();

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULTS, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAiEnabledForTests();
  mockSettingsGet.mockResolvedValue(makeSettings());
  mockSettingsSet.mockResolvedValue({ saved: true });
  Object.defineProperty(window, 'api', {
    value: { settingsGet: mockSettingsGet, settingsSet: mockSettingsSet },
    writable: true,
    configurable: true,
  });
});

function setup(settings: AppSettings = makeSettings()) {
  const setSettings = vi.fn();
  render(<AiMasterSection settings={settings} setSettings={setSettings} />);
  return { setSettings };
}

describe('AiMasterSection (M11a)', () => {
  it('renders the prototype heading, description copy, and an on switch by default', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'AI features' })).toBeInTheDocument();
    expect(screen.getByText(DESCRIPTION_COPY)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'AI features' });
    expect(toggle).toBeChecked();
    expect(screen.queryByText('Manual mode is on')).not.toBeInTheDocument();
  });

  it('treats an absent ai field (pre-M11 settings) as enabled', () => {
    const settings = makeSettings();
    delete (settings as { ai?: unknown }).ai;
    setup(settings);
    expect(screen.getByRole('switch', { name: 'AI features' })).toBeChecked();
  });

  it('turning off persists ai.enabled=false immediately and toasts the manual-mode message', async () => {
    const { setSettings } = setup();
    fireEvent.click(screen.getByRole('switch', { name: 'AI features' }));

    expect(await screen.findByText('AI features off — every tool is now manual')).toBeInTheDocument();
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    expect(mockSettingsSet.mock.calls[0][0].ai).toEqual({ enabled: false });
    expect(setSettings).toHaveBeenCalled();
    expect(getAiEnabled()).toBe(false);
  });

  it('turning back on toasts "AI features back on" and persists ai.enabled=true', async () => {
    setup(makeSettings({ ai: { enabled: false } }));
    fireEvent.click(screen.getByRole('switch', { name: 'AI features' }));

    expect(await screen.findByText('AI features back on')).toBeInTheDocument();
    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledTimes(1));
    expect(mockSettingsSet.mock.calls[0][0].ai).toEqual({ enabled: true });
  });

  it('shows the persistent "Manual mode is on" indicator with prototype copy while off', () => {
    setup(makeSettings({ ai: { enabled: false } }));
    expect(screen.getByRole('switch', { name: 'AI features' })).not.toBeChecked();
    expect(screen.getByText('Manual mode is on')).toBeInTheDocument();
    expect(screen.getByText(MANUAL_NOTE_COPY)).toBeInTheDocument();
  });

  it('reverts the flip and shows an error toast when the save fails', async () => {
    mockSettingsSet.mockRejectedValue(new Error('disk full'));
    const { setSettings } = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'AI features' }));
    });

    expect(await screen.findByText(/Could not save the AI switch — disk full/)).toBeInTheDocument();
    // Optimistic update then revert: last setSettings call restores enabled.
    await waitFor(() => expect(setSettings).toHaveBeenCalledTimes(2));
    expect(getAiEnabled()).toBe(true);
  });
});
