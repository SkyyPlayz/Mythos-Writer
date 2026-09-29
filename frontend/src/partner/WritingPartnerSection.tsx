/**
 * Slice C — Settings › Writing partner.
 * Identity binds B partner store (agentNames.brainstorm).
 * Slice D: also syncs name/icon to Agents Vault partner.md.
 */
import { useEffect, useState } from 'react';
import {
  PARTNER_HANDS,
  DEFAULT_PARTNER_DISPLAY_NAME,
  resolvePartnerDisplayName,
  type PartnerHandId,
} from '../agents/partnerIdentity';
import {
  PARTNER_TRAIT_LABELS,
  traitDetail,
  traitOptions,
  type PartnerTraitKey,
} from './partnerPersonality';
import {
  BUILTIN_TOOLS,
  HAND_LIMITS,
  HEARTBEAT_ROWS,
  PARTNER_CONFIDENCE_LEVELS,
  PARTNER_CONFIDENCE_THRESHOLDS,
  PARTNER_ICON_OPTIONS,
  modelsForProvider,
  resolvePartnerConfidence,
  resolveWritingPartner,
  scopedModel,
  type PartnerConfidenceLabel,
  type PartnerIconId,
  type WritingPartnerSettings,
} from './partnerSettings';
import { runHeartbeatAutomationStub } from './partnerBusyStore';
import SessionHistoryViewer from '../components/SettingsPanel/SessionHistoryViewer';
import './WritingPartnerSection.css';

const TRAIT_ORDER: PartnerTraitKey[] = ['tone', 'teach', 'register', 'ambient', 'verbosity'];

const ICON_GLYPH: Record<PartnerIconId, string> = {
  sparkle: '✦',
  feather: '🪶',
  moon: '☾',
  star: '★',
  eye: '◉',
  compass: '◎',
  flame: '▴',
  gem: '◆',
};

interface WritingPartnerSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setAgentDisplayName: (agent: 'writingAssistant' | 'brainstorm' | 'archive' | 'betaReader', name: string) => void;
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

/** Persist confidence on writingPartner AND sync every hand's confidenceThreshold. */
function patchPartnerConfidence(
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>,
  label: PartnerConfidenceLabel,
): void {
  const threshold = PARTNER_CONFIDENCE_THRESHOLDS[label];
  setSettings((prev) => {
    const cur = resolveWritingPartner(prev);
    const agents = prev.agents
      ? {
          ...prev.agents,
          writingAssistant: prev.agents.writingAssistant
            ? { ...prev.agents.writingAssistant, confidenceThreshold: threshold }
            : prev.agents.writingAssistant,
          brainstorm: prev.agents.brainstorm
            ? { ...prev.agents.brainstorm, confidenceThreshold: threshold }
            : prev.agents.brainstorm,
          archive: prev.agents.archive
            ? { ...prev.agents.archive, confidenceThreshold: threshold }
            : prev.agents.archive,
          betaReader: prev.agents.betaReader
            ? { ...prev.agents.betaReader, confidenceThreshold: threshold }
            : prev.agents.betaReader,
        }
      : prev.agents;
    return {
      ...prev,
      writingPartner: { ...cur, confidence: label },
      agents,
    };
  });
}

