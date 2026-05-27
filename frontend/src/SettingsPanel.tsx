import { useState, useEffect, useCallback, useRef } from 'react';
import defaultBg from './assets/default-bg.webp';
import { applyLiquidGlassTokens, LG_DEFAULTS } from './theme';
import './SettingsPanel.css';

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku' },
  { value: 'claude-sonnet-4-6', label: 'claude-sonnet' },
  { value: 'claude-opus-4-7', label: 'claude-opus' },
];

const BUDGET_DEFAULTS: AgentBudgetSettings = {
  autoApply: false,
  confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000,
  maxSuggestionsPerHour: 50,
  heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500_000,
};

const AGENT_VOICE_DEFAULTS: AgentVoiceSettings = {
  ttsEnabled: false,
  sttEngine: 'local',
};

const DEFAULTS: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: { enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, ...BUDGET_DEFAULTS, ...AGENT_VOICE_DEFAULTS },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6', ...BUDGET_DEFAULTS, ...AGENT_VOICE_DEFAULTS },
    archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, ...BUDGET_DEFAULTS, ...AGENT_VOICE_DEFAULTS },
  },
  theme: 'dark',
  snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  telemetry: { enabled: false },
  liquidGlass: LG_DEFAULTS,
};

function validateApiKey(key: string): string | null {
  if (!key) return null;
  if (!key.startsWith('sk-ant-')) return 'Key must start with sk-ant-';
  return null;
}

interface Props {
  onClose: () => void;
  onSaved?: (settings: AppSettings) => void;
  onRerunOnboarding?: () => void;
}

