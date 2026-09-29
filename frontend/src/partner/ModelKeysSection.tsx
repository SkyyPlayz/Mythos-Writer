/**
 * Slice C — Settings › Model & keys (was AI Agents).
 * Three provider buckets + Claude connect stubs + models + privacy.
 * No four per-agent Settings cards as Writing partner primary.
 */
import { useEffect, useState } from 'react';
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
   * F5#3: open the existing whole-vault MoveVaultWizard (Agent Vault lives
   * inside the Mythos vault — keys/memory relocate with it).
   */
  onMoveVault?: () => void;
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
}: ModelKeysSectionProps) {
  const partner = resolveWritingPartner(settings);
  const selected = partner.modelKeysProvider;
  const cli = partner.claudeCli;
  const [installOpen, setInstallOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const modelOpts = modelsForProvider(selected);
  const hasKey = !!(providerApiKey.trim() || settings.provider?.apiKey);
  const needsUrl = selected === 'ollama' || selected === 'lmstudio' || selected === 'llamacpp' || selected === 'openrouter';
  const needsKey =
    selected === 'openrouter' || selected === 'paste-key' || (selected === 'claude' && cli === 'ready');

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
      void window.api?.agentsVaultEnsure?.().catch(() => { /* non-fatal */ });
      window.api?.agentsVaultStats?.()
        .then((res) => {
          if (cancelled) return;
          // Fail closed: no Mythos root → plain inline error (not silently disabled).
          if (!res?.ok || !res.path) {
            setKeysLoc(null);
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
        {/* Distinct id from legacy ProviderSection (section-providers) so E2E
            getByRole('heading', { name: 'Provider Configuration' }) stays unique. */}
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
                const on = item.id === selected && !soon;
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
              value={providerBaseUrl}
              placeholder={
                selected === 'ollama'
                  ? 'http://localhost:11434'
                  : selected === 'lmstudio'
                    ? 'http://localhost:1234/v1'
                    : selected === 'openrouter'
                      ? 'https://openrouter.ai/api/v1'
                      : 'http://localhost:8080'
              }
              onChange={(e) => {
                setProviderBaseUrl(e.target.value);
                setSavedOk(false);
              }}
              aria-label="Provider endpoint"
            />
          </div>
        )}

        {needsKey && (
          <div className="mk-field" data-testid="mk-api-key">
            <div className="wp-label">API KEY</div>
            <div className="mk-key-row">
              <input
                className="settings-input"
                type={showApiKey ? 'text' : 'password'}
                value={providerApiKey}
                placeholder={selected === 'openrouter' ? 'sk-or-v1-…' : 'sk-…'}
                onChange={(e) => {
                  setProviderApiKey(e.target.value);
                  setProviderApiKeyDirty(true);
                  setSavedOk(false);
                }}
                aria-label="API key"
              />
              <button
                type="button"
                className="settings-btn settings-btn-secondary"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="settings-hint">Stored locally on this machine. Mythos never resells access.</p>
          </div>
        )}

        <div className="mk-test-row">
          <button
            type="button"
            className="settings-btn settings-btn-secondary"
            data-testid="mk-test-connection"
            onClick={onTestConnection}
            disabled={testStatus === 'testing'}
          >
            {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
          </button>
          <span className="mk-stored" data-testid="mk-storage-status">
            <span className="wp-sandbox__dot" aria-hidden="true" />
            {selected === 'ollama' || selected === 'lmstudio' || selected === 'llamacpp'
              ? 'Runs locally — nothing sent out'
              : 'Key stored locally'}
          </span>
          {testMsg ? <span className="settings-hint">{testMsg}</span> : null}
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
                disabled={keysBusy}
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
                  disabled={keysBusy}
                  onClick={() => {
                    setKeysBusy(true);
                    setKeysError(null);
                    setKeysStatus(null);
                    void window.api?.agentsVaultClearMemory?.()
                      .then((res) => {
                        if (!res?.ok) {
                          setKeysError(res?.error || 'Clear failed');
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
                      .catch((e: unknown) => setKeysError(e instanceof Error ? e.message : 'Clear failed'))
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
            Move relocates the Story Vault only. Agent Vault (keys &amp; memory) is a sibling
            under the Mythos root and does not move with this action.
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
