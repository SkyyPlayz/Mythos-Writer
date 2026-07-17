import { useState, useCallback, useEffect } from 'react';
import AgentProviderSection from '../AgentProviderSection';
import AutoApplyCategoryToggles from '../AutoApplyCategoryToggles';
import PersonaViewer from '../PersonaViewer';
import {
  MODEL_OPTIONS,
  BETA_READER_DEFAULTS,
  type AgentName,
  type AgentOverrideState,
  type ProviderKind,
  type TestConnectionStatus,
  type MicDevice,
} from '../settingsPanelTypes';
import {
  DEFAULT_AGENT_DISPLAY_NAMES,
  resolveAgentDisplayName,
  type NamedAgentId,
} from '../../../agents/agentIdentity';

// Beta 3 M22: rename input (prototype Identity & files name field, HTML 1852).
// The card header shows the resolved name so renames propagate immediately.
function AgentRenameField({
  agent,
  idPrefix,
  agentNames,
  setAgentDisplayName,
}: {
  agent: NamedAgentId;
  idPrefix: string;
  agentNames: AppSettings['agentNames'];
  setAgentDisplayName: (agent: AgentName, name: string) => void;
}) {
  return (
    <div className="settings-field settings-field-inline">
      <label className="settings-label" htmlFor={`${idPrefix}-display-name`}>Agent name</label>
      <input
        id={`${idPrefix}-display-name`}
        className="settings-input settings-input-sm"
        type="text"
        value={agentNames?.[agent] ?? ''}
        placeholder={DEFAULT_AGENT_DISPLAY_NAMES[agent]}
        aria-label={`Rename ${DEFAULT_AGENT_DISPLAY_NAMES[agent]}`}
        maxLength={64}
        onChange={(e) => setAgentDisplayName(agent, e.target.value)}
      />
    </div>
  );
}

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

interface AgentsSectionProps {
  settings: AppSettings;
  providerKind: ProviderKind;
  agentOverrides: Record<AgentName, AgentOverrideState>;
  agentTestStatus: Record<AgentName, TestConnectionStatus>;
  agentTestMsg: Record<AgentName, string>;
  setAgentField: <A extends keyof AppSettings['agents'], K extends keyof NonNullable<AppSettings['agents'][A]>>(agent: A, field: K, value: NonNullable<AppSettings['agents'][A]>[K]) => void;
  setCategoryAutoApply: (agent: keyof AppSettings['agents'], category: SuggestionCategory, enabled: boolean) => void;
  setAgentOverride: <K extends keyof AgentOverrideState>(agentName: AgentName, field: K, value: AgentOverrideState[K]) => void;
  onAgentTest: (agentName: AgentName) => void;
  micDevices: MicDevice[];
  refreshMicDevices: () => void;
  /** Beta 3 M22: agent renames — writes settings.agentNames. */
  setAgentDisplayName: (agent: AgentName, name: string) => void;
}

