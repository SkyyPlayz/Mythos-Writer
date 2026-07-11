// SKY-6228: M15 — Right panel agent hub (§5.6).
// Tabs: Assistant · Scenes · Notes · References
// Assistant tab: AGENTS card (compact rows → in-panel chat), Suggestions card, Scene Analysis card.

import { useState, useCallback } from 'react';
import type { Scene } from './types';
import { useAgentSessions } from './lib/useAgentSessions';
import AgentSessionPicker from './components/AgentSessionPicker';
import WritingAssistantPanel from './WritingAssistantPanel';
import { resolveAgentDisplayName } from './agents/agentIdentity';
import type { NamedAgentId } from './agents/agentIdentity';
import type { TtsEngineSettings } from './hooks/useTtsPlayer';
import './AgentHubPanel.css';

type HubTab = 'assistant' | 'scenes' | 'notes' | 'references';
type ActiveAgent = 'writing-assistant' | 'brainstorm' | 'archive' | 'beta-reader' | null;

interface AgentDef {
  id: ActiveAgent;
  agentKey: NamedAgentId;
  label: string;
  description: string;
  statusText: string;
  statusColor: 'idle' | 'active' | 'busy';
  color: string;
}

const AGENT_DEFS: AgentDef[] = [
  {
    id: 'writing-assistant',
    agentKey: 'writingAssistant',
    label: 'Writing Coach',
    description: 'Teaches you to write better using your own pages — never ghost-writes.',
    statusText: 'Idle',
    statusColor: 'idle',
    color: '#00f0ff',
  },
  {
    id: 'brainstorm',
    agentKey: 'brainstorm',
    label: 'Brainstorm Agent',
    description: 'Curates your vault, extracts facts, and develops ideas with you.',
    statusText: 'Idle',
    statusColor: 'idle',
    color: '#9b5fff',
  },
  {
    id: 'archive',
    agentKey: 'archive',
    label: 'Archive Agent',
    description: 'Continuity guardian — catches inconsistencies and builds your timeline.',
    statusText: 'Idle',
    statusColor: 'idle',
    color: '#ffd319',
  },
  {
    id: 'beta-reader',
    agentKey: 'betaReader',
    label: 'Beta Reader',
    description: 'Reads your pages like a first-time reader and leaves honest reactions.',
    statusText: 'Idle',
    statusColor: 'idle',
    color: '#8ad9ff',
  },
];

interface Props {
  scene: Scene | null;
  enabled?: boolean;
  scanIntervalSeconds?: number;
  waScanInterval?: number | 'on-save' | 'manual';
  isActive?: boolean;
  isPageFocused?: boolean;
  onJumpToText?: (text: string) => void;
  voiceEnabled?: boolean;
  ttsSettings?: TtsEngineSettings;
  voicePrefs?: import('./hooks/useTtsPlayer').TtsVoicePrefs & { micDeviceId?: string; inputLanguage?: string };
  cadenceTrigger?: 'on_save' | 'idle_heartbeat';
  idleHeartbeatConstantInterval?: boolean;
  idleDebounceSeconds?: number;
  autoApply?: boolean;
  autoApplyCategories?: Partial<Record<SuggestionCategory, boolean>>;
  onAutoApplyCategoriesChange?: (categories: Partial<Record<SuggestionCategory, boolean>>) => void;
  agentNames?: Partial<Record<NamedAgentId, string>>;
}

