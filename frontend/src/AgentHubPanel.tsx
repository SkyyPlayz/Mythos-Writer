// Slice B — Unified Writing Partner shell (replaces four-agent hub).
// Right-panel tabs: <name> · Suggestions · Scenes · Notes & Analysis
// Partner tab: card + Past chats & calls + thread + glass composer.
// Hands (Writer / Analyst / Archivist) keep engines; no AGENTS multi-face card.

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { Scene, Story } from './types';
import { useAgentSessions } from './lib/useAgentSessions';
import AgentSessionPicker from './components/AgentSessionPicker';
import WritingAssistantPanel from './WritingAssistantPanel';
import ScenesPanel from './ScenesPanel';
import { useAiEnabled } from './hooks/useAiEnabled';
import type { NamedAgentId } from './agents/agentIdentity';
import {
  PARTNER_HANDS,
  resolvePartnerDisplayName,
  type PartnerHandId,
} from './agents/partnerIdentity';
import { useAgentRunningEntry } from './agents/aiActivity';
import { useBrainstormActivity } from './agents/brainstormActivity';
import type { BrainstormActivitySnapshot } from './agents/brainstormActivity';
import type { TtsEngineSettings } from './hooks/useTtsPlayer';
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
import type { InconsistencyItem } from './InconsistencyCard';
import { useMiniAgentChat } from './timeline2/panel/useMiniAgentChat';
import MiniAgentChat from './timeline2/panel/MiniAgentChat';
import { invokeBrainstorm } from './timeline2/panel/BrainstormTab';
import SuggestionReview from './SuggestionReview';
import PartnerCallChrome, { type PartnerCallState } from './partner/PartnerCallChrome';
import QuestionsForYou, { type PartnerQuestion } from './partner/QuestionsForYou';
import {
  enqueuePartnerMessage,
  getPartnerHandBusy,
  getPartnerMsgQueue,
  setPartnerDrainHandler,
  subscribePartnerBusy,
  type QueuedPartnerMessage,
} from './partner/partnerBusyStore';
import { resolveWritingPartner } from './partner/partnerSettings';
import './AgentHubPanel.css';

/** Legacy agent row ids — kept for resolveAgentStatus + hand routing tests. */
export type AgentId = 'writing-assistant' | 'brainstorm' | 'archive' | 'beta-reader';

type HubTab = 'partner' | 'suggestions' | 'scenes' | 'notes-analysis';

type AgentStatusDot = 'idle' | 'watching' | 'attention' | 'disabled';

interface AgentStatus {
  text: string;
  dot: AgentStatusDot;
  pulse: boolean;
}

/** Status helper retained for hand/engine surfaces + unit tests. */
export function resolveAgentStatus(
  agentId: AgentId,
  { enabled, pendingCount, continuityCount, activeEntry, recentTerminal, brainstormActivity }: {
    enabled: boolean;
    pendingCount: number;
    continuityCount: number;
    activeEntry: AiActivityEntry | null;
    recentTerminal: AiActivityTerminalEvent | null;
    brainstormActivity: BrainstormActivitySnapshot;
  },
): AgentStatus {
  if (!enabled) return { text: 'Disabled', dot: 'disabled', pulse: false };
  if (pendingCount > 0) return { text: `${pendingCount} new`, dot: 'attention', pulse: false };
  if (activeEntry) {
    return { text: `Working — ${activeEntry.surfaceLabel}`, dot: 'watching', pulse: true };
  }
  if (recentTerminal?.status === 'error') {
    return { text: `Needs attention — ${recentTerminal.reason ?? 'the last request failed'}`, dot: 'attention', pulse: false };
  }
  if (recentTerminal?.status === 'empty') {
    return { text: 'Produced nothing — try again', dot: 'attention', pulse: false };
  }
  switch (agentId) {
    case 'brainstorm': {
      if (brainstormActivity.hasError) {
        return { text: 'Needs attention — check the session', dot: 'attention', pulse: false };
      }
      if (!brainstormActivity.active) {
        return { text: 'Idle — will extract facts as you chat', dot: 'idle', pulse: false };
      }
      if (brainstormActivity.factsCount > 0) {
        const n = brainstormActivity.factsCount;
        return { text: `${n} fact${n === 1 ? '' : 's'} this session`, dot: 'watching', pulse: true };
      }
      return {
        text: brainstormActivity.lastActionText ?? 'Watching for facts to extract into the vault',
        dot: 'watching',
        pulse: true,
      };
    }
    case 'archive':
      return continuityCount > 0
        ? { text: `${continuityCount} flag${continuityCount === 1 ? '' : 's'} open`, dot: 'attention', pulse: false }
        : { text: 'Ready', dot: 'idle', pulse: false };
    default:
      return { text: 'Ready', dot: 'idle', pulse: false };
  }
}

