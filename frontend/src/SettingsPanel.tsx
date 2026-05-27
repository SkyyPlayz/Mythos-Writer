import { useState, useEffect, useCallback, useRef } from 'react';
import { applyTheme, applyLiquidGlassTokens, resetLiquidGlassTokens, LIQUID_GLASS_DEFAULTS, DEFAULT_BG_GRADIENT, type ThemeMode } from './theme';
import './SettingsPanel.css';

const THEME_CHOICES: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: 'Dark (Liquid Glass)' },
  { value: 'high-contrast', label: 'High contrast' },
];

// Predefined text-color palettes (all pass ≥ 4.5:1 on dark glass surfaces)
const TEXT_HEADER_OPTIONS = [
  { value: '#edecf6', label: 'Warm White' },
  { value: '#ffffff', label: 'Pure White' },
  { value: '#f5f0e8', label: 'Cream' },
];
const TEXT_BODY_OPTIONS = [
  { value: '#bfd6e8', label: 'Blue-Gray' },
  { value: '#d0d5db', label: 'Light Gray' },
  { value: '#e8e4f0', label: 'Warm White' },
];
const TEXT_MUTED_OPTIONS = [
  { value: '#8a9bb0', label: 'Gray-Blue' },
  { value: '#9aa0a8', label: 'Medium Gray' },
  { value: '#a0b0c0', label: 'Light Blue' },
];

const LG_DEFAULTS: LiquidGlassPrefs = LIQUID_GLASS_DEFAULTS;

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

const DEFAULTS: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: { enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, ...BUDGET_DEFAULTS },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6', ...BUDGET_DEFAULTS },
    archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, ...BUDGET_DEFAULTS },
  },
  theme: 'dark',
  snapshots: { maxPerScene: 100, maxAgeDays: 30 },
};

function validateApiKey(key: string): string | null {
  if (!key) return null;
  if (!key.startsWith('sk-ant-')) return 'Key must start with sk-ant-';
  return null;
}

interface Props {
  onClose: () => void;
  onSaved?: (settings: AppSettings) => void;
}