export default function AgentHubPanel({
  scene,
  enabled = true,
  scanIntervalSeconds = 60,
  waScanInterval,
  isActive = true,
  isPageFocused,
  onJumpToText,
  voiceEnabled = false,
  ttsSettings,
  voicePrefs,
  cadenceTrigger,
  idleHeartbeatConstantInterval,
  idleDebounceSeconds,
  autoApply = false,
  autoApplyCategories,
  onAutoApplyCategoriesChange,
  agentNames,
}: Props) {
  const [activeTab, setActiveTab] = useState<HubTab>('assistant');
  const [activeAgent, setActiveAgent] = useState<ActiveAgent>(null);

  const coachSessionStore = useAgentSessions('coach');

  const handleAgentClick = useCallback((id: ActiveAgent) => {
    if (id === 'beta-reader') {
      // Beta Reader view is M27 — route to the beta view
      window.dispatchEvent(new CustomEvent('mythos:nav', { detail: { view: 'beta' } }));
      return;
    }
    setActiveAgent(id);
  }, []);

  const handleBack = useCallback(() => setActiveAgent(null), []);

  const TABS: { id: HubTab; label: string }[] = [
    { id: 'assistant', label: 'Assistant' },
    { id: 'scenes', label: 'Scenes' },
    { id: 'notes', label: 'Notes' },
    { id: 'references', label: 'References' },
  ];

  return (
    <div className="ahp-root" data-testid="agent-hub-panel">
      <nav className="ahp-tabs" aria-label="Right panel tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ahp-tab${activeTab === t.id ? ' ahp-tab--active' : ''}`}
            onClick={() => { setActiveTab(t.id); setActiveAgent(null); }}
            aria-selected={activeTab === t.id}
            role="tab"
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="ahp-body">
        {activeTab === 'assistant' && (
          activeAgent
            ? <AgentChatView
                agentId={activeAgent}
                agentDef={AGENT_DEFS.find((a) => a.id === activeAgent)!}
                agentNames={agentNames}
                coachSessionStore={coachSessionStore}
                onBack={handleBack}
                scene={scene}
                enabled={enabled}
                scanIntervalSeconds={scanIntervalSeconds}
                waScanInterval={waScanInterval}
                isActive={isActive}
                isPageFocused={isPageFocused}
                onJumpToText={onJumpToText}
                voiceEnabled={voiceEnabled}
                ttsSettings={ttsSettings}
                voicePrefs={voicePrefs}
                cadenceTrigger={cadenceTrigger}
                idleHeartbeatConstantInterval={idleHeartbeatConstantInterval}
                idleDebounceSeconds={idleDebounceSeconds}
                autoApply={autoApply}
                autoApplyCategories={autoApplyCategories}
                onAutoApplyCategoriesChange={onAutoApplyCategoriesChange}
              />
            : <AgentHubView
                agentDefs={AGENT_DEFS}
                agentNames={agentNames}
                onAgentClick={handleAgentClick}
                scene={scene}
              />
        )}
        {activeTab === 'scenes' && <ScenesTab scene={scene} />}
        {activeTab === 'notes' && <NotesTab />}
        {activeTab === 'references' && <ReferencesTab />}
      </div>
    </div>
  );
}

// ── Agent hub view (compact rows) ──────────────────────────────────────────

interface AgentHubViewProps {
  agentDefs: AgentDef[];
  agentNames?: Partial<Record<NamedAgentId, string>>;
  onAgentClick: (id: ActiveAgent) => void;
  scene: Scene | null;
}

function AgentHubView({ agentDefs, agentNames, onAgentClick }: AgentHubViewProps) {
  return (
    <div className="ahp-hub">
      {/* AGENTS card */}
      <section className="ahp-card" aria-label="Agents">
        <header className="ahp-card-header">
          <span className="ahp-card-eyebrow">AGENTS</span>
        </header>
        <div className="ahp-agent-rows" role="list">
          {agentDefs.map((def) => (
            <AgentRow
              key={def.id}
              def={def}
              displayName={resolveAgentDisplayName(def.agentKey, agentNames)}
              onClick={() => onAgentClick(def.id)}
            />
          ))}
        </div>
      </section>

      {/* Suggestions card — preview 3 rows + See All */}
      <SuggestionPreviewCard />

      {/* Scene Analysis card — surface only (computation is M13) */}
      <SceneAnalysisCard />
    </div>
  );
}

interface AgentRowProps {
  def: AgentDef;
  displayName: string;
  onClick: () => void;
}

function AgentRow({ def, displayName, onClick }: AgentRowProps) {
  return (
    <button
      type="button"
      className="ahp-agent-row"
      onClick={onClick}
      aria-label={`Open ${displayName} chat`}
      title={def.description}
      role="listitem"
    >
      <span
        className="ahp-agent-tile"
        style={{ '--agent-color': def.color } as React.CSSProperties}
        aria-hidden="true"
      >
        <AgentIcon agentId={def.id} />
      </span>
      <span className="ahp-agent-name">{displayName}</span>
      <span className="ahp-agent-status">
        <span
          className={`ahp-status-dot ahp-status-dot--${def.statusColor}`}
          aria-hidden="true"
        />
        <span className="ahp-status-text">{def.statusText}</span>
      </span>
    </button>
  );
}

function AgentIcon({ agentId }: { agentId: ActiveAgent }) {
  switch (agentId) {
    case 'writing-assistant': return <span aria-hidden="true">🎓</span>;
    case 'brainstorm': return <span aria-hidden="true">💡</span>;
    case 'archive': return <span aria-hidden="true">📚</span>;
    case 'beta-reader': return <span aria-hidden="true">👁</span>;
    default: return <span aria-hidden="true">🤖</span>;
  }
}

// ── Suggestions preview card ────────────────────────────────────────────────

function SuggestionPreviewCard() {
  return (
    <section className="ahp-card" aria-label="Suggestions">
      <header className="ahp-card-header">
        <span className="ahp-card-eyebrow">
          SUGGESTIONS
          <span className="ahp-badge ahp-badge--coach">WRITING COACH</span>
        </span>
      </header>
      <p className="ahp-suggestion-empty">No new suggestions — scan a scene to get feedback.</p>
      <button
        type="button"
        className="ahp-see-all-btn"
        onClick={() => window.dispatchEvent(new CustomEvent('mythos:nav', { detail: { view: 'suggestion-inbox' } }))}
      >
        See All Suggestions
      </button>
    </section>
  );
}