export default function AgentsSection({
  settings,
  providerKind,
  agentOverrides,
  agentTestStatus,
  agentTestMsg,
  setAgentField,
  setCategoryAutoApply,
  setAgentOverride,
  onAgentTest,
  micDevices,
  refreshMicDevices,
  setAgentDisplayName,
}: AgentsSectionProps) {
  // Beta 3 M22: betaReader is optional in AppSettings (pre-M22 files) — the
  // panel normalizes it at load; this fallback keeps rendering total.
  const betaReader = settings.agents.betaReader ?? BETA_READER_DEFAULTS;

  return (
    <section className="settings-section" aria-labelledby="section-agents" data-settings-cat="agents">
      <h3 className="settings-section-title" id="section-agents">Agents</h3>

      <div className="settings-agent-card">
        <div className="settings-agent-header">
          <span className="settings-agent-name">{resolveAgentDisplayName('writingAssistant', settings.agentNames)}</span>
          <label className="settings-toggle">
            <input
              type="checkbox"
              aria-label="Enable Writing Coach"
              checked={settings.agents.writingAssistant.enabled}
              onChange={(e) => setAgentField('writingAssistant', 'enabled', e.target.checked)}
            />
            <span className="settings-toggle-track" />
          </label>
        </div>
        <div className="settings-agent-fields">
          <AgentRenameField agent="writingAssistant" idPrefix="wa" agentNames={settings.agentNames} setAgentDisplayName={setAgentDisplayName} />
          {/* Model selector for global provider override */}
          {!agentOverrides.writingAssistant.enabled && (
            <div className="settings-field settings-field-inline">
              <label className="settings-label" htmlFor="wa-model">Model</label>
              {providerKind === 'anthropic' ? (
                <select
                  id="wa-model"
                  className="settings-input settings-select settings-input-sm"
                  value={settings.agents.writingAssistant.model}
                  aria-label="Writing Coach model"
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
                  aria-label="Writing Coach model"
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
            onTest={() => onAgentTest('writingAssistant')}
          />
          <fieldset className="settings-fieldset">
            <legend className="settings-label">Scan cadence</legend>
            <div className="settings-field settings-field-inline" role="radiogroup" aria-label="Scan cadence">
              <label className="settings-radio-label">
                <input
                  type="radio"
                  name="wa-cadence-trigger"
                  value="on_save"
                  aria-label="Scan cadence: on save"
                  checked={settings.agents.writingAssistant.cadenceTrigger === 'on_save'}
                  onChange={() => setAgentField('writingAssistant', 'cadenceTrigger', 'on_save')}
                />
                On save
              </label>
              <label className="settings-radio-label">
                <input
                  type="radio"
                  name="wa-cadence-trigger"
                  value="idle_heartbeat"
                  aria-label="Scan cadence: idle heartbeat"
                  checked={settings.agents.writingAssistant.cadenceTrigger === 'idle_heartbeat'}
                  onChange={() => setAgentField('writingAssistant', 'cadenceTrigger', 'idle_heartbeat')}
                />
                Idle heartbeat
              </label>
            </div>
            {settings.agents.writingAssistant.cadenceTrigger === 'idle_heartbeat' && (
              <div className="settings-sub-section">
                <div className="settings-field settings-field-inline">
                  <label className="settings-toggle" htmlFor="wa-constant-interval">
                    <input
                      id="wa-constant-interval"
                      type="checkbox"
                      aria-label="Idle-typing heartbeat: constant interval"
                      checked={settings.agents.writingAssistant.idleHeartbeatConstantInterval ?? true}
                      onChange={(e) => setAgentField('writingAssistant', 'idleHeartbeatConstantInterval', e.target.checked)}
                    />
                    <span className="settings-toggle-track" />
                  </label>
                  <span className="settings-label">Constant interval</span>
                </div>
                {(settings.agents.writingAssistant.idleHeartbeatConstantInterval ?? true) ? (
                  <>
                    <p className="settings-help-text">Scans every N seconds regardless of typing activity.</p>
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
                  </>
                ) : (
                  <>
                    <p className="settings-help-text">Scans after N seconds of no keypress activity.</p>
                    <div className="settings-field settings-field-inline">
                      <label className="settings-label" htmlFor="wa-idle-debounce">Idle debounce (s)</label>
                      <input
                        id="wa-idle-debounce"
                        className="settings-input settings-input-sm settings-input-number"
                        type="number"
                        min={5}
                        max={3600}
                        value={settings.agents.writingAssistant.idleDebounceSeconds ?? 30}
                        onChange={(e) => setAgentField('writingAssistant', 'idleDebounceSeconds', Number(e.target.value))}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </fieldset>
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
                aria-label="Auto-apply Writing Coach suggestions"
                checked={settings.agents.writingAssistant.autoApply}
                onChange={(e) => setAgentField('writingAssistant', 'autoApply', e.target.checked)}
              />
              <span className="settings-toggle-track" />
            </label>
            <span className="settings-label">Auto-apply suggestions</span>
          </div>
          <AutoApplyCategoryToggles
            idPrefix="wa"
            agentLabel="Writing Coach"
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
                aria-label="Writing Coach auto-apply threshold"
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
          <span className="settings-agent-name">{resolveAgentDisplayName('brainstorm', settings.agentNames)}</span>
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
          <AgentRenameField agent="brainstorm" idPrefix="brainstorm" agentNames={settings.agentNames} setAgentDisplayName={setAgentDisplayName} />
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
            onTest={() => onAgentTest('brainstorm')}
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
          {/* SKY-2597: Voice toggle (AC-BST-12/13) — default off so no mic prompt on first use */}
          <div className="settings-field settings-field-inline">
            <label className="settings-toggle" htmlFor="brainstorm-voice-enabled">
              <input
                id="brainstorm-voice-enabled"
                type="checkbox"
                aria-label="Brainstorm Agent voice"
                checked={settings.agents.brainstorm.voiceEnabled ?? false}
                onChange={(e) => setAgentField('brainstorm', 'voiceEnabled', e.target.checked)}
              />
              <span className="settings-toggle-track" />
            </label>
            <span className="settings-label">Enable voice input</span>
          </div>
          {/* AC-BST-15: Mic selection, only visible when voice is enabled */}
          {(settings.agents.brainstorm.voiceEnabled ?? false) && (
            <div className="settings-field settings-field-inline">
              <label className="settings-label" htmlFor="brainstorm-mic">Microphone</label>
              <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
                <select
                  id="brainstorm-mic"
                  className="settings-input settings-select settings-input-sm"
                  style={{ flex: 1 }}
                  value={settings.agents.brainstorm.micDeviceId ?? ''}
                  aria-label="Brainstorm Agent microphone"
                  onChange={(e) => {
                    const val = e.target.value || undefined;
                    setAgentField('brainstorm', 'micDeviceId', val);
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
                  aria-label="Refresh microphone device list"
                  title="Refresh device list"
                >
                  ↺
                </button>
              </div>
            </div>
          )}
          {/* SKY-20: per-category routing memory for Blank-mode vaults. */}
          <BrainstormRoutingPanel />
        </div>
        <PersonaViewer agentName="brainstorm" />
      </div>

      <div className="settings-agent-card">
        <div className="settings-agent-header">
          <span className="settings-agent-name">{resolveAgentDisplayName('archive', settings.agentNames)}</span>
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
          <AgentRenameField agent="archive" idPrefix="archive" agentNames={settings.agentNames} setAgentDisplayName={setAgentDisplayName} />
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
            onTest={() => onAgentTest('archive')}
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
        <PersonaViewer agentName="archive" />
      </div>

      {/* Beta 3 M22: fourth named agent — Beta Reader (prototype agentDefs, HTML 4350).
          Reader-eye chapter reads; reactions land as margin comments. */}
      <div className="settings-agent-card" data-testid="beta-reader-agent-card">
        <div className="settings-agent-header">
          <span className="settings-agent-name">{resolveAgentDisplayName('betaReader', settings.agentNames)}</span>
          <label className="settings-toggle">
            <input
              type="checkbox"
              aria-label="Enable Beta Reader"
              checked={betaReader.enabled}
              onChange={(e) => setAgentField('betaReader', 'enabled', e.target.checked)}
            />
            <span className="settings-toggle-track" />
          </label>
        </div>
        <div className="settings-agent-fields">
          <AgentRenameField agent="betaReader" idPrefix="beta-reader" agentNames={settings.agentNames} setAgentDisplayName={setAgentDisplayName} />
          {!agentOverrides.betaReader.enabled && (
            <div className="settings-field settings-field-inline">
              <label className="settings-label" htmlFor="beta-reader-model">Model</label>
              {providerKind === 'anthropic' ? (
                <select
                  id="beta-reader-model"
                  className="settings-input settings-select settings-input-sm"
                  value={betaReader.model}
                  aria-label="Beta Reader model"
                  onChange={(e) => setAgentField('betaReader', 'model', e.target.value)}
                >
                  {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  id="beta-reader-model"
                  className="settings-input settings-input-sm"
                  type="text"
                  value={betaReader.model}
                  placeholder="model name (e.g. llama3-70b)"
                  aria-label="Beta Reader model"
                  maxLength={128}
                  onChange={(e) => setAgentField('betaReader', 'model', e.target.value)}
                />
              )}
            </div>
          )}
          <AgentProviderSection
            agentName="betaReader"
            idPrefix="beta-reader"
            globalProviderKind={providerKind}
            override={agentOverrides.betaReader}
            savedApiKey={betaReader.provider?.apiKey}
            testStatus={agentTestStatus.betaReader}
            testMsg={agentTestMsg.betaReader}
            onChange={(field, value) => setAgentOverride('betaReader', field, value)}
            onTest={() => onAgentTest('betaReader')}
          />
          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor="beta-reader-heartbeat">Heartbeat interval (min)</label>
            <input
              id="beta-reader-heartbeat"
              className="settings-input settings-input-sm settings-input-number"
              type="number"
              min={1}
              max={120}
              value={betaReader.heartbeatIntervalMinutes}
              onChange={(e) => setAgentField('betaReader', 'heartbeatIntervalMinutes', Number(e.target.value))}
            />
          </div>
          <div className="settings-field settings-field-inline">
            <label className="settings-toggle" htmlFor="beta-reader-auto-apply">
              <input
                id="beta-reader-auto-apply"
                type="checkbox"
                aria-label="Auto-apply Beta Reader suggestions"
                checked={betaReader.autoApply}
                onChange={(e) => setAgentField('betaReader', 'autoApply', e.target.checked)}
              />
              <span className="settings-toggle-track" />
            </label>
            <span className="settings-label">Auto-apply suggestions</span>
          </div>
          <AutoApplyCategoryToggles
            idPrefix="beta-reader"
            agentLabel="Beta Reader"
            agent={betaReader}
            agentKey="betaReader"
            onChange={setCategoryAutoApply}
          />
          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor="beta-reader-confidence">Auto-apply threshold</label>
            <div className="settings-slider-row">
              <input
                id="beta-reader-confidence"
                className="settings-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                disabled={!betaReader.autoApply}
                value={betaReader.confidenceThreshold}
                aria-label="Beta Reader auto-apply threshold"
                onChange={(e) => setAgentField('betaReader', 'confidenceThreshold', Number(e.target.value))}
              />
              <span className="settings-slider-value">{betaReader.confidenceThreshold.toFixed(2)}</span>
            </div>
          </div>
          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor="beta-reader-max-tokens-day">Max tokens/day</label>
            <input
              id="beta-reader-max-tokens-day"
              className="settings-input settings-input-sm settings-input-number"
              type="number"
              min={1000}
              max={10_000_000}
              step={1000}
              value={betaReader.maxTokensPerDay}
              onChange={(e) => setAgentField('betaReader', 'maxTokensPerDay', Number(e.target.value))}
            />
          </div>
          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor="beta-reader-max-suggestions">Max suggestions/hr</label>
            <input
              id="beta-reader-max-suggestions"
              className="settings-input settings-input-sm settings-input-number"
              type="number"
              min={1}
              max={1000}
              value={betaReader.maxSuggestionsPerHour}
              onChange={(e) => setAgentField('betaReader', 'maxSuggestionsPerHour', Number(e.target.value))}
            />
          </div>
          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor="beta-reader-max-tokens">Max tokens/hr</label>
            <input
              id="beta-reader-max-tokens"
              className="settings-input settings-input-sm settings-input-number"
              type="number"
              min={1000}
              max={1_000_000}
              step={1000}
              value={betaReader.maxTokensPerHour}
              onChange={(e) => setAgentField('betaReader', 'maxTokensPerHour', Number(e.target.value))}
            />
          </div>
        </div>
        <PersonaViewer agentName="betaReader" />
      </div>

      {/* M6: green callout — note linking is built-in, no agent needed (spec §13) */}
      <div className="settings-autolinker-callout" role="note" aria-label="Note linking is automatic">
        <span className="settings-autolinker-callout__icon" aria-hidden="true">🔗</span>
        <div className="settings-autolinker-callout__body">
          <strong>Note linking is automatic — no agent needed.</strong>{' '}
          The built-in Auto Note Linker converts plain mentions of note titles into{' '}
          <code>{'[[wiki links]]'}</code> without using any AI credits.{' '}
          Configure it under{' '}
          <button
            type="button"
            className="settings-autolinker-callout__link"
            onClick={() => {
              // Navigate the parent SettingsPanel to the Vaults tab.
              // The panel listens for this custom event.
              window.dispatchEvent(
                new CustomEvent('settings:navigate', { detail: { category: 'vaults' } }),
              );
            }}
          >
            Vaults &amp; Files
          </button>.
        </div>
      </div>
    </section>
  );
}