export default function SettingsPanel({ onClose, onSaved, onRerunOnboarding }: Props) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  // Separate input state so the masked value from settingsGet never appears in the writable field.
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const micEnumeratedRef = useRef(false);

  useEffect(() => {
    window.api.settingsGet().then((s) => {
      setSettings(s);
      // Do not populate the input — masked value stays in settings state only
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const enumerateMics = useCallback(async () => {
    if (micEnumeratedRef.current) return;
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermission('granted');
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(devices.filter((d) => d.kind === 'audioinput'));
      micEnumeratedRef.current = true;
    } catch {
      setMicPermission('denied');
    }
  }, []);

  // Enumerate mics on load when voice is already enabled from a previous session
  useEffect(() => {
    if (!loading && settings.voice?.enabled) {
      enumerateMics();
    }
  }, [loading, settings.voice?.enabled, enumerateMics]);

  const keyIsConfigured = Boolean(settings.apiKey);
  // Only validate when the user has touched the field; an untouched empty input is not an error.
  const apiKeyError = apiKeyDirty ? validateApiKey(apiKeyInput) : null;

  const setAgentField = useCallback(<A extends keyof AppSettings['agents'], K extends keyof AppSettings['agents'][A]>(
    agent: A,
    field: K,
    value: AppSettings['agents'][A][K],
  ) => {
    setSettings((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        [agent]: { ...prev.agents[agent], [field]: value },
      },
    }));
    setSavedOk(false);
  }, []);

  const setLgField = useCallback(<K extends keyof LiquidGlassPrefs>(field: K, value: LiquidGlassPrefs[K]) => {
    setSettings((prev) => {
      const next = { ...prev, liquidGlass: { ...(prev.liquidGlass ?? LG_DEFAULTS), [field]: value } };
      applyLiquidGlassTokens(next.liquidGlass!);
      return next;
    });
    setSavedOk(false);
  }, []);

  const handleResetLg = useCallback(() => {
    setSettings((prev) => ({ ...prev, liquidGlass: LG_DEFAULTS }));
    applyLiquidGlassTokens(LG_DEFAULTS);
    setSavedOk(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (apiKeyError) return;
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const payload: AppSettings = {
        ...settings,
        // When dirty: send the typed value ('' clears the key; a new sk-ant-... value updates it).
        // When not dirty: echo the masked value back so the backend guard preserves the stored key.
        apiKey: apiKeyDirty ? apiKeyInput : settings.apiKey,
      };
      await window.api.settingsSet(payload);
      applyLiquidGlassTokens(payload.liquidGlass ?? LG_DEFAULTS);
      setSavedOk(true);
      onSaved?.(payload);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }, [settings, apiKeyInput, apiKeyDirty, apiKeyError, onSaved]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (loading) {
    return (
      <div className="settings-overlay" onClick={handleBackdropClick} aria-modal="true" role="dialog">
        <div className="settings-panel">
          <div className="settings-loading">Loading settings…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-overlay" onClick={handleBackdropClick} aria-modal="true" role="dialog" aria-label="Settings">
      <div className="settings-panel">
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="settings-body">

          {/* ── API Key ── */}
          <section className="settings-section" aria-labelledby="section-api-key">
            <h3 className="settings-section-title" id="section-api-key">API Key</h3>
            <div className="settings-field">
              <label className="settings-label" htmlFor="api-key-input">Anthropic API Key</label>
              <div className="settings-input-row">
                <input
                  id="api-key-input"
                  className={`settings-input${apiKeyError ? ' settings-input-error' : ''}`}
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => { setApiKeyInput(e.target.value); setApiKeyDirty(true); setSavedOk(false); }}
                  placeholder={keyIsConfigured ? 'Key configured — enter a new key to replace' : 'sk-ant-…'}
                  aria-describedby={apiKeyError ? 'api-key-error' : undefined}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  className="settings-reveal-btn"
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              </div>
              {apiKeyError && (
                <p className="settings-error-msg" id="api-key-error" role="alert">{apiKeyError}</p>
              )}
              {!apiKeyDirty && keyIsConfigured && (
                <p className="settings-hint" data-testid="key-configured-hint">Key is already configured.</p>
              )}
              <p className="settings-hint">Used by all AI agents. Falls back to the ANTHROPIC_API_KEY environment variable if left empty.</p>
            </div>
          </section>

          {/* ── Agents ── */}
          <section className="settings-section" aria-labelledby="section-agents">
            <h3 className="settings-section-title" id="section-agents">Agents</h3>

            <div className="settings-agent-card">
              <div className="settings-agent-header">
                <span className="settings-agent-name">Writing Assistant</span>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    aria-label="Enable Writing Assistant"
                    checked={settings.agents.writingAssistant.enabled}
                    onChange={(e) => setAgentField('writingAssistant', 'enabled', e.target.checked)}
                  />
                  <span className="settings-toggle-track" />
                </label>
              </div>
              <div className="settings-agent-fields">
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="wa-model">Model</label>
                  <select
                    id="wa-model"
                    className="settings-input settings-select settings-input-sm"
                    value={settings.agents.writingAssistant.model}
                    aria-label="Writing Assistant model"
                    onChange={(e) => setAgentField('writingAssistant', 'model', e.target.value)}
                  >
                    {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="wa-interval">Scan interval (s)</label>
                  <input
                    id="wa-interval"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={5}
                    max={3600}
                    value={settings.agents.writingAssistant.scanIntervalSeconds}
                    onChange={(e) => setAgentField('writingAssistant', 'scanIntervalSeconds', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="wa-heartbeat">Heartbeat interval (min)</label>
                  <input
                    id="wa-heartbeat"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1}
                    max={120}
                    value={settings.agents.writingAssistant.heartbeatIntervalMinutes}
                    onChange={(e) => setAgentField('writingAssistant', 'heartbeatIntervalMinutes', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-toggle" htmlFor="wa-auto-apply">
                    <input
                      id="wa-auto-apply"
                      type="checkbox"
                      aria-label="Auto-apply Writing Assistant suggestions"
                      checked={settings.agents.writingAssistant.autoApply}
                      onChange={(e) => setAgentField('writingAssistant', 'autoApply', e.target.checked)}
                    />
                    <span className="settings-toggle-track" />
                  </label>
                  <span className="settings-label">Auto-apply suggestions</span>
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="wa-confidence">Auto-apply threshold</label>
                  <div className="settings-slider-row">
                    <input
                      id="wa-confidence"
                      className="settings-slider"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      disabled={!settings.agents.writingAssistant.autoApply}
                      value={settings.agents.writingAssistant.confidenceThreshold}
                      aria-label="Writing Assistant auto-apply threshold"
                      onChange={(e) => setAgentField('writingAssistant', 'confidenceThreshold', Number(e.target.value))}
                    />
                    <span className="settings-slider-value">{settings.agents.writingAssistant.confidenceThreshold.toFixed(2)}</span>
                  </div>
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="wa-max-tokens-day">Max tokens/day</label>
                  <input
                    id="wa-max-tokens-day"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1000}
                    max={10_000_000}
                    step={1000}
                    value={settings.agents.writingAssistant.maxTokensPerDay}
                    onChange={(e) => setAgentField('writingAssistant', 'maxTokensPerDay', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="wa-max-suggestions">Max suggestions/hr</label>
                  <input
                    id="wa-max-suggestions"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1}
                    max={1000}
                    value={settings.agents.writingAssistant.maxSuggestionsPerHour}
                    onChange={(e) => setAgentField('writingAssistant', 'maxSuggestionsPerHour', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="wa-max-tokens">Max tokens/hr</label>
                  <input
                    id="wa-max-tokens"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1000}
                    max={1_000_000}
                    step={1000}
                    value={settings.agents.writingAssistant.maxTokensPerHour}
                    onChange={(e) => setAgentField('writingAssistant', 'maxTokensPerHour', Number(e.target.value))}
                  />
                </div>
                {settings.voice?.enabled && (
                  <>
                    <div className="settings-field settings-field-inline">
                      <label className="settings-toggle" htmlFor="wa-tts-enabled">
                        <input
                          id="wa-tts-enabled"
                          type="checkbox"
                          aria-label="Enable TTS replies for Writing Assistant"
                          checked={settings.agents.writingAssistant.ttsEnabled ?? false}
                          onChange={(e) => setAgentField('writingAssistant', 'ttsEnabled', e.target.checked)}
                        />
                        <span className="settings-toggle-track" />
                      </label>
                      <span className="settings-label">Speak replies (TTS)</span>
                    </div>
                    <div className="settings-field settings-field-inline">
                      <label className="settings-label" htmlFor="wa-stt-engine">STT engine</label>
                      <select
                        id="wa-stt-engine"
                        className="settings-input settings-select settings-input-sm"
                        value={settings.agents.writingAssistant.sttEngine ?? 'local'}
                        aria-label="STT engine for Writing Assistant"
                        onChange={(e) => setAgentField('writingAssistant', 'sttEngine', e.target.value as 'local' | 'cloud')}
                      >
                        <option value="local">Local (Web Speech API)</option>
                        <option value="cloud">Cloud (Whisper)</option>
                      </select>
                    </div>
                    {micPermission === 'granted' && micDevices.length > 0 && (
                      <div className="settings-field settings-field-inline">
                        <label className="settings-label" htmlFor="wa-agent-mic-device">Microphone</label>
                        <select
                          id="wa-agent-mic-device"
                          className="settings-input settings-select"
                          value={settings.agents.writingAssistant.micDeviceId ?? ''}
                          aria-label="Microphone for Writing Assistant"
                          onChange={(e) => {
                            const val = e.target.value || undefined;
                            setSettings((p) => ({ ...p, agents: { ...p.agents, writingAssistant: { ...p.agents.writingAssistant, micDeviceId: val } } }));
                            setSavedOk(false);
                          }}
                        >
                          <option value="">Use global default</option>
                          {micDevices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="settings-agent-card">
              <div className="settings-agent-header">
                <span className="settings-agent-name">Brainstorm Agent</span>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    aria-label="Enable Brainstorm Agent"
                    checked={settings.agents.brainstorm.enabled}
                    onChange={(e) => setAgentField('brainstorm', 'enabled', e.target.checked)}
                  />
                  <span className="settings-toggle-track" />
                </label>
              </div>
              <div className="settings-agent-fields">
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="brainstorm-model">Model</label>
                  <select
                    id="brainstorm-model"
                    className="settings-input settings-select settings-input-sm"
                    value={settings.agents.brainstorm.model}
                    aria-label="Brainstorm Agent model"
                    onChange={(e) => setAgentField('brainstorm', 'model', e.target.value)}
                  >
                    {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="brainstorm-heartbeat">Heartbeat interval (min)</label>
                  <input
                    id="brainstorm-heartbeat"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1}
                    max={120}
                    value={settings.agents.brainstorm.heartbeatIntervalMinutes}
                    onChange={(e) => setAgentField('brainstorm', 'heartbeatIntervalMinutes', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-toggle" htmlFor="brainstorm-auto-apply">
                    <input
                      id="brainstorm-auto-apply"
                      type="checkbox"
                      aria-label="Auto-apply Brainstorm Agent suggestions"
                      checked={settings.agents.brainstorm.autoApply}
                      onChange={(e) => setAgentField('brainstorm', 'autoApply', e.target.checked)}
                    />
                    <span className="settings-toggle-track" />
                  </label>
                  <span className="settings-label">Auto-apply suggestions</span>
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="brainstorm-confidence">Auto-apply threshold</label>
                  <div className="settings-slider-row">
                    <input
                      id="brainstorm-confidence"
                      className="settings-slider"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      disabled={!settings.agents.brainstorm.autoApply}
                      value={settings.agents.brainstorm.confidenceThreshold}
                      aria-label="Brainstorm Agent auto-apply threshold"
                      onChange={(e) => setAgentField('brainstorm', 'confidenceThreshold', Number(e.target.value))}
                    />
                    <span className="settings-slider-value">{settings.agents.brainstorm.confidenceThreshold.toFixed(2)}</span>
                  </div>
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="brainstorm-max-tokens-day">Max tokens/day</label>
                  <input
                    id="brainstorm-max-tokens-day"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1000}
                    max={10_000_000}
                    step={1000}
                    value={settings.agents.brainstorm.maxTokensPerDay}
                    onChange={(e) => setAgentField('brainstorm', 'maxTokensPerDay', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="brainstorm-max-suggestions">Max suggestions/hr</label>
                  <input
                    id="brainstorm-max-suggestions"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1}
                    max={1000}
                    value={settings.agents.brainstorm.maxSuggestionsPerHour}
                    onChange={(e) => setAgentField('brainstorm', 'maxSuggestionsPerHour', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="brainstorm-max-tokens">Max tokens/hr</label>
                  <input
                    id="brainstorm-max-tokens"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1000}
                    max={1_000_000}
                    step={1000}
                    value={settings.agents.brainstorm.maxTokensPerHour}
                    onChange={(e) => setAgentField('brainstorm', 'maxTokensPerHour', Number(e.target.value))}
                  />
                </div>
                {settings.voice?.enabled && (
                  <>
                    <div className="settings-field settings-field-inline">
                      <label className="settings-toggle" htmlFor="brainstorm-tts-enabled">
                        <input
                          id="brainstorm-tts-enabled"
                          type="checkbox"
                          aria-label="Enable TTS replies for Brainstorm Agent"
                          checked={settings.agents.brainstorm.ttsEnabled ?? false}
                          onChange={(e) => setAgentField('brainstorm', 'ttsEnabled', e.target.checked)}
                        />
                        <span className="settings-toggle-track" />
                      </label>
                      <span className="settings-label">Speak replies (TTS)</span>
                    </div>
                    <div className="settings-field settings-field-inline">
                      <label className="settings-label" htmlFor="brainstorm-stt-engine">STT engine</label>
                      <select
                        id="brainstorm-stt-engine"
                        className="settings-input settings-select settings-input-sm"
                        value={settings.agents.brainstorm.sttEngine ?? 'local'}
                        aria-label="STT engine for Brainstorm Agent"
                        onChange={(e) => setAgentField('brainstorm', 'sttEngine', e.target.value as 'local' | 'cloud')}
                      >
                        <option value="local">Local (Web Speech API)</option>
                        <option value="cloud">Cloud (Whisper)</option>
                      </select>
                    </div>
                    {micPermission === 'granted' && micDevices.length > 0 && (
                      <div className="settings-field settings-field-inline">
                        <label className="settings-label" htmlFor="brainstorm-agent-mic-device">Microphone</label>
                        <select
                          id="brainstorm-agent-mic-device"
                          className="settings-input settings-select"
                          value={settings.agents.brainstorm.micDeviceId ?? ''}
                          aria-label="Microphone for Brainstorm Agent"
                          onChange={(e) => {
                            const val = e.target.value || undefined;
                            setSettings((p) => ({ ...p, agents: { ...p.agents, brainstorm: { ...p.agents.brainstorm, micDeviceId: val } } }));
                            setSavedOk(false);
                          }}
                        >
                          <option value="">Use global default</option>
                          {micDevices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="settings-agent-card">
              <div className="settings-agent-header">
                <span className="settings-agent-name">Archive Agent</span>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    aria-label="Enable Archive Agent"
                    checked={settings.agents.archive.enabled}
                    onChange={(e) => setAgentField('archive', 'enabled', e.target.checked)}
                  />
                  <span className="settings-toggle-track" />
                </label>
              </div>
              <div className="settings-agent-fields">
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="archive-model">Model</label>
                  <select
                    id="archive-model"
                    className="settings-input settings-select settings-input-sm"
                    value={settings.agents.archive.model}
                    aria-label="Archive Agent model"
                    onChange={(e) => setAgentField('archive', 'model', e.target.value)}
                  >
                    {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="archive-interval">Continuity check interval (s)</label>
                  <input
                    id="archive-interval"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={5}
                    max={3600}
                    value={settings.agents.archive.continuityCheckIntervalSeconds}
                    onChange={(e) => setAgentField('archive', 'continuityCheckIntervalSeconds', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="archive-heartbeat">Heartbeat interval (min)</label>
                  <input
                    id="archive-heartbeat"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1}
                    max={120}
                    value={settings.agents.archive.heartbeatIntervalMinutes}
                    onChange={(e) => setAgentField('archive', 'heartbeatIntervalMinutes', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-toggle" htmlFor="archive-auto-apply">
                    <input
                      id="archive-auto-apply"
                      type="checkbox"
                      aria-label="Auto-apply Archive Agent suggestions"
                      checked={settings.agents.archive.autoApply}
                      onChange={(e) => setAgentField('archive', 'autoApply', e.target.checked)}
                    />
                    <span className="settings-toggle-track" />
                  </label>
                  <span className="settings-label">Auto-apply suggestions</span>
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="archive-confidence">Auto-apply threshold</label>
                  <div className="settings-slider-row">
                    <input
                      id="archive-confidence"
                      className="settings-slider"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      disabled={!settings.agents.archive.autoApply}
                      value={settings.agents.archive.confidenceThreshold}
                      aria-label="Archive Agent auto-apply threshold"
                      onChange={(e) => setAgentField('archive', 'confidenceThreshold', Number(e.target.value))}
                    />
                    <span className="settings-slider-value">{settings.agents.archive.confidenceThreshold.toFixed(2)}</span>
                  </div>
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="archive-max-tokens-day">Max tokens/day</label>
                  <input
                    id="archive-max-tokens-day"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1000}
                    max={10_000_000}
                    step={1000}
                    value={settings.agents.archive.maxTokensPerDay}
                    onChange={(e) => setAgentField('archive', 'maxTokensPerDay', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="archive-max-suggestions">Max suggestions/hr</label>
                  <input
                    id="archive-max-suggestions"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1}
                    max={1000}
                    value={settings.agents.archive.maxSuggestionsPerHour}
                    onChange={(e) => setAgentField('archive', 'maxSuggestionsPerHour', Number(e.target.value))}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="archive-max-tokens">Max tokens/hr</label>
                  <input
                    id="archive-max-tokens"
                    className="settings-input settings-input-sm settings-input-number"
                    type="number"
                    min={1000}
                    max={1_000_000}
                    step={1000}
                    value={settings.agents.archive.maxTokensPerHour}
                    onChange={(e) => setAgentField('archive', 'maxTokensPerHour', Number(e.target.value))}
                  />
                </div>
                {settings.voice?.enabled && (
                  <>
                    <div className="settings-field settings-field-inline">
                      <label className="settings-toggle" htmlFor="archive-tts-enabled">
                        <input
                          id="archive-tts-enabled"
                          type="checkbox"
                          aria-label="Enable TTS replies for Archive Agent"
                          checked={settings.agents.archive.ttsEnabled ?? false}
                          onChange={(e) => setAgentField('archive', 'ttsEnabled', e.target.checked)}
                        />
                        <span className="settings-toggle-track" />
                      </label>
                      <span className="settings-label">Speak replies (TTS)</span>
                    </div>
                    <div className="settings-field settings-field-inline">
                      <label className="settings-label" htmlFor="archive-stt-engine">STT engine</label>
                      <select
                        id="archive-stt-engine"
                        className="settings-input settings-select settings-input-sm"
                        value={settings.agents.archive.sttEngine ?? 'local'}
                        aria-label="STT engine for Archive Agent"
                        onChange={(e) => setAgentField('archive', 'sttEngine', e.target.value as 'local' | 'cloud')}
                      >
                        <option value="local">Local (Web Speech API)</option>
                        <option value="cloud">Cloud (Whisper)</option>
                      </select>
                    </div>
                    {micPermission === 'granted' && micDevices.length > 0 && (
                      <div className="settings-field settings-field-inline">
                        <label className="settings-label" htmlFor="archive-agent-mic-device">Microphone</label>
                        <select
                          id="archive-agent-mic-device"
                          className="settings-input settings-select"
                          value={settings.agents.archive.micDeviceId ?? ''}
                          aria-label="Microphone for Archive Agent"
                          onChange={(e) => {
                            const val = e.target.value || undefined;
                            setSettings((p) => ({ ...p, agents: { ...p.agents, archive: { ...p.agents.archive, micDeviceId: val } } }));
                            setSavedOk(false);
                          }}
                        >
                          <option value="">Use global default</option>
                          {micDevices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ── Snapshots ── */}
          <section className="settings-section" aria-labelledby="section-snapshots">
            <h3 className="settings-section-title" id="section-snapshots">Snapshots</h3>
            <div className="settings-agent-fields">
              <div className="settings-field settings-field-inline">
                <label className="settings-label" htmlFor="snap-max-per-scene">Max snapshots per scene</label>
                <input
                  id="snap-max-per-scene"
                  className="settings-input settings-input-sm settings-input-number"
                  type="number"
                  min={1}
                  max={500}
                  value={settings.snapshots?.maxPerScene ?? 100}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setSettings((p) => ({ ...p, snapshots: { maxAgeDays: p.snapshots?.maxAgeDays ?? 30, maxPerScene: val } }));
                    setSavedOk(false);
                  }}
                />
              </div>
              <div className="settings-field settings-field-inline">
                <label className="settings-label" htmlFor="snap-max-age-days">Retain snapshots for (days, 0=unlimited)</label>
                <input
                  id="snap-max-age-days"
                  className="settings-input settings-input-sm settings-input-number"
                  type="number"
                  min={0}
                  max={365}
                  value={settings.snapshots?.maxAgeDays ?? 30}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setSettings((p) => ({ ...p, snapshots: { maxPerScene: p.snapshots?.maxPerScene ?? 100, maxAgeDays: val } }));
                    setSavedOk(false);
                  }}
                />
              </div>
            </div>
            <p className="settings-hint">Snapshots are taken automatically while you write. Older ones are pruned by count and age.</p>
          </section>

          {/* ── Onboarding ── */}
          {onRerunOnboarding && (
            <section className="settings-section" aria-labelledby="section-onboarding">
              <h3 className="settings-section-title" id="section-onboarding">Onboarding</h3>
              <div className="settings-field">
                <button
                  className="settings-btn settings-btn-cancel"
                  type="button"
                  onClick={onRerunOnboarding}
                  data-testid="rerun-onboarding-btn"
                >
                  Run Setup Wizard…
                </button>
                <p className="settings-hint">Re-run the first-run wizard to change your vault, API key, or default agents.</p>
              </div>
            </section>
          )}

          {/* ── Voice IO ── */}
          <section className="settings-section" aria-labelledby="section-voice">
            <h3 className="settings-section-title" id="section-voice">Voice Input</h3>
            <div className="settings-field settings-field-inline">
              <label className="settings-toggle" htmlFor="voice-enabled">
                <input
                  id="voice-enabled"
                  type="checkbox"
                  aria-label="Enable voice input"
                  checked={settings.voice?.enabled ?? false}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setSettings((p) => ({ ...p, voice: { enabled, cloudFallback: p.voice?.cloudFallback ?? false, micDeviceId: p.voice?.micDeviceId } }));
                    setSavedOk(false);
                    if (enabled) enumerateMics();
                  }}
                />
                <span className="settings-toggle-track" />
              </label>
              <span className="settings-label">Enable voice input (mic button in Writing Assistant &amp; Brainstorm)</span>
            </div>

            {(settings.voice?.enabled) && (
              <div className="settings-agent-fields">
                <div className="settings-field">
                  <div className="settings-voice-permission">
                    {micPermission === 'unknown' && (
                      <button className="settings-btn settings-btn-secondary" type="button" onClick={enumerateMics}>
                        Check microphone permission
                      </button>
                    )}
                    {micPermission === 'granted' && (
                      <span className="settings-voice-perm-ok">Microphone access granted</span>
                    )}
                    {micPermission === 'denied' && (
                      <span className="settings-voice-perm-denied">Microphone access denied — allow it in your OS/browser settings</span>
                    )}
                  </div>
                </div>

                {micPermission === 'granted' && micDevices.length > 0 && (
                  <div className="settings-field settings-field-inline">
                    <label className="settings-label" htmlFor="voice-mic-device">Microphone</label>
                    <select
                      id="voice-mic-device"
                      className="settings-input settings-select"
                      value={settings.voice?.micDeviceId ?? ''}
                      aria-label="Select microphone"
                      onChange={(e) => {
                        const micDeviceId = e.target.value || undefined;
                        setSettings((p) => ({ ...p, voice: { ...p.voice!, micDeviceId } }));
                        setSavedOk(false);
                      }}
                    >
                      <option value="">Default microphone</option>
                      {micDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="settings-field settings-field-inline">
                  <label className="settings-toggle" htmlFor="voice-cloud">
                    <input
                      id="voice-cloud"
                      type="checkbox"
                      aria-label="Enable cloud speech-to-text fallback"
                      checked={settings.voice?.cloudFallback ?? false}
                      onChange={(e) => {
                        setSettings((p) => ({ ...p, voice: { ...p.voice!, cloudFallback: e.target.checked } }));
                        setSavedOk(false);
                      }}
                    />
                    <span className="settings-toggle-track" />
                  </label>
                  <span className="settings-label">Cloud STT fallback (OpenAI Whisper)</span>
                </div>

                {settings.voice?.cloudFallback && (
                  <div className="settings-field settings-field-inline">
                    <label className="settings-label" htmlFor="voice-openai-key">OpenAI API Key</label>
                    <input
                      id="voice-openai-key"
                      className="settings-input"
                      type="password"
                      value={settings.voice?.openaiApiKey ?? ''}
                      placeholder="sk-… (leave blank to use OPENAI_API_KEY env var)"
                      autoComplete="off"
                      onChange={(e) => {
                        setSettings((p) => ({ ...p, voice: { ...p.voice!, openaiApiKey: e.target.value || undefined } }));
                        setSavedOk(false);
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            <p className="settings-hint">Voice input uses your browser's built-in Web Speech API by default, with no data sent to third parties.</p>
          </section>

          {/* ── Privacy & Telemetry ── */}
          <section className="settings-section" aria-labelledby="section-telemetry">
            <h3 className="settings-section-title" id="section-telemetry">Privacy &amp; Telemetry</h3>
            <div className="settings-field settings-field-inline">
              <label className="settings-toggle" htmlFor="telemetry-enabled">
                <input
                  id="telemetry-enabled"
                  type="checkbox"
                  aria-label="Send anonymous usage data"
                  checked={settings.telemetry?.enabled ?? false}
                  onChange={(e) => {
                    setSettings((p) => ({ ...p, telemetry: { enabled: e.target.checked } }));
                    setSavedOk(false);
                  }}
                />
                <span className="settings-toggle-track" />
              </label>
              <span className="settings-label">Send anonymous usage data to help improve Mythos Writer</span>
            </div>
            <div className="settings-hint">
              <p>When enabled, Mythos Writer collects:</p>
              <ul className="settings-telemetry-list">
                <li>Anonymized crash reports</li>
                <li>Feature usage counts (e.g. "agent ran", "snapshot saved")</li>
              </ul>
              <p>Your vault content, story text, and personal information are <strong>never</strong> collected.</p>
            </div>
          </section>

          {/* ── Appearance ── */}
          <section className="settings-section" aria-labelledby="section-appearance">
            <h3 className="settings-section-title" id="section-appearance">Appearance</h3>

            {/* Theme sub-group */}
            <div className="settings-field">
              <span className="settings-label">Color theme</span>
              {/* P3: flex-wrap + row-gap so "High contrast" never top-aligns on 390px */}
              <div className="settings-radio-group" role="radiogroup" aria-label="App theme">
                {([
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ] as const).map(({ value, label }) => (
                  <label key={value} className="settings-radio-label">
                    <input
                      type="radio"
                      name="theme"
                      value={value}
                      checked={settings.theme === value}
                      onChange={() => { setSettings((p) => ({ ...p, theme: value })); setSavedOk(false); }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="settings-hint">Theme switching is persisted for future use.</p>
            </div>

            {/* P2: Liquid Glass sub-group divider */}
            <div className="lg-subgroup-divider" role="separator">
              <span>Liquid Glass</span>
            </div>

            {/* Background */}
            <div className="settings-field">
              <span className="settings-label">Background</span>
              <div className="lg-bg-options">
                <button
                  className={`lg-bg-option${(settings.liquidGlass?.background ?? 'default') === 'default' ? ' lg-bg-option--active' : ''}`}
                  onClick={() => setLgField('background', 'default')}
                  aria-pressed={(settings.liquidGlass?.background ?? 'default') === 'default'}
                >
                  {/* lg-bg-preview thumbnail showing the nebula asset */}
                  <div
                    className="lg-bg-preview"
                    style={{ backgroundImage: `url(${defaultBg})` }}
                    aria-hidden="true"
                  />
                  <span>Default</span>
                </button>
                <button
                  className={`lg-bg-option${settings.liquidGlass?.background === 'none' ? ' lg-bg-option--active' : ''}`}
                  onClick={() => setLgField('background', 'none')}
                  aria-pressed={settings.liquidGlass?.background === 'none'}
                >
                  <div className="lg-bg-preview lg-bg-preview--none" aria-hidden="true" />
                  <span>None</span>
                </button>
              </div>
            </div>

            {/* Style slider (main — lg-slider-main, P1: accent-color via var(--accent)) */}
            <div className="settings-field">
              <label className="settings-label" htmlFor="lg-style">Style</label>
              <div className="settings-slider-row">
                <span className="lg-axis-label">Off</span>
                <input
                  id="lg-style"
                  type="range"
                  className="settings-slider lg-slider-main"
                  min={0} max={100} step={1}
                  value={settings.liquidGlass?.style ?? LG_DEFAULTS.style}
                  onChange={(e) => setLgField('style', Number(e.target.value))}
                  aria-label="Liquid Glass style intensity"
                />
                <span className="lg-axis-label">Full</span>
                <span className="settings-slider-value">{settings.liquidGlass?.style ?? LG_DEFAULTS.style}</span>
              </div>
            </div>

            {/* Advanced sliders (P1: accent-color via var(--accent); P1 mobile: stack below 420px via CSS) */}
            <div className="settings-field">
              <span className="settings-label settings-label--subheading">Advanced</span>
            </div>
            {(
              [
                { id: 'lg-glass', field: 'glass', label: 'Glass' },
                { id: 'lg-blur',  field: 'blur',  label: 'Blur'  },
                { id: 'lg-neon',  field: 'neon',  label: 'Neon'  },
              ] as const
            ).map(({ id, field, label }) => (
              <div key={id} className="settings-field settings-field-inline lg-advanced-row">
                <label className="settings-label" htmlFor={id}>{label}</label>
                <span className="lg-axis-label">0</span>
                <input
                  id={id}
                  type="range"
                  className="settings-slider"
                  min={0} max={100} step={1}
                  value={settings.liquidGlass?.[field] ?? LG_DEFAULTS[field]}
                  onChange={(e) => setLgField(field, Number(e.target.value))}
                  aria-label={`Liquid Glass ${label.toLowerCase()} level`}
                />
                <span className="lg-axis-label">100</span>
                <span className="settings-slider-value">{settings.liquidGlass?.[field] ?? LG_DEFAULTS[field]}</span>
              </div>
            ))}

            {/* Neon Accent */}
            <div className="settings-field">
              <span className="settings-label">Neon Accent</span>
              <div className="lg-accent-options" role="group" aria-label="Neon accent color">
                {(
                  [
                    { value: 'cyan',    label: 'Cyan',    color: '#00f0ff' },
                    { value: 'violet',  label: 'Violet',  color: '#7c3aed' },
                    { value: 'magenta', label: 'Magenta', color: '#e040fb' },
                  ] as const
                ).map(({ value, label, color }) => (
                  <button
                    key={value}
                    className={`lg-accent-btn${(settings.liquidGlass?.neonAccent ?? LG_DEFAULTS.neonAccent) === value ? ' lg-accent-btn--active' : ''}`}
                    style={{ '--swatch': color } as React.CSSProperties}
                    onClick={() => setLgField('neonAccent', value)}
                    aria-pressed={(settings.liquidGlass?.neonAccent ?? LG_DEFAULTS.neonAccent) === value}
                    aria-label={`${label} neon accent`}
                  >
                    <span className="lg-accent-swatch" aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Text color overrides (P3: Aa live preview chip) */}
            <div className="settings-field">
              <span className="settings-label settings-label--subheading">Text colors</span>
            </div>
            {(
              [
                { id: 'lg-text-header', field: 'textHeader', label: 'Header', fallback: '#e4e4e7' },
                { id: 'lg-text-body',   field: 'textBody',   label: 'Body',   fallback: '#d4d4d8' },
                { id: 'lg-text-muted',  field: 'textMuted',  label: 'Muted',  fallback: '#a1a1aa' },
              ] as const
            ).map(({ id, field, label, fallback }) => {
              const currentColor = settings.liquidGlass?.[field] ?? fallback;
              return (
                <div key={id} className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor={id}>{label}</label>
                  {/* P3: Aa glyph chip showing actual resolved color */}
                  <span
                    className="lg-text-preview-chip"
                    style={{ color: currentColor }}
                    aria-hidden="true"
                    title={currentColor}
                  >Aa</span>
                  <input
                    id={id}
                    type="color"
                    className="lg-color-input"
                    value={currentColor}
                    onChange={(e) => setLgField(field, e.target.value)}
                    aria-label={`${label} text color`}
                  />
                </div>
              );
            })}

            {/* P2: Reset Liquid Glass (scoped label — does not reset theme) */}
            <div className="settings-field">
              <button className="lg-reset-btn" onClick={handleResetLg} type="button">
                Reset Liquid Glass
              </button>
            </div>

          </section>

        </div>

        <div className="settings-footer">
          {saveError && <p className="settings-error-msg" role="alert">{saveError}</p>}
          {savedOk && <p className="settings-saved-msg" aria-live="polite">Settings saved.</p>}
          <div className="settings-footer-actions">
            <button className="settings-btn settings-btn-cancel" onClick={onClose}>Cancel</button>
            <button
              className="settings-btn settings-btn-save"
              onClick={handleSave}
              disabled={saving || !!apiKeyError}
              aria-label="Save settings"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