export default function SettingsPanel({ onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  // Separate input state so the masked value from settingsGet never appears in the writable field.
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // Liquid Glass customization state (MYT-613)
  const [lg, setLg] = useState<LiquidGlassPrefs>({ ...LG_DEFAULTS });
  const [lgAdvancedOpen, setLgAdvancedOpen] = useState(false);
  const [bgPreviewUrl, setBgPreviewUrl] = useState<string | null>(null);
  const [bgPickBusy, setBgPickBusy] = useState(false);

  useEffect(() => {
    window.api.settingsGet().then((s) => {
      setSettings(s);
      // Do not populate the input — masked value stays in settings state only
      if (s.liquidGlass) {
        setLg({ ...LG_DEFAULTS, ...s.liquidGlass });
        // Load background preview if a custom path is stored
        const bg = s.liquidGlass.background;
        if (bg && bg !== 'default') {
          (window.api as any).loadBgImage?.(bg)
            .then((res: { dataUrl: string | null }) => { if (res?.dataUrl) setBgPreviewUrl(res.dataUrl); })
            .catch(() => {});
        }
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

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
        liquidGlass: lg,
      };
      await window.api.settingsSet(payload);
      setSavedOk(true);
      // Apply tokens live when saved
      applyLiquidGlassTokens(lg, bgPreviewUrl);
      onSaved?.(payload);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }, [settings, apiKeyInput, apiKeyDirty, apiKeyError, lg, bgPreviewUrl, onSaved]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  // ── Liquid Glass helpers ─────────────────────────────────────────────────

  const setLgField = useCallback(<K extends keyof LiquidGlassPrefs>(key: K, value: LiquidGlassPrefs[K]) => {
    setLg((prev) => {
      const next = { ...prev, [key]: value };
      // Live preview
      applyLiquidGlassTokens(next);
      return next;
    });
    setSavedOk(false);
  }, []);

  // When the main softnessContrast slider moves, sync all three component sliders
  const handleSoftnessChange = useCallback((s: number) => {
    setLg((prev) => {
      const next: LiquidGlassPrefs = { ...prev, softnessContrast: s, glass: s, blur: s, neonIntensity: s };
      applyLiquidGlassTokens(next);
      return next;
    });
    setSavedOk(false);
  }, []);

  const handlePickBgImage = useCallback(async () => {
    if (bgPickBusy) return;
    setBgPickBusy(true);
    try {
      const res = await (window.api as any).pickBgImage?.();
      if (res?.filePath && !res.cancelled) {
        const loadRes = await (window.api as any).loadBgImage?.(res.filePath);
        const dataUrl: string | null = loadRes?.dataUrl ?? null;
        setBgPreviewUrl(dataUrl);
        setLg((prev) => {
          const next = { ...prev, background: res.filePath as string };
          applyLiquidGlassTokens(next, dataUrl);
          return next;
        });
        setSavedOk(false);
      }
    } catch {
      // non-fatal
    } finally {
      setBgPickBusy(false);
    }
  }, [bgPickBusy]);

  const handleResetBg = useCallback(() => {
    setBgPreviewUrl(null);
    setLg((prev) => {
      const next = { ...prev, background: 'default' as const };
      applyLiquidGlassTokens(next, null);
      return next;
    });
    setSavedOk(false);
  }, []);

  const handleResetAll = useCallback(() => {
    const defaults = { ...LG_DEFAULTS };
    setLg(defaults);
    setBgPreviewUrl(null);
    resetLiquidGlassTokens();
    applyLiquidGlassTokens(defaults);
    setSavedOk(false);
  }, []);

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
      <div className="settings-panel" ref={dialogRef}>
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
                  aria-invalid={apiKeyError ? 'true' : 'false'}
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

          {/* ── Updates ── */}
          <section className="settings-section" aria-labelledby="section-updates">
            <h3 className="settings-section-title" id="section-updates">Updates</h3>
            <div className="settings-field">
              <label className="settings-label">Update Channel</label>
              <div className="settings-radio-group" role="radiogroup" aria-label="Update channel">
                {(['stable', 'beta'] as const).map((ch) => (
                  <label key={ch} className="settings-radio-label">
                    <input
                      type="radio"
                      name="updateChannel"
                      value={ch}
                      checked={(settings.updateChannel ?? 'stable') === ch}
                      onChange={() => { setSettings((p) => ({ ...p, updateChannel: ch })); setSavedOk(false); }}
                    />
                    {ch === 'stable' ? 'Stable' : 'Beta'}
                  </label>
                ))}
              </div>
              <p className="settings-hint">
                Stable receives official releases. Beta receives pre-releases and may contain unfinished features.
                Changes take effect on the next update check.
              </p>
            </div>
          </section>

          {/* ── Appearance ── */}
          <section className="settings-section" aria-labelledby="section-theme">
            <h3 className="settings-section-title" id="section-theme">Appearance</h3>

            {/* Theme mode */}
            <div className="settings-field">
              <div className="settings-radio-group" role="radiogroup" aria-label="Appearance">
                {THEME_CHOICES.map(({ value, label }) => (
                  <label key={value} className="settings-radio-label">
                    <input
                      type="radio"
                      name="theme"
                      value={value}
                      checked={settings.theme === value}
                      onChange={() => {
                        setSettings((p) => ({ ...p, theme: value }));
                        applyTheme(value); // live preview
                        setSavedOk(false);
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="settings-hint">
                High contrast switches to opaque, AAA-contrast surfaces for accessibility.
              </p>
            </div>

            {/* App Background */}
            <div className="settings-field lg-bg-field">
              <label className="settings-label">App Background</label>
              <div className="lg-bg-preview-row">
                <div
                  className="lg-bg-preview"
                  role="img"
                  aria-label="Current background preview"
                  style={{
                    backgroundImage: bgPreviewUrl
                      ? `url("${bgPreviewUrl}")`
                      : lg.background !== 'default'
                        ? `url("${lg.background}")`
                        : DEFAULT_BG_GRADIENT,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
                <div className="lg-bg-actions">
                  <button
                    className="settings-btn lg-btn-secondary"
                    type="button"
                    onClick={handlePickBgImage}
                    disabled={bgPickBusy}
                    aria-label="Browse for background image"
                  >
                    {bgPickBusy ? 'Loading…' : 'Browse…'}
                  </button>
                  {lg.background !== 'default' && (
                    <button
                      className="settings-btn lg-btn-secondary"
                      type="button"
                      onClick={handleResetBg}
                      aria-label="Reset background to default"
                    >
                      Use Default
                    </button>
                  )}
                </div>
              </div>
              <p className="settings-hint">JPEG, PNG, WebP, GIF — replaces the app background.</p>
            </div>

            {/* Main softness↔contrast slider */}
            <div className="settings-field">
              <label className="settings-label" htmlFor="lg-softness">Style</label>
              <div className="lg-slider-labeled-row">
                <span className="lg-axis-label">Softness</span>
                <input
                  id="lg-softness"
                  className="settings-slider lg-slider-main"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={lg.softnessContrast}
                  aria-label="Softness to Contrast"
                  onChange={(e) => handleSoftnessChange(Number(e.target.value))}
                />
                <span className="lg-axis-label lg-axis-right">Contrast</span>
              </div>
            </div>

            {/* Advanced options */}
            <div className="lg-advanced-section">
              <button
                className="lg-advanced-toggle"
                type="button"
                aria-expanded={lgAdvancedOpen}
                onClick={() => setLgAdvancedOpen((o) => !o)}
              >
                <span className={`lg-chevron${lgAdvancedOpen ? ' lg-chevron-open' : ''}`}>›</span>
                Advanced options
              </button>

              {lgAdvancedOpen && (
                <div className="lg-advanced-body">

                  {/* Glass slider */}
                  <div className="settings-field settings-field-inline">
                    <label className="settings-label lg-adv-label" htmlFor="lg-glass">Glass</label>
                    <div className="lg-slider-labeled-row lg-adv-slider-row">
                      <span className="lg-axis-label">Lighter</span>
                      <input
                        id="lg-glass"
                        className="settings-slider"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={lg.glass}
                        aria-label="Glass lighter to darker"
                        onChange={(e) => setLgField('glass', Number(e.target.value))}
                      />
                      <span className="lg-axis-label lg-axis-right">Darker</span>
                    </div>
                  </div>

                  {/* Blur slider */}
                  <div className="settings-field settings-field-inline">
                    <label className="settings-label lg-adv-label" htmlFor="lg-blur">Blur</label>
                    <div className="lg-slider-labeled-row lg-adv-slider-row">
                      <span className="lg-axis-label">More</span>
                      <input
                        id="lg-blur"
                        className="settings-slider"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={lg.blur}
                        aria-label="Blur more to less"
                        onChange={(e) => setLgField('blur', Number(e.target.value))}
                      />
                      <span className="lg-axis-label lg-axis-right">Less</span>
                    </div>
                  </div>

                  {/* Neon intensity slider */}
                  <div className="settings-field settings-field-inline">
                    <label className="settings-label lg-adv-label" htmlFor="lg-neon">Neon</label>
                    <div className="lg-slider-labeled-row lg-adv-slider-row">
                      <span className="lg-axis-label">Strong</span>
                      <input
                        id="lg-neon"
                        className="settings-slider"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={lg.neonIntensity}
                        aria-label="Neon strong to soft"
                        onChange={(e) => setLgField('neonIntensity', Number(e.target.value))}
                      />
                      <span className="lg-axis-label lg-axis-right">Soft</span>
                    </div>
                  </div>

                  {/* Neon accent color */}
                  <div className="settings-field">
                    <label className="settings-label">Neon Accent</label>
                    <div className="lg-swatch-row" role="radiogroup" aria-label="Neon accent color">
                      {(['cyan', 'violet', 'magenta'] as const).map((accent) => (
                        <label key={accent} className="lg-swatch-label">
                          <input
                            type="radio"
                            name="lg-neon-accent"
                            value={accent}
                            checked={lg.neonAccent === accent}
                            onChange={() => setLgField('neonAccent', accent)}
                            aria-label={`Neon accent ${accent}`}
                          />
                          <span
                            className={`lg-swatch lg-swatch-${accent}${lg.neonAccent === accent ? ' lg-swatch-active' : ''}`}
                            title={accent.charAt(0).toUpperCase() + accent.slice(1)}
                          />
                          <span className="lg-swatch-name">{accent.charAt(0).toUpperCase() + accent.slice(1)}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Text colors */}
                  <div className="settings-field">
                    <label className="settings-label">Text Colors</label>
                    <div className="lg-text-color-grid">
                      <div className="lg-color-row">
                        <span className="lg-color-row-label">Header</span>
                        <div className="lg-swatch-row" role="radiogroup" aria-label="Header text color">
                          {TEXT_HEADER_OPTIONS.map((opt) => (
                            <label key={opt.value} className="lg-swatch-label">
                              <input
                                type="radio"
                                name="lg-text-header"
                                value={opt.value}
                                checked={lg.textHeader === opt.value}
                                onChange={() => setLgField('textHeader', opt.value)}
                                aria-label={`Header text ${opt.label}`}
                              />
                              <span
                                className={`lg-text-swatch${lg.textHeader === opt.value ? ' lg-swatch-active' : ''}`}
                                style={{ background: opt.value }}
                                title={opt.label}
                              />
                              <span className="lg-swatch-name">{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="lg-color-row">
                        <span className="lg-color-row-label">Body</span>
                        <div className="lg-swatch-row" role="radiogroup" aria-label="Body text color">
                          {TEXT_BODY_OPTIONS.map((opt) => (
                            <label key={opt.value} className="lg-swatch-label">
                              <input
                                type="radio"
                                name="lg-text-body"
                                value={opt.value}
                                checked={lg.textBody === opt.value}
                                onChange={() => setLgField('textBody', opt.value)}
                                aria-label={`Body text ${opt.label}`}
                              />
                              <span
                                className={`lg-text-swatch${lg.textBody === opt.value ? ' lg-swatch-active' : ''}`}
                                style={{ background: opt.value }}
                                title={opt.label}
                              />
                              <span className="lg-swatch-name">{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="lg-color-row">
                        <span className="lg-color-row-label">Muted</span>
                        <div className="lg-swatch-row" role="radiogroup" aria-label="Muted text color">
                          {TEXT_MUTED_OPTIONS.map((opt) => (
                            <label key={opt.value} className="lg-swatch-label">
                              <input
                                type="radio"
                                name="lg-text-muted"
                                value={opt.value}
                                checked={lg.textMuted === opt.value}
                                onChange={() => setLgField('textMuted', opt.value)}
                                aria-label={`Muted text ${opt.label}`}
                              />
                              <span
                                className={`lg-text-swatch${lg.textMuted === opt.value ? ' lg-swatch-active' : ''}`}
                                style={{ background: opt.value }}
                                title={opt.label}
                              />
                              <span className="lg-swatch-name">{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              )}
            </div>

            {/* Reset to defaults */}
            <div className="lg-reset-row">
              <button
                className="settings-btn lg-btn-reset"
                type="button"
                onClick={handleResetAll}
                aria-label="Reset all appearance settings to defaults"
              >
                Reset to defaults
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
