// SKY-6228: M15 — Right panel agent hub (§5.6).
// Tabs: Assistant · Scenes · Notes · References
// Assistant tab: AGENTS card (compact rows → in-panel chat), Suggestions card, Scene Analysis card.
// Beta 4 M13 (§5.4): the Scene Analysis card computes local metrics for the
// open scene and `View Full Analysis` posts the full card into the Coach page.

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { Scene } from './types';
import { useAgentSessions } from './lib/useAgentSessions';
import AgentSessionPicker from './components/AgentSessionPicker';
import WritingAssistantPanel from './WritingAssistantPanel';
import { resolveAgentDisplayName } from './agents/agentIdentity';
import type { NamedAgentId } from './agents/agentIdentity';
import type { TtsEngineSettings } from './hooks/useTtsPlayer';
import { AGENT_LABELS, type UnifiedSuggestion } from './SuggestionDetailPane';
import {
  computeSceneMetrics,
  formatWordCount,
  formatReadTime,
  sceneBalanceNote,
} from './analysis/computedSceneMetrics';
import {
  runFullSceneAnalysis,
  latestAnalysisCardForScene,
  compactReadValue,
} from './coach/sceneAnalysis';
import { showLnToast } from './theme/lnToast';
import './AgentHubPanel.css';

const SUGGESTION_POLL_MS = 30_000;
const SUGGESTION_PREVIEW_LIMIT = 3;

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
  onOpenSuggestionInbox?: () => void;
  /** M13: `View Full Analysis` navigates to the Writing Coach page (§5.4). */
  onOpenCoachPage?: () => void;
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
  onOpenSuggestionInbox,
  onOpenCoachPage,
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
                onOpenSuggestionInbox={onOpenSuggestionInbox}
                onOpenCoachPage={onOpenCoachPage}
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
  onOpenSuggestionInbox?: () => void;
  onOpenCoachPage?: () => void;
}