// ── Scene Analysis card (surface only — M13 provides computation) ──────────

function SceneAnalysisCard() {
  return (
    <section className="ahp-card" aria-label="Scene Analysis">
      <header className="ahp-card-header">
        <span className="ahp-card-eyebrow">SCENE ANALYSIS</span>
      </header>
      <p className="ahp-analysis-placeholder">
        Open a scene to see analysis.
      </p>
    </section>
  );
}

// ── In-panel chat view ──────────────────────────────────────────────────────

interface AgentChatViewProps {
  agentId: ActiveAgent;
  agentDef: AgentDef;
  agentNames?: Partial<Record<NamedAgentId, string>>;
  coachSessionStore: ReturnType<typeof useAgentSessions>;
  onBack: () => void;
  scene: Scene | null;
  enabled: boolean;
  scanIntervalSeconds: number;
  waScanInterval?: number | 'on-save' | 'manual';
  isActive: boolean;
  isPageFocused?: boolean;
  onJumpToText?: (text: string) => void;
  voiceEnabled: boolean;
  ttsSettings?: TtsEngineSettings;
  voicePrefs?: import('./hooks/useTtsPlayer').TtsVoicePrefs & { micDeviceId?: string; inputLanguage?: string };
  cadenceTrigger?: 'on_save' | 'idle_heartbeat';
  idleHeartbeatConstantInterval?: boolean;
  idleDebounceSeconds?: number;
  autoApply: boolean;
  autoApplyCategories?: Partial<Record<SuggestionCategory, boolean>>;
  onAutoApplyCategoriesChange?: (categories: Partial<Record<SuggestionCategory, boolean>>) => void;
}

function AgentChatView({
  agentId,
  agentDef,
  agentNames,
  coachSessionStore,
  onBack,
  scene,
  enabled,
  scanIntervalSeconds,
  waScanInterval,
  isActive,
  isPageFocused,
  onJumpToText,
  voiceEnabled,
  ttsSettings,
  voicePrefs,
  cadenceTrigger,
  idleHeartbeatConstantInterval,
  idleDebounceSeconds,
  autoApply,
  autoApplyCategories,
  onAutoApplyCategoriesChange,
}: AgentChatViewProps) {
  const displayName = resolveAgentDisplayName(agentDef.agentKey, agentNames);

  return (
    <div className="ahp-chat-view">
      <div className="ahp-chat-header">
        <button
          type="button"
          className="ahp-back-btn"
          onClick={onBack}
          aria-label="Back to agents"
        >
          ‹ Back
        </button>
        <span
          className="ahp-chat-agent-tile"
          style={{ '--agent-color': agentDef.color } as React.CSSProperties}
          aria-hidden="true"
        >
          <AgentIcon agentId={agentId} />
        </span>
        <span className="ahp-chat-agent-name">{displayName}</span>
        <AgentSessionPicker store={coachSessionStore} className="ahp-session-pill" />
      </div>

      {/* Writing Coach / Writing Assistant uses the existing panel */}
      {agentId === 'writing-assistant' && (
        <WritingAssistantPanel
          scene={scene}
          enabled={enabled}
          scanIntervalSeconds={scanIntervalSeconds}
          waScanInterval={waScanInterval}
          isActive={isActive}
          isPageFocused={isPageFocused}
          onJumpToText={onJumpToText}
          voiceEnabled={voiceEnabled}
          ttsSettings={ttsSettings}
          voicePrefs={voicePrefs}
          cadenceTrigger={cadenceTrigger}
          idleHeartbeatConstantInterval={idleHeartbeatConstantInterval}
          idleDebounceSeconds={idleDebounceSeconds}
          autoApply={autoApply}
          autoApplyCategories={autoApplyCategories}
          onAutoApplyCategoriesChange={onAutoApplyCategoriesChange}
          displayName={displayName}
        />
      )}

      {agentId !== 'writing-assistant' && (
        <div className="ahp-chat-placeholder">
          <p className="ahp-chat-coming-soon">{displayName} chat coming soon.</p>
        </div>
      )}
    </div>
  );
}

// ── Stub tabs ───────────────────────────────────────────────────────────────

function ScenesTab({ scene }: { scene: Scene | null }) {
  return (
    <div className="ahp-stub-tab">
      <p className="ahp-stub-label">
        {scene ? `Open scene: ${scene.title}` : 'No scene open.'}
      </p>
    </div>
  );
}

function NotesTab() {
  return (
    <div className="ahp-stub-tab">
      <p className="ahp-stub-label">Quick notes — coming in M18.</p>
    </div>
  );
}

function ReferencesTab() {
  return (
    <div className="ahp-stub-tab">
      <p className="ahp-stub-label">Wiki link targets — coming soon.</p>
    </div>
  );
}
