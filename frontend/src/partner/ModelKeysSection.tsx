/**
 * Slice C — Settings › Model & keys (was AI Agents).
 * Three provider buckets + Claude connect stubs + models + privacy.
 * No four per-agent Settings cards as Writing partner primary.
 */
import { useEffect, useRef, useState } from 'react';
import { PARTNER_HANDS } from '../agents/partnerIdentity';
import {
  COMING_SOON_PROVIDERS,
  HAND_LIMITS,
  modelsForProvider,
  resolveWritingPartner,
  scopedModel,
  type ClaudeCliState,
  type ModelKeysProviderId,
  type TelemetryLevel,
  type WritingPartnerSettings,
} from './partnerSettings';
import {
  looksLikeMaskedApiKeyPreview,
  MASKED_API_KEY_PREVIEW_MESSAGE,
} from '../lib/maskedApiKeyPreview';
import {
  DEFAULT_BASE_URLS,
  LISTABLE_PROVIDERS,
  PROVIDER_OPTIONS,
  type ModelListStatus,
  type ProviderKind,
  type TestConnectionStatus,
} from '../components/SettingsPanel/settingsPanelTypes';
import './ModelKeysSection.css';

interface ModelKeysSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  /** Existing provider test wiring from SettingsPanel. */
  onTestConnection: () => void;
  testStatus: 'idle' | 'testing' | 'ok' | 'error';
  testMsg: string;
  providerApiKey: string;
  setProviderApiKey: (v: string) => void;
  providerApiKeyDirty: boolean;
  setProviderApiKeyDirty: (v: boolean) => void;
  providerBaseUrl: string;
  setProviderBaseUrl: (v: string) => void;
  showApiKey: boolean;
  setShowApiKey: (v: boolean) => void;
  setSavedOk: (ok: boolean) => void;
  /**
   * F5#3: open the existing whole-vault MoveVaultWizard. Only the Story Vault
   * folder moves; Agent Vault (identity & memory) is a Mythos-root sibling and
   * stays put. API keys live in userData secrets.json and never move.
   */
  onMoveVault?: () => void;
  /**
   * PLAN-058 L2 (12:44): live provider kind. Bucket clicks call
   * onSelectProviderKind so kind / base URL / model list stay on this page
   * after the old Provider Configuration section is unmounted.
   * Omitted by isolated mounts — buckets then only patch modelKeysProvider.
   */
  providerKind?: ProviderKind;
  onSelectProviderKind?: (kind: ProviderKind) => void;
  providerModel?: string;
  setProviderModel?: (model: string) => void;
  savedProviderApiKey?: string;
  modelList?: string[];
  modelListStatus?: ModelListStatus;
  modelListError?: string | null;
  useCustomInput?: boolean;
  setUseCustomInput?: (v: boolean) => void;
  onFetchModels?: (kind: ProviderKind, baseUrl: string) => void;
  setTestConnectionStatus?: (status: TestConnectionStatus) => void;
}

function patchPartner(
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>,
  patch: Partial<WritingPartnerSettings>,
): void {
  setSettings((prev) => {
    const cur = resolveWritingPartner(prev);
    return { ...prev, writingPartner: { ...cur, ...patch } };
  });
}

const BUCKETS: ReadonlyArray<{
  id: 'cli' | 'api' | 'local';
  label: string;
  sub: string;
  items: ReadonlyArray<{ id: ModelKeysProviderId; title: string }>;
}> = [
  {
    id: 'cli',
    label: 'USE MY SUBSCRIPTION (CLI)',
    sub: 'Log in with an account you already pay for. Mythos never resells it.',
    items: [
      { id: 'claude', title: 'Claude' },
      { id: 'openai-codex', title: 'OpenAI Codex' },
      { id: 'gemini', title: 'Google Gemini' },
      { id: 'copilot', title: 'GitHub Copilot' },
      { id: 'cursor', title: 'Cursor' },
    ],
  },
  {
    id: 'api',
    label: 'API KEY / CREDITS',
    sub: 'Uses API credits — different from a subscription login.',
    items: [
      { id: 'openrouter', title: 'OpenRouter' },
      { id: 'paste-key', title: 'Paste key (OpenAI-compatible)' },
    ],
  },
  {
    id: 'local',
    label: 'ON THIS COMPUTER',
    sub: 'Runs on your own hardware. Nothing is sent anywhere.',
    items: [
      { id: 'ollama', title: 'Ollama' },
      { id: 'lmstudio', title: 'LM Studio' },
      { id: 'llamacpp', title: 'llama.cpp' },
    ],
  },
];