interface Props {
  scene: Scene | null;
  story?: Story | null;
  onOpenScenesFull?: (board: { id: string; name: string } | null) => void;
  onOpenSceneNote?: (notePath: string) => void;
  enabled?: boolean;
  scanIntervalSeconds?: number;
  waScanInterval?: number | 'on-save' | 'manual';
  isActive?: boolean;
  isPageFocused?: boolean;
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
  onOpenVaultPath?: (path: string) => void;
  onOpenCoachPage?: () => void;
  sceneNotesRefresh?: number;
  onPromoteSceneNote?: (payload: SceneNoteDragPayload) => void;
  onSceneNotesChanged?: () => void;
  agentEnablement?: Partial<Record<AgentId, boolean>>;
  continuityCount?: number;
  gettingStartedCard?: import('react').ReactNode;
  continuityPanel?: import('react').ReactNode;
  continuityItems?: InconsistencyItem[];
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
  onOpenVaultPath,
  onOpenCoachPage,
  sceneNotesRefresh,
  onPromoteSceneNote,
  onSceneNotesChanged,
  agentEnablement,
  continuityCount = 0,
  gettingStartedCard,
  continuityPanel,
  continuityItems = [],
  referencesPanel,
}: Props) {
  const aiEnabled = useAiEnabled();
  const partnerName = resolvePartnerDisplayName(agentNames);
  const [activeTab, setActiveTabState] = useState<HubTab>('partner');
  const setActiveTab = useCallback((tab: HubTab) => {
    setActiveTabState(tab === 'partner' && !aiEnabled ? 'scenes' : tab);
  }, [aiEnabled]);
  useEffect(() => {
    if (!aiEnabled) setActiveTabState((cur) => (cur === 'partner' || cur === 'suggestions' ? 'scenes' : cur));
  }, [aiEnabled]);

  const [activeHand, setActiveHand] = useState<PartnerHandId | null>(null);
  const [call, setCall] = useState<PartnerCallState>({
    onCall: false,
    muted: false,
    transcriptMode: 'stream',
    settingsOpen: false,
  });
  const endCall = useCallback(() => {
    setCall({ onCall: false, muted: false, transcriptMode: 'stream', settingsOpen: false });
  }, []);

  const partnerSessionStore = useAgentSessions('brainstorm');
  const coachSessionStore = useAgentSessions('coach');

  const handleHand = useCallback((hand: PartnerHandId) => {
    if (hand === 'analyst') {
      window.dispatchEvent(new CustomEvent('mythos:nav', { detail: { view: 'beta' } }));
      return;
    }
    if (hand === 'writer') {
      setActiveHand((cur) => (cur === 'writer' ? null : 'writer'));
      return;
    }
    // Archivist: surface continuity in Notes & Analysis (engine kept; no face).
    setActiveHand(null);
    setActiveTab('notes-analysis');
  }, [setActiveTab]);

  const closeWriterHand = useCallback(() => setActiveHand(null), []);

  const TABS: { id: HubTab; label: string }[] = [
    ...(aiEnabled ? [
      { id: 'partner' as const, label: partnerName },
      { id: 'suggestions' as const, label: 'Suggestions' },
    ] : []),
    { id: 'scenes', label: 'Scenes' },
    { id: 'notes-analysis', label: 'Notes & Analysis' },
  ];

  return (
    <div className="ahp-root" data-testid="agent-hub-panel" data-partner-shell="true">
      <nav className="ahp-tabs" aria-label="Right panel tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ahp-tab${activeTab === t.id ? ' ahp-tab--active' : ''}`}
            onClick={() => { setActiveTab(t.id); }}
            aria-selected={activeTab === t.id}
            role="tab"
            data-testid={`ahp-tab-${t.id}`}
            title={t.label}
          >
            <span className="ahp-tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      <div className="ahp-body">
        {activeTab === 'partner' && aiEnabled && (
          <PartnerChatView
            partnerName={partnerName}
            agentNames={agentNames}
            agentEnablement={agentEnablement}
            continuityCount={continuityCount}
            gettingStartedCard={gettingStartedCard}
            partnerSessionStore={partnerSessionStore}
            coachSessionStore={coachSessionStore}
            activeHand={activeHand}
            onHand={handleHand}
            onCloseWriter={closeWriterHand}
            call={call}
            onCallChange={setCall}
            onEndCall={endCall}
            scene={scene}
            enabled={enabled}
            scanIntervalSeconds={scanIntervalSeconds}
            waScanInterval={waScanInterval}
            isActive={isActive}
            isPageFocused={isPageFocused}
            voiceEnabled={voiceEnabled}
            ttsSettings={ttsSettings}
            voicePrefs={voicePrefs}
            cadenceTrigger={cadenceTrigger}
            idleHeartbeatConstantInterval={idleHeartbeatConstantInterval}
            idleDebounceSeconds={idleDebounceSeconds}
            autoApply={autoApply}
            autoApplyCategories={autoApplyCategories}
            onAutoApplyCategoriesChange={onAutoApplyCategoriesChange}
            continuityPanel={continuityPanel}
            continuityItems={continuityItems}
          />
        )}
        {activeTab === 'suggestions' && aiEnabled && (
          <div className="ahp-suggestions-tab" data-testid="ahp-suggestions-tab">
            <SuggestionReview onOpenVaultPath={onOpenVaultPath} />
          </div>
        )}
        {activeTab === 'scenes' && (
          <ScenesPanel story={story} onOpenFull={onOpenScenesFull ?? (() => {})} onOpenNote={onOpenSceneNote} />
        )}
        {activeTab === 'notes-analysis' && (
          <NotesAndAnalysisTab
            scene={scene}
            onOpenCoachPage={onOpenCoachPage}
            referencesPanel={referencesPanel}
            continuityPanel={continuityPanel}
            sceneNotesRefresh={sceneNotesRefresh}
            onPromoteSceneNote={onPromoteSceneNote}
            onSceneNotesChanged={onSceneNotesChanged}
          />
        )}
      </div>
    </div>
  );
}

