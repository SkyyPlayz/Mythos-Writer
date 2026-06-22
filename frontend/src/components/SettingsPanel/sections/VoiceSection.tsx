import { useState, useCallback, useEffect } from 'react';
import { formatProviderLabel, providerSupportsVoice, type MicDevice, type ProviderKind } from '../settingsPanelTypes';

interface VoiceSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  providerKind: ProviderKind;
  setSavedOk: (ok: boolean) => void;
}

export default function VoiceSection({ settings, setSettings, providerKind, setSavedOk }: VoiceSectionProps) {
  const [micDevices, setMicDevices] = useState<MicDevice[]>([]);

  const refreshMicDevices = useCallback(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const mics = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
      setMicDevices(mics);
    }).catch(() => {});
  }, []);

  useEffect(() => { refreshMicDevices(); }, [refreshMicDevices]);

  const activeProvider = settings.provider?.kind === providerKind ? settings.provider : undefined;
  const activeProviderSupportsVoice = providerSupportsVoice(activeProvider);
  const shouldShowVoiceProviderSelector =
    (settings.stt?.provider ?? 'local') !== 'local' || (settings.tts?.provider ?? 'local') !== 'local';
  const voiceProviders = activeProviderSupportsVoice && activeProvider ? [activeProvider] : [];

  return (
    <section className="settings-section" aria-labelledby="section-voice" data-settings-cat="agents">
      <h3 className="settings-section-title" id="section-voice">Voice</h3>
      <div className="settings-field">
        <div className="settings-agent-header">
          <span className="settings-label">Enable voice input</span>
          <label className="settings-toggle" htmlFor="voice-enabled">
            <input
              id="voice-enabled"
              type="checkbox"
              aria-label="Enable voice input"
              checked={settings.voice?.enabled ?? false}
              onChange={(e) => {
                const checked = e.target.checked;
                setSettings((p) => {
                  const voiceBase = { cloudFallback: false, ...p.voice };
                  return { ...p, voice: { ...voiceBase, enabled: checked } };
                });
                setSavedOk(false);
              }}
            />
            <span className="settings-toggle-track" />
          </label>
        </div>

        {(settings.voice?.enabled) && (
          <>
            {/* Capture mode */}
            <div className="settings-field">
              <span className="settings-label">Capture mode</span>
              <div className="settings-radio-group" role="radiogroup" aria-label="Voice capture mode">
                <label className="settings-radio-label">
                  <input
                    type="radio"
                    name="voice-mode"
                    value="toggle"
                    checked={(settings.voice?.voiceMode ?? 'toggle') === 'toggle'}
                    onChange={() => {
                      setSettings((p) => ({
                        ...p,
                        voice: { ...(p.voice ?? { enabled: true, cloudFallback: false }), voiceMode: 'toggle' },
                      }));
                      setSavedOk(false);
                    }}
                  />
                  <span>Toggle — press <kbd>Ctrl+Shift+V</kbd> to start/stop</span>
                </label>
                <label className="settings-radio-label">
                  <input
                    type="radio"
                    name="voice-mode"
                    value="push-to-talk"
                    checked={settings.voice?.voiceMode === 'push-to-talk'}
                    onChange={() => {
                      setSettings((p) => ({
                        ...p,
                        voice: { ...(p.voice ?? { enabled: true, cloudFallback: false }), voiceMode: 'push-to-talk' },
                      }));
                      setSavedOk(false);
                    }}
                  />
                  <span>Push-to-talk — hold <kbd>Alt+V</kbd> while speaking</span>
                </label>
              </div>
            </div>

            {/* Microphone device */}
            <div className="settings-field settings-field-inline">
              <label className="settings-label" htmlFor="voice-mic">Microphone</label>
              <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
                <select
                  id="voice-mic"
                  className="settings-input settings-select"
                  style={{ flex: 1 }}
                  value={settings.voice?.micDeviceId ?? ''}
                  aria-label="Microphone selection"
                  onChange={(e) => {
                    const val = e.target.value || undefined;
                    setSettings((p) => ({
                      ...p,
                      voice: { ...(p.voice ?? { enabled: true, cloudFallback: false }), micDeviceId: val },
                    }));
                    setSavedOk(false);
                  }}
                >
                  <option value="">System default</option>
                  {micDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="settings-btn"
                  onClick={refreshMicDevices}
                  aria-label="Refresh microphone list"
                  title="Refresh device list"
                >
                  ↺
                </button>
              </div>
            </div>
          </>
        )}

        <div className="settings-agent-header" style={{ marginTop: '8px' }}>
          <span className="settings-label">Push-to-talk mode</span>
          <label className="settings-toggle" htmlFor="voice-ptt">
            <input
              id="voice-ptt"
              type="checkbox"
              aria-label="Push-to-talk mode"
              checked={settings.voice?.pushToTalkMode ?? false}
              onChange={(e) => {
                const pushToTalkMode = e.target.checked;
                setSettings((p) => ({
                  ...p,
                  voice: { ...(p.voice ?? { enabled: false, cloudFallback: false }), pushToTalkMode },
                }));
                setSavedOk(false);
              }}
            />
            <span className="settings-toggle-track" />
          </label>
        </div>

        {shouldShowVoiceProviderSelector && (
          <>
            <div className="settings-field settings-field-inline">
              <label className="settings-label" htmlFor="voice-provider-select">Voice Provider</label>
              <select
                id="voice-provider-select"
                className="settings-input settings-select"
                value={settings.voiceProviderId ?? ''}
                aria-label="Voice provider"
                aria-describedby="voice-provider-hint"
                onChange={(e) => {
                  const val = e.target.value || undefined;
                  setSettings((p) => ({ ...p, voiceProviderId: val }));
                  setSavedOk(false);
                }}
              >
                <option value="">
                  {voiceProviders.length === 0
                    ? 'No providers support voice — configure an OpenAI-compatible provider'
                    : 'Select a provider…'}
                </option>
                {voiceProviders.map((provider) => (
                  <option key={provider.kind} value={provider.kind}>
                    {formatProviderLabel(provider)}
                  </option>
                ))}
              </select>
            </div>
            <p className="settings-hint" id="voice-provider-hint">
              Voice provider controls cloud speech-to-text and text-to-speech. Only providers with voice capabilities (OpenAI or OpenAI-compatible custom endpoints) are shown; local STT/TTS stays on your device.
            </p>
          </>
        )}

        <div className="settings-field settings-field-inline">
          <label className="settings-label" htmlFor="voice-language">Input language</label>
          <select
            id="voice-language"
            className="settings-input settings-select"
            value={settings.voice?.inputLanguage ?? ''}
            aria-label="STT input language"
            onChange={(e) => {
              const val = e.target.value || undefined;
              setSettings((p) => {
                const voiceBase = { enabled: false, cloudFallback: false, ...p.voice };
                return { ...p, voice: { ...voiceBase, inputLanguage: val } };
              });
              setSavedOk(false);
            }}
          >
            <option value="">Auto-detect</option>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="es-ES">Spanish (Spain)</option>
            <option value="es-MX">Spanish (Mexico)</option>
            <option value="fr-FR">French</option>
            <option value="de-DE">German</option>
            <option value="pt-BR">Portuguese (Brazil)</option>
            <option value="ja-JP">Japanese</option>
            <option value="zh-CN">Chinese (Simplified)</option>
          </select>
        </div>
        <div className="settings-field settings-field-inline">
          <label className="settings-label" htmlFor="voice-tts-voice">TTS voice</label>
          <input
            id="voice-tts-voice"
            className="settings-input"
            type="text"
            value={settings.voice?.ttsVoiceId ?? ''}
            placeholder="e.g. alloy, nova, en_US/vctk_low"
            spellCheck={false}
            aria-label="TTS voice identifier"
            onChange={(e) => {
              const val = e.target.value || undefined;
              setSettings((p) => {
                const voiceBase = { enabled: false, cloudFallback: false, ...p.voice };
                return { ...p, voice: { ...voiceBase, ttsVoiceId: val } };
              });
              setSavedOk(false);
            }}
          />
        </div>
        <div className="settings-field settings-field-inline">
          <label className="settings-label" htmlFor="voice-tts-volume">TTS volume</label>
          <div className="settings-slider-row">
            <input
              id="voice-tts-volume"
              className="settings-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.voice?.ttsVolume ?? 1}
              aria-label="TTS volume"
              onChange={(e) => {
                const val = Number(e.target.value);
                setSettings((p) => {
                  const voiceBase = { enabled: false, cloudFallback: false, ...p.voice };
                  return { ...p, voice: { ...voiceBase, ttsVolume: val } };
                });
                setSavedOk(false);
              }}
            />
            <span className="settings-slider-value">{Math.round((settings.voice?.ttsVolume ?? 1) * 100)}%</span>
          </div>
        </div>
        <div className="settings-field settings-field-inline">
          <label className="settings-label" htmlFor="voice-tts-rate">TTS rate</label>
          <div className="settings-slider-row">
            <input
              id="voice-tts-rate"
              className="settings-slider"
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={settings.voice?.ttsRate ?? 1}
              aria-label="TTS speech rate"
              onChange={(e) => {
                const val = Number(e.target.value);
                setSettings((p) => {
                  const voiceBase = { enabled: false, cloudFallback: false, ...p.voice };
                  return { ...p, voice: { ...voiceBase, ttsRate: val } };
                });
                setSavedOk(false);
              }}
            />
            <span className="settings-slider-value">{(settings.voice?.ttsRate ?? 1).toFixed(1)}×</span>
          </div>
        </div>
        <div className="settings-field settings-field-inline">
          <label className="settings-toggle" htmlFor="voice-persistent-mute">
            <input
              id="voice-persistent-mute"
              type="checkbox"
              aria-label="Start microphone muted"
              checked={settings.voice?.persistentMute ?? false}
              onChange={(e) => {
                const checked = e.target.checked;
                setSettings((p) => {
                  const voiceBase = { enabled: false, cloudFallback: false, ...p.voice };
                  return { ...p, voice: { ...voiceBase, persistentMute: checked } };
                });
                setSavedOk(false);
              }}
            />
            <span className="settings-toggle-track" />
          </label>
          <span className="settings-label">Start microphone muted</span>
        </div>

        <p className="settings-hint">
          When push-to-talk is on, hold <kbd>Ctrl+Shift+M</kbd> to record and release to stop.
          When off, <kbd>Ctrl+Shift+M</kbd> toggles recording on/off.
          Requires microphone permission.
        </p>
      </div>
    </section>
  );
}
