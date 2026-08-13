// SKY-6228: M15 — Right panel agent hub (§5.6).
// Tabs: Assistant · Scenes · Notes · References
// Assistant tab: AGENTS card (compact rows → in-panel chat), Suggestions card, Scene Analysis card.
// Beta 4 M13 (§5.4): the Scene Analysis card computes local metrics for the
// open scene and `View Full Analysis` posts the full card into the Coach page.

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { Scene, Story } from './types';
import { useAgentSessions } from './lib/useAgentSessions';
import AgentSessionPicker from './components/AgentSessionPicker';
import WritingAssistantPanel from './WritingAssistantPanel';
import ScenesPanel from './ScenesPanel';
import { useAiEnabled } from './hooks/useAiEnabled';
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
  useSceneAnalysisPending,
} from './coach/sceneAnalysis';
import { showLnToast } from './theme/lnToast';
import SceneNotesPanel from './SceneNotesPanel';
import type { SceneNoteDragPayload } from './sceneNotes';
import SuggestionReview from './SuggestionReview';
import './AgentHubPanel.css';

const SUGGESTION_POLL_MS = 30_000;
const SUGGESTION_PREVIEW_LIMIT = 3;

type HubTab = 'assistant' | 'scenes' | 'notes' | 'references';
/** SKY-9022/M6: the four AGENTS-card rows (kebab ids match suggestion sourceAgent). */
export type AgentId = 'writing-assistant' | 'brainstorm' | 'archive' | 'beta-reader';
type ActiveAgent = AgentId | null;

interface AgentDef {
  id: AgentId;
  agentKey: NamedAgentId;
  label: string;
  description: string;
  color: string;
}

const AGENT_DEFS: AgentDef[] = [
  {
    id: 'writing-assistant',
    agentKey: 'writingAssistant',
    label: 'Writing Coach',
    description: 'Teaches you to write better using your own pages — never ghost-writes.',
    color: '#00f0ff',
  },
  {
    id: 'brainstorm',
    agentKey: 'brainstorm',
    label: 'Brainstorm Agent',
    description: 'Curates your vault, extracts facts, and develops ideas with you.',
    color: '#9b5fff',
  },
  {
    id: 'archive',
    agentKey: 'archive',
    label: 'Archive Agent',
    description: 'Continuity guardian — catches inconsistencies and builds your timeline.',
    color: '#ffd319',
  },
  {
    id: 'beta-reader',
    agentKey: 'betaReader',
    label: 'Beta Reader',
    description: 'Reads your pages like a first-time reader and leaves honest reactions.',
    color: '#8ad9ff',
  },
];

// ── Live AGENTS-card statuses (SKY-9022/M6 GAP-1) ───────────────────────────
//
// Honest wiring only — every status is a state this surface can actually
// observe (no fake demo data). Precedence: Disabled > '{n} new' > live status.

type AgentStatusDot = 'idle' | 'watching' | 'attention' | 'disabled';

interface AgentStatus {
  text: string;
  dot: AgentStatusDot;
  /** Brainstorm's watching dot pulses (prototype 6398) — only while enabled. */
  pulse: boolean;
}

function resolveAgentStatus(
  agentId: AgentId,
  { enabled, pendingCount, continuityCount }: { enabled: boolean; pendingCount: number; continuityCount: number },
): AgentStatus {
  // GAP-6: a disabled agent says so — and suppresses the '{n} new' override
  // (its chat view surfaces the same disabled state on click-through).
  if (!enabled) return { text: 'Disabled', dot: 'disabled', pulse: false };
  // §9 attention override: pending suggestions from this agent are waiting.
  if (pendingCount > 0) return { text: `${pendingCount} new`, dot: 'attention', pulse: false };
  switch (agentId) {
    case 'brainstorm':
      // Enabled Brainstorm literally watches the writing session.
      return { text: 'Watching session', dot: 'watching', pulse: true };
    case 'archive':
      // Live open-flag count fed from ContinuityPanel via DesktopShell.
      return continuityCount > 0
        ? { text: `${continuityCount} flag${continuityCount === 1 ? '' : 's'} open`, dot: 'attention', pulse: false }
        : { text: 'Ready', dot: 'idle', pulse: false };
    default:
      // Writing Coach with nothing pending; Beta Reader has no live
      // reactions feed in the app yet — Ready/Disabled only.
      return { text: 'Ready', dot: 'idle', pulse: false };
  }
}