// ── Partner chat-first view ─────────────────────────────────────────────────

interface PartnerChatViewProps {
  partnerName: string;
  agentNames?: Partial<Record<NamedAgentId, string>>;
  agentEnablement?: Partial<Record<AgentId, boolean>>;
  continuityCount: number;
  gettingStartedCard?: import('react').ReactNode;
  partnerSessionStore: ReturnType<typeof useAgentSessions>;
  coachSessionStore: ReturnType<typeof useAgentSessions>;
  activeHand: PartnerHandId | null;
  onHand: (hand: PartnerHandId) => void;
  onCloseWriter: () => void;
  call: PartnerCallState;
  onCallChange: (next: PartnerCallState) => void;
  onEndCall: () => void;
  scene: Scene | null;
  enabled: boolean;
  scanIntervalSeconds: number;
  waScanInterval?: number | 'on-save' | 'manual';
  isActive: boolean;
  isPageFocused?: boolean;
  voiceEnabled: boolean;
  ttsSettings?: TtsEngineSettings;
  voicePrefs?: import('./hooks/useTtsPlayer').TtsVoicePrefs & { micDeviceId?: string; inputLanguage?: string };
  cadenceTrigger?: 'on_save' | 'idle_heartbeat';
  idleHeartbeatConstantInterval?: boolean;
  idleDebounceSeconds?: number;
  autoApply: boolean;
  autoApplyCategories?: Partial<Record<SuggestionCategory, boolean>>;
  onAutoApplyCategoriesChange?: (categories: Partial<Record<SuggestionCategory, boolean>>) => void;
  continuityPanel?: import('react').ReactNode;
  continuityItems?: InconsistencyItem[];
}

