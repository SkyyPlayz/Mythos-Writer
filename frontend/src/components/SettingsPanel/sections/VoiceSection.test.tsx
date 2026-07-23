// SKY-7771: VoiceSection used to render two independent capture-mode
// controls — the `role=radiogroup` "Capture mode" control writing
// voice.voiceMode, and a separate "Push-to-talk mode" checkbox writing the
// now-deleted voice.pushToTalkMode boolean. This locks in that only the
// radio group remains.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VoiceSection from './VoiceSection';

const baseSettings = {
  apiKey: '',
  agents: {},
  theme: 'dark',
  voice: { enabled: true, cloudFallback: false },
} as unknown as AppSettings;

function setup(settings: AppSettings = baseSettings) {
  const setSettings = vi.fn();
  const setSavedOk = vi.fn();
  render(
    <VoiceSection
      settings={settings}
      setSettings={setSettings}
      providerKind="anthropic"
      setSavedOk={setSavedOk}
      onPickSttBinary={vi.fn()}
      onPickSttModel={vi.fn()}
    />,
  );
  return { setSettings, setSavedOk };
}

describe('VoiceSection — single capture-mode control (SKY-7771)', () => {
  it('renders exactly one capture-mode control (the radio group)', () => {
    setup();
    expect(screen.getByRole('radiogroup', { name: 'Voice capture mode' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Push-to-talk mode')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /push-to-talk/i })).not.toBeInTheDocument();
  });

  it('selecting push-to-talk in the radio group persists voice.voiceMode', () => {
    const { setSettings } = setup();
    fireEvent.click(screen.getByRole('radio', { name: /push-to-talk/i }));

    expect(setSettings).toHaveBeenCalled();
    const updater = setSettings.mock.calls[0][0] as (prev: AppSettings) => AppSettings;
    const next = updater(baseSettings);
    expect(next.voice?.voiceMode).toBe('push-to-talk');
    expect((next.voice as unknown as Record<string, unknown>).pushToTalkMode).toBeUndefined();
  });

  it('selecting toggle in the radio group persists voice.voiceMode', () => {
    const pttSettings = {
      ...baseSettings,
      voice: { enabled: true, cloudFallback: false, voiceMode: 'push-to-talk' as const },
    } as AppSettings;
    const { setSettings } = setup(pttSettings);
    fireEvent.click(screen.getByRole('radio', { name: /toggle/i }));

    const updater = setSettings.mock.calls[0][0] as (prev: AppSettings) => AppSettings;
    const next = updater(pttSettings);
    expect(next.voice?.voiceMode).toBe('toggle');
  });
});
