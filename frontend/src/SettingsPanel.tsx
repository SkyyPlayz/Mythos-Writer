import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { FocusPrefs } from './types';
import { applyTheme, applyLiquidNeonTokens, resetLiquidNeonTokens, LIQUID_NEON_DEFAULTS, DEFAULT_BG_GRADIENT, contrastRatio, enforceContrastFloor, type ThemeMode } from './theme';
import { resolveAxisTokens } from './themeAxis';
import { detectCloudProvider } from './lib/cloudSync';
import { SUGGESTION_CATEGORY_LABELS } from './types';
import VaultSyncBadge from './components/VaultSyncBadge';
import MoveVaultWizard from './MoveVaultWizard';
import './SettingsPanel.css';

interface MicDevice {
  deviceId: string;
  label: string;
}

// ─── SKY-207: Custom frontmatter field schema (mirrors electron-main/src/ipc.ts) ──

type FieldType = 'text' | 'number' | 'select';

interface CustomFieldDef {
  id: string;
  name: string;
  type: FieldType;
  options?: string[];
}

// ─── Persona viewer (MYT-816) ─────────────────────────────────────────────────

type PersonaKey = 'AGENTS' | 'HEARTBEAT' | 'SOUL' | 'TOOLS';
const PERSONA_KEYS: PersonaKey[] = ['AGENTS', 'HEARTBEAT', 'SOUL', 'TOOLS'];

interface PersonaFileState {
  content: string;
  isCustom: boolean;
  loading: boolean;
  error: string | null;
}

function PersonaViewer({ agentName }: { agentName: 'writingAssistant' | 'brainstorm' }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PersonaKey>('AGENTS');
  const tablistRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<Record<PersonaKey, PersonaFileState>>({
    AGENTS:    { content: '', isCustom: false, loading: false, error: null },
    HEARTBEAT: { content: '', isCustom: false, loading: false, error: null },
    SOUL:      { content: '', isCustom: false, loading: false, error: null },
    TOOLS:     { content: '', isCustom: false, loading: false, error: null },
  });
  const [resetBusy, setResetBusy] = useState(false);

  const loadFile = useCallback(async (key: PersonaKey) => {
    setFiles((prev) => ({ ...prev, [key]: { ...prev[key], loading: true, error: null } }));
    try {
      const res = await (window.api as any).agentPersonaRead(agentName, key) as { content: string; isCustom: boolean };
      setFiles((prev) => ({ ...prev, [key]: { content: res.content, isCustom: res.isCustom, loading: false, error: null } }));
    } catch (err) {
      setFiles((prev) => ({ ...prev, [key]: { ...prev[key], loading: false, error: (err as Error).message } }));
    }
  }, [agentName]);

  useEffect(() => {
    if (!open) return;
    for (const key of PERSONA_KEYS) loadFile(key);
  }, [open, loadFile]);

  const handleReset = async (key: PersonaKey) => {
    setResetBusy(true);
    try {
      await (window.api as any).agentPersonaReset(agentName, key);
      await loadFile(key);
    } finally {
      setResetBusy(false);
    }
  };

  const file = files[activeTab];

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const idx = PERSONA_KEYS.indexOf(activeTab);
    const next = e.key === 'ArrowRight'
      ? PERSONA_KEYS[(idx + 1) % PERSONA_KEYS.length]
      : PERSONA_KEYS[(idx + PERSONA_KEYS.length - 1) % PERSONA_KEYS.length];
    setActiveTab(next);
    e.preventDefault();
    const btn = tablistRef.current?.querySelector<HTMLElement>(`[data-tabkey="${next}"]`);
    btn?.focus();
  };

  const panelId = `persona-panel-${agentName}`;

  return (
    <div className="settings-persona-viewer">
      <button
        type="button"
        className="settings-persona-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="settings-persona-chevron">{open ? '▾' : '▸'}</span>
        Persona files
      </button>
      {open && (
        <div className="settings-persona-panel">
          <div className="settings-persona-tabs" role="tablist" aria-label="Persona file tabs" ref={tablistRef} onKeyDown={handleTabKeyDown}>
            {PERSONA_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`persona-tab-${agentName}-${key}`}
                data-tabkey={key}
                aria-selected={activeTab === key}
                aria-controls={panelId}
                tabIndex={activeTab === key ? 0 : -1}
                className={`settings-persona-tab${activeTab === key ? ' settings-persona-tab--active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {key}.md
                {files[key].isCustom && (
                  <span className="settings-persona-custom-badge" title="Custom override">●</span>
                )}
              </button>
            ))}
          </div>
          <div id={panelId} className="settings-persona-content" role="tabpanel" aria-labelledby={`persona-tab-${agentName}-${activeTab}`}>
            {file.loading && <p className="settings-persona-loading">Loading…</p>}
            {file.error && <p className="settings-persona-error">{file.error}</p>}
            {!file.loading && !file.error && (
              <>
                {file.isCustom && (
                  <div className="settings-persona-actions">
                    <span className="settings-persona-custom-label">Custom</span>
                    <button
                      type="button"
                      className="settings-persona-reset-btn"
                      disabled={resetBusy}
                      onClick={() => handleReset(activeTab)}
                    >
                      Reset to default
                    </button>
                  </div>
                )}
                <textarea
                  className="settings-persona-textarea"
                  readOnly
                  value={file.content}
                  aria-label={`${agentName} ${activeTab}.md content`}
                  spellCheck={false}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Provider / Telemetry types (MYT-779) ─────────────────────────────────────

type ProviderKind = 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'custom';

const PROVIDER_OPTIONS: { value: ProviderKind; label: string; needsKey: boolean; needsUrl: boolean }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)', needsKey: true, needsUrl: false },
  { value: 'openai', label: 'OpenAI', needsKey: true, needsUrl: false },
  { value: 'ollama', label: 'Ollama (local)', needsKey: false, needsUrl: true },
  { value: 'lmstudio', label: 'LM Studio (local)', needsKey: false, needsUrl: true },
  { value: 'custom', label: 'Custom endpoint', needsKey: true, needsUrl: true },
];

const TELEMETRY_DATA_LIST = [
  'App version and platform (OS / Electron version)',
  'Session start and end timestamps',
  'Feature usage counts (e.g. brainstorm invocations, suggestions accepted)',
  'Error type and frequency (no content or personal data)',
];

type TestConnectionStatus = 'idle' | 'testing' | 'ok' | 'error';

const THEME_CHOICES: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: 'Liquid Neon' },
  { value: 'high-contrast', label: 'High contrast' },
];

const LG_DEFAULTS: LiquidNeonPrefs = LIQUID_NEON_DEFAULTS;

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku' },
  { value: 'claude-sonnet-4-6', label: 'claude-sonnet' },
  { value: 'claude-opus-4-7', label: 'claude-opus' },
];

type AgentName = 'writingAssistant' | 'brainstorm' | 'archive';

/** Per-agent provider override state; null means "use global provider". */
interface AgentOverrideState {
  enabled: boolean;
  kind: ProviderKind;
  apiKey: string;
  apiKeyDirty: boolean;
  baseUrl: string;
  model: string;
}

const DEFAULT_AGENT_OVERRIDE: AgentOverrideState = {
  enabled: false,
  kind: 'anthropic',
  apiKey: '',
  apiKeyDirty: false,
  baseUrl: '',
  model: '',
};

const DEFAULT_BASE_URLS: Record<ProviderKind, string> = {
  anthropic: '',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  custom: '',
};

/** Returns true when a base URL points to localhost / 127.x.x.x / [::1]. */
function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

const ALL_CATEGORIES_ENABLED: Record<SuggestionCategory, boolean> = {
  punctuation: true,
  spelling: true,
  grammar: true,
  'sentence-structure': true,
  'style-tone': true,
  other: true,
};

const BUDGET_DEFAULTS: AgentBudgetSettings = {
  autoApply: false,
  confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000,
  maxSuggestionsPerHour: 50,
  heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500_000,
  autoApplyCategories: ALL_CATEGORIES_ENABLED,
};

// SKY-908 — per-category auto-apply toggle group.
// Order is the display order. 'other' is intentionally last because it covers
// suggestions that don't fit the four named categories.
const SUGGESTION_CATEGORY_ORDER: SuggestionCategory[] = [
  'punctuation',
  'spelling',
  'grammar',
  'sentence-structure',
  'style-tone',
  'other',
];

/**
 * Read the effective per-category enable state for a settings entry.
 * Backward compatible: when the map is absent (pre-SKY-908 settings), every
 * category reads as enabled — the existing master `autoApply` boolean stays
 * the kill-switch. Absent keys inside an explicit map also default to true so
 * a forward-compat field never silently disables a new category.
 */
function isCategoryAutoApplyEnabled(
  agent: AgentBudgetSettings,
  category: SuggestionCategory,
): boolean {
  if (!agent.autoApplyCategories) return true;
  const value = agent.autoApplyCategories[category];
  return value !== false;
}

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

const BG_POSITIONS = [
  { value: 'top left',     label: '↖' },
  { value: 'top',          label: '↑' },
  { value: 'top right',    label: '↗' },
  { value: 'left',         label: '←' },
  { value: 'center',       label: '·' },
  { value: 'right',        label: '→' },
  { value: 'bottom left',  label: '↙' },
  { value: 'bottom',       label: '↓' },
  { value: 'bottom right', label: '↘' },
];

function validateApiKey(key: string): string | null {
  if (!key) return null;
  if (!key.startsWith('sk-ant-')) return 'Key must start with sk-ant-';
  return null;
}

function providerSupportsVoice(provider?: AppSettings['provider']): boolean {
  if (!provider) return false;
  if (provider.capabilities?.transcribe || provider.capabilities?.speak) return true;
  if (provider.kind === 'openai') return true;
  return provider.kind === 'custom' && Boolean(provider.baseUrl);
}

function formatProviderLabel(provider: AppSettings['provider']): string {
  if (!provider) return 'Provider';
  if (provider.kind === 'openai') return 'OpenAI';
  if (provider.kind === 'custom') return provider.baseUrl ? `Custom (${provider.baseUrl})` : 'Custom endpoint';
  const option = PROVIDER_OPTIONS.find((p) => p.value === provider.kind);
  return option?.label ?? provider.kind.charAt(0).toUpperCase() + provider.kind.slice(1);
}

/** Contrast ratio badge — shows ratio and colour-codes pass/fail. */
function ContrastBadge({ ratio }: { ratio: number }) {
  const pass = ratio >= 4.5;
  const warn = ratio >= 3 && ratio < 4.5;
  const cls = pass ? 'tcs-badge tcs-badge-pass' : warn ? 'tcs-badge tcs-badge-warn' : 'tcs-badge tcs-badge-fail';
  return <span className={cls} aria-live="polite">{ratio.toFixed(1)}:1</span>;
}

/** A colour picker control: swatch + hex input + contrast badge. */
function ColorPicker({
  id,
  label,
  value,
  bgForContrast,
  onChange,
  minRatio = 0,
}: {
  id: string;
  label: string;
  value: string;
  bgForContrast?: string;
  onChange: (hex: string) => void;
  minRatio?: number;
}) {
  const [hexInput, setHexInput] = useState(value);
  const [clamped, setClamped] = useState(false);

  useEffect(() => { setHexInput(value); }, [value]);

  const handleColorChange = (raw: string) => {
    setHexInput(raw);
    let final = raw;
    if (minRatio > 0 && bgForContrast) {
      const safe = enforceContrastFloor(raw, bgForContrast, minRatio);
      if (safe !== raw) { setClamped(true); final = safe; }
      else { setClamped(false); }
    }
    onChange(final);
  };

  const handleHexBlur = () => {
    const trimmed = hexInput.startsWith('#') ? hexInput : `#${hexInput}`;
    if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(trimmed)) {
      handleColorChange(trimmed);
    } else {
      setHexInput(value);
    }
  };

  const ratio = bgForContrast ? contrastRatio(value, bgForContrast) : null;

  return (
    <div className="lg-color-picker-row">
      <label className="settings-label lg-adv-label" htmlFor={id}>{label}</label>
      <div className="lg-color-picker-controls">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => handleColorChange(e.target.value)}
          className="lg-color-input"
          aria-label={`${label} colour`}
        />
        <input
          type="text"
          className="lg-hex-input settings-input"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={handleHexBlur}
          maxLength={7}
          aria-label={`${label} hex value`}
          spellCheck={false}
        />
        {ratio !== null && <ContrastBadge ratio={ratio} />}
        {clamped && <span className="lg-clamp-notice">Adjusted to stay readable</span>}
      </div>
    </div>
  );
}