interface Props {
  scene: Scene | null;
  /** M9c/M6: drives the Scenes tab's canvas-board list. */
  story?: Story | null;
  /** M9c/M6: Scenes tab empty-state + "Open full" → Scene Crafter. */
  onOpenScenesFull?: () => void;
  /** M9c/M6: Scenes tab canvas board note links. */
  onOpenSceneNote?: (notePath: string) => void;
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
  /** SKY-10057: notified when the Review Inbox drill-down opens (side-effect hook — the
   *  drill-down itself is rendered internally, this is not the render target). */
  onOpenSuggestionInbox?: () => void;
  /** SKY-10057: opens a suggestion's target file — passed through to the
   *  in-panel Review Inbox drill-down (SuggestionReview). */
  onOpenVaultPath?: (path: string) => void;
  /** M13: `View Full Analysis` navigates to the Writing Coach page (§5.4). */
  onOpenCoachPage?: () => void;
  /** M9b (SKY-9823): pass-throughs for the Notes tab's SceneNotesPanel. */
  sceneNotesRefresh?: number;
  onPromoteSceneNote?: (payload: SceneNoteDragPayload) => void;
  onSceneNotesChanged?: () => void;
  /** SKY-9022/M6 (GAP-6): per-agent enablement from Settings
   *  (`agents.<key>.enabled ?? true`). Distinct from `enabled`, which means
   *  "Writing Assistant scanning enabled" and feeds WritingAssistantPanel.
   *  Absent key or absent prop = enabled (fresh-profile default). */
  agentEnablement?: Partial<Record<AgentId, boolean>>;
  /** SKY-9022/M6 (GAP-1): live open continuity-flag count — drives the
   *  Archive row's '{n} flags open' status. Fed by ContinuityPanel's
   *  onCountChange via DesktopShell. */
  continuityCount?: number;
  /** M6: Rendered at top of the Assistant tab hub view — Getting Started card. */
  gettingStartedCard?: import('react').ReactNode;
  /** M6: Rendered after SceneAnalysisCard — the Continuity section. */
  continuityPanel?: import('react').ReactNode;
  /** M9a (SKY-9822): Rendered inside the References tab — wiki-link auto-collection. */
  referencesPanel?: import('react').ReactNode;
}