function cliStatusLine(cli: ClaudeCliState): string {
  switch (cli) {
    case 'none':
      return 'Not installed on this computer yet.';
    case 'installing':
      return 'Setting up the hidden CLI…';
    case 'login':
      return 'Installed — finish the login in the partner chat.';
    case 'ready':
      return 'Connected with your own Claude account.';
    default: {
      const _exhaustive: never = cli;
      return _exhaustive;
    }
  }
}

function bucketIdForKind(kind: ProviderKind): ModelKeysProviderId {
  switch (kind) {
    case 'anthropic':
      return 'claude';
    case 'openai':
      return 'paste-key';
    case 'custom':
      return 'openrouter';
    case 'ollama':
      return 'ollama';
    case 'lmstudio':
      return 'lmstudio';
    case 'llamacpp':
      return 'llamacpp';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function kindForBucket(id: ModelKeysProviderId): ProviderKind | null {
  switch (id) {
    case 'claude':
      return 'anthropic';
    case 'paste-key':
      return 'openai';
    case 'openrouter':
      return 'custom';
    case 'ollama':
      return 'ollama';
    case 'lmstudio':
      return 'lmstudio';
    case 'llamacpp':
      return 'llamacpp';
    case 'openai-codex':
    case 'gemini':
    case 'copilot':
    case 'cursor':
      return null;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function providerStatus(
  id: ModelKeysProviderId,
  selected: ModelKeysProviderId,
  cli: ClaudeCliState,
  hasKey: boolean,
): string {
  if (COMING_SOON_PROVIDERS.has(id)) return 'Coming soon';
  if (id === 'claude') {
    switch (cli) {
      case 'none':
        return 'Not installed';
      case 'installing':
        return 'Installing…';
      case 'login':
        return 'Needs login';
      case 'ready':
        return 'Connected';
      default: {
        const _exhaustive: never = cli;
        return _exhaustive;
      }
    }
  }
  if (id === 'ollama' || id === 'lmstudio' || id === 'llamacpp') return 'Local';
  if (hasKey && id === selected) return 'Key saved';
  return 'Key needed';
}

const TELEMETRY_LEVELS: ReadonlyArray<{ id: TelemetryLevel; title: string; desc: string }> = [
  { id: 'off', title: 'Don’t send anything', desc: 'Nothing leaves this computer.' },
  { id: 'crash', title: 'Crash reports only', desc: 'Anonymous crash stacks — no vault, manuscript or chat.' },
  {
    id: 'usage',
    title: 'Anonymous usage metadata',
    desc: 'Never your vault, manuscript or chat contents.',
  },
];

export default function ModelKeysSection({
  settings,
  setSettings,
  onTestConnection,
  testStatus,
  testMsg,
  providerApiKey,
  setProviderApiKey,
  setProviderApiKeyDirty,
  providerBaseUrl,
  setProviderBaseUrl,
  showApiKey,
  setShowApiKey,
  setSavedOk,
  onMoveVault,
  providerKind,
  onSelectProviderKind,
  providerModel = '',
  setProviderModel,
  savedProviderApiKey = '',
  modelList = [],
  modelListStatus = 'idle',
  modelListError = null,
  useCustomInput = false,
  setUseCustomInput,
  onFetchModels,
  setTestConnectionStatus,
}: ModelKeysSectionProps) {
  const partner = resolveWritingPartner(settings);
  const selected = partner.modelKeysProvider;
  const cli = partner.claudeCli;
  const liveBucket: ModelKeysProviderId = providerKind ? bucketIdForKind(providerKind) : selected;
  const providerDef = providerKind
    ? PROVIDER_OPTIONS.find((p) => p.value === providerKind)
    : undefined;
  const [installOpen, setInstallOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pasteMaskError, setPasteMaskError] = useState<string | null>(null);
  const modelOpts = modelsForProvider(selected);
  const needsReentry = (settings.keyReentryPaths ?? []).includes('provider.apiKey');
  const hasKey = !needsReentry && !!(providerApiKey.trim() || settings.provider?.apiKey);
  const needsUrl = providerDef?.needsUrl
    || selected === 'ollama' || selected === 'lmstudio' || selected === 'llamacpp' || selected === 'openrouter';
  const needsKey = providerDef?.needsKey
    || selected === 'openrouter' || selected === 'paste-key' || (selected === 'claude' && cli === 'ready');
  const baseUrlFetchTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (baseUrlFetchTimer.current) window.clearTimeout(baseUrlFetchTimer.current);
  }, []);

  // F5 Critic Path A: Hands & files via existing agentsVault:* (+ one showItemInFolder)
  const [keysLoc, setKeysLoc] = useState<{
    path: string;
    name: string;
    files: number;
    chips: string[];
    scope: string;
  } | null>(null);
  const [keysBusy, setKeysBusy] = useState(false);
  const [keysStatus, setKeysStatus] = useState<string | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [confirmClearKeys, setConfirmClearKeys] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      // resolveKeysDir (via stats) already ensures identity files — no separate
      // agentsVaultEnsure on every focus (Critic soft).
      window.api?.agentsVaultStats?.()
        .then((res) => {
          if (cancelled) return;
          // Fail closed: no Mythos root → plain inline error (not silently disabled).
          if (!res?.ok || !res.path) {
            setKeysLoc(null);
            setConfirmClearKeys(false);
            setKeysError(res?.error || 'No Mythos vault open');
            return;
          }
          setKeysError(null);
          setKeysLoc({
            path: res.path,
            name: res.name ?? 'Agent Vault',
            files: res.files ?? 0,
            chips: res.chips ?? [],
            scope: res.scope ?? 'This vault',
          });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setKeysLoc(null);
          setConfirmClearKeys(false);
          setKeysError(e instanceof Error ? e.message : 'No Mythos vault open');
        });
    };
    refresh();
    // Soft: refresh path after vault move / remount focus
    const onFocus = () => { refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  const pickProvider = (id: ModelKeysProviderId) => {
    if (COMING_SOON_PROVIDERS.has(id)) {
      showToast(`${BUCKETS.flatMap((b) => b.items).find((i) => i.id === id)?.title ?? id} arrives after the beta — Claude is the beta path`);
      return;
    }
    patchPartner(setSettings, { modelKeysProvider: id });
    setSavedOk(false);
    const kind = kindForBucket(id);
    if (kind && onSelectProviderKind) {
      onSelectProviderKind(kind);
      return;
    }
    showToast('Provider selected — model list updated');
  };

  const startInstall = () => {
    setInstallOpen(false);
    patchPartner(setSettings, { claudeCli: 'installing' });
    showToast('Installing the hidden Claude CLI…');
    window.setTimeout(() => {
      patchPartner(setSettings, { claudeCli: 'login' });
      showToast('Installed — log in from the partner chat');
    }, 1200);
  };

  return (
    <div className="mk-settings" data-testid="model-keys-page">
      <section
        className="settings-section mk-card"
        aria-labelledby="section-provider-buckets"
        data-settings-cat="agents"
        data-testid="mk-provider-buckets"
      >
        <h3 className="settings-section-title" id="section-provider-buckets">PROVIDER BUCKETS</h3>
        <p className="mk-honest" data-testid="mk-byo-copy">
          Bring your own AI. A Mythos subscription is <strong>not</strong> a Claude — or any other — AI
          subscription: you connect your own login or key. Your vault and manuscript stay on this computer.
        </p>

        {BUCKETS.map((bk) => (
          <div key={bk.id} className={`mk-bucket mk-bucket--${bk.id}`} data-testid={`mk-bucket-${bk.id}`}>
            <div className="mk-bucket__label">{bk.label}</div>
            <div className="mk-bucket__sub">{bk.sub}</div>
            <div className="mk-bucket__items">
              {bk.items.map((item) => {
                const soon = COMING_SOON_PROVIDERS.has(item.id);
                const on = item.id === liveBucket && !soon;
                const status = providerStatus(item.id, selected, cli, hasKey);
                const good = status === 'Connected' || status === 'Key saved' || status === 'Local';
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mk-prov${on ? ' mk-prov--on' : ''}${soon ? ' mk-prov--soon' : ''}`}
                    data-testid={`mk-prov-${item.id}`}
                    title={soon ? `${item.title} — not in this build` : `Use ${item.title}`}
                    onClick={() => pickProvider(item.id)}
                  >
                    <span className="mk-prov__row">
                      <span className={`mk-prov__dot${good ? ' mk-prov__dot--good' : soon ? ' mk-prov__dot--soon' : ''}`} />
                      <span className="mk-prov__name">{item.title}</span>
                    </span>
                    <span className={`mk-prov__status${good ? ' mk-prov__status--good' : ''}`}>{status}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {selected === 'claude' && (
          <div className="mk-claude" data-testid="mk-claude-row">
            <div className="mk-claude__row">
              <span className={`mk-prov__dot${cli === 'ready' ? ' mk-prov__dot--good' : ''}`} />
              <span className="mk-claude__name">Claude</span>
              <span className="mk-claude__status">{cliStatusLine(cli)}</span>
              {cli === 'none' && (
                <button
                  type="button"
                  className="mk-claude__action"
                  data-testid="mk-claude-install"
                  onClick={() => setInstallOpen(true)}
                >
                  Install…
                </button>
              )}
              {cli === 'installing' && (
                <span className="mk-claude__busy" data-testid="mk-claude-installing">Installing…</span>
              )}
              {cli === 'login' && (
                <span className="mk-claude__busy" data-testid="mk-claude-needs-login">Open chat to log in</span>
              )}
              {cli === 'ready' && (
                <>
                  <span className="mk-claude__connected" data-testid="mk-claude-connected">Connected</span>
                  <button
                    type="button"
                    className="mk-claude__disconnect"
                    data-testid="mk-claude-disconnect"
                    onClick={() => {
                      patchPartner(setSettings, { claudeCli: 'none' });
                      showToast('Claude disconnected — your account stays yours');
                    }}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
            {cli === 'ready' && (
              <div className="mk-claude__mode" data-testid="mk-claude-mode">
                <span>Where you talk to it</span>
                <div className="mk-seg">
                  {([
                    ['app', 'Claude in app'],
                    ['cli', 'Claude CLI'],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className={`mk-seg__btn${partner.claudeCliMode === mode ? ' mk-seg__btn--on' : ''}`}
                      data-testid={`mk-claude-mode-${mode}`}
                      onClick={() => patchPartner(setSettings, { claudeCliMode: mode })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="settings-hint">Both run the hidden Claude CLI — the labels only say where the conversation appears.</p>
              </div>
            )}
            <div className="mk-coming" data-testid="mk-claude-coming-soon">
              <div className="mk-coming__label">COMING AT 1.0</div>
              <div className="mk-coming__chips">
                <span className="mk-coming__chip" title="Not available in this build">
                  Sign in with Claude (OAuth) <span className="wp-chip-tag">PRIMARY</span>
                </span>
                <span className="mk-coming__chip" title="Not available in this build">
                  Use Claude Desktop
                </span>
              </div>
            </div>
          </div>
        )}

        {needsUrl && (
          <div className="mk-field" data-testid="mk-endpoint">
            <div className="wp-label">ENDPOINT</div>
            <input
              className="settings-input"
              type="url"
              value={providerBaseUrl}
              placeholder={
                providerKind
                  ? (DEFAULT_BASE_URLS[providerKind] || 'http://localhost:11434')
                  : selected === 'ollama'
                    ? 'http://localhost:11434'
                    : selected === 'lmstudio'
                      ? 'http://localhost:1234/v1'
                      : selected === 'openrouter'
                        ? 'https://openrouter.ai/api/v1'
                        : 'http://localhost:8080'
              }
              onChange={(e) => {
                const nextUrl = e.target.value;
                setProviderBaseUrl(nextUrl);
                setTestConnectionStatus?.('idle');
                setSavedOk(false);
                if (providerKind && onFetchModels && LISTABLE_PROVIDERS.has(providerKind)) {
                  if (baseUrlFetchTimer.current) window.clearTimeout(baseUrlFetchTimer.current);
                  baseUrlFetchTimer.current = window.setTimeout(() => {
                    onFetchModels(providerKind, nextUrl);
                  }, 400);
                }
              }}
              aria-label="Provider base URL"
            />
          </div>
        )}

        {providerKind && setProviderModel && (
          <div className="mk-field" data-testid="mk-default-model">
            <div className="wp-label">DEFAULT MODEL</div>
            {LISTABLE_PROVIDERS.has(providerKind) && modelListStatus === 'ok' && modelList.length > 0 && !useCustomInput ? (
              <select
                className="settings-input settings-select"
                value={modelList.includes(providerModel) ? providerModel : ''}
                aria-label="Default model for this provider"
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__custom__') {
                    setUseCustomInput?.(true);
                    setProviderModel('');
                  } else {
                    setProviderModel(val);
                  }
                  setSavedOk(false);
                }}
              >
                {!modelList.includes(providerModel) && providerModel && (
                  <option value={providerModel}>{providerModel}</option>
                )}
                {modelList.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
            ) : (
              <input
                className="settings-input"
                type="text"
                value={providerModel}
                placeholder={providerKind === 'anthropic' ? 'claude-sonnet-4-6' : 'model name'}
                spellCheck={false}
                aria-label="Default model for this provider"
                onChange={(e) => { setProviderModel(e.target.value); setSavedOk(false); }}
              />
            )}
            {modelListStatus === 'loading' && (
              <p className="settings-hint" data-testid="model-list-loading">Loading models…</p>
            )}
            {modelListStatus === 'error' && modelListError && (
              <p className="settings-hint settings-hint-warn" data-testid={providerKind === 'ollama' ? 'ollama-not-running-hint' : 'model-list-error'}>
                {modelListError}
              </p>
            )}
            {LISTABLE_PROVIDERS.has(providerKind) && (
              <button
                type="button"
                className="settings-btn settings-btn-secondary"
                disabled={modelListStatus === 'loading'}
                aria-label="Refresh model list"
                data-testid="refresh-models-btn"
                onClick={() => onFetchModels?.(providerKind, providerBaseUrl)}
              >
                {modelListStatus === 'loading' ? 'Loading…' : 'Refresh models'}
              </button>
            )}
          </div>
        )}

        {needsKey && (
          <div className="mk-field" data-testid="mk-api-key">
            <div className="wp-label">API KEY</div>
            <div className="mk-key-row">
              <input
                className={`settings-input${pasteMaskError ? ' settings-input-error' : ''}`}
                type={showApiKey ? 'text' : 'password'}
                value={providerApiKey}
                placeholder={savedProviderApiKey && !needsReentry ? 'Key configured — enter a new key to replace' : selected === 'openrouter' ? 'sk-or-v1-…' : 'sk-…'}
                onChange={(e) => {
                  const next = e.target.value;
                  if (looksLikeMaskedApiKeyPreview(next)) {
                    setPasteMaskError(MASKED_API_KEY_PREVIEW_MESSAGE);
                    // Field stays not-dirty; value unchanged — nothing sent on Save/Close.
                    return;
                  }
                  setPasteMaskError(null);
                  setProviderApiKey(next);
                  setProviderApiKeyDirty(true);
                  setSavedOk(false);
                }}
                aria-label="API key"
                aria-invalid={pasteMaskError ? 'true' : 'false'}
                aria-describedby={pasteMaskError ? 'mk-api-key-error' : undefined}
              />
              <button
                type="button"
                className="settings-btn settings-btn-secondary"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
            {pasteMaskError && (
              <p className="settings-error-msg" id="mk-api-key-error" role="alert" data-testid="mk-api-key-mask-error">
                {pasteMaskError}
              </p>
            )}
            {needsReentry && !pasteMaskError && (
              <p className="settings-error-msg" role="status" data-testid="mk-api-key-reentry">
                Please re-enter your key.
              </p>
            )}
            {/* KEYS-B: one re-enter line only — do not also show mk-api-key-missing. */}
            <p className="settings-hint">Stored locally on this machine. Mythos never resells access.</p>
          </div>
        )}

        <div className="mk-test-row">
          <button
            type="button"
            className="settings-btn settings-btn-secondary"
            data-testid="mk-test-connection"
            aria-label="Test provider connection"
            onClick={onTestConnection}
            disabled={testStatus === 'testing'}
          >
            {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
          </button>
          <span className="mk-stored" data-testid="mk-storage-status">
            <span className="wp-sandbox__dot" aria-hidden="true" />
            {liveBucket === 'ollama' || liveBucket === 'lmstudio' || liveBucket === 'llamacpp'
              ? 'Runs locally — nothing sent out'
              : 'Key stored locally'}
          </span>
          {testStatus === 'ok' && (
            <span className="settings-test-ok" role="status">{testMsg}</span>
          )}
          {testStatus === 'error' && (
            <span className="settings-test-error" role="alert">{testMsg}</span>
          )}
        </div>
      </section>

      <section className="settings-section mk-card" aria-labelledby="section-models" data-testid="mk-models">
        <h3 className="settings-section-title" id="section-models">Models</h3>
        {(
          [
            ['Partner', 'modelPartner', 0],
            ['Writer', 'modelWriter', 0],
            ['Analyst', 'modelAnalyst', 0],
            ['Archivist', 'modelArchivist', 1],
          ] as const
        ).map(([label, key, fallback]) => (
          <div key={key} className="mk-model-row">
            <span>{label}</span>
            <select
              className="settings-input settings-select"
              data-testid={`mk-model-${key}`}
              value={scopedModel(selected, String(partner[key]), fallback)}
              onChange={(e) => patchPartner(setSettings, { [key]: e.target.value })}
            >
              {modelOpts.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        ))}
      </section>

      <section className="settings-section mk-card" aria-labelledby="section-privacy" data-testid="mk-privacy">
        <h3 className="settings-section-title" id="section-privacy">Help improve Mythos</h3>
        <p className="settings-hint">Always opt-in. Nothing is sent unless you pick it here.</p>
        <div className="mk-telemetry" role="radiogroup" aria-label="Help improve Mythos">
          {TELEMETRY_LEVELS.map((level) => {
            const on = partner.telemetryLevel === level.id;
            return (
              <button
                key={level.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={`mk-radio${on ? ' mk-radio--on' : ''}`}
                data-testid={`mk-telemetry-${level.id}`}
                onClick={() => {
                  patchPartner(setSettings, { telemetryLevel: level.id });
                  setSettings((prev) => ({
                    ...prev,
                    telemetry: {
                      enabled: level.id !== 'off',
                      sessionId: prev.telemetry?.sessionId ?? '',
                    },
                  }));
                  setSavedOk(false);
                }}
              >
                <span className={`mk-radio__dot${on ? ' mk-radio__dot--on' : ''}`} />
                <span>
                  <span className="mk-radio__title">{level.title}</span>
                  <span className="settings-hint">{level.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mk-report-row">
          <p className="settings-hint">
            Something went wrong in a conversation? This is the only path that can send a chat log — and only the one you pick.
          </p>
          <button
            type="button"
            className="settings-btn settings-btn-secondary"
            data-testid="mk-report-chat"
            onClick={() => setReportOpen(true)}
          >
            Report this chat…
          </button>
        </div>
      </section>

      <section className="settings-section mk-card" aria-labelledby="section-hands-files" data-testid="mk-hands-files">
        <h3 className="settings-section-title" id="section-hands-files">Hands &amp; files</h3>
        <p className="settings-hint">
          Your partner works through three built-in hands — Writer, Analyst, Archivist. The partner’s name and voice
          live under <strong>Writing partner</strong>. Identity and memory files live in the Agent Vault below.
        </p>
        <div className="mk-hands">
          {PARTNER_HANDS.map((h) => {
            const meta = HAND_LIMITS[h.id];
            return (
              <div key={h.id} className="mk-hand" data-testid={`mk-hand-${h.id}`}>
                <div className="wp-hand-card__head">
                  <span className="wp-hand-dot" style={{ background: h.color }} aria-hidden="true" />
                  <span className="wp-hand-card__name">{h.label}</span>
                  <span className="mk-hand-badge">HAND</span>
                </div>
                <p className="wp-hand-card__desc">{meta.description}</p>
                <p className="wp-hand-card__limit">{meta.limit}</p>
              </div>
            );
          })}
        </div>

        <div className="mk-keys-files" data-testid="mk-keys-files">
          <div className="mk-keys-files__title-row">
            <span className="mk-keys-files__title">{keysLoc?.name ?? 'Agent Vault'}</span>
            <span className="mk-keys-files__scope" data-testid="mk-keys-scope">
              {keysLoc?.scope ?? 'This vault'}
            </span>
          </div>
          <p className="settings-hint">
            Partner identity and hand files live here. Clear memory also deletes Sessions/ and
            Boards/brainstorm.board.json, and keeps partner.md · writer.md · analyst.md · archivist.md.
          </p>
          <div className="mk-keys-files__path-row">
            <span
              className="mk-keys-files__path"
              title={keysLoc?.path}
              data-testid="mk-keys-path"
            >
              {keysLoc?.path ?? '—'}
            </span>
            <button
              type="button"
              className="settings-btn settings-btn-secondary"
              data-testid="mk-keys-reveal"
              disabled={keysBusy || !keysLoc}
              onClick={() => {
                setKeysBusy(true);
                setKeysError(null);
                void window.api?.modelKeysShowItemInFolder?.()
                  .then((res) => {
                    if (res && !res.opened) setKeysError(res.error || 'Could not reveal folder');
                  })
                  .catch((e: unknown) => setKeysError(e instanceof Error ? e.message : 'Reveal failed'))
                  .finally(() => setKeysBusy(false));
              }}
            >
              Reveal
            </button>
            <button
              type="button"
              className="settings-btn settings-btn-secondary"
              data-testid="mk-keys-open"
              disabled={keysBusy || !keysLoc}
              onClick={() => {
                setKeysBusy(true);
                setKeysError(null);
                void window.api?.agentsVaultReveal?.()
                  .then((res) => {
                    if (res && !res.opened) setKeysError(res.error || 'Could not open folder');
                  })
                  .catch((e: unknown) => setKeysError(e instanceof Error ? e.message : 'Open failed'))
                  .finally(() => setKeysBusy(false));
              }}
            >
              Open
            </button>
          </div>
          <div className="mk-keys-files__chips">
            {(keysLoc?.chips ?? ['partner.md', 'Writer', 'Analyst', 'Archivist']).map((c) => (
              <span key={c} className="mk-keys-files__chip">{c}</span>
            ))}
            {keysLoc ? (
              <span className="mk-keys-files__chip" data-testid="mk-keys-file-count">
                {keysLoc.files} files
              </span>
            ) : null}
          </div>
          <div className="mk-keys-files__actions">
            {!confirmClearKeys ? (
              <button
                type="button"
                className="mk-keys-files__danger"
                data-testid="mk-keys-clear"
                disabled={keysBusy || !keysLoc}
                onClick={() => setConfirmClearKeys(true)}
              >
                Clear memory
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="mk-keys-files__danger mk-keys-files__danger--confirm"
                  data-testid="mk-keys-clear-confirm"
                  disabled={keysBusy || !keysLoc}
                  onClick={() => {
                    setKeysBusy(true);
                    setKeysError(null);
                    setKeysStatus(null);
                    void window.api?.agentsVaultClearMemory?.()
                      .then((res) => {
                        if (!res?.ok) {
                          setKeysError(res?.error || 'Clear failed');
                          // Probe soft: leave Confirm after a refused clear.
                          setConfirmClearKeys(false);
                        } else {
                          setKeysStatus(`Cleared agent memory (${res.removed?.length ?? 0} items). Partner files kept.`);
                          setConfirmClearKeys(false);
                          showToast('Agent memory cleared');
                          void window.api?.agentsVaultStats?.().then((loc) => {
                            if (loc?.ok && loc.path) {
                              setKeysLoc({
                                path: loc.path,
                                name: loc.name ?? 'Agent Vault',
                                files: loc.files ?? 0,
                                chips: loc.chips ?? [],
                                scope: loc.scope ?? 'This vault',
                              });
                            }
                          });
                        }
                      })
                      .catch((e: unknown) => {
                        setKeysError(e instanceof Error ? e.message : 'Clear failed');
                        setConfirmClearKeys(false);
                      })
                      .finally(() => setKeysBusy(false));
                  }}
                >
                  Confirm clear
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn-secondary"
                  data-testid="mk-keys-clear-cancel"
                  disabled={keysBusy}
                  onClick={() => setConfirmClearKeys(false)}
                >
                  Cancel
                </button>
              </>
            )}
            <button
              type="button"
              className="settings-btn settings-btn-secondary"
              data-testid="mk-keys-move"
              disabled={keysBusy || !onMoveVault}
              title="Moves the Story Vault folder only — Agent Vault is a sibling and stays put"
              onClick={() => {
                setKeysError(null);
                setKeysStatus(null);
                onMoveVault?.();
              }}
            >
              Move vault…
            </button>
          </div>
          <p className="settings-hint" data-testid="mk-keys-move-hint">
            Move relocates the Story Vault only. Agent Vault (identity &amp; memory) is a sibling
            under the Mythos root and does not move with this action. API keys stay in app
            secrets and are unrelated to the vault folder.
          </p>
          {keysStatus && (
            <p className="settings-hint" data-testid="mk-keys-status">{keysStatus}</p>
          )}
          {keysError && (
            <p className="settings-error-msg" role="alert" data-testid="mk-keys-error">{keysError}</p>
          )}
        </div>
      </section>

      {installOpen && (
        <div className="mk-modal" data-testid="mk-install-modal" role="dialog" aria-modal="true" aria-labelledby="mk-install-title">
          <button type="button" className="mk-modal__scrim" aria-label="Cancel install" onClick={() => setInstallOpen(false)} />
          <div className="mk-modal__card">
            <h4 id="mk-install-title">Install Claude into Mythos Writer?</h4>
            <p className="settings-hint">
              Mythos installs a hidden Claude CLI for this app. You log in with your own account. Nothing is
              installed system-wide. Mythos does not sell Claude access.
            </p>
            <div className="mk-modal__actions">
              <button type="button" className="settings-btn settings-btn-secondary" onClick={() => setInstallOpen(false)}>
                Cancel
              </button>
              <button type="button" className="mk-claude__action" data-testid="mk-install-confirm" onClick={startInstall}>
                Install
              </button>
            </div>
          </div>
        </div>
      )}

      {reportOpen && (
        <div className="mk-modal" data-testid="mk-report-modal" role="dialog" aria-modal="true" aria-labelledby="mk-report-title">
          <button type="button" className="mk-modal__scrim" aria-label="Cancel report" onClick={() => setReportOpen(false)} />
          <div className="mk-modal__card">
            <h4 id="mk-report-title">Send this conversation to Mythos?</h4>
            <p className="settings-hint">
              Your vault, notes and manuscript are never included — only the messages in this thread.
            </p>
            <div className="mk-modal__actions">
              <button type="button" className="settings-btn settings-btn-secondary" data-testid="mk-report-cancel" onClick={() => setReportOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="mk-claude__action"
                data-testid="mk-report-send"
                onClick={() => {
                  setReportOpen(false);
                  void window.api?.telemetryReport?.('chat-report', { confirmed: true });
                  showToast('Report sent — thank you');
                }}
              >
                Send report
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="mk-toast" role="status" data-testid="mk-toast">{toast}</div>
      )}
    </div>
  );
}