export default function WritingPartnerSection({
  settings,
  setSettings,
  setAgentDisplayName,
}: WritingPartnerSectionProps) {
  const partner = resolveWritingPartner(settings);
  const partnerName = resolvePartnerDisplayName(settings.agentNames);
  const [lastTrait, setLastTrait] = useState<PartnerTraitKey>('teach');
  const provider = partner.modelKeysProvider;
  const modelOpts = modelsForProvider(provider);
  const detail = traitDetail(
    lastTrait,
    lastTrait === 'tone'
      ? partner.tone
      : lastTrait === 'teach'
        ? partner.teach
        : lastTrait === 'register'
          ? partner.register
          : lastTrait === 'ambient'
            ? partner.ambient
            : partner.verbosity,
  );

  const handModelKey = (id: PartnerHandId): keyof WritingPartnerSettings => {
    switch (id) {
      case 'writer':
        return 'modelWriter';
      case 'analyst':
        return 'modelAnalyst';
      case 'archivist':
        return 'modelArchivist';
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
  };

  const toolsPath = '<vault>\\.mythos\\tools';

  // Slice D: bind Settings identity ↔ Agents Vault partner.md (file is source on disk).
  useEffect(() => {
    const name = settings.agentNames?.brainstorm?.trim() || DEFAULT_PARTNER_DISPLAY_NAME;
    const icon = partner.icon;
    void window.api?.agentsVaultSyncPartner?.({ name, icon });
  }, [settings.agentNames?.brainstorm, partner.icon]);

  return (
    <div className="wp-settings" data-testid="writing-partner-page">
      <section className="settings-section wp-card" aria-labelledby="section-writing-partner" data-settings-cat="writingPartner">
        <h3 className="settings-section-title" id="section-writing-partner">Writing partner</h3>
        <div className="wp-identity" data-testid="wp-identity">
          <span className="wp-identity__avatar" aria-hidden="true">
            {ICON_GLYPH[partner.icon] ?? '✦'}
          </span>
          <div className="wp-identity__field">
            <label className="wp-label" htmlFor="wp-name">NAME</label>
            <input
              id="wp-name"
              className="settings-input"
              data-testid="wp-name"
              value={settings.agentNames?.brainstorm ?? ''}
              placeholder={DEFAULT_PARTNER_DISPLAY_NAME}
              maxLength={64}
              onChange={(e) => setAgentDisplayName('brainstorm', e.target.value)}
            />
          </div>
          <div className="wp-identity__field">
            <span className="wp-label">ICON</span>
            <div className="wp-icons" role="group" aria-label="Partner icon">
              {PARTNER_ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={`wp-icon-btn${partner.icon === icon ? ' wp-icon-btn--on' : ''}`}
                  data-testid={`wp-icon-${icon}`}
                  title={icon}
                  aria-pressed={partner.icon === icon}
                  onClick={() => patchPartner(setSettings, { icon })}
                >
                  {ICON_GLYPH[icon]}
                </button>
              ))}
            </div>
          </div>
          <div className="wp-identity__field">
            <label className="wp-label" htmlFor="wp-model-partner">MODEL</label>
            <select
              id="wp-model-partner"
              className="settings-input settings-select"
              data-testid="wp-model-partner"
              value={scopedModel(provider, partner.modelPartner)}
              onChange={(e) => patchPartner(setSettings, { modelPartner: e.target.value })}
            >
              {modelOpts.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <p className="settings-hint">Chat &amp; voice. Keys under Model &amp; keys.</p>
          </div>
        </div>
        <p className="settings-hint wp-lede">
          One conversational partner — the Brainstorm spine — for voice and text. Coach, Archive and Beta Reader
          are folded in behind it.
        </p>
      </section>

      <section className="settings-section wp-card" aria-labelledby="section-personality" data-testid="wp-personality">
        <h3 className="settings-section-title" id="section-personality">Personality defaults</h3>
        <p className="settings-hint">Shipping defaults — change any of them.</p>
        <div className="wp-personality-grid">
          <div className="wp-personality-left" data-testid="wp-personality-copy">
            {TRAIT_ORDER.map((key) => {
              const value =
                key === 'tone'
                  ? partner.tone
                  : key === 'teach'
                    ? partner.teach
                    : key === 'register'
                      ? partner.register
                      : key === 'ambient'
                        ? partner.ambient
                        : partner.verbosity;
              return (
                <div key={key} className="wp-trait-row">
                  <span className="wp-trait-label">{PARTNER_TRAIT_LABELS[key]}</span>
                  <div className="wp-chips" role="group" aria-label={PARTNER_TRAIT_LABELS[key]}>
                    {traitOptions(key).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={`wp-chip${value === opt ? ' wp-chip--on' : ''}`}
                        data-testid={`wp-trait-${key}-${opt.replace(/\s+/g, '-').toLowerCase()}`}
                        aria-pressed={value === opt}
                        onClick={() => {
                          setLastTrait(key);
                          if (key === 'tone') patchPartner(setSettings, { tone: opt as WritingPartnerSettings['tone'] });
                          else if (key === 'teach') patchPartner(setSettings, { teach: opt as WritingPartnerSettings['teach'] });
                          else if (key === 'register') patchPartner(setSettings, { register: opt as WritingPartnerSettings['register'] });
                          else if (key === 'ambient') patchPartner(setSettings, { ambient: opt as WritingPartnerSettings['ambient'] });
                          else patchPartner(setSettings, { verbosity: opt as WritingPartnerSettings['verbosity'] });
                        }}
                      >
                        {opt}
                        {opt === 'Adaptive' && key === 'teach' ? (
                          <span className="wp-chip-tag"> DEFAULT</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  {key === 'teach' && (
                    <p className="settings-hint wp-teach-hint">
                      How {partnerName} teaches craft when you ask for help.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <aside className="wp-behavior" data-testid="wp-behavior-spec" aria-label="Trait behavior">
            <div className="wp-behavior__label">{detail.label}</div>
            <div className="wp-behavior__title">
              <span className="wp-behavior__dot" aria-hidden="true" />
              <span>{detail.selected}</span>
              {detail.tag ? <span className="wp-chip-tag wp-chip-tag--outline">{detail.tag}</span> : null}
            </div>
            <p className="wp-behavior__copy">{detail.copy}</p>
            <div className="wp-behavior__beh-label">BEHAVIOR</div>
            {detail.beh.map((b) => (
              <p key={b.slice(0, 24)} className="wp-behavior__beh">{b}</p>
            ))}
          </aside>
        </div>

        <div className="wp-toggles">
          {([
            ['memory', 'Cross-session memory', 'Remembers your world and your habits between sessions.'],
            ['craft', 'Craft stance', 'Coach craft; never ghostwrite the book.'],
            ['initiative', 'Unprompted thread-watching', 'Flags continuity and gaps without hijacking the chat.'],
          ] as const).map(([key, title, desc]) => (
            <div key={key} className="wp-toggle-row">
              <div className="wp-toggle-copy">
                <div className="wp-toggle-title">{title}</div>
                <div className="settings-hint">{desc}</div>
              </div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label={title}
                  data-testid={`wp-toggle-${key}`}
                  checked={partner[key]}
                  onChange={(e) => patchPartner(setSettings, { [key]: e.target.checked })}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>
          ))}
        </div>

        <div className="wp-hard-bans" data-testid="wp-hard-bans" role="note">
          <strong>Hard bans — not overridable by personality or voice settings.</strong>{' '}
          No data-loss action without explicit confirm. No export or vault move initiated by the partner
          without explicit confirm. Manuscript line edits always ask first; the partner never authors story
          into the manuscript except on an explicit continuity-fix request.
        </div>
      </section>

      <section className="settings-section wp-card" aria-labelledby="section-hands" data-testid="wp-hands">
        <h3 className="settings-section-title" id="section-hands">Three built-in hands</h3>
        <p className="settings-hint">A fixed set that works behind the partner. Nothing is spawned at runtime.</p>
        <div className="wp-hands-grid">
          {PARTNER_HANDS.map((h) => {
            const meta = HAND_LIMITS[h.id];
            const mk = handModelKey(h.id);
            const modelVal = scopedModel(
              provider,
              String(partner[mk]),
              h.id === 'archivist' ? 1 : 0,
            );
            return (
              <div key={h.id} className="wp-hand-card" data-testid={`wp-hand-${h.id}`}>
                <div className="wp-hand-card__head">
                  <span className="wp-hand-dot" style={{ background: h.color }} aria-hidden="true" />
                  <span className="wp-hand-card__name">{h.label}</span>
                </div>
                <p className="wp-hand-card__desc">{meta.description}</p>
                <p className="wp-hand-card__limit">{meta.limit}</p>
                <div className="wp-hand-model">
                  <span className="wp-label">MODEL</span>
                  <select
                    className="settings-input settings-select"
                    data-testid={`wp-hand-model-${h.id}`}
                    aria-label={`${h.label} model`}
                    value={modelVal}
                    onChange={(e) => patchPartner(setSettings, { [mk]: e.target.value })}
                  >
                    {modelOpts.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="settings-section wp-card" aria-labelledby="section-partner-limits" data-testid="wp-limits">
        <h3 className="settings-section-title" id="section-partner-limits">What the partner can use</h3>
        <p className="settings-hint">Off by default. Everything the partner needs for your story is already in the vault.</p>
        <div className="wp-toggles">
          <div className="wp-toggle-row">
            <div className="wp-toggle-copy">
              <div className="wp-toggle-title">Web search</div>
              <div className="settings-hint">Let the partner look things up on the web.</div>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                aria-label="Web search"
                data-testid="wp-web-search"
                checked={partner.webSearch}
                onChange={(e) => patchPartner(setSettings, { webSearch: e.target.checked })}
              />
              <span className="settings-toggle-track" />
            </label>
          </div>
          <div className="wp-toggle-row">
            <div className="wp-toggle-copy">
              <div className="wp-toggle-title">
                Use Claude memory <span className="wp-adv-tag">ADVANCED</span>
              </div>
              <div className="settings-hint">Also use Claude’s own memory — off keeps memory in Mythos only.</div>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                aria-label="Use Claude memory"
                data-testid="wp-claude-memory"
                checked={partner.claudeMemory}
                onChange={(e) => patchPartner(setSettings, { claudeMemory: e.target.checked })}
              />
              <span className="settings-toggle-track" />
            </label>
          </div>
        </div>
      </section>

      <section className="settings-section wp-card" aria-labelledby="section-tools" data-testid="wp-tools">
        <div className="wp-tools-head">
          <h3 className="settings-section-title" id="section-tools">Tools Mythos ships</h3>
          <span className="wp-sandbox" data-testid="wp-tools-sandboxed">
            <span className="wp-sandbox__dot" aria-hidden="true" />
            Running sandboxed
          </span>
        </div>
        <p className="settings-hint">A fixed pack. The partner cannot reach anything outside it.</p>
        <div className="wp-tools-grid">
          {BUILTIN_TOOLS.map((t) => (
            <div key={t.title} className="wp-tool-card" data-testid={`wp-tool-${t.title.replace(/\s+/g, '-').toLowerCase()}`}>
              <div className="wp-tool-card__title">
                {t.title}
                <span className="wp-chip-tag wp-chip-tag--outline">BUILT-IN</span>
              </div>
              <p className="settings-hint">{t.description}</p>
            </div>
          ))}
        </div>
        <div className="wp-tools-footer">
          <div className="wp-toggle-row wp-toggle-row--disabled">
            <div className="wp-toggle-copy">
              <div className="wp-toggle-title">
                Allow partner to invent tools <span className="wp-soon-tag">COMING SOON</span>
              </div>
              <div className="settings-hint">Off in this build. Invented tools would never touch the built-in pack.</div>
            </div>
            <label className="settings-toggle">
              <input type="checkbox" disabled checked={false} aria-label="Allow partner to invent tools" />
              <span className="settings-toggle-track" />
            </label>
          </div>
          <div className="wp-toggle-row">
            <div className="wp-toggle-copy">
              <div className="wp-toggle-title">Disable all custom tools</div>
              <div className="settings-hint">
                Your own tools stay separate from what Mythos ships — this never turns off the built-in pack.
              </div>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                aria-label="Disable all custom tools"
                data-testid="wp-custom-tools-off"
                checked={partner.customToolsOff}
                onChange={(e) => patchPartner(setSettings, { customToolsOff: e.target.checked })}
              />
              <span className="settings-toggle-track" />
            </label>
          </div>
          <div className="wp-custom-empty" data-testid="wp-custom-tools-empty">
            <div className="wp-custom-empty__title">Your custom tools</div>
            <p className="settings-hint">
              None yet. Drop a tool folder into the path below — one folder per tool, each with a{' '}
              <code>tool.json</code>.
            </p>
            <div className="wp-tools-path">
              <code data-testid="wp-tools-path">{toolsPath}</code>
              <button type="button" className="settings-btn settings-btn-secondary" data-testid="wp-tools-open">
                Open folder
              </button>
              <button
                type="button"
                className="settings-btn settings-btn-secondary"
                data-testid="wp-tools-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(toolsPath);
                }}
              >
                Copy
              </button>
            </div>
            <button type="button" className="settings-btn settings-btn-secondary" data-testid="wp-tools-rescan">
              Rescan folder
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section wp-card" aria-labelledby="section-heartbeat" data-testid="wp-heartbeat">
        <div className="wp-hb-head">
          <h3 className="settings-section-title" id="section-heartbeat">Heartbeat automations</h3>
          <span className="settings-hint">
            {partner.heartbeatOn ? 'Heartbeat on · every 20 min while writing' : 'Heartbeat off — manual runs only'}
          </span>
          <label className="settings-toggle">
            <input
              type="checkbox"
              aria-label="Heartbeat master"
              data-testid="wp-heartbeat-master"
              checked={partner.heartbeatOn}
              onChange={(e) => patchPartner(setSettings, { heartbeatOn: e.target.checked })}
            />
            <span className="settings-toggle-track" />
          </label>
        </div>
        <p className="settings-hint">Each runs quietly on the heartbeat when on. Manual run is always available.</p>
        <div className="wp-hb-rows">
          {HEARTBEAT_ROWS.map((row) => {
            const on = partner.heartbeat[row.id] === true;
            return (
              <div key={row.id} className="wp-hb-row" data-testid={`wp-hb-${row.id}`}>
                <div className="wp-hb-row__copy">
                  <div className="wp-hb-row__title">{row.title}</div>
                  <div className="settings-hint">{row.description}</div>
                </div>
                <button
                  type="button"
                  className="settings-btn settings-btn-secondary"
                  data-testid={`wp-hb-run-${row.id}`}
                  onClick={() => {
                    // Vault cleanup = chrome + QUEUED only — not merge engine.
                    runHeartbeatAutomationStub(row.id, row.hand);
                  }}
                >
                  Run now
                </button>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    aria-label={`${row.title} enabled`}
                    checked={on}
                    onChange={(e) =>
                      patchPartner(setSettings, {
                        heartbeat: { ...partner.heartbeat, [row.id]: e.target.checked },
                      })
                    }
                  />
                  <span className="settings-toggle-track" />
                </label>
              </div>
            );
          })}
        </div>
      </section>

      <section
        className="settings-section wp-card"
        aria-labelledby="section-wp-confidence"
        data-testid="wp-confidence"
      >
        <h3 className="settings-section-title" id="section-wp-confidence">Confidence</h3>
        <p className="settings-hint">
          How sure {partnerName} must be before auto-applying a suggestion. Default is Confident.
          Below the bar, suggestions land in the inbox for review.
        </p>
        <div className="settings-slider-row" data-testid="wp-confidence-row">
          <label className="wp-label" htmlFor="wp-confidence-slider">LEVEL</label>
          <input
            id="wp-confidence-slider"
            className="settings-slider"
            type="range"
            min={0}
            max={PARTNER_CONFIDENCE_LEVELS.length - 1}
            step={1}
            value={PARTNER_CONFIDENCE_LEVELS.indexOf(partner.confidence)}
            aria-label="Partner confidence"
            aria-valuetext={partner.confidence}
            data-testid="wp-confidence-slider"
            onChange={(e) => {
              const idx = Number(e.target.value);
              const label = PARTNER_CONFIDENCE_LEVELS[idx] ?? 'Confident';
              patchPartnerConfidence(setSettings, label);
            }}
          />
          <span className="settings-slider-value" data-testid="wp-confidence-value">
            {partner.confidence}
          </span>
        </div>
        <p className="settings-hint" data-testid="wp-confidence-threshold">
          Threshold {resolvePartnerConfidence(settings).threshold.toFixed(2)} · read by every partner hand
        </p>
      </section>

      {/* F3 — Earlier chats opens Settings › Writing partner session history
          (AgentsSection is unmounted; partner spine sessions are brainstorm). */}
      <section className="settings-section wp-card" aria-labelledby="section-partner-history" data-testid="wp-session-history">
        <h3 className="settings-section-title" id="section-partner-history">Earlier chats</h3>
        <p className="settings-hint">Read-only history of partner conversations saved in this vault.</p>
        <SessionHistoryViewer agentName="brainstorm" />
      </section>
    </div>
  );
}