/** Security warning dialog shown once when user configures a non-localhost custom endpoint. */
function SecurityWarningDialog({
  url,
  onConfirm,
  onCancel,
}: {
  url: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  let hostname = url;
  try { hostname = new URL(url).hostname; } catch { /* use full url */ }
  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="security-warn-title">
      <div className="settings-panel settings-security-warning" style={{ maxWidth: 420 }}>
        <h3 id="security-warn-title" className="settings-section-title">⚠ Remote Endpoint Warning</h3>
        <p className="settings-hint" style={{ marginBottom: 8 }}>
          This endpoint is not on your local network.
        </p>
        <p className="settings-hint" style={{ marginBottom: 8 }}>
          When you use it, Mythos Writer will send your text to:
        </p>
        <code className="settings-security-hostname">{hostname}</code>
        <p className="settings-hint" style={{ marginTop: 8, marginBottom: 12 }}>
          We cannot inspect or encrypt this traffic before it leaves your device.
          Proceed only if you own or fully trust this endpoint.
        </p>
        <div className="settings-action-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="settings-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="settings-btn settings-btn-danger" onClick={onConfirm}>
            I understand, continue
          </button>
        </div>
      </div>
    </div>
  );
}

/** Per-agent provider override section, shown inside each agent card. */
function AgentProviderSection({
  agentName,
  idPrefix,
  globalProviderKind,
  override,
  savedApiKey,
  testStatus,
  testMsg,
  onChange,
  onTest,
}: {
  agentName: AgentName;
  idPrefix: string;
  globalProviderKind: ProviderKind;
  override: AgentOverrideState;
  savedApiKey?: string;
  testStatus: TestConnectionStatus;
  testMsg: string;
  onChange: <K extends keyof AgentOverrideState>(field: K, value: AgentOverrideState[K]) => void;
  onTest: () => void;
}) {
  const activeKind = override.enabled ? override.kind : globalProviderKind;
  const activeDef = PROVIDER_OPTIONS.find((p) => p.value === activeKind)!;
  const overrideDef = PROVIDER_OPTIONS.find((p) => p.value === override.kind)!;

  return (
    <>
      {/* Per-agent model selector (uses global provider when override is off) */}
      {!override.enabled && (
        <p className="settings-hint" style={{ marginTop: 2, marginBottom: 2 }}>
          Using global provider ({activeDef.label}). Defaults from provider settings above.
        </p>
      )}

      {/* Per-agent provider override toggle */}
      <div className="settings-field settings-field-inline settings-agent-provider-toggle">
        <label className="settings-toggle" htmlFor={`${idPrefix}-provider-toggle`}>
          <input
            id={`${idPrefix}-provider-toggle`}
            type="checkbox"
            aria-label={`Enable ${agentName} provider override`}
            checked={override.enabled}
            onChange={(e) => onChange('enabled', e.target.checked)}
          />
          <span className="settings-toggle-track" />
        </label>
        <span className="settings-label">Override provider for this agent</span>
      </div>

      {override.enabled && (
        <div className="settings-agent-provider-form">
          {/* Provider kind selector */}
          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor={`${idPrefix}-provider-kind`}>Provider</label>
            <select
              id={`${idPrefix}-provider-kind`}
              className="settings-input settings-select settings-input-sm"
              value={override.kind}
              aria-label={`Provider for ${agentName}`}
              onChange={(e) => {
                const newKind = e.target.value as ProviderKind;
                onChange('kind', newKind);
                if (DEFAULT_BASE_URLS[newKind]) onChange('baseUrl', DEFAULT_BASE_URLS[newKind]);
              }}
            >
              {PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* API Key (anthropic / openai / custom) */}
          {overrideDef.needsKey && (
            <div className="settings-field settings-field-inline">
              <label className="settings-label" htmlFor={`${idPrefix}-api-key`}>API Key</label>
              <input
                id={`${idPrefix}-api-key`}
                className="settings-input settings-input-sm"
                type="password"
                value={override.apiKey}
                placeholder={savedApiKey ? 'Key configured — enter new key to replace' : 'Paste API key…'}
                aria-label={`API key for ${agentName}`}
                onChange={(e) => { onChange('apiKey', e.target.value); onChange('apiKeyDirty', true); }}
              />
              {!override.apiKeyDirty && savedApiKey && (
                <p className="settings-hint">Key is already configured.</p>
              )}
            </div>
          )}

          {/* Base URL (ollama / lmstudio / custom) */}
          {overrideDef.needsUrl && (
            <div className="settings-field settings-field-inline">
              <label className="settings-label" htmlFor={`${idPrefix}-base-url`}>Base URL</label>
              <input
                id={`${idPrefix}-base-url`}
                className="settings-input settings-input-sm"
                type="url"
                value={override.baseUrl}
                placeholder={DEFAULT_BASE_URLS[override.kind] || 'https://…/v1'}
                aria-label={`Base URL for ${agentName}`}
                onChange={(e) => onChange('baseUrl', e.target.value)}
              />
              {override.baseUrl && !isLocalhostUrl(override.baseUrl) && (
                <p className="settings-hint settings-hint-warn" role="alert">
                  ⚠ This endpoint is not on localhost — your text will be sent to a remote server. Only use endpoints you own or fully trust.
                </p>
              )}
            </div>
          )}

          {/* Model */}
          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor={`${idPrefix}-model`}>Model</label>
            {override.kind === 'anthropic' ? (
              <select
                id={`${idPrefix}-model`}
                className="settings-input settings-select settings-input-sm"
                value={MODEL_OPTIONS.some((o) => o.value === override.model) ? override.model : ''}
                aria-label={`Model for ${agentName}`}
                onChange={(e) => onChange('model', e.target.value)}
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                id={`${idPrefix}-model`}
                className="settings-input settings-input-sm"
                type="text"
                value={override.model}
                placeholder="e.g. llama3-70b, gpt-4o-mini"
                aria-label={`Model for ${agentName}`}
                maxLength={128}
                onChange={(e) => onChange('model', e.target.value)}
              />
            )}
          </div>

          {/* Test connection */}
          <div className="settings-field settings-field-inline">
            <button
              type="button"
              className="settings-btn"
              disabled={testStatus === 'testing'}
              aria-label={`Test provider connection for ${agentName}`}
              onClick={onTest}
            >
              {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            {testStatus === 'ok' && (
              <span className="settings-test-ok" role="status">{testMsg}</span>
            )}
            {testStatus === 'error' && (
              <span className="settings-test-error" role="alert">{testMsg}</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

interface Props {
  onClose: () => void;
  onSaved?: (settings: AppSettings) => void;
  focusPrefs?: FocusPrefs;
  onFocusPrefsChange?: (prefs: FocusPrefs) => void;
}

const FOCUS_PREFS_DEFAULTS: Pick<FocusPrefs, 'showTitleBar' | 'showStatusBar' | 'showTabBar' | 'showSidebarButtons' | 'showScrollbars' | 'showFileTreeArrows'> = {
  showTitleBar: true, showStatusBar: true, showTabBar: true,
  showSidebarButtons: true, showScrollbars: true, showFileTreeArrows: true,
};

// SKY-908 — per-category auto-apply toggle group, rendered under the master
// auto-apply checkbox on each agent card. Hidden when the master is off (the
// kill-switch dominates per CEO direction).
interface AutoApplyCategoryTogglesProps {
  idPrefix: string;
  agentLabel: string;
  agent: AgentBudgetSettings;
  agentKey: keyof AppSettings['agents'];
  onChange: (
    agent: keyof AppSettings['agents'],
    category: SuggestionCategory,
    enabled: boolean,
  ) => void;
}

function AutoApplyCategoryToggles({
  idPrefix,
  agentLabel,
  agent,
  agentKey,
  onChange,
}: AutoApplyCategoryTogglesProps) {
  if (!agent.autoApply) return null;
  return (
    <fieldset
      className="settings-category-toggles"
      data-testid={`${idPrefix}-category-toggles`}
      aria-label={`${agentLabel} auto-apply categories`}
    >
      <legend className="settings-category-toggles-legend">
        Auto-apply categories
      </legend>
      {SUGGESTION_CATEGORY_ORDER.map((category) => {
        const id = `${idPrefix}-cat-${category}`;
        const checked = isCategoryAutoApplyEnabled(agent, category);
        return (
          <div key={category} className="settings-field settings-field-inline">
            <label className="settings-toggle" htmlFor={id}>
              <input
                id={id}
                type="checkbox"
                aria-label={`${agentLabel} auto-apply ${SUGGESTION_CATEGORY_LABELS[category]}`}
                checked={checked}
                onChange={(e) => onChange(agentKey, category, e.target.checked)}
              />
              <span className="settings-toggle-track" />
            </label>
            <span className="settings-label">{SUGGESTION_CATEGORY_LABELS[category]}</span>
          </div>
        );
      })}
    </fieldset>
  );
}

export default function SettingsPanel({ onClose, onSaved, focusPrefs, onFocusPrefsChange }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

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
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [micDevices, setMicDevices] = useState<MicDevice[]>([]);

  // SKY-9: Vault paths state. `vaults` mirrors the persisted Story Vault +
  // Notes Vault roots; `vaultsDirty` flags an unsaved local edit so the Save
  // Vault Paths button only fires when there's something to persist.
  const [vaults, setVaults] = useState<{ storyVaultPath: string; notesVaultPath: string }>({
    storyVaultPath: '',
    notesVaultPath: '',
  });
  const [vaultsDirty, setVaultsDirty] = useState(false);
  const [vaultsSavedOk, setVaultsSavedOk] = useState(false);
  const [vaultsError, setVaultsError] = useState<string | null>(null);

  // SKY-861/SKY-1112: Cloud-sync vault placement entry point.
  const [showMoveWizard, setShowMoveWizard] = useState(false);
  const vaultProvider = useMemo(() => detectCloudProvider(vaults.storyVaultPath), [vaults.storyVaultPath]);

  // SKY-207: Custom field definitions
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [customFieldsDirty, setCustomFieldsDirty] = useState(false);
  const [customFieldsSavedOk, setCustomFieldsSavedOk] = useState(false);
  const [customFieldsError, setCustomFieldsError] = useState<string | null>(null);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [addingField, setAddingField] = useState(false);

  // Provider state (MYT-779)
  const [providerKind, setProviderKind] = useState<ProviderKind>('anthropic');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerApiKeyDirty, setProviderApiKeyDirty] = useState(false);
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [testConnectionStatus, setTestConnectionStatus] = useState<TestConnectionStatus>('idle');
  const [testConnectionMsg, setTestConnectionMsg] = useState('');

  // Per-agent provider overrides (SKY-686)
  const [agentOverrides, setAgentOverrides] = useState<Record<AgentName, AgentOverrideState>>({
    writingAssistant: { ...DEFAULT_AGENT_OVERRIDE },
    brainstorm: { ...DEFAULT_AGENT_OVERRIDE },
    archive: { ...DEFAULT_AGENT_OVERRIDE },
  });
  const [agentTestStatus, setAgentTestStatus] = useState<Record<AgentName, TestConnectionStatus>>({
    writingAssistant: 'idle', brainstorm: 'idle', archive: 'idle',
  });
  const [agentTestMsg, setAgentTestMsg] = useState<Record<AgentName, string>>({
    writingAssistant: '', brainstorm: '', archive: '',
  });
  // Security warning: non-localhost endpoint confirmation
  const [remoteWarning, setRemoteWarning] = useState<{ agent: AgentName | 'global' | null; url: string; onConfirm: () => void } | null>(null);

  // Telemetry state (MYT-344 / MYT-779)
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);

  // Liquid Neon customization state (MYT-613 / MYT-716)
  const [lg, setLg] = useState<LiquidNeonPrefs>({ ...LG_DEFAULTS });
  const [lgAdvancedOpen, setLgAdvancedOpen] = useState(false);
  const [bgPreviewUrl, setBgPreviewUrl] = useState<string | null>(null);
  const [bgPickBusy, setBgPickBusy] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  useEffect(() => {
    window.api.settingsGet().then((s) => {
      setSettings(s);
      if (s.liquidNeon) {
        setLg({ ...LG_DEFAULTS, ...s.liquidNeon });
        const bg = s.liquidNeon.background;
        if (bg && bg !== 'default') {
          (window.api as any).loadBgImage?.(bg)
            .then((res: { dataUrl: string | null }) => { if (res?.dataUrl) setBgPreviewUrl(res.dataUrl); })
            .catch(() => {});
        }
      }
      if (s.provider) {
        setProviderKind(s.provider.kind as ProviderKind);
        setProviderBaseUrl(s.provider.baseUrl ?? '');
        setProviderModel(s.provider.model ?? '');
      }
      // Load per-agent provider overrides
      const loadAgentOverride = (agentCfg: { provider?: ProviderConfig }): AgentOverrideState => {
        const p = agentCfg.provider;
        if (!p) return { ...DEFAULT_AGENT_OVERRIDE };
        return {
          enabled: true,
          kind: p.kind as ProviderKind,
          apiKey: '',
          apiKeyDirty: false,
          baseUrl: p.baseUrl ?? '',
          model: p.model,
        };
      };
      setAgentOverrides({
        writingAssistant: loadAgentOverride(s.agents.writingAssistant),
        brainstorm: loadAgentOverride(s.agents.brainstorm),
        archive: loadAgentOverride(s.agents.archive),
      });
      setTelemetryEnabled(s.telemetry?.enabled ?? false);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  // Close popover on Escape
  useEffect(() => {
    if (!lgAdvancedOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLgAdvancedOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [lgAdvancedOpen]);

  // Keep --lg-neon in sync with the softness slider (SKY-261)
  useEffect(() => {
    const s = lg.softnessContrast;
    if (s != null && !isNaN(s)) {
      document.documentElement.style.setProperty('--lg-neon', resolveAxisTokens(s * 100).neon.toFixed(2));
    }
  }, [lg.softnessContrast]);

  // Close main dialog on Escape when the inner popover is not open (ARIA APG dialog pattern)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lgAdvancedOpen) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, lgAdvancedOpen]);

  // Focus trap in popover
  useEffect(() => {
    if (!lgAdvancedOpen) return;
    const first = popoverRef.current?.querySelector<HTMLElement>(
      'button, input, select, [tabindex]:not([tabindex="-1"])'
    );
    first?.focus();
  }, [lgAdvancedOpen]);

  // SKY-9: load currently-persisted vault paths once on mount. The IPC
  // resolves any unset path to its computed default (Option A) so the input
  // always shows the value that's actually in effect.
  useEffect(() => {
    window.api.vaultGetPaths().then((paths) => {
      setVaults(paths);
    }).catch(() => {
      // non-fatal — leave inputs blank; user can still pick folders
    });
  }, []);

  const handleMoveVault = useCallback(() => {
    // TODO(SKY-861): wire wizard IPC
    if (window.api.openMoveVaultWizard) {
      void window.api.openMoveVaultWizard();
      return;
    }
    setShowMoveWizard(true);
  }, []);

  const refreshMicDevices = useCallback(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const mics = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
      setMicDevices(mics);
    }).catch(() => {});
  }, []);

  // SKY-207: load custom field definitions
  useEffect(() => {
    (window.api as any).customFieldsList?.()
      .then((res: { fields: CustomFieldDef[] }) => {
        if (res?.fields) setCustomFields(res.fields);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { refreshMicDevices(); }, [refreshMicDevices]);

  const keyIsConfigured = Boolean(settings.apiKey);
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

  // SKY-908 — single source of truth for per-category auto-apply edits.
  // On first edit, materialises a full map seeded with the current enabled
  // state so the persisted JSON is unambiguous (no implicit "all enabled"
  // shorthand once the user has expressed an opinion).
  const setCategoryAutoApply = useCallback((
    agent: keyof AppSettings['agents'],
    category: SuggestionCategory,
    enabled: boolean,
  ) => {
    setSettings((prev) => {
      const current = prev.agents[agent];
      const existing = current.autoApplyCategories ?? {};
      const seeded: Record<SuggestionCategory, boolean> = {
        'punctuation': existing.punctuation ?? true,
        'spelling': existing.spelling ?? true,
        'grammar': existing.grammar ?? true,
        'sentence-structure': existing['sentence-structure'] ?? true,
        'style-tone': existing['style-tone'] ?? true,
        'other': existing.other ?? true,
      };
      seeded[category] = enabled;
      return {
        ...prev,
        agents: {
          ...prev.agents,
          [agent]: { ...current, autoApplyCategories: seeded },
        },
      };
    });
    setSavedOk(false);
  }, []);

  const buildAgentProviderConfig = useCallback((agentName: AgentName): ProviderConfig | undefined => {
    const ov = agentOverrides[agentName];
    if (!ov.enabled) return undefined;
    const def = PROVIDER_OPTIONS.find((p) => p.value === ov.kind)!;
    return {
      kind: ov.kind,
      model: ov.model,
      ...(def.needsKey ? { apiKey: ov.apiKeyDirty ? ov.apiKey : (settings.agents[agentName].provider?.apiKey ?? '') } : {}),
      ...(def.needsUrl && ov.baseUrl ? { baseUrl: ov.baseUrl } : {}),
    };
  }, [agentOverrides, settings.agents]);


  const handleSave = useCallback(async () => {
    if (apiKeyError) return;
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const providerDef = PROVIDER_OPTIONS.find((p) => p.value === providerKind)!;
      const provider: AppSettings['provider'] = {
        kind: providerKind,
        model: providerModel,
        ...(providerDef.needsKey ? { apiKey: providerApiKeyDirty ? providerApiKey : (settings.provider?.apiKey ?? '') } : {}),
        ...(providerDef.needsUrl && providerBaseUrl ? { baseUrl: providerBaseUrl } : {}),
        ...(settings.provider?.kind === providerKind && settings.provider.capabilities ? { capabilities: settings.provider.capabilities } : {}),
      };
      const payload: AppSettings = {
        ...settings,
        apiKey: apiKeyDirty ? apiKeyInput : settings.apiKey,
        provider,
        liquidNeon: lg,
        telemetry: { enabled: telemetryEnabled, sessionId: settings.telemetry?.sessionId ?? '' },
        agents: {
          ...settings.agents,
          writingAssistant: { ...settings.agents.writingAssistant, provider: buildAgentProviderConfig('writingAssistant') },
          brainstorm: { ...settings.agents.brainstorm, provider: buildAgentProviderConfig('brainstorm') },
          archive: { ...settings.agents.archive, provider: buildAgentProviderConfig('archive') },
        },
      };
      await window.api.settingsSet(payload);
      setSavedOk(true);
      applyLiquidNeonTokens(lg, bgPreviewUrl);
      onSaved?.(payload);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }, [settings, apiKeyInput, apiKeyDirty, apiKeyError, providerKind, providerModel, providerApiKey, providerApiKeyDirty, providerBaseUrl, telemetryEnabled, lg, bgPreviewUrl, onSaved, buildAgentProviderConfig]);

  // SKY-9: persist vault paths in a separate round-trip from settingsSet so
  // a misconfigured path can't block API-key edits, and so the main side can
  // re-seed both vault dirs in the same call (vault:setPaths handler does
  // ensureVaultDir + ensureNotesVaultDir before returning).
  const handleSaveVaults = useCallback(async () => {
    setVaultsError(null);
    setVaultsSavedOk(false);
    try {
      const result = await window.api.vaultSetPaths(
        vaults.storyVaultPath.trim(),
        vaults.notesVaultPath.trim(),
      );
      if (result.saved) {
        setVaults({
          storyVaultPath: result.storyVaultPath,
          notesVaultPath: result.notesVaultPath,
        });
        setVaultsDirty(false);
        setVaultsSavedOk(true);
      }
    } catch (e) {
      setVaultsError(e instanceof Error ? e.message : 'Failed to save vault paths.');
    }
  }, [vaults.storyVaultPath, vaults.notesVaultPath]);

  // SKY-207: custom fields handlers
  const handleSaveCustomFields = useCallback(async () => {
    setCustomFieldsError(null);
    setCustomFieldsSavedOk(false);
    try {
      const res = await (window.api as any).customFieldsSet?.(customFields) as { fields: CustomFieldDef[] };
      if (res?.fields) {
        setCustomFields(res.fields);
        setCustomFieldsDirty(false);
        setCustomFieldsSavedOk(true);
      }
    } catch (e) {
      setCustomFieldsError(e instanceof Error ? e.message : 'Failed to save field definitions.');
    }
  }, [customFields]);

  const handleAddField = useCallback(() => {
    const name = newFieldName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!name) return;
    if (customFields.some((f) => f.name === name)) {
      setCustomFieldsError(`A field named "${name}" already exists.`);
      return;
    }
    const options = newFieldType === 'select'
      ? newFieldOptions.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const newDef: CustomFieldDef = {
      id: crypto.randomUUID(),
      name,
      type: newFieldType,
      ...(options ? { options } : {}),
    };
    setCustomFields((prev) => [...prev, newDef]);
    setCustomFieldsDirty(true);
    setCustomFieldsSavedOk(false);
    setCustomFieldsError(null);
    setNewFieldName('');
    setNewFieldOptions('');
    setAddingField(false);
  }, [customFields, newFieldName, newFieldType, newFieldOptions]);

  const handleRemoveField = useCallback((id: string) => {
    setCustomFields((prev) => prev.filter((f) => f.id !== id));
    setCustomFieldsDirty(true);
    setCustomFieldsSavedOk(false);
  }, []);

  const handlePickVaultFolder = useCallback(
    async (which: 'storyVaultPath' | 'notesVaultPath') => {
      const title = which === 'storyVaultPath' ? 'Choose Story Vault folder' : 'Choose Notes Vault folder';
      const res = await window.api.chooseVaultFolder(title, vaults[which] || undefined);
      if (res.cancelled || !res.path) return;
      setVaults((prev) => ({ ...prev, [which]: res.path as string }));
      setVaultsDirty(true);
      setVaultsSavedOk(false);
    },
    [vaults],
  );

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleDialogKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((el) => !(el as HTMLInputElement).disabled);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  const handleTestConnection = useCallback(async () => {
    setTestConnectionStatus('testing');
    setTestConnectionMsg('');
    try {
      const result = await window.api.settingsTestConnection({
        kind: providerKind,
        apiKey: providerApiKeyDirty ? providerApiKey : (settings.provider?.apiKey ?? ''),
        baseUrl: providerBaseUrl || undefined,
        model: providerModel,
      });
      if (result?.ok) {
        setTestConnectionStatus('ok');
        setTestConnectionMsg('Connection successful');
      } else {
        setTestConnectionStatus('error');
        setTestConnectionMsg(result?.error ?? 'Connection failed');
      }
    } catch (e) {
      setTestConnectionStatus('error');
      setTestConnectionMsg(e instanceof Error ? e.message : 'Connection failed');
    }
  }, [providerKind, providerApiKey, providerApiKeyDirty, providerBaseUrl, providerModel, settings.provider?.apiKey]);

  const handleAgentTestConnection = useCallback(async (agentName: AgentName) => {
    setAgentTestStatus((prev) => ({ ...prev, [agentName]: 'testing' }));
    setAgentTestMsg((prev) => ({ ...prev, [agentName]: '' }));
    const ov = agentOverrides[agentName];
    try {
      const result = await window.api.settingsTestConnection({
        kind: ov.kind,
        apiKey: ov.apiKeyDirty ? ov.apiKey : (settings.agents[agentName].provider?.apiKey ?? ''),
        baseUrl: ov.baseUrl || undefined,
        model: ov.model,
      });
      if (result?.ok) {
        setAgentTestStatus((prev) => ({ ...prev, [agentName]: 'ok' }));
        setAgentTestMsg((prev) => ({ ...prev, [agentName]: 'Connection successful' }));
      } else {
        setAgentTestStatus((prev) => ({ ...prev, [agentName]: 'error' }));
        setAgentTestMsg((prev) => ({ ...prev, [agentName]: result?.error ?? 'Connection failed' }));
      }
    } catch (e) {
      setAgentTestStatus((prev) => ({ ...prev, [agentName]: 'error' }));
      setAgentTestMsg((prev) => ({ ...prev, [agentName]: e instanceof Error ? e.message : 'Connection failed' }));
    }
  }, [agentOverrides, settings.agents]);

  const setAgentOverride = useCallback(<K extends keyof AgentOverrideState>(
    agentName: AgentName,
    field: K,
    value: AgentOverrideState[K],
  ) => {
    setAgentOverrides((prev) => ({
      ...prev,
      [agentName]: { ...prev[agentName], [field]: value },
    }));
    setSavedOk(false);
  }, []);

  // ── Liquid Neon helpers ──────────────────────────────────────────────────

  const setLgField = useCallback(<K extends keyof LiquidNeonPrefs>(key: K, value: LiquidNeonPrefs[K]) => {
    setLg((prev) => {
      const next = { ...prev, [key]: value };
      applyLiquidNeonTokens(next, bgPreviewUrl);
      return next;
    });
    setSavedOk(false);
  }, [bgPreviewUrl]);

  const handleSoftnessChange = useCallback((s: number) => {
    document.documentElement.style.setProperty('--lg-neon', resolveAxisTokens(s * 100).neon.toFixed(2));
    setLg((prev) => {
      if (prev.advancedDecoupled) {
        // When decoupled only update the master; individual sliders stay
        const next: LiquidNeonPrefs = { ...prev, softnessContrast: s };
        applyLiquidNeonTokens(next, bgPreviewUrl);
        return next;
      }
      const next: LiquidNeonPrefs = { ...prev, softnessContrast: s, glass: s, blur: s, neonIntensity: s };
      applyLiquidNeonTokens(next, bgPreviewUrl);
      return next;
    });
    setSavedOk(false);
  }, [bgPreviewUrl]);

  const handleRelinkToSlider = useCallback(() => {
    setLg((prev) => {
      const s = prev.softnessContrast;
      const next: LiquidNeonPrefs = { ...prev, advancedDecoupled: false, glass: s ?? LG_DEFAULTS.glass, blur: s ?? LG_DEFAULTS.blur, neonIntensity: s ?? LG_DEFAULTS.neonIntensity };
      applyLiquidNeonTokens(next, bgPreviewUrl);
      return next;
    });
    setSavedOk(false);
  }, [bgPreviewUrl]);

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
          const next = { ...prev, background: res.filePath as string, bgMode: 'image' as const };
          applyLiquidNeonTokens(next, dataUrl);
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
      const next = { ...prev, background: 'default' as const, bgMode: 'color' as const };
      applyLiquidNeonTokens(next, null);
      return next;
    });
    setSavedOk(false);
  }, []);

  const handleResetAll = useCallback(() => {
    if (!resetConfirm) { setResetConfirm(true); return; }
    const defaults = { ...LG_DEFAULTS };
    setLg(defaults);
    setBgPreviewUrl(null);
    setResetConfirm(false);
    resetLiquidNeonTokens();
    applyLiquidNeonTokens(defaults);
    setSavedOk(false);
  }, [resetConfirm]);

  if (loading) {
    return (
      <div className="settings-overlay" onClick={handleBackdropClick} aria-modal="true" role="dialog" aria-label="Settings">
        <div className="settings-panel">
          <div className="settings-loading">Loading settings…</div>
        </div>
      </div>
    );
  }

  const effectiveBg = lg.bgBaseColor ?? LG_DEFAULTS.bgBaseColor!;
  const activeProvider = settings.provider?.kind === providerKind ? settings.provider : undefined;
  const activeProviderSupportsVoice = providerSupportsVoice(activeProvider);
  const shouldShowVoiceProviderSelector =
    (settings.stt?.provider ?? 'local') !== 'local' || (settings.tts?.provider ?? 'local') !== 'local';
  const voiceProviders = activeProviderSupportsVoice && activeProvider ? [activeProvider] : [];

  return (
    <>
    <div className="settings-overlay" onClick={handleBackdropClick} aria-modal="true" role="dialog" aria-label="Settings">
      <div className="settings-panel" ref={dialogRef} onKeyDown={handleDialogKeyDown}>
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="settings-body">

          {/* ── AI Providers ── */}
          <section className="settings-section provider-settings-section" aria-labelledby="section-providers">
            <h3 className="settings-section-title" id="section-providers">Provider Configuration</h3>
            {activeProviderSupportsVoice && (
              <span
                className="provider-voice-badge"
                aria-label="This provider supports voice input and/or output"
                role="status"
              >
                Voice
              </span>
            )}
            <div className="settings-field">
              <label className="settings-label" htmlFor="provider-select">Provider</label>
              <select
                id="provider-select"
                className="settings-input settings-select"
                value={providerKind}
                aria-label="AI provider"
                onChange={(e) => {
                  setProviderKind(e.target.value as ProviderKind);
                  setProviderApiKeyDirty(false);
                  setTestConnectionStatus('idle');
                  setSavedOk(false);
                }}
              >
                {PROVIDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            {(() => {
              const def = PROVIDER_OPTIONS.find((p) => p.value === providerKind)!;
              return (
                <>
                  {def.needsKey && (
                    <div className="settings-field">
                      <label className="settings-label" htmlFor="provider-api-key">API Key</label>
                      <div className="settings-input-row">
                        <input
                          id="provider-api-key"
                          className="settings-input"
                          type="password"
                          value={providerApiKey}
                          placeholder={settings.provider?.apiKey ? 'Key configured — enter a new key to replace' : 'Paste API key…'}
                          autoComplete="off"
                          spellCheck={false}
                          aria-label="Provider API key"
                          onChange={(e) => { setProviderApiKey(e.target.value); setProviderApiKeyDirty(true); setTestConnectionStatus('idle'); setSavedOk(false); }}
                        />
                      </div>
                      {!providerApiKeyDirty && settings.provider?.apiKey && (
                        <p className="settings-hint" data-testid="provider-key-configured-hint">Key is already configured.</p>
                      )}
                    </div>
                  )}
                  {def.needsUrl && (
                    <div className="settings-field">
                      <label className="settings-label" htmlFor="provider-base-url">Base URL</label>
                      <input
                        id="provider-base-url"
                        className="settings-input"
                        type="url"
                        value={providerBaseUrl}
                        placeholder="http://localhost:11434"
                        spellCheck={false}
                        aria-label="Provider base URL"
                        onChange={(e) => { setProviderBaseUrl(e.target.value); setTestConnectionStatus('idle'); setSavedOk(false); }}
                      />
                    </div>
                  )}
                  <div className="settings-field">
                    <label className="settings-label" htmlFor="provider-model">Default model</label>
                    <input
                      id="provider-model"
                      className="settings-input"
                      type="text"
                      value={providerModel}
                      placeholder={providerKind === 'anthropic' ? 'claude-sonnet-4-6' : 'model name'}
                      spellCheck={false}
                      aria-label="Default model for this provider"
                      onChange={(e) => { setProviderModel(e.target.value); setSavedOk(false); }}
                    />
                  </div>
                  <div className="settings-field">
                    <div className="settings-input-row">
                      <button
                        className="settings-btn settings-btn-secondary"
                        type="button"
                        disabled={testConnectionStatus === 'testing'}
                        aria-label="Test provider connection"
                        onClick={handleTestConnection}
                      >
                        {testConnectionStatus === 'testing' ? 'Testing…' : 'Test connection'}
                      </button>
                      {testConnectionStatus === 'ok' && (
                        <span className="settings-test-ok" role="status">{testConnectionMsg}</span>
                      )}
                      {testConnectionStatus === 'error' && (
                        <span className="settings-test-error" role="alert">{testConnectionMsg}</span>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </section>

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
                  aria-describedby={apiKeyError ? 'api-key-error api-key-hint' : 'api-key-hint'}
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
              <p className="settings-hint" id="api-key-hint">Used by all AI agents. Falls back to the ANTHROPIC_API_KEY environment variable if left empty.</p>
            </div>
          </section>

          {/* ── Account / Vault status (SKY-1112) ── */}
          <section className="settings-section settings-account-section" aria-labelledby="section-account">
            <h3 className="settings-section-title" id="section-account">Account</h3>
            <div className="settings-vault-card" aria-label="Current Story Vault">
              <div className="settings-vault-card-header">
                <div>
                  <span className="settings-vault-card-kicker">Vault</span>
                  <h4 className="settings-vault-card-title">Story Vault location</h4>
                </div>
                <VaultSyncBadge provider={vaultProvider} />
              </div>
              <p
                className="settings-vault-path-display"
                title={vaults.storyVaultPath || undefined}
              >
                {vaults.storyVaultPath || 'No Story Vault configured'}
              </p>
              <button
                className="settings-btn settings-btn-secondary settings-vault-move-btn"
                type="button"
                onClick={handleMoveVault}
                aria-label="Move to a different folder"
                data-testid="move-vault-btn"
              >
                Move to a different folder
              </button>
            </div>
          </section>

          {/* ── Vault paths (SKY-9) ── */}
          <section className="settings-section" aria-labelledby="section-vault-paths">
            <h3 className="settings-section-title" id="section-vault-paths">Vault paths</h3>
            <div className="settings-field">
              <label className="settings-label" htmlFor="story-vault-path-input">Story Vault</label>
              <div className="settings-input-row">
                <input
                  id="story-vault-path-input"
                  className="settings-input"
                  type="text"
                  value={vaults.storyVaultPath}
                  onChange={(e) => {
                    setVaults((prev) => ({ ...prev, storyVaultPath: e.target.value }));
                    setVaultsDirty(true);
                    setVaultsSavedOk(false);
                  }}
                  placeholder="~/Mythos/Story Vault"
                  aria-describedby="story-vault-path-hint"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  className="settings-reveal-btn"
                  type="button"
                  onClick={() => handlePickVaultFolder('storyVaultPath')}
                  aria-label="Choose Story Vault folder"
                >
                  Browse…
                </button>
              </div>
              <p className="settings-hint" id="story-vault-path-hint">Chapters and scenes live here. Agents never edit Story Vault contents.</p>
            </div>
            <div className="settings-field">
              <label className="settings-label" htmlFor="notes-vault-path-input">Notes Vault</label>
              <div className="settings-input-row">
                <input
                  id="notes-vault-path-input"
                  className="settings-input"
                  type="text"
                  value={vaults.notesVaultPath}
                  onChange={(e) => {
                    setVaults((prev) => ({ ...prev, notesVaultPath: e.target.value }));
                    setVaultsDirty(true);
                    setVaultsSavedOk(false);
                  }}
                  placeholder="~/Mythos/Notes Vault"
                  aria-describedby="notes-vault-path-hint"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  className="settings-reveal-btn"
                  type="button"
                  onClick={() => handlePickVaultFolder('notesVaultPath')}
                  aria-label="Choose Notes Vault folder"
                >
                  Browse…
                </button>
              </div>
              <p className="settings-hint" id="notes-vault-path-hint">Worldbuilding, characters, lore, and AI-curated notes. Seeded with <code>Universes/</code>, <code>Stories/</code>, <code>Inbox/</code>, <code>Research/</code>, <code>Daily Notes/</code>, and <code>Archive/</code> on first run (per the SKY-15 default layout).</p>
            </div>
            <div className="settings-input-row">
              <button
                className="settings-btn settings-btn-secondary"
                type="button"
                onClick={handleSaveVaults}
                disabled={!vaultsDirty || !vaults.storyVaultPath.trim() || !vaults.notesVaultPath.trim()}
              >
                Save vault paths
              </button>
              {vaultsSavedOk && <span className="settings-saved-msg" role="status">Saved. Restart to fully apply.</span>}
              {vaultsError && <span className="settings-error-msg" role="alert">{vaultsError}</span>}
            </div>
            <p className="settings-hint">Changes take effect after restart — the Story Vault watcher and DB are bound at app boot.</p>

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
                {/* Model selector for global provider override */}
                {!agentOverrides.writingAssistant.enabled && (
                  <div className="settings-field settings-field-inline">
                    <label className="settings-label" htmlFor="wa-model">Model</label>
                    {providerKind === 'anthropic' ? (
                      <select
                        id="wa-model"
                        className="settings-input settings-select settings-input-sm"
                        value={settings.agents.writingAssistant.model}
                        aria-label="Writing Assistant model"
                        onChange={(e) => setAgentField('writingAssistant', 'model', e.target.value)}
                      >
                        {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input
                        id="wa-model"
                        className="settings-input settings-input-sm"
                        type="text"
                        value={settings.agents.writingAssistant.model}
                        placeholder="model name (e.g. llama3-70b)"
                        aria-label="Writing Assistant model"
                        maxLength={128}
                        onChange={(e) => setAgentField('writingAssistant', 'model', e.target.value)}
                      />
                    )}
                  </div>
                )}
                <AgentProviderSection
                  agentName="writingAssistant"
                  idPrefix="wa"
                  globalProviderKind={providerKind}
                  override={agentOverrides.writingAssistant}
                  savedApiKey={settings.agents.writingAssistant.provider?.apiKey}
                  testStatus={agentTestStatus.writingAssistant}
                  testMsg={agentTestMsg.writingAssistant}
                  onChange={(field, value) => setAgentOverride('writingAssistant', field, value)}
                  onTest={() => handleAgentTestConnection('writingAssistant')}
                />
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
                <AutoApplyCategoryToggles
                  idPrefix="wa"
                  agentLabel="Writing Assistant"
                  agent={settings.agents.writingAssistant}
                  agentKey="writingAssistant"
                  onChange={setCategoryAutoApply}
                />
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
              <PersonaViewer agentName="writingAssistant" />
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
                {!agentOverrides.brainstorm.enabled && (
                  <div className="settings-field settings-field-inline">
                    <label className="settings-label" htmlFor="brainstorm-model">Model</label>
                    {providerKind === 'anthropic' ? (
                      <select
                        id="brainstorm-model"
                        className="settings-input settings-select settings-input-sm"
                        value={settings.agents.brainstorm.model}
                        aria-label="Brainstorm Agent model"
                        onChange={(e) => setAgentField('brainstorm', 'model', e.target.value)}
                      >
                        {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input
                        id="brainstorm-model"
                        className="settings-input settings-input-sm"
                        type="text"
                        value={settings.agents.brainstorm.model}
                        placeholder="model name (e.g. llama3-70b)"
                        aria-label="Brainstorm Agent model"
                        maxLength={128}
                        onChange={(e) => setAgentField('brainstorm', 'model', e.target.value)}
                      />
                    )}
                  </div>
                )}
                <AgentProviderSection
                  agentName="brainstorm"
                  idPrefix="brainstorm"
                  globalProviderKind={providerKind}
                  override={agentOverrides.brainstorm}
                  savedApiKey={settings.agents.brainstorm.provider?.apiKey}
                  testStatus={agentTestStatus.brainstorm}
                  testMsg={agentTestMsg.brainstorm}
                  onChange={(field, value) => setAgentOverride('brainstorm', field, value)}
                  onTest={() => handleAgentTestConnection('brainstorm')}
                />
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
                <AutoApplyCategoryToggles
                  idPrefix="brainstorm"
                  agentLabel="Brainstorm Agent"
                  agent={settings.agents.brainstorm}
                  agentKey="brainstorm"
                  onChange={setCategoryAutoApply}
                />
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
                {/* SKY-20: per-category routing memory for Blank-mode vaults.
                    Hidden in Default-mode vaults (the seeded layout fixes the
                    destination) so users don't see an empty / inert control. */}
                <BrainstormRoutingPanel />
              </div>
              <PersonaViewer agentName="brainstorm" />
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
                {!agentOverrides.archive.enabled && (
                  <div className="settings-field settings-field-inline">
                    <label className="settings-label" htmlFor="archive-model">Model</label>
                    {providerKind === 'anthropic' ? (
                      <select
                        id="archive-model"
                        className="settings-input settings-select settings-input-sm"
                        value={settings.agents.archive.model}
                        aria-label="Archive Agent model"
                        onChange={(e) => setAgentField('archive', 'model', e.target.value)}
                      >
                        {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input
                        id="archive-model"
                        className="settings-input settings-input-sm"
                        type="text"
                        value={settings.agents.archive.model}
                        placeholder="model name (e.g. llama3-70b)"
                        aria-label="Archive Agent model"
                        maxLength={128}
                        onChange={(e) => setAgentField('archive', 'model', e.target.value)}
                      />
                    )}
                  </div>
                )}
                <AgentProviderSection
                  agentName="archive"
                  idPrefix="archive"
                  globalProviderKind={providerKind}
                  override={agentOverrides.archive}
                  savedApiKey={settings.agents.archive.provider?.apiKey}
                  testStatus={agentTestStatus.archive}
                  testMsg={agentTestMsg.archive}
                  onChange={(field, value) => setAgentOverride('archive', field, value)}
                  onTest={() => handleAgentTestConnection('archive')}
                />
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
                <AutoApplyCategoryToggles
                  idPrefix="archive"
                  agentLabel="Archive Agent"
                  agent={settings.agents.archive}
                  agentKey="archive"
                  onChange={setCategoryAutoApply}
                />
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

          {/* ── Auto Linker (SKY-192) ── */}
          <section className="settings-section" aria-labelledby="section-autolinker">
            <h3 className="settings-section-title" id="section-autolinker">Auto Linker</h3>
            <div className="settings-field">
              <label className="settings-label">Entity mention mode</label>
              <div className="settings-radio-group" role="radiogroup" aria-label="Auto Linker mode">
                {([
                  { value: 'off', label: 'Off' },
                  { value: 'suggest', label: 'Suggest (default)' },
                  { value: 'auto', label: 'Auto on save' },
                ] as const).map(({ value, label }) => (
                  <label key={value} className="settings-radio-label">
                    <input
                      type="radio"
                      name="autoLinkerMode"
                      value={value}
                      checked={(settings.autoLinker?.mode ?? 'suggest') === value}
                      onChange={() => {
                        setSettings((p) => ({ ...p, autoLinker: { mode: value } }));
                        setSavedOk(false);
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="settings-hint">
                <strong>Suggest</strong> — underlines unlinked entity names; click to wrap in{' '}
                <code>[[wikilink]]</code>.{' '}
                <strong>Auto on save</strong> — applies all suggestions automatically when the scene is saved
                (one Undo to revert).
              </p>
            </div>
          </section>

          {/* ── Journal Mode (SKY-204) ── */}
          <section className="settings-section" aria-labelledby="section-journal">
            <h3 className="settings-section-title" id="section-journal">Journal Mode</h3>
            <div className="settings-field">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.journalMode?.enabled ?? false}
                  onChange={(e) => {
                    setSettings((p) => ({
                      ...p,
                      journalMode: { ...(p.journalMode ?? {}), enabled: e.target.checked },
                    }));
                    setSavedOk(false);
                  }}
                />
                Enable daily notes (auto-create a dated note each day you open the app)
              </label>
              <p className="settings-hint">
                Creates a note like <code>Daily Notes/2025-01-15.md</code> on first launch of each new
                calendar day. The writing streak counter in the Notes sidebar tracks consecutive days
                with a note.
              </p>
            </div>
            {(settings.journalMode?.enabled) && (
              <div className="settings-field settings-field-inline">
                <label className="settings-label" htmlFor="journal-folder">Daily notes folder</label>
                <input
                  id="journal-folder"
                  className="settings-input"
                  type="text"
                  placeholder="Daily Notes"
                  value={settings.journalMode?.noteFolder ?? ''}
                  onChange={(e) => {
                    setSettings((p) => ({
                      ...p,
                      journalMode: { ...(p.journalMode ?? { enabled: true }), noteFolder: e.target.value || undefined },
                    }));
                    setSavedOk(false);
                  }}
                />
              </div>
            )}
          </section>

          {/* ── Scene Fields (SKY-207) ── */}
          <section className="settings-section" aria-labelledby="section-scene-fields">
            <h3 className="settings-section-title" id="section-scene-fields">Scene Fields</h3>
            <p className="settings-hint">
              Define custom frontmatter fields — mood, tension, weather, POV, etc. — that appear in the scene
              properties panel and are queryable in Saved Searches (e.g. <code>mood: tense AND tension: 8</code>).
              Removing a field definition does not delete existing values from scene files.
            </p>
            {customFields.length > 0 && (
              <ul className="cf-field-list" aria-label="Custom field definitions">
                {customFields.map((f) => (
                  <li key={f.id} className="cf-field-item">
                    <span className="cf-field-name">{f.name}</span>
                    <span className="cf-field-type">{f.type}</span>
                    {f.type === 'select' && f.options && (
                      <span className="cf-field-options">{f.options.join(', ')}</span>
                    )}
                    <button
                      type="button"
                      className="cf-field-remove"
                      aria-label={`Remove field ${f.name}`}
                      onClick={() => handleRemoveField(f.id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!addingField ? (
              <button
                type="button"
                className="settings-btn settings-btn-secondary"
                onClick={() => { setAddingField(true); setCustomFieldsError(null); }}
              >
                + Add field
              </button>
            ) : (
              <div className="cf-add-form" role="group" aria-label="Add custom field">
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="cf-name">Name</label>
                  <input
                    id="cf-name"
                    className="settings-input"
                    type="text"
                    placeholder="mood"
                    value={newFieldName}
                    autoFocus
                    onChange={(e) => setNewFieldName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddField(); if (e.key === 'Escape') setAddingField(false); }}
                  />
                </div>
                <div className="settings-field settings-field-inline">
                  <label className="settings-label" htmlFor="cf-type">Type</label>
                  <select
                    id="cf-type"
                    className="settings-input settings-select"
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value as FieldType)}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="select">Select</option>
                  </select>
                </div>
                {newFieldType === 'select' && (
                  <div className="settings-field settings-field-inline">
                    <label className="settings-label" htmlFor="cf-options">Options</label>
                    <input
                      id="cf-options"
                      className="settings-input"
                      type="text"
                      placeholder="calm, tense, urgent"
                      value={newFieldOptions}
                      onChange={(e) => setNewFieldOptions(e.target.value)}
                    />
                    <span className="settings-hint" style={{ marginLeft: 8 }}>comma-separated</span>
                  </div>
                )}
                <div className="settings-input-row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="settings-btn settings-btn-save"
                    onClick={handleAddField}
                    disabled={!newFieldName.trim()}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="settings-btn settings-btn-cancel"
                    onClick={() => setAddingField(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {customFieldsDirty && (
              <div className="settings-input-row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="settings-btn settings-btn-secondary"
                  onClick={handleSaveCustomFields}
                >
                  Save field definitions
                </button>
                {customFieldsSavedOk && <span className="settings-saved-msg" role="status">Saved.</span>}
                {customFieldsError && <span className="settings-error-msg" role="alert">{customFieldsError}</span>}
              </div>
            )}
            {!customFieldsDirty && customFieldsSavedOk && (
              <span className="settings-saved-msg" role="status">Saved.</span>
            )}
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
            <div className="settings-field settings-field-inline" style={{ marginTop: 8 }}>
              <span className="settings-label">Danger zone</span>
              <button
                className="settings-btn-danger"
                onClick={async () => {
                  if (!window.confirm('Delete ALL snapshots across every scene? This cannot be undone.')) return;
                  await window.api.snapshotDeleteAll();
                  setSavedOk(false);
                }}
              >
                Delete all snapshots
              </button>
            </div>
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
                        applyTheme(value);
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

            {/* Main softness↔contrast slider with Advanced button */}
            <div className="settings-field">
              <label className="settings-label" htmlFor="lg-softness">Style</label>
              <div className="lg-slider-band">
                <div className="lg-slider-labeled-row">
                  <span className="lg-axis-label">Softness</span>
                  <input
                    id="lg-softness"
                    data-testid="theme-contrast-slider"
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
                <div className="lg-slider-footer">
                  {lg.advancedDecoupled && (
                    <button
                      className="lg-relink-btn"
                      type="button"
                      onClick={handleRelinkToSlider}
                    >
                      Re-link to slider
                    </button>
                  )}
                  <button
                    className="lg-advanced-pill"
                    type="button"
                    onClick={() => setLgAdvancedOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={lgAdvancedOpen}
                  >
                    Advanced…
                  </button>
                </div>
              </div>
            </div>

            {/* Reset to defaults */}
            <div className="lg-reset-row">
              <button
                className="settings-btn lg-btn-reset"
                type="button"
                onClick={handleResetAll}
                aria-label="Reset all appearance settings to defaults"
              >
                {resetConfirm ? 'Confirm reset' : 'Reset to defaults'}
              </button>
              {resetConfirm && (
                <button
                  className="settings-btn lg-btn-secondary"
                  type="button"
                  onClick={() => setResetConfirm(false)}
                >
                  Cancel
                </button>
              )}
            </div>

          </section>

          {/* ── Focus Mode (SKY-325) ── */}
          {onFocusPrefsChange && (
            <section className="settings-section" aria-labelledby="section-focus-mode">
              <h3 className="settings-section-title" id="section-focus-mode">Focus Mode</h3>
              <p className="settings-hint">Choose which UI elements stay visible in Focus Mode and Distraction-Free mode. Changes apply immediately.</p>
              {(
                [
                  { key: 'showTitleBar',       label: 'Show title bar' },
                  { key: 'showStatusBar',       label: 'Show status bar' },
                  { key: 'showTabBar',          label: 'Show tabs' },
                  { key: 'showSidebarButtons',  label: 'Show sidebar collapse buttons' },
                  { key: 'showScrollbars',      label: 'Show scrollbars' },
                  { key: 'showFileTreeArrows',  label: 'Show file tree toggle arrows' },
                ] as const
              ).map(({ key, label }) => {
                const checked = focusPrefs ? focusPrefs[key] : FOCUS_PREFS_DEFAULTS[key];
                return (
                  <label key={key} className="settings-focus-toggle">
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={label}
                      onChange={() => {
                        if (!focusPrefs || !onFocusPrefsChange) return;
                        onFocusPrefsChange({ ...focusPrefs, [key]: !checked });
                      }}
                    />
                    <span className="settings-label">{label}</span>
                  </label>
                );
              })}
              <div className="settings-input-row" style={{ marginTop: 8 }}>
                <button
                  className="settings-btn settings-btn-secondary"
                  type="button"
                  onClick={() => {
                    if (!focusPrefs || !onFocusPrefsChange) return;
                    onFocusPrefsChange({ ...focusPrefs, ...FOCUS_PREFS_DEFAULTS });
                  }}
                >
                  Reset to defaults
                </button>
              </div>
            </section>
          )}

          {/* ── Voice ── */}
          <section className="settings-section" aria-labelledby="section-voice">
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
                      const enabled = e.target.checked;
                      setSettings((p) => ({
                        ...p,
                        voice: { ...(p.voice ?? { enabled: false, cloudFallback: false }), enabled },
                      }));
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

              <p className="settings-hint settings-hint-privacy">
                Voice is processed locally on your device when local mode is active; cloud voice uses the selected provider.
              </p>
              <p className="settings-hint">
                When push-to-talk is on, hold <kbd>Ctrl+Shift+M</kbd> to record and release to stop.
                When off, <kbd>Ctrl+Shift+M</kbd> toggles recording on/off.
                Requires microphone permission.
              </p>
            </div>
          </section>

          {/* ── Telemetry ── */}
          <section className="settings-section" aria-labelledby="section-telemetry">
            <h3 className="settings-section-title" id="section-telemetry">Telemetry</h3>
            <div className="settings-field">
              <div className="settings-agent-header">
                <span className="settings-label">Send anonymous usage data</span>
                <label className="settings-toggle" htmlFor="telemetry-enabled">
                  <input
                    id="telemetry-enabled"
                    type="checkbox"
                    aria-label="Enable telemetry"
                    checked={telemetryEnabled}
                    onChange={(e) => { setTelemetryEnabled(e.target.checked); setSavedOk(false); }}
                  />
                  <span className="settings-toggle-track" />
                </label>
              </div>
              <p className="settings-hint">Off by default. When enabled, we collect only:</p>
              <ul className="settings-telemetry-list" aria-label="Telemetry data items">
                {TELEMETRY_DATA_LIST.map((item) => (
                  <li key={item} className="settings-telemetry-item">{item}</li>
                ))}
              </ul>
              <p className="settings-hint">No text content, file names, or personal data is ever sent.</p>
            </div>
          </section>

        </div>

        <div className="settings-footer">
          {saveError && <p className="settings-error-msg" role="alert">{saveError}</p>}
          {savedOk && <p className="settings-saved-msg" aria-live="polite">Settings saved.</p>}
          {/* SKY-12.4: debug reset — only rendered when MYTHOS_DEV=1 is set in the dev environment */}
          {import.meta.env.VITE_MYTHOS_DEV === '1' && (
            <div className="settings-debug-section">
              <h3 className="settings-section-title">Developer</h3>
              <button
                className="settings-btn settings-btn-cancel"
                data-testid="reset-onboarding"
                onClick={() => {
                  if (window.confirm('Reset onboarding? The wizard will re-appear on next boot.')) {
                    window.api.onboardingReset().then(() => {
                      window.location.reload();
                    }).catch(() => {});
                  }
                }}
              >
                Reset onboarding
              </button>
            </div>
          )}
          <div className="settings-footer-actions">
            <button type="button" className="settings-btn settings-btn-cancel" onClick={onClose}>Cancel</button>
            <button
              type="button"
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

      {/* ── Advanced UI settings popover (MYT-716) ── */}
      {lgAdvancedOpen && (
        <div
          className="lg-popover-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setLgAdvancedOpen(false); }}
        >
          <div
            className="lg-popover"
            role="dialog"
            aria-modal="true"
            aria-label="Advanced UI settings"
            ref={popoverRef}
          >
            <div className="lg-popover-header">
              <h3 className="lg-popover-title">Advanced UI settings</h3>
              <button
                className="settings-close"
                type="button"
                onClick={() => setLgAdvancedOpen(false)}
                aria-label="Close advanced UI settings"
              >
                ✕
              </button>
            </div>

            <div className="lg-popover-body">

              {/* ── B1–B3: Per-value sliders ── */}
              <div className="lg-popover-section">
                <h4 className="lg-popover-section-title">Backdrop &amp; Glow</h4>
                {lg.advancedDecoupled && (
                  <p className="settings-hint lg-decouple-notice">
                    Sliders below are decoupled from the main Style slider.{' '}
                    <button className="lg-link-btn" onClick={handleRelinkToSlider} type="button">Re-link</button>
                  </p>
                )}

                <div className="settings-field settings-field-inline">
                  <label className="settings-label lg-adv-label" htmlFor="adv-blur">Backdrop blur</label>
                  <div className="lg-slider-labeled-row lg-adv-slider-row">
                    <span className="lg-axis-label">More</span>
                    <input
                      id="adv-blur"
                      className="settings-slider"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={lg.blur}
                      aria-label="Backdrop blur more to less"
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setLg((prev) => {
                          const next = { ...prev, blur: v, advancedDecoupled: true };
                          applyLiquidNeonTokens(next, bgPreviewUrl);
                          return next;
                        });
                        setSavedOk(false);
                      }}
                    />
                    <span className="lg-axis-label lg-axis-right">Less</span>
                  </div>
                </div>

                <div className="settings-field settings-field-inline">
                  <label className="settings-label lg-adv-label" htmlFor="adv-glass">Glass opacity</label>
                  <div className="lg-slider-labeled-row lg-adv-slider-row">
                    <span className="lg-axis-label">Lighter</span>
                    <input
                      id="adv-glass"
                      className="settings-slider"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={lg.glass}
                      aria-label="Glass opacity lighter to darker"
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setLg((prev) => {
                          const next = { ...prev, glass: v, advancedDecoupled: true };
                          applyLiquidNeonTokens(next, bgPreviewUrl);
                          return next;
                        });
                        setSavedOk(false);
                      }}
                    />
                    <span className="lg-axis-label lg-axis-right">Darker</span>
                  </div>
                </div>

                <div className="settings-field settings-field-inline">
                  <label className="settings-label lg-adv-label" htmlFor="adv-neon">Neon glow</label>
                  <div className="lg-slider-labeled-row lg-adv-slider-row">
                    <span className="lg-axis-label">Strong</span>
                    <input
                      id="adv-neon"
                      className="settings-slider"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={lg.neonIntensity}
                      aria-label="Neon glow strong to soft"
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setLg((prev) => {
                          const next = { ...prev, neonIntensity: v, advancedDecoupled: true };
                          applyLiquidNeonTokens(next, bgPreviewUrl);
                          return next;
                        });
                        setSavedOk(false);
                      }}
                    />
                    <span className="lg-axis-label lg-axis-right">Soft</span>
                  </div>
                </div>
              </div>

              {/* ── D1–D3: Extra sliders ── */}
              <div className="lg-popover-section">
                <h4 className="lg-popover-section-title">Detail</h4>

                <div className="settings-field settings-field-inline">
                  <label className="settings-label lg-adv-label" htmlFor="adv-neon-frame">Neon frame</label>
                  <div className="lg-slider-labeled-row lg-adv-slider-row">
                    <span className="lg-axis-label">Thin</span>
                    <input
                      id="adv-neon-frame"
                      className="settings-slider"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={lg.neonFrameWidth ?? 50}
                      aria-label="Neon frame width thin to thick"
                      onChange={(e) => setLgField('neonFrameWidth', Number(e.target.value))}
                    />
                    <span className="lg-axis-label lg-axis-right">Thick</span>
                  </div>
                </div>

                <div className="settings-field settings-field-inline">
                  <label className="settings-label lg-adv-label" htmlFor="adv-border">Border</label>
                  <div className="lg-slider-labeled-row lg-adv-slider-row">
                    <span className="lg-axis-label">Subtle</span>
                    <input
                      id="adv-border"
                      className="settings-slider"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={lg.borderStrength ?? 50}
                      aria-label="Border strength subtle to strong"
                      onChange={(e) => setLgField('borderStrength', Number(e.target.value))}
                    />
                    <span className="lg-axis-label lg-axis-right">Strong</span>
                  </div>
                </div>
              </div>

              {/* ── C4–C7: Background ── */}
              <div className="lg-popover-section">
                <h4 className="lg-popover-section-title">Background</h4>

                {/* Mode toggle */}
                <div className="settings-field">
                  <div className="lg-mode-toggle" role="radiogroup" aria-label="Background mode">
                    {(['color', 'image'] as const).map((mode) => (
                      <label key={mode} className={`lg-mode-btn${(lg.bgMode ?? 'color') === mode ? ' lg-mode-btn-active' : ''}`}>
                        <input
                          type="radio"
                          name="lg-bg-mode"
                          value={mode}
                          checked={(lg.bgMode ?? 'color') === mode}
                          onChange={() => setLgField('bgMode', mode)}
                          aria-label={`Background mode ${mode}`}
                        />
                        {mode === 'color' ? 'Colour' : 'Image'}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Image controls */}
                {(lg.bgMode ?? 'color') === 'image' && (
                  <div className="lg-bg-image-section">
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
                          backgroundSize: lg.bgFit === 'tile' ? 'auto' : (lg.bgFit ?? 'cover'),
                          backgroundRepeat: lg.bgFit === 'tile' ? 'repeat' : 'no-repeat',
                          backgroundPosition: lg.bgPosition ?? 'center',
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
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="settings-hint">JPEG, PNG, WebP — replaces the app wallpaper. Max ~12 MB.</p>

                    {/* Fit */}
                    <div className="settings-field settings-field-inline">
                      <label className="settings-label lg-adv-label" htmlFor="adv-bg-fit">Fit</label>
                      <div className="lg-mode-toggle" role="radiogroup" aria-label="Image fit">
                        {(['cover', 'contain', 'tile'] as const).map((fit) => (
                          <label key={fit} className={`lg-mode-btn${(lg.bgFit ?? 'cover') === fit ? ' lg-mode-btn-active' : ''}`}>
                            <input
                              type="radio"
                              name="lg-bg-fit"
                              value={fit}
                              checked={(lg.bgFit ?? 'cover') === fit}
                              onChange={() => setLgField('bgFit', fit)}
                              aria-label={`Image fit ${fit}`}
                            />
                            {fit.charAt(0).toUpperCase() + fit.slice(1)}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Position — 9-point grid */}
                    <div className="settings-field">
                      <label className="settings-label">Position</label>
                      <div className="lg-position-grid" role="radiogroup" aria-label="Image position">
                        {BG_POSITIONS.map(({ value, label }) => (
                          <label
                            key={value}
                            className={`lg-position-cell${(lg.bgPosition ?? 'center') === value ? ' lg-position-cell-active' : ''}`}
                            title={value}
                          >
                            <input
                              type="radio"
                              name="lg-bg-position"
                              value={value}
                              checked={(lg.bgPosition ?? 'center') === value}
                              onChange={() => setLgField('bgPosition', value)}
                              aria-label={`Image position ${value}`}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Scrim */}
                    <div className="settings-field settings-field-inline">
                      <label className="settings-label lg-adv-label" htmlFor="adv-scrim">Scrim</label>
                      <div className="lg-slider-labeled-row lg-adv-slider-row">
                        <span className="lg-axis-label">Light</span>
                        <input
                          id="adv-scrim"
                          className="settings-slider"
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={lg.bgScrim ?? 40}
                          aria-label="Background scrim light to dark"
                          onChange={(e) => setLgField('bgScrim', Number(e.target.value))}
                        />
                        <span className="lg-axis-label lg-axis-right">Dark</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Vignette (always visible) */}
                <div className="settings-field settings-field-inline">
                  <label className="settings-label lg-adv-label" htmlFor="adv-vignette">Vignette</label>
                  <div className="lg-slider-labeled-row lg-adv-slider-row">
                    <span className="lg-axis-label">Off</span>
                    <input
                      id="adv-vignette"
                      className="settings-slider"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={lg.bgVignette ?? 40}
                      aria-label="Background vignette off to strong"
                      onChange={(e) => setLgField('bgVignette', Number(e.target.value))}
                    />
                    <span className="lg-axis-label lg-axis-right">Strong</span>
                  </div>
                </div>

                {/* Base color */}
                <ColorPicker
                  id="adv-bg-base"
                  label="Base colour"
                  value={lg.bgBaseColor ?? '#0e1116'}
                  onChange={(v) => setLgField('bgBaseColor', v)}
                />
              </div>

              {/* ── E1–E4: Color pickers ── */}
              <div className="lg-popover-section">
                <h4 className="lg-popover-section-title">Colours</h4>

                <ColorPicker
                  id="adv-text-header"
                  label="Header text"
                  value={lg.textHeader ?? LG_DEFAULTS.textHeader!}
                  bgForContrast={effectiveBg}
                  minRatio={4.5}
                  onChange={(v) => setLgField('textHeader', v)}
                />
                <ColorPicker
                  id="adv-text-body"
                  label="Body text"
                  value={lg.textBody ?? LG_DEFAULTS.textBody!}
                  bgForContrast={effectiveBg}
                  minRatio={4.5}
                  onChange={(v) => setLgField('textBody', v)}
                />
                <ColorPicker
                  id="adv-text-muted"
                  label="Muted text"
                  value={lg.textMuted ?? LG_DEFAULTS.textMuted!}
                  bgForContrast={effectiveBg}
                  minRatio={4.5}
                  onChange={(v) => setLgField('textMuted', v)}
                />
                <ColorPicker
                  id="adv-accent"
                  label="Accent"
                  value={lg.accentColor ?? '#00f0ff'}
                  onChange={(v) => setLgField('accentColor', v)}
                />

                {/* Neon border colour slots A / B / C (SKY-910) — three-stop
                    configurable gradient for the multi-color border treatment. */}
                {([
                  { field: 'neonBorderColor',  label: 'Neon border A', radioName: 'lg-neon-border',   fallback: 'cyan' },
                  { field: 'neonBorderColor2', label: 'Neon border B', radioName: 'lg-neon-border-2', fallback: 'violet' },
                  { field: 'neonBorderColor3', label: 'Neon border C', radioName: 'lg-neon-border-3', fallback: 'magenta' },
                ] as const).map(({ field, label, radioName, fallback }) => {
                  const current = (lg[field] ?? fallback) as 'cyan' | 'violet' | 'magenta';
                  return (
                    <div key={field} className="settings-field">
                      <label className="settings-label">{label}</label>
                      <div className="lg-swatch-row" role="radiogroup" aria-label={`${label} colour`}>
                        {(['cyan', 'violet', 'magenta'] as const).map((accent) => (
                          <label key={accent} className="lg-swatch-label">
                            <input
                              type="radio"
                              name={radioName}
                              value={accent}
                              checked={current === accent}
                              onChange={() => setLgField(field, accent)}
                              aria-label={`${label} ${accent}`}
                            />
                            <span
                              className={`lg-swatch lg-swatch-${accent}${current === accent ? ' lg-swatch-active' : ''}`}
                              title={accent.charAt(0).toUpperCase() + accent.slice(1)}
                            />
                            <span className="lg-swatch-name">{accent.charAt(0).toUpperCase() + accent.slice(1)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Legacy neon accent slot (kept for compatibility) */}
                <div className="settings-field">
                  <label className="settings-label">Neon accent</label>
                  <div className="lg-swatch-row" role="radiogroup" aria-label="Neon accent colour">
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

                {/* Neon colors (SKY-127) — user-configurable RGB values */}
                <ColorPicker
                  id="lg-neon-cyan"
                  label="Cyan neon colour"
                  value={lg.neonColorCyan ?? '#00f0ff'}
                  onChange={(v) => setLgField('neonColorCyan', v)}
                />
                <ColorPicker
                  id="lg-neon-violet"
                  label="Violet neon colour"
                  value={lg.neonColorViolet ?? '#9b5fff'}
                  onChange={(v) => setLgField('neonColorViolet', v)}
                />
                <ColorPicker
                  id="lg-neon-magenta"
                  label="Magenta neon colour"
                  value={lg.neonColorMagenta ?? '#ff4dff'}
                  onChange={(v) => setLgField('neonColorMagenta', v)}
                />
              </div>

              {/* ── Reset ── */}
              <div className="lg-popover-reset">
                <button
                  className="settings-btn lg-btn-reset"
                  type="button"
                  onClick={handleResetAll}
                  aria-label="Reset all appearance settings to defaults"
                >
                  {resetConfirm ? 'Confirm reset' : 'Reset to defaults'}
                </button>
                {resetConfirm && (
                  <button
                    className="settings-btn lg-btn-secondary"
                    type="button"
                    onClick={() => setResetConfirm(false)}
                  >
                    Cancel
                  </button>
                )}
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
    {remoteWarning && (
      <SecurityWarningDialog
        url={remoteWarning.url}
        onConfirm={() => { remoteWarning.onConfirm(); setRemoteWarning(null); }}
        onCancel={() => setRemoteWarning(null)}
      />
    )}
    {showMoveWizard && (
      <MoveVaultWizard
        onClose={() => setShowMoveWizard(false)}
        onSuccess={(newPath) => {
          setShowMoveWizard(false);
          setVaults((prev) => ({ ...prev, storyVaultPath: newPath }));
        }}
      />
    )}
    </>
  );
}

// SKY-20: Brainstorm routing memory — shows which folder the agent has
// remembered for each category in a Blank-mode vault and lets the user
// clear it. Hidden in Default-mode vaults (the seeded layout fixes the
// destination so there is nothing to reset).
type RoutingCategory = 'character' | 'location' | 'item' | 'note';
const ROUTING_CATEGORIES: RoutingCategory[] = ['character', 'location', 'item', 'note'];

function BrainstormRoutingPanel() {
  const [layoutMode, setLayoutMode] = useState<'default' | 'blank' | 'imported' | null>(null);
  const [routing, setRouting] = useState<Partial<Record<RoutingCategory, string>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { layoutMode: mode, notesRouting } = await window.api.brainstormGetSettings();
        if (cancelled) return;
        setLayoutMode(mode);
        setRouting(notesRouting);
      } catch {
        if (!cancelled) setLayoutMode('default');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleReset = useCallback(async (category: RoutingCategory) => {
    try {
      const result = await window.api.brainstormResetCategoryRouting(category);
      setRouting(result.notesRouting);
    } catch {
      // No-op — failure here leaves the existing memory in place.
    }
  }, []);

  if (layoutMode === null || layoutMode === 'default') return null;

  return (
    <div className="settings-field" data-testid="brainstorm-routing-panel">
      <label className="settings-label" id="brainstorm-routing-label">Notes folder routing</label>
      <p className="settings-help-text" id="brainstorm-routing-hint">
        Brainstorm asks once per category in a Blank vault and remembers your
        pick. Clear a row below to be asked again on the next note.
      </p>
      <ul className="bs-routing-memory-list" aria-labelledby="brainstorm-routing-label" aria-describedby="brainstorm-routing-hint">
        {ROUTING_CATEGORIES.map((cat) => {
          const dest = routing[cat];
          return (
            <li
              key={cat}
              className="bs-routing-memory-row"
              data-testid={`brainstorm-routing-memory-${cat}`}
            >
              <span className="bs-routing-memory-cat">{cat}</span>
              <span className="bs-routing-memory-dest">
                {dest !== undefined ? dest || '/ (root)' : <em>Ask on next note</em>}
              </span>
              <button
                type="button"
                className="bs-routing-memory-reset"
                disabled={dest === undefined}
                onClick={() => void handleReset(cat)}
                aria-label={`Reset routing for ${cat}`}
                data-testid={`brainstorm-routing-reset-${cat}`}
              >
                Reset
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