export default function AgentHubPanel({
  scene,
  story = null,
  onOpenScenesFull,
  onOpenSceneNote,
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
  onOpenVaultPath,
  onOpenCoachPage,
  sceneNotesRefresh,
  onPromoteSceneNote,
  onSceneNotesChanged,
  agentEnablement,
  continuityCount = 0,
  gettingStartedCard,
  continuityPanel,
  referencesPanel,
}: Props) {
  // R11/M11a/M11b: master AI toggle off removes the Assistant tab (AGENTS,
  // Suggestions, Scene Analysis, Continuity, Getting Started all live inside
  // it) — "right panel collapses cleanly, no dead bands." Scenes/Notes/
  // References are utility tabs, not AI, and stay either way.
  const aiEnabled = useAiEnabled();
  const [activeTab, setActiveTabState] = useState<HubTab>('assistant');
  const setActiveTab = useCallback((tab: HubTab) => {
    setActiveTabState(tab === 'assistant' && !aiEnabled ? 'scenes' : tab);
  }, [aiEnabled]);
  useEffect(() => {
    if (!aiEnabled) setActiveTabState((cur) => (cur === 'assistant' ? 'scenes' : cur));
  }, [aiEnabled]);
  const [activeAgent, setActiveAgent] = useState<ActiveAgent>(null);

  // SKY-10057: "See All Suggestions" drills into a self-contained Review
  // Inbox in place — mirrors the AgentHubView <-> AgentChatView swap above.
  // The panel-stack home this used to expand (SKY-6321's setGrsPanels) was
  // removed by M6 with no replacement, leaving the button a same-tab no-op.
  const [inboxOpen, setInboxOpen] = useState(false);
  const handleOpenInbox = useCallback(() => {
    setInboxOpen(true);
    onOpenSuggestionInbox?.();
  }, [onOpenSuggestionInbox]);
  const handleInboxBack = useCallback(() => setInboxOpen(false), []);

  const coachSessionStore = useAgentSessions('coach');

  const handleAgentClick = useCallback((id: ActiveAgent) => {
    if (id === 'beta-reader') {
      // Beta Reader view is M27 — route to the beta view
      window.dispatchEvent(new CustomEvent('mythos:nav', { detail: { view: 'beta' } }));
      return;
    }
    setActiveAgent(id);
  }, []);

  // §4: focus returns to the AGENTS row for the agent just exited, not the
  // top of the panel — the row unmounts/remounts across this transition
  // (AgentHubView <-> AgentChatView swap the whole subtree), so a captured
  // element ref would go stale; look the row up fresh by testid instead.
  const handleBack = useCallback(() => {
    const exitingAgentId = activeAgent;
    setActiveAgent(null);
    if (exitingAgentId) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-testid="ahp-agent-row-${exitingAgentId}"]`)?.focus();
      });
    }
  }, [activeAgent]);

  // M11b surface contract: "Assistant" tab is AI-bearing chrome — gone when
  // the master toggle is off. Scenes/Notes/References stay either way.
  const TABS: { id: HubTab; label: string }[] = [
    ...(aiEnabled ? [{ id: 'assistant' as const, label: 'Assistant' }] : []),
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
            onClick={() => { setActiveTab(t.id); setActiveAgent(null); setInboxOpen(false); }}
            aria-selected={activeTab === t.id}
            role="tab"
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="ahp-body">
        {activeTab === 'assistant' && aiEnabled && (
          inboxOpen
            ? <ReviewInboxView onBack={handleInboxBack} onOpenVaultPath={onOpenVaultPath} />
          : activeAgent
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
                agentEnablement={agentEnablement}
                continuityCount={continuityCount}
                onAgentClick={handleAgentClick}
                scene={scene}
                onOpenSuggestionInbox={handleOpenInbox}
                onOpenCoachPage={onOpenCoachPage}
                gettingStartedCard={gettingStartedCard}
                continuityPanel={continuityPanel}
              />
        )}
        {activeTab === 'scenes' && (
          <ScenesPanel story={story} onOpenFull={onOpenScenesFull ?? (() => {})} onOpenNote={onOpenSceneNote} />
        )}
        {activeTab === 'notes' && (
          <SceneNotesPanel
            scene={scene}
            refreshToken={sceneNotesRefresh}
            onPromoteNote={onPromoteSceneNote}
            onNotesChanged={onSceneNotesChanged}
          />
        )}
        {activeTab === 'references' && <ReferencesTab referencesPanel={referencesPanel} />}
      </div>
    </div>
  );
}

// ── Research Quick Links card (M6) ──────────────────────────────────────────

function ResearchQuickLinksCard() {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="ahp-card ahp-card--collapsible" aria-label="Research Quick Links">
      <button
        className="ahp-collapsible-header"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        type="button"
      >
        <span className="ahp-card-eyebrow">RESEARCH QUICK LINKS</span>
        <span className="ahp-collapse-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="ahp-quick-links-body">
          <p className="ahp-stub-text">Quick links to research sources — contents in M9.</p>
        </div>
      )}
    </section>
  );
}

// ── Agent hub view (compact rows) ──────────────────────────────────────────

interface AgentHubViewProps {
  agentDefs: AgentDef[];
  agentNames?: Partial<Record<NamedAgentId, string>>;
  agentEnablement?: Partial<Record<AgentId, boolean>>;
  continuityCount: number;
  onAgentClick: (id: ActiveAgent) => void;
  scene: Scene | null;
  onOpenSuggestionInbox?: () => void;
  onOpenCoachPage?: () => void;
  gettingStartedCard?: import('react').ReactNode;
  continuityPanel?: import('react').ReactNode;
}

function AgentHubView({ agentDefs, agentNames, agentEnablement, continuityCount, onAgentClick, scene, onOpenSuggestionInbox, onOpenCoachPage, gettingStartedCard, continuityPanel }: AgentHubViewProps) {
  // §9: lifted here (rather than owned inside SuggestionPreviewCard) so the
  // AGENTS card can derive each row's "needs attention" count from the same
  // poll instead of a second one.
  const { items, totalCount, loading } = useSuggestionPreview(SUGGESTION_PREVIEW_LIMIT);
  const pendingByAgent = useMemo(() => {
    const counts: Partial<Record<string, number>> = {};
    for (const s of items) counts[s.sourceAgent] = (counts[s.sourceAgent] ?? 0) + 1;
    return counts;
  }, [items]);

  return (
    <div className="ahp-hub">
      {gettingStartedCard}
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
              pendingCount={pendingByAgent[def.id] ?? 0}
              enabled={agentEnablement?.[def.id] ?? true}
              continuityCount={continuityCount}
            />
          ))}
        </div>
      </section>

      {/* Suggestions card — preview 3 rows + See All */}
      <SuggestionPreviewCard
        items={items}
        totalCount={totalCount}
        loading={loading}
        onOpenSuggestionInbox={onOpenSuggestionInbox}
      />

      {/* Scene Analysis card — M13 computes the values locally (§5.4) */}
      <SceneAnalysisCard scene={scene} onOpenCoachPage={onOpenCoachPage} />
      {continuityPanel}
      <ResearchQuickLinksCard />
    </div>
  );
}

interface AgentRowProps {
  def: AgentDef;
  displayName: string;
  onClick: () => void;
  /** §9: pending suggestions from this agent — drives the "needs attention"
   *  status (Beta 4 ships text chat only, not background autonomy, so idle
   *  vs. needs-attention is the state this surface can actually observe). */
  pendingCount?: number;
  /** GAP-6: this agent's Settings enablement (`agents.<key>.enabled ?? true`). */
  enabled?: boolean;
  /** GAP-1: live open continuity-flag count (Archive row only). */
  continuityCount?: number;
}

function AgentRow({ def, displayName, onClick, pendingCount = 0, enabled = true, continuityCount = 0 }: AgentRowProps) {
  const status = resolveAgentStatus(def.id, { enabled, pendingCount, continuityCount });
  // SKY-3941: the row is a button — its accessible name carries name + status
  // so a status change is announced with the agent it belongs to.
  const ariaStatus = status.dot === 'attention' && pendingCount > 0
    ? `${pendingCount} new suggestion${pendingCount === 1 ? '' : 's'}`
    : status.text;

  return (
    <button
      type="button"
      className="ahp-agent-row"
      data-testid={`ahp-agent-row-${def.id}`}
      onClick={onClick}
      aria-label={`Open ${displayName} chat — ${ariaStatus}`}
      title={def.description}
      role="listitem"
      style={{ '--agent-color': def.color } as React.CSSProperties}
    >
      <span className="ahp-agent-tile" aria-hidden="true">
        <AgentIcon agentId={def.id} />
      </span>
      <span className="ahp-agent-text">
        <span className="ahp-agent-name">{displayName}</span>
        <span className="ahp-agent-status">
          <span
            className={`ahp-status-dot ahp-status-dot--${status.dot}${status.pulse ? ' ahp-status-dot--pulse' : ''}`}
            aria-hidden="true"
          />
          <span className="ahp-status-text">{status.text}</span>
        </span>
      </span>
      {/* Prototype 3030: trailing right-chevron. */}
      <svg
        className="ahp-agent-chevron"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
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
  // Only the very first fetch shows a skeleton (Doherty Threshold, §2) —
  // subsequent 30s polls update in place without re-showing a loading state.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    if (typeof api?.suggestionsUnifiedList !== 'function') {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const poll = () => {
      (api.suggestionsUnifiedList({ status: 'proposed', limit }) as Promise<{ items?: UnifiedSuggestion[]; totalCount?: number }>)
        .then((r) => {
          if (cancelled) return;
          setItems(r.items ?? []);
          setTotalCount(r.totalCount ?? (r.items?.length ?? 0));
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    poll();
    const id = window.setInterval(poll, SUGGESTION_POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [limit]);

  return { items, totalCount, loading };
}

interface SuggestionPreviewCardProps {
  items: UnifiedSuggestion[];
  totalCount: number;
  loading: boolean;
  onOpenSuggestionInbox?: () => void;
}

function SuggestionPreviewCard({ items, totalCount, loading, onOpenSuggestionInbox }: SuggestionPreviewCardProps) {
  return (
    <section className="ahp-card" aria-label="Suggestions">
      <header className="ahp-card-header">
        <span className="ahp-card-eyebrow">
          SUGGESTIONS
          {/* Prototype 3040–3043 order: source badge, then count chip. */}
          <span className="ahp-badge ahp-badge--coach">WRITING COACH</span>
          {totalCount > 0 && (
            <span className="ahp-badge ahp-badge--count" aria-label={`${totalCount} pending`}>
              {totalCount}
            </span>
          )}
        </span>
      </header>
      {loading ? (
        <div className="ahp-skeleton-rows" role="status" aria-label="Loading suggestions" data-testid="ahp-suggestions-skeleton">
          <div className="ahp-skeleton-bar" />
          <div className="ahp-skeleton-bar" />
          <div className="ahp-skeleton-bar" />
        </div>
      ) : items.length === 0 ? (
        <p className="ahp-suggestion-empty">No suggestions right now — the team&apos;s watching.</p>
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
  const coachReadPending = useSceneAnalysisPending();

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
      ) : metrics.words === 0 ? (
        <p className="ahp-analysis-placeholder">
          Write a little, then check back — analysis needs some text to work with.
        </p>
      ) : (
        <>
          <div className="ahp-analysis-rows" data-testid="scene-analysis-rows">
            {rows.map((row) => (
              <div key={row.k} className="ahp-analysis-row">
                <span className="ahp-analysis-row-k">{row.k}</span>
                {row.ai && coachReadPending ? (
                  <span className="ahp-skeleton-bar ahp-skeleton-bar--inline" data-testid={`ahp-analysis-skeleton-${row.k}`} />
                ) : (
                  <span
                    className={`ahp-analysis-row-v${row.hot ? ' ahp-analysis-row-v--hot' : ''}`}
                    title={row.v === '—' && row.ai ? 'A judgment call — run View Full Analysis for the coach’s read' : undefined}
                  >
                    {row.v}
                  </span>
                )}
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

// ── Review Inbox drill-down (SKY-10057) ─────────────────────────────────────
//
// "See All Suggestions" used to expand a panel-stack entry that M6 removed
// from rendering; this renders the same SuggestionReview inbox (filters,
// accept/reject/ignore, audit trail) in place, mirroring the AgentChatView
// back-navigation pattern above.

function ReviewInboxView({
  onBack,
  onOpenVaultPath,
}: {
  onBack: () => void;
  onOpenVaultPath?: (path: string) => void;
}) {
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
        <span className="ahp-chat-agent-name">Review Inbox</span>
      </div>
      <SuggestionReview onOpenVaultPath={onOpenVaultPath} />
    </div>
  );
}

// ── Stub tabs ───────────────────────────────────────────────────────────────

// M9a (SKY-9822): the real References tab content (ReferencesPanel — wiki-link
// auto-collection, typed roles, unresolved state) is passed in from
// DesktopShell via `referencesPanel`, the same slot pattern M6 uses for
// `continuityPanel`. Falls back to the pre-M9a stub when unset (e.g. in tests
// that mount AgentHubPanel standalone).
function ReferencesTab({ referencesPanel }: { referencesPanel?: import('react').ReactNode }) {
  if (referencesPanel) return <>{referencesPanel}</>;
  return (
    <div className="ahp-stub-tab">
      <p className="ahp-stub-label">Wiki link targets — coming soon.</p>
    </div>
  );
}