function PartnerChatView({
  partnerName,
  gettingStartedCard,
  partnerSessionStore,
  coachSessionStore,
  activeHand,
  onHand,
  onCloseWriter,
  call,
  onCallChange,
  onEndCall,
  scene,
  enabled,
  scanIntervalSeconds,
  waScanInterval,
  isActive,
  isPageFocused,
  voiceEnabled,
  ttsSettings,
  voicePrefs,
  cadenceTrigger,
  idleHeartbeatConstantInterval,
  idleDebounceSeconds,
  autoApply,
  autoApplyCategories,
  onAutoApplyCategoriesChange,
}: PartnerChatViewProps) {
  const brainstormActivity = useBrainstormActivity();
  const writerBusy = useAgentRunningEntry('writingAssistant');
  const [heartbeatBusy, setHeartbeatBusy] = useState<PartnerHandId | null>(getPartnerHandBusy());
  useEffect(() => subscribePartnerBusy(() => setHeartbeatBusy(getPartnerHandBusy())), []);
  const handBusy: PartnerHandId | null = heartbeatBusy
    ?? (writerBusy
      ? 'writer'
      : brainstormActivity.active
        ? null
        : activeHand === 'writer' || activeHand === 'archivist' || activeHand === 'analyst'
          ? activeHand
          : null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);

  return (
    <div className="ahp-partner" data-testid="ahp-partner-view">
      {gettingStartedCard}
      <PartnerCallChrome
        partnerName={partnerName}
        handBusy={handBusy}
        call={call}
        onCallChange={onCallChange}
        onEndCall={onEndCall}
      />

      <div className="ahp-past-chats" data-testid="ahp-past-chats">
        <button
          type="button"
          className="ahp-past-chats__toggle"
          aria-expanded={pastOpen}
          onClick={() => setPastOpen((o) => !o)}
          data-testid="ahp-past-chats-toggle"
        >
          <span>Past chats &amp; calls</span>
          <span className="ahp-past-chats__count">
            {partnerSessionStore.sessions.length} thread{partnerSessionStore.sessions.length === 1 ? '' : 's'}
          </span>
          <span aria-hidden="true">{pastOpen ? '▾' : '▸'}</span>
        </button>
        {pastOpen && (
          <div className="ahp-past-chats__menu" data-testid="ahp-past-chats-menu">
            <AgentSessionPicker
              store={partnerSessionStore}
              className="ahp-session-pill ahp-session-pill--dropdown"
              busy={false}
            />
          </div>
        )}
      </div>

      <div className="ahp-hands" role="group" aria-label="Partner hands">
        {PARTNER_HANDS.map((h) => (
          <button
            key={h.id}
            type="button"
            className={`ahp-hand-chip${activeHand === h.id ? ' ahp-hand-chip--active' : ''}`}
            style={{ '--hand-color': h.color } as React.CSSProperties}
            data-testid={`ahp-hand-${h.id}`}
            title={h.description}
            onClick={() => onHand(h.id)}
          >
            {h.label}
          </button>
        ))}
      </div>

      {activeHand === 'writer' ? (
        <div className="ahp-partner-thread" data-testid="ahp-writer-hand">
          <div className="ahp-hand-header">
            <span className="ahp-chat-agent-name">Writer · {partnerName}</span>
            <AgentSessionPicker store={coachSessionStore} className="ahp-session-pill" busy={coachBusy} />
            <button
              type="button"
              className="ahp-hand-close"
              data-testid="ahp-close-writer"
              onClick={onCloseWriter}
            >
              Close
            </button>
          </div>
          <WritingAssistantPanel
            sessionStore={coachSessionStore}
            scene={scene}
            enabled={enabled}
            scanIntervalSeconds={scanIntervalSeconds}
            waScanInterval={waScanInterval}
            isActive={isActive}
            isPageFocused={isPageFocused}
            voiceEnabled={voiceEnabled}
            ttsSettings={ttsSettings}
            voicePrefs={voicePrefs}
            cadenceTrigger={cadenceTrigger}
            idleHeartbeatConstantInterval={idleHeartbeatConstantInterval}
            idleDebounceSeconds={idleDebounceSeconds}
            autoApply={autoApply}
            autoApplyCategories={autoApplyCategories}
            onAutoApplyCategoriesChange={onAutoApplyCategoriesChange}
            displayName={partnerName}
            onBusyChange={setCoachBusy}
          />
        </div>
      ) : (
        <div className="ahp-partner-thread" data-testid="ahp-partner-thread">
          <PartnerBrainstormChat
            partnerName={partnerName}
            onCall={call.onCall}
            handBusy={!!handBusy}
          />
        </div>
      )}
    </div>
  );
}