function AgentHubView({ agentDefs, agentNames, onAgentClick, scene, onOpenSuggestionInbox, onOpenCoachPage }: AgentHubViewProps) {
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
      <SuggestionPreviewCard onOpenSuggestionInbox={onOpenSuggestionInbox} />

      {/* Scene Analysis card — M13 computes the values locally (§5.4) */}
      <SceneAnalysisCard scene={scene} onOpenCoachPage={onOpenCoachPage} />
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

/** Polls the M13 unified suggestion feed for a top-N preview + live count. */
function useSuggestionPreview(limit: number) {
  const [items, setItems] = useState<UnifiedSuggestion[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    if (typeof api?.suggestionsUnifiedList !== 'function') return;
    let cancelled = false;
    const poll = () => {
      (api.suggestionsUnifiedList({ status: 'proposed', limit }) as Promise<{ items?: UnifiedSuggestion[]; totalCount?: number }>)
        .then((r) => {
          if (cancelled) return;
          setItems(r.items ?? []);
          setTotalCount(r.totalCount ?? (r.items?.length ?? 0));
        })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, SUGGESTION_POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [limit]);

  return { items, totalCount };
}

function SuggestionPreviewCard({ onOpenSuggestionInbox }: { onOpenSuggestionInbox?: () => void }) {
  const { items, totalCount } = useSuggestionPreview(SUGGESTION_PREVIEW_LIMIT);

  return (
    <section className="ahp-card" aria-label="Suggestions">
      <header className="ahp-card-header">
        <span className="ahp-card-eyebrow">
          SUGGESTIONS
          {totalCount > 0 && (
            <span className="ahp-badge ahp-badge--count" aria-label={`${totalCount} pending`}>
              {totalCount}
            </span>
          )}
          <span className="ahp-badge ahp-badge--coach">WRITING COACH</span>
        </span>
      </header>
      {items.length === 0 ? (
        <p className="ahp-suggestion-empty">No new suggestions — scan a scene to get feedback.</p>
      ) : (
        <ul className="ahp-suggestion-rows" role="list">
          {items.map((s) => (
            <li key={s.id} className="ahp-suggestion-row">
              <span className="ahp-suggestion-agent">{AGENT_LABELS[s.sourceAgent] ?? s.sourceAgent}</span>
              <span className="ahp-suggestion-rationale">{s.rationale}</span>
              <span className="ahp-suggestion-confidence">{Math.round(s.confidence * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="ahp-see-all-btn"
        onClick={() => onOpenSuggestionInbox?.()}
      >
        See All Suggestions
      </button>
    </section>
  );
}

// ── Scene Analysis card (M13 — §5.4) ────────────────────────────────────────
//
// Rows per prototype 5848: Purpose · Tension · Pacing · POV · Word Count ·
// Read Time. Word count / read time / pacing / POV are computed locally and
// always available. Purpose and Tension are judgment calls — they surface the
// newest Coach's Read for this scene (shared coach session) and honestly show
// a dash until a Full Analysis has run.

/** Prototype toast (HTML 7266). */
const FULL_ANALYSIS_TOAST =
  'Full analysis — computed stats are free & local; the coach’s read uses AI';

function SceneAnalysisCard({ scene, onOpenCoachPage }: { scene: Scene | null; onOpenCoachPage?: () => void }) {
  const coachStore = useAgentSessions('coach');

  const metrics = useMemo(() => (scene ? computeSceneMetrics(scene) : null), [scene]);
  const aiRead = useMemo(() => {
    const card = latestAnalysisCardForScene(coachStore.activeSession?.turns, scene);
    const map = new Map<string, string>();
    for (const [label, clause] of card?.read ?? []) map.set(label, compactReadValue(clause));
    return map;
  }, [coachStore.activeSession, scene]);

  const handleViewFullAnalysis = useCallback(() => {
    if (!scene) return;
    // Fire-and-forget: the card lands in the shared coach conversation when
    // the computed metrics (instant) + AI read (or its honest unavailable
    // state) are assembled. Navigation happens immediately.
    void runFullSceneAnalysis(scene);
    showLnToast(FULL_ANALYSIS_TOAST);
    onOpenCoachPage?.();
  }, [scene, onOpenCoachPage]);

  const rows: Array<{ k: string; v: string; hot?: boolean; ai?: boolean }> = metrics
    ? [
        { k: 'Purpose', v: aiRead.get('Purpose') ?? '—', ai: !aiRead.has('Purpose') },
        { k: 'Tension', v: aiRead.get('Tension') ?? '—', ai: !aiRead.has('Tension'), hot: aiRead.has('Tension') },
        { k: 'Pacing', v: aiRead.get('Pacing') ?? metrics.pacing },
        { k: 'POV', v: aiRead.get('POV') ?? metrics.pov },
        { k: 'Word Count', v: formatWordCount(metrics.words) },
        { k: 'Read Time', v: formatReadTime(metrics) },
      ]
    : [];

  return (
    <section className="ahp-card" aria-label="Scene Analysis">
      <header className="ahp-card-header">
        <span className="ahp-card-eyebrow">
          SCENE ANALYSIS
          <span className="ahp-badge ahp-badge--beta">BETA</span>
        </span>
      </header>
      {!scene || !metrics ? (
        <p className="ahp-analysis-placeholder">
          Open a scene to see analysis.
        </p>
      ) : (
        <>
          <div className="ahp-analysis-rows" data-testid="scene-analysis-rows">
            {rows.map((row) => (
              <div key={row.k} className="ahp-analysis-row">
                <span className="ahp-analysis-row-k">{row.k}</span>
                <span
                  className={`ahp-analysis-row-v${row.hot ? ' ahp-analysis-row-v--hot' : ''}`}
                  title={row.v === '—' && row.ai ? 'A judgment call — run View Full Analysis for the coach’s read' : undefined}
                >
                  {row.v}
                </span>
              </div>
            ))}
          </div>
          <p className="ahp-analysis-note">{sceneBalanceNote(metrics)}</p>
          <button
            type="button"
            className="ahp-view-analysis-btn"
            data-testid="view-full-analysis"
            title="Opens a full breakdown in the Writing Coach"
            onClick={handleViewFullAnalysis}
          >
            View Full Analysis
          </button>
        </>
      )}
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
  // SKY-7076: mirror WritingAssistantPanel's generation state so this
  // surface's picker is disabled during generation too, not just Coach's.
  const [coachBusy, setCoachBusy] = useState(false);

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
        <AgentSessionPicker store={coachSessionStore} className="ahp-session-pill" busy={agentId === 'writing-assistant' && coachBusy} />
      </div>

      {/* Writing Coach uses the existing panel; M12 wires it onto the SHARED
          coach session store so this mini chat and the Coach page render one
          conversation (§5.2/§5.6). */}
      {agentId === 'writing-assistant' && (
        <WritingAssistantPanel
          sessionStore={coachSessionStore}
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
          onBusyChange={setCoachBusy}
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