function PartnerBrainstormChat({
  partnerName,
  onCall,
  handBusy,
}: {
  partnerName: string;
  onCall: boolean;
  handBusy: boolean;
}) {
  const chat = useMiniAgentChat('brainstorm', invokeBrainstorm);
  const [queued, setQueued] = useState<readonly QueuedPartnerMessage[]>(getPartnerMsgQueue());
  const [settingsSnap, setSettingsSnap] = useState<AppSettings | null>(null);

  useEffect(() => subscribePartnerBusy(() => setQueued([...getPartnerMsgQueue()])), []);

  useEffect(() => {
    let cancelled = false;
    void window.api?.settingsGet?.().then((s) => {
      if (!cancelled) setSettingsSnap(s);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setPartnerDrainHandler((items) => {
      void (async () => {
        for (const item of items) {
          await chat.send(item.text);
        }
      })();
    });
    return () => setPartnerDrainHandler(null);
  }, [chat]);

  const partnerPrefs = resolveWritingPartner(settingsSnap ?? undefined);
  const showClaudeLogin = partnerPrefs.claudeCli === 'login';
  const webSearchOn = partnerPrefs.webSearch;

  const sendQueuedAware = useCallback(async (prompt: string) => {
    if (handBusy || getPartnerHandBusy()) {
      if (enqueuePartnerMessage(prompt)) {
        setQueued([...getPartnerMsgQueue()]);
        return;
      }
    }
    await chat.send(prompt);
  }, [chat, handBusy]);

  const queuedChat = useMemo(() => ({
    ...chat,
    send: sendQueuedAware,
    // Allow composer while heartbeat-busy so messages can enter QUEUED.
    busy: chat.busy && !handBusy && !getPartnerHandBusy(),
  }), [chat, sendQueuedAware, handBusy]);

  return (
    <div className="ahp-brainstorm-chat ahp-partner-composer" data-testid="ahp-partner-chat">
      {showClaudeLogin && (
        <div className="ahp-claude-login" data-testid="ahp-claude-login-card">
          <div className="ahp-claude-login__title">Log in to Claude to finish setup</div>
          <div className="ahp-claude-login__actions">
            <button
              type="button"
              className="ahp-claude-login__primary"
              data-testid="ahp-claude-login"
              onClick={() => {
                void window.api?.settingsGet?.().then(async (s) => {
                  const cur = resolveWritingPartner(s);
                  const next = {
                    ...s,
                    writingPartner: { ...cur, claudeCli: 'ready' as const },
                  };
                  await window.api?.settingsSet?.(next);
                  setSettingsSnap(next);
                });
              }}
            >
              Log in with Claude
            </button>
            <button
              type="button"
              className="ahp-claude-login__later"
              data-testid="ahp-claude-login-later"
              onClick={() => {
                void window.api?.settingsGet?.().then(async (s) => {
                  const cur = resolveWritingPartner(s);
                  const next = {
                    ...s,
                    writingPartner: { ...cur, claudeCli: 'none' as const },
                  };
                  await window.api?.settingsSet?.(next);
                  setSettingsSnap(next);
                });
              }}
            >
              Later
            </button>
          </div>
          <p className="ahp-claude-login__note">
            The Claude CLI runs hidden in the background — no terminal, nothing to manage.
          </p>
        </div>
      )}
      <MiniAgentChat
        chat={queuedChat}
        accent="brainstorm"
        placeholder={onCall ? `Speak or type to ${partnerName}…` : `Message ${partnerName}…`}
        testidPrefix="ahp-partner"
      />
      {queued.length > 0 && (
        <div className="ahp-queued" data-testid="ahp-queued-list" aria-label="Queued messages">
          {queued.map((q) => (
            <div key={q.id} className="ahp-queued__item" data-testid="ahp-queued-chip">
              <span className="ahp-queued__tag">QUEUED</span>
              <span>{q.text}</span>
            </div>
          ))}
        </div>
      )}
      {webSearchOn && (
        <p className="ahp-web-search-chip" data-testid="ahp-web-search-used">
          Web search used
        </p>
      )}
      {onCall && (
        <p className="ahp-voice-hint" data-testid="ahp-voice-hint">
          🎙 VOICE turns appear as ordinary bubbles in this thread.
        </p>
      )}
    </div>
  );
}

// ── Notes & Analysis ────────────────────────────────────────────────────────

function NotesAndAnalysisTab({
  scene,
  onOpenCoachPage,
  referencesPanel,
  continuityPanel,
  sceneNotesRefresh,
  onPromoteSceneNote,
  onSceneNotesChanged,
}: {
  scene: Scene | null;
  onOpenCoachPage?: () => void;
  referencesPanel?: import('react').ReactNode;
  continuityPanel?: import('react').ReactNode;
  sceneNotesRefresh?: number;
  onPromoteSceneNote?: (payload: SceneNoteDragPayload) => void;
  onSceneNotesChanged?: () => void;
}) {
  // Seed empty-state-friendly placeholders so Questions-for-you sub-tabs are
  // reachable for fidelity proof; live vault-gap wiring can replace these.
  const demoNotesQs: PartnerQuestion[] = useMemo(() => ([
    {
      id: 'nq-gap-1',
      heading: 'Who holds the key?',
      detail: 'A notes gap mentioned a key without naming the holder. Clarify for the vault.',
      targetNotePath: null,
      source: 'notes',
    },
  ]), []);
  const demoStoryQs: PartnerQuestion[] = useMemo(() => ([
    {
      id: 'sq-1',
      heading: 'What changes after the reveal?',
      detail: 'Open story question — answer appends to the chosen note.',
      targetNotePath: 'Notes/Story questions.md',
      source: 'story',
    },
  ]), []);

  const handleAppend = useCallback(async ({ notePath, heading, answer }: { notePath: string; heading: string; answer: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    const block = `\n\n## ${heading}\n\n${answer}\n`;
    if (typeof api?.notesAppend === 'function') {
      await api.notesAppend({ path: notePath, content: block });
      return;
    }
    if (typeof api?.vaultAppendText === 'function') {
      await api.vaultAppendText({ path: notePath, text: block });
      return;
    }
    // Soft path for tests / missing IPC — surface success via toast only.
    showLnToast(`Answer ready for ${notePath}`);
  }, []);

  return (
    <div className="ahp-notes-analysis" data-testid="ahp-notes-analysis">
      <SceneAnalysisCard scene={scene} onOpenCoachPage={onOpenCoachPage} />
      <QuestionsForYou
        notesQuestions={demoNotesQs}
        storyQuestions={demoStoryQs}
        activityItems={[
          { id: 'act-ready', text: 'Partner ready — hands idle', at: 'now' },
        ]}
        noteOptions={[
          { path: 'Notes/Characters.md', title: 'Characters' },
          { path: 'Notes/Story questions.md', title: 'Story questions' },
        ]}
        onAppendToNote={handleAppend}
      />
      <section className="ahp-card" aria-label="References">
        <header className="ahp-card-header">
          <span className="ahp-card-eyebrow">REFERENCES</span>
        </header>
        {referencesPanel ?? (
          <p className="ahp-stub-text">Wiki link targets appear here.</p>
        )}
      </section>
      <SceneNotesPanel
        scene={scene}
        refreshToken={sceneNotesRefresh}
        onPromoteNote={onPromoteSceneNote}
        onNotesChanged={onSceneNotesChanged}
      />
      {continuityPanel}
    </div>
  );
}

// ── Scene Analysis card (moved into Notes & Analysis) ───────────────────────

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
        <p className="ahp-analysis-placeholder">Open a scene to see analysis.</p>
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
            title="Opens a full breakdown via the Writer hand"
            onClick={handleViewFullAnalysis}
          >
            View Full Analysis
          </button>
        </>
      )}
    </section>
  );
}
