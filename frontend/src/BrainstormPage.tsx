import { useState, useCallback, useEffect, useRef, useMemo, Fragment } from 'react';
import { IdeaCard } from './components/BrainstormCard/IdeaCard';
import { IdeaDetailDrawer } from './components/BrainstormCard/IdeaDetailDrawer';
import { ProposalCard } from './components/BrainstormCard/ProposalCard';
import type { NoteProposal, NoteProposalKind } from './components/BrainstormCard/ProposalCard';
import { ScenePicker } from './components/BrainstormCard/ScenePicker';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import PresetSelector from './components/PresetSelector';
import PresetEditor from './components/PresetEditor';
import RefinementChips from './components/RefinementChips';
import {
  loadSessionPreset,
  saveSessionPreset,
  getEffectiveAxes,
  buildPresetContext,
} from './presets';
import type { PresetAxes, RefinementChip } from './presets';
import EntriesQuickAdd from './EntriesQuickAdd';
import { PROMPT_MAX_CHARS } from './promptConstants';
import { useToast } from './hooks/useToast';
import { Toast } from './components/Toast/Toast';
import './BrainstormPage.css';

interface ContinuityIssue {
  id: string;
  description: string;
  anchorText: string;
  resolved: boolean;
}

type AnswerKind = 'fix-note' | 'suggest-change' | 'free-text';

interface ContinuityAnswerDraft {
  kind: AnswerKind;
  text: string;
}

function parseContinuityIssues(raw: Record<string, unknown>[]): ContinuityIssue[] {
  return raw.flatMap((r) => {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(r.payload_json as string); } catch { /* skip */ }
    if (payload.kind !== 'inconsistency') return [];
    return [{
      id: r.id as string,
      description: (r.rationale as string) || '',
      anchorText: (payload.anchorText as string) || '',
      resolved: (r.status as string) === 'accepted',
    }];
  });
}

const BRAINSTORM_SYSTEM_PROMPT = `You are a creative writing assistant helping an author develop their story world. When the user mentions specific named characters, locations, items, or notable concepts, emit structured fact tags using this format:

[FACT:type|Name|Brief description]

Where type is: character, location, item, or note.
Example: [FACT:character|Aria Voss|A young sorceress who discovers her hidden powers]

Emit one FACT tag per entity. Place them at the end of your response. Then respond naturally to help develop the story.`;

export const STALL_TIMEOUT_MS = 20_000;
export const HARD_TIMEOUT_MS = 90_000;

const DRAFT_KEY = 'brainstorm:draft';
const MAX_DRAFT_BYTES = 2 * 1024 * 1024; // 2 MB

// Sentinel value used when the user explicitly picks "Vault root" in the
// routing-prompt select. Empty string is reserved for "nothing selected yet"
// (the disabled placeholder), so vault-root needs its own distinct token.
// resolveRoutingPrompt translates this back to '' before calling the API.
export const VAULT_ROOT_SENTINEL = '__vault_root__';

interface BrainstormDraft {
  v: 2;
  savedAt: string;
  prompt: string;
  messages: Message[];
  facts: DetectedFact[];
  sortMode?: SortOrder;
  customOrder?: string[];
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

interface DetectedFact {
  id: string;
  type: 'character' | 'location' | 'item' | 'note';
  name: string;
  content: string;
  savedStatus: 'unsaved' | 'saving' | 'saved' | 'error' | 'pending_review' | 'needs_routing';
  savedPath?: string;
  /** SKY-1393: scene this idea is directly linked to (fast-path — skips picker). */
  linkedSceneId?: string;
  updatedAt?: string;
  createdAt?: number;
}

type SortOrder = 'newest' | 'oldest' | 'by-type' | 'by-status' | 'custom';
type FilterType = 'all' | 'character' | 'location' | 'item' | 'note';

const SORT_LABELS: Record<SortOrder, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  'by-type': 'By type',
  'by-status': 'By status (saved first)',
  custom: 'Custom order',
};

const FILTER_LABELS: Record<FilterType, string> = {
  all: 'All types',
  character: 'Characters',
  location: 'Locations',
  item: 'Items',
  note: 'Concept notes',
};

const SAVED_STATUS_RANK: Record<DetectedFact['savedStatus'], number> = {
  saved: 0,
  saving: 1,
  unsaved: 2,
  pending_review: 3,
  needs_routing: 4,
  error: 5,
};

function sortFacts(facts: DetectedFact[], sortOrder: SortOrder): DetectedFact[] {
  if (sortOrder === 'custom') return [...facts];
  return [...facts].sort((a, b) => {
    switch (sortOrder) {
      case 'newest':
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      case 'oldest':
        return (a.createdAt ?? 0) - (b.createdAt ?? 0);
      case 'by-type': {
        const ai = FACT_TYPE_ORDER.indexOf(a.type);
        const bi = FACT_TYPE_ORDER.indexOf(b.type);
        return ai !== bi ? ai - bi : (b.createdAt ?? 0) - (a.createdAt ?? 0);
      }
      case 'by-status': {
        const diff = SAVED_STATUS_RANK[a.savedStatus] - SAVED_STATUS_RANK[b.savedStatus];
        return diff !== 0 ? diff : (b.createdAt ?? 0) - (a.createdAt ?? 0);
      }
    }
  });
}

// SKY-196: context selection result surfaced in the "Context used" panel.
interface ContextResultItem {
  path: string;
  name: string;
  type: 'character' | 'location' | 'item' | 'note';
  content: string;
  estimatedTokens: number;
  whyIncluded: string;
}

interface ContextResult {
  included: ContextResultItem[];
  excluded: ContextResultItem[];
  usedTokens: number;
  budgetTokens: number;
}

function buildContextBlock(items: ContextResultItem[]): string {
  const lines = [
    '',
    '---',
    '## Story Vault Context',
    "The following entities are in the user's story vault and may be relevant:",
    '',
  ];
  for (const item of items) {
    lines.push(`**${item.name}** (${item.type})`);
    if (item.content.trim()) {
      lines.push(item.content.trim().slice(0, 400));
    }
    lines.push('');
  }
  return lines.join('\n');
}

// SKY-20: a pending routing prompt rendered as a chat bubble. When the
// Brainstorm agent emits a fact whose category has no remembered destination
// in a Blank-mode vault, main stages the file and tells the renderer to ask.
interface RoutingPrompt {
  factId: string;
  stagedPath: string;
  category: 'character' | 'location' | 'item' | 'note';
  name: string;
  /** User's currently selected destination — controlled component state. */
  destination: string;
  /** Free-text input for "create a new folder under root" mode. */
  customFolder: string;
}

type NoteCategory = 'character' | 'location' | 'item' | 'note';

const CATEGORY_LABEL: Record<NoteCategory, string> = {
  character: 'character',
  location: 'location',
  item: 'item',
  note: 'note',
};

function extractFacts(text: string): Omit<DetectedFact, 'id' | 'savedStatus'>[] {
  const factPattern = /\[FACT:(character|location|item|note)\|([^\]|]+)\|([^\]]+)\]/gi;
  const facts: Omit<DetectedFact, 'id' | 'savedStatus'>[] = [];
  let match;
  while ((match = factPattern.exec(text)) !== null) {
    facts.push({
      type: match[1].toLowerCase() as DetectedFact['type'],
      name: match[2].trim(),
      content: match[3].trim(),
    });
  }
  return facts;
}

function stripFactTags(text: string): string {
  return text.replace(/\[FACT:(character|location|item|note)\|[^\]]+\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}

const FACT_TYPE_LABELS: Record<DetectedFact['type'], string> = {
  character: 'Character',
  location: 'Location',
  item: 'Item',
  note: 'Note',
};

const FACT_TYPE_ORDER: DetectedFact['type'][] = ['character', 'location', 'item', 'note'];

interface Props {
  onClose: () => void;
  enabled?: boolean;
  onFirstSubmit?: () => void;
  onNavigateToEntity?: (entityId: string) => void;
  onNavigateToScene?: (sceneId: string) => Promise<boolean>;
  /** SKY-1764/SKY-2306: slug of the currently selected story, used to add
   *  scene_crafter_card proposals directly to the active board. */
  activeStorySlug?: string | null;
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'error';

const MIC_ARIA_LABELS: Record<VoiceState, string> = {
  idle: 'Start voice input',
  listening: 'Stop voice input — listening',
  processing: 'Processing speech…',
  error: 'Voice error — click to retry',
};

const MIC_ICONS: Record<VoiceState, string> = {
  idle: '🎤', listening: '🎤', processing: '⏳', error: '⚠',
};

const COUNTDOWN_RING_R = 15;
const COUNTDOWN_RING_C = 2 * Math.PI * COUNTDOWN_RING_R;

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function BrainstormPage({ onClose, enabled = true, onFirstSubmit, onNavigateToEntity, onNavigateToScene, activeStorySlug }: Props) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [facts, setFacts] = useState<DetectedFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceState, _setVoiceStateRaw] = useState<VoiceState>('idle');
  const voiceStateRef = useRef<VoiceState>('idle');
  const [voiceTranscript, setVoiceTranscript] = useState({ confirmed: '', interim: '' });
  const [silenceSecondsLeft, setSilenceSecondsLeft] = useState<number | null>(null);
  const [alertText, setAlertText] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceStartRef = useRef<number>(0);
  const confirmedTextRef = useRef('');
  const setVoiceState = useCallback((s: VoiceState) => {
    voiceStateRef.current = s;
    _setVoiceStateRaw(s);
  }, []);
  const { toast: toastState, showToast } = useToast(3000);
  const [pasteWarning, setPasteWarning] = useState(false);
  const [detailDrawerIdeaId, setDetailDrawerIdeaId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<NoteProposal[]>([]);
  const [continuityIssues, setContinuityIssues] = useState<ContinuityIssue[]>([]);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, ContinuityAnswerDraft>>({});
  // Per-card body preview toggle: set of fact IDs that are currently expanded.
  // New facts start expanded so the user sees the extracted content immediately.
  const [expandedFactIds, setExpandedFactIds] = useState<Set<string>>(new Set());
  const [draftSizeWarning, setDraftSizeWarning] = useState(false);
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);
  const [streamPhase, setStreamPhase] = useState<'idle' | 'streaming' | 'stalled'>('idle');
  const [presetId, setPresetId] = useState<string>(() => loadSessionPreset().presetId);
  const [presetOverrides, setPresetOverrides] = useState<Partial<PresetAxes>>(
    () => loadSessionPreset().overrides,
  );
  const [showPresetEditor, setShowPresetEditor] = useState(false);
  const [activeRefinementId, setActiveRefinementId] = useState<string | null>(null);
  // SKY-20: routing state — list of pending prompts plus the folder catalog
  // pulled from the Notes Vault. Both are populated lazily on first need.
  const [routingPrompts, setRoutingPrompts] = useState<RoutingPrompt[]>([]);
  const [notesFolders, setNotesFolders] = useState<Array<{ path: string; label: string }>>([]);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Custom sort order: persisted list of fact IDs (empty = not yet initialized)
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  // Drag-and-drop ephemeral state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropBelow, setDropBelow] = useState(false);
  // Tracks the id of a brand-new idea created via Ctrl+N that hasn't been saved yet
  const [pendingNewIdeaId, setPendingNewIdeaId] = useState<string | null>(null);
  // SKY-1393: scene picker — id of the idea waiting for a scene selection
  const [scenePickerIdeaId, setScenePickerIdeaId] = useState<string | null>(null);
  // Tracks which element opened the detail drawer so focus can be restored on close
  const triggerElementRef = useRef<HTMLElement | null>(null);

  // SKY-196: vault context surfaced in the "Context used" panel
  const [contextResult, setContextResult] = useState<ContextResult | null>(null);
  const [contextOpen, setContextOpen] = useState(false);

  const streamIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef<string>('');
  const cleanupStreamRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  // Refs for drag state values needed inside closures without stale captures
  const dragSourceIdRef = useRef<string | null>(null);
  const dropBelowRef = useRef(false);
  const lastTokenAtRef = useRef<number>(0);
  const lastApiMessagesRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  // Holds the system prompt augmented with vault context for the current/last request.
  const contextSystemRef = useRef<string>(BRAINSTORM_SYSTEM_PROMPT);
  // SKY-1485: mirror proposals state for use in async callbacks without stale closure
  const proposalsRef = useRef<NoteProposal[]>([]);
  // Tracks when each proposal first appeared so confirm/reject can report timeToDecideMs
  const proposalAppearAt = useRef<Map<string, number>>(new Map());
  const { announce, liveText } = useLiveAnnounce();
  const effectiveAxes = useMemo(
    () => getEffectiveAxes(presetId, presetOverrides),
    [presetId, presetOverrides],
  );

  const displayedFacts = useMemo(() => {
    const filtered = filterType === 'all' ? facts : facts.filter((f) => f.type === filterType);
    if (sortOrder === 'custom' && customOrder.length > 0) {
      const orderMap = new Map(customOrder.map((id, i) => [id, i]));
      return [...filtered].sort((a, b) => {
        const ai = orderMap.has(a.id) ? (orderMap.get(a.id) as number) : Infinity;
        const bi = orderMap.has(b.id) ? (orderMap.get(b.id) as number) : Infinity;
        return ai - bi;
      });
    }
    return sortFacts(filtered, sortOrder);
  }, [facts, sortOrder, filterType, customOrder]);

  const visibleTypes = useMemo(
    () => (filterType === 'all' ? FACT_TYPE_ORDER : ([filterType] as DetectedFact['type'][])),
    [filterType],
  );

  const toggleGroup = useCallback((type: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  const expandAllGroups = useCallback(() => setCollapsedGroups(new Set()), []);
  const collapseAllGroups = useCallback(
    () => setCollapsedGroups(new Set(visibleTypes)),
    [visibleTypes],
  );

  // Restore draft from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft: { v?: number; messages?: Message[]; facts?: DetectedFact[]; prompt?: string; sortMode?: string; customOrder?: string[] } = JSON.parse(raw);
        const draftMessages = Array.isArray(draft.messages)
          ? draft.messages.map((m) => ({ ...m, streaming: false }))
          : [];
        const draftFacts = Array.isArray(draft.facts) ? draft.facts : [];
        const draftPrompt = typeof draft.prompt === 'string' ? draft.prompt : '';

        if ((draft.v === 1 || draft.v === 2) && (draftMessages.length > 0 || draftFacts.length > 0 || draftPrompt.trim())) {
          setMessages(draftMessages);
          setFacts(draftFacts);
          setExpandedFactIds(new Set(draftFacts.map((f) => f.id)));
          setPrompt(draftPrompt);
          if (draft.sortMode === 'custom') {
            setSortOrder('custom');
            if (Array.isArray(draft.customOrder)) setCustomOrder(draft.customOrder);
          }
          setShowRecoveryBanner(true);
        }
      }
    } catch { /* ignore malformed draft */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist draft whenever prompt, messages, facts, sort mode, or custom order change.
  useEffect(() => {
    if (!prompt.trim() && messages.length === 0 && facts.length === 0) {
      localStorage.removeItem(DRAFT_KEY);
      setDraftSizeWarning(false);
      return;
    }
    const draft: BrainstormDraft = {
      v: 2,
      savedAt: new Date().toISOString(),
      prompt,
      messages: messages.map((m) => ({ ...m, streaming: false })),
      facts,
      ...(sortOrder === 'custom' ? { sortMode: 'custom', customOrder } : {}),
    };
    const serialized = JSON.stringify(draft);
    if (serialized.length > MAX_DRAFT_BYTES) {
      setDraftSizeWarning(true);
      return;
    }
    setDraftSizeWarning(false);
    try {
      localStorage.setItem(DRAFT_KEY, serialized);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        showToast('Order not saved — storage full.');
      }
    }
  // showToast is stable (no deps) — including it satisfies exhaustive-deps without churn
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, messages, facts, sortOrder, customOrder]);

  // SKY-1485: keep proposalsRef in sync so async confirm/reject callbacks read latest state
  useEffect(() => {
    proposalsRef.current = proposals;
  }, [proposals]);

  // Warn before window close when there is an active session
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (messages.length > 0 || facts.length > 0 || prompt.trim()) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [messages.length, facts.length, prompt]);

  // ESC closes the page unless an overlay (drawer, delete confirm, preset editor, context
  // menu) is handling it. Overlays call e.stopPropagation() or we detect them by state.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Voice input active: the voice ESC handler (registered below after cancelVoice is
      // defined) intercepts this event in capture phase before this handler runs, so
      // we will never reach here while voice is active.
      // Drawer / confirm / preset editor handle ESC themselves
      if (detailDrawerIdeaId || showDeleteConfirm || showPresetEditor || pendingNewIdeaId) return;
      // Context menus: focus is inside a [role="menu"] element
      const focused = document.activeElement;
      if (focused && (focused as HTMLElement).closest('[role="menu"]')) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose, detailDrawerIdeaId, showDeleteConfirm, showPresetEditor, pendingNewIdeaId]);

  useEffect(() => {
    const el = messagesEndRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    const unsub = window.api.onSttResult?.((text: string) => {
      setPrompt((prev) => (prev ? `${prev} ${text}` : text));
      setVoiceState('idle');
    });
    return () => { unsub?.(); };
  }, [setVoiceState]);

  useEffect(() => {
    const unsub = window.api.onVaultNotesUpdated?.((data: { count: number }) => {
      const msg = `Vault notes updated (${data.count} note${data.count !== 1 ? 's' : ''})`;
      showToast(msg);
    });
    return () => { unsub?.(); };
  }, [showToast]);

  useEffect(() => {
    return () => {
      cleanupStreamRef.current?.();
      if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
      const rec = recognitionRef.current;
      if (rec) try { rec.abort(); } catch { /* non-fatal */ }
    };
  }, []);

  // Stall detection: 20 s no-token → warn; 90 s → hard abort
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      const sinceLastToken = Date.now() - lastTokenAtRef.current;
      if (sinceLastToken >= HARD_TIMEOUT_MS) {
        const sid = streamIdRef.current;
        if (sid) void window.api.streamCancel(sid);
        cleanupStreamRef.current?.();
        setMessages((prev) => prev.slice(0, -1));
        setError('Generation timed out after 90 seconds. Check your connection and try again.');
        setLoading(false);
        setStreamPhase('idle');
        announce('Generation timed out.');
      } else if (sinceLastToken >= STALL_TIMEOUT_MS) {
        setStreamPhase((prev) => (prev === 'streaming' ? 'stalled' : prev));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [loading, announce]);

  const cancelStream = useCallback(() => {
    const sid = streamIdRef.current;
    if (!sid) return;
    void window.api.streamCancel(sid);
    cleanupStreamRef.current?.();
    setMessages((prev) => prev.slice(0, -1));
    setLoading(false);
    setStreamPhase('idle');
    showToast('Generation cancelled');
  }, [showToast]);

  const handleNewSession = useCallback(() => {
    if (streamIdRef.current) {
      void window.api.streamCancel(streamIdRef.current);
    }
    cleanupStreamRef.current?.();
    setMessages([]);
    setFacts([]);
    setExpandedFactIds(new Set());
    setPrompt('');
    setError(null);
    setLoading(false);
    setDraftSizeWarning(false);
    setShowRecoveryBanner(false);
    setRoutingPrompts([]);
    setContextResult(null);
    setContextOpen(false);
    setCustomOrder([]);
    setSortOrder('newest');
    setDraggingId(null);
    setDragOverId(null);
    dragSourceIdRef.current = null;
    contextSystemRef.current = BRAINSTORM_SYSTEM_PROMPT;
    localStorage.removeItem(DRAFT_KEY);
  }, []);

  const handleDownload = useCallback(() => {
    const lines: string[] = ['# Brainstorm Session\n'];
    for (const msg of messages) {
      lines.push(`## ${msg.role === 'user' ? 'You' : 'Assistant'}`);
      lines.push(msg.text);
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainstorm-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  // Ref holds the latest persistFactWithRouting to avoid a forward-reference
  // circular dep between _runStream and persistFactWithRouting.
  const persistFactWithRoutingRef = useRef<((fact: DetectedFact) => Promise<void>) | null>(null);

  const _runStream = useCallback(async (apiMessages: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    lastApiMessagesRef.current = apiMessages;
    streamingTextRef.current = '';
    lastTokenAtRef.current = Date.now();
    setStreamPhase('streaming');

    const unsubToken = window.api.onStreamToken(({ streamId: sid, token }) => {
      if (sid !== streamIdRef.current) return;
      lastTokenAtRef.current = Date.now();
      setStreamPhase((prev) => (prev === 'stalled' ? 'streaming' : prev));
      streamingTextRef.current += token;
      const currentText = streamingTextRef.current;
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          updated[updated.length - 1] = { ...last, text: currentText };
        }
        return updated;
      });
      window.api.streamAck(sid, 1);
    });

    const unsubEnd = window.api.onStreamEnd(({ streamId: sid }) => {
      if (sid !== streamIdRef.current) return;
      const fullText = streamingTextRef.current;
      const extracted = extractFacts(fullText);
      cleanupStreamRef.current?.();
      setStreamPhase('idle');

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            text: stripFactTags(fullText) || fullText,
            streaming: false,
          };
        }
        return updated;
      });

      if (extracted.length > 0) {
        const nowMs = Date.now();
        const newFacts: DetectedFact[] = extracted.map((f, i) => ({
          ...f,
          id: `fact-${nowMs}-${Math.random().toString(36).slice(2)}`,
          savedStatus: 'saving' as const,
          createdAt: nowMs + i,
        }));
        setFacts((prev) => [...prev, ...newFacts]);
        setExpandedFactIds((prev) => {
          const next = new Set(prev);
          for (const f of newFacts) next.add(f.id);
          return next;
        });
        for (const fact of newFacts) {
          void persistFactWithRoutingRef.current?.(fact);
        }
      }

      // SKY-1485: fire-and-forget LLM proposal extraction; push event delivers results
      if (typeof window.api.brainstormExtractProposals === 'function') {
        void window.api.brainstormExtractProposals({ turnText: fullText, turnId: sid });
      }

      const factCount = extracted.length;
      announce(
        factCount > 0
          ? `Response ready. ${factCount} fact${factCount !== 1 ? 's' : ''} detected.`
          : 'Response ready.',
      );
      setLoading(false);
    });

    const unsubError = window.api.onStreamError(({ streamId: sid, error }) => {
      if (sid !== streamIdRef.current) return;
      cleanupStreamRef.current?.();
      setMessages((prev) => prev.slice(0, -1));
      const msg = error || 'AI unavailable — check your API key in settings.';
      setError(msg);
      announce(`Error: ${msg}`);
      setLoading(false);
      setStreamPhase('idle');
    });

    cleanupStreamRef.current = () => {
      unsubToken();
      unsubEnd();
      unsubError();
      streamIdRef.current = null;
      streamingTextRef.current = '';
      cleanupStreamRef.current = null;
    };

    try {
      const { streamId: sid } = await window.api.streamStart({
        messages: apiMessages,
        system: contextSystemRef.current,
      });
      streamIdRef.current = sid;
    } catch (err) {
      cleanupStreamRef.current?.();
      setMessages((prev) => prev.slice(0, -1));
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'AI unavailable — check your API key in settings.');
      announce(`Error: ${msg}`);
      setLoading(false);
      setStreamPhase('idle');
    }
  }, [announce]);

  const retryFromStalled = useCallback(async () => {
    const sid = streamIdRef.current;
    if (sid) void window.api.streamCancel(sid);
    cleanupStreamRef.current?.();
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = { ...last, text: '', streaming: true };
      }
      return updated;
    });
    announce('Retrying…');
    await _runStream(lastApiMessagesRef.current);
  }, [announce, _runStream]);

  const send = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    onFirstSubmit?.();
    setLoading(true);
    setError(null);
    setPrompt('');
    announce('Generating response…');

    const userMsg: Message = { role: 'user', text: trimmed };
    const assistantMsg: Message = { role: 'assistant', text: '', streaming: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const apiMessages = [...messages, userMsg].map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.text,
    }));

    // SKY-196: fetch vault context before streaming so relevant entities are
    // visible to Claude. Non-critical — proceed without context on any error.
    const presetGuide = buildPresetContext(effectiveAxes);
    let systemPrompt = presetGuide + '\n\n' + BRAINSTORM_SYSTEM_PROMPT;
    try {
      const convText = messages.map((m) => m.text).join('\n');
      const ctx = await window.api.brainstormSelectContext?.({
        userMessage: trimmed,
        conversationText: convText,
      });
      if (ctx) {
        setContextResult(ctx);
        if (ctx.included.length > 0) {
          // Preserve preset context alongside vault context
          systemPrompt = presetGuide + '\n\n' + BRAINSTORM_SYSTEM_PROMPT + buildContextBlock(ctx.included);
        }
      }
    } catch { /* vault context is non-critical */ }
    contextSystemRef.current = systemPrompt;

    await _runStream(apiMessages);
  }, [prompt, loading, messages, announce, _runStream, effectiveAxes, onFirstSubmit]);

  const handleRefine = useCallback((chip: RefinementChip) => {
    if (loading) return;
    const adjusted = chip.adjustAxes(effectiveAxes);
    const newOverrides = { ...presetOverrides, ...adjusted };
    setPresetOverrides(newOverrides);
    saveSessionPreset(presetId, newOverrides);
    setActiveRefinementId(chip.id);

    const refinementText = `Please rewrite your previous response with a ${chip.description} style.`;
    const userMsg: Message = { role: 'user', text: refinementText };
    const assistantMsg: Message = { role: 'assistant', text: '', streaming: true };
    setLoading(true);
    setError(null);
    announce('Refining…');

    const presetGuide = buildPresetContext({ ...effectiveAxes, ...adjusted });
    contextSystemRef.current = presetGuide + '\n\n' + BRAINSTORM_SYSTEM_PROMPT;

    const apiMessages = [...messages, userMsg].map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.text,
    }));
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    void _runStream(apiMessages);
  }, [announce, effectiveAxes, loading, messages, presetId, presetOverrides, _runStream]);

  useEffect(() => {
    if (!loading) setActiveRefinementId(null);
  }, [loading]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    setSilenceSecondsLeft(null);
  }, []);

  const commitTranscript = useCallback(() => {
    const text = confirmedTextRef.current.trim();
    if (text) {
      setPrompt((prev) => (prev ? `${prev} ${text}` : text));
      announce(`Transcribed: ${text}`);
    }
    confirmedTextRef.current = '';
    setVoiceTranscript({ confirmed: '', interim: '' });
  }, [announce]);

  const stopRecognition = useCallback((mode: 'cancel' | 'commit') => {
    clearSilenceTimer();
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) try { rec.abort(); } catch { /* non-fatal */ }
    if (mode === 'cancel') {
      confirmedTextRef.current = '';
      setVoiceTranscript({ confirmed: '', interim: '' });
    }
  }, [clearSilenceTimer]);

  const startVoice = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      window.api.sttStart?.();
      setVoiceState('listening');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new Ctor() as any;
    recognitionRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => {
      setVoiceState('listening');
      silenceStartRef.current = Date.now();
      silenceTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - silenceStartRef.current) / 1000;
        const left = Math.max(0, 3 - elapsed);
        setSilenceSecondsLeft(left);
        if (elapsed >= 3) {
          clearSilenceTimer();
          const r = recognitionRef.current;
          recognitionRef.current = null;
          if (r) try { r.abort(); } catch { /* non-fatal */ }
          setVoiceState('processing');
          setTimeout(() => {
            commitTranscript();
            setVoiceState('idle');
          }, 400);
        }
      }, 100);
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      silenceStartRef.current = Date.now();
      let confirmed = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) confirmed += t;
        else interim += t;
      }
      if (confirmed) {
        confirmedTextRef.current += confirmed;
        setVoiceTranscript((prev) => ({ confirmed: prev.confirmed + confirmed, interim }));
      } else {
        setVoiceTranscript((prev) => ({ confirmed: prev.confirmed, interim }));
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      clearSilenceTimer();
      recognitionRef.current = null;
      setVoiceState('error');
      setAlertText(`Voice error: ${event.error}`);
    };

    rec.onend = () => {
      if (voiceStateRef.current === 'listening') {
        clearSilenceTimer();
        recognitionRef.current = null;
        setVoiceState('idle');
      }
    };

    try { rec.start(); } catch { setVoiceState('error'); }
  }, [setVoiceState, clearSilenceTimer, commitTranscript]);

  const cancelVoice = useCallback(() => {
    stopRecognition('cancel');
    window.api.sttStop?.();
    setVoiceState('idle');
    announce('Voice input cancelled.');
    setAlertText('Voice input cancelled.');
  }, [stopRecognition, setVoiceState, announce]);

  const handleMicToggle = useCallback(() => {
    const state = voiceStateRef.current;
    if (state === 'idle') startVoice();
    else if (state === 'listening') cancelVoice();
    else if (state === 'error') setVoiceState('idle');
    // processing: ignore
  }, [startVoice, cancelVoice, setVoiceState]);

  // Voice Escape: registered on window in capture phase so it fires before the
  // page-close ESC handler (which uses document capture). When voice is active,
  // cancel it and swallow the event so the page does not close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && voiceStateRef.current !== 'idle') {
        e.stopPropagation();
        cancelVoice();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [cancelVoice]);

  // SKY-20: load the Notes Vault folder catalog the first time we need it for
  // a routing prompt. Cached for the session so the picker is instant on the
  // 2nd…Nth prompt. Listing is a cheap fs.readdir walk, depth-capped at 3.
  const ensureNotesFolders = useCallback(async () => {
    if (notesFolders.length > 0) return notesFolders;
    try {
      const { folders } = await window.api.brainstormListNotesFolders();
      setNotesFolders(folders);
      return folders;
    } catch {
      return [];
    }
  }, [notesFolders]);

  // SKY-20: per-fact persistence with layoutMode-aware routing. Default-mode
  // vaults land in the seeded category folder immediately. Blank-mode vaults
  // either reuse a remembered destination (silent) or stage the file and
  // surface a routing prompt for the user to pick a destination.
  const persistFactWithRouting = useCallback(
    async (fact: DetectedFact) => {
      try {
        const result = await window.api.brainstormWriteNote({
          category: fact.type,
          name: fact.name,
          content: fact.content,
        });
        if (result.status === 'written') {
          setFacts((prev) =>
            prev.map((f) => (
              f.id === fact.id
                ? { ...f, savedStatus: 'saved', savedPath: result.path, updatedAt: new Date().toISOString() }
                : f
            )),
          );
          return;
        }
        // status === 'needs_routing' — main staged the file; we ask the user.
        await ensureNotesFolders();
        setFacts((prev) =>
          prev.map((f) => (f.id === fact.id ? { ...f, savedStatus: 'needs_routing' } : f)),
        );
        setRoutingPrompts((prev) => [
          ...prev,
          {
            factId: fact.id,
            stagedPath: result.stagedPath,
            category: result.category,
            name: result.name,
            destination: '',
            customFolder: '',
          },
        ]);
        announce(`Where should ${result.category}s like "${result.name}" be saved?`);
      } catch {
        setFacts((prev) =>
          prev.map((f) => (f.id === fact.id ? { ...f, savedStatus: 'error' } : f)),
        );
      }
    },
    [announce, ensureNotesFolders],
  );
  persistFactWithRoutingRef.current = persistFactWithRouting;

  // SKY-20: commit the user's pick — main moves the staged file and (when
  // `remember` is true) persists the choice as the new default for this
  // category in the session and on disk.
  const resolveRoutingPrompt = useCallback(
    async (factId: string, remember: boolean) => {
      const prompt = routingPrompts.find((p) => p.factId === factId);
      if (!prompt) return;
      // Block when neither the select nor the custom-folder input has been touched.
      // VAULT_ROOT_SENTINEL in destination means the user explicitly chose vault root;
      // translate that sentinel to '' (empty path) before passing it to the API.
      if (prompt.destination === '' && prompt.customFolder.trim() === '') {
        return;
      }
      const chosen = prompt.customFolder.trim()
        ? prompt.customFolder.trim()
        : prompt.destination === VAULT_ROOT_SENTINEL ? '' : prompt.destination;
      setFacts((prev) =>
        prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'saving' } : f)),
      );
      try {
        const result = await window.api.brainstormResolveRouting({
          stagedPath: prompt.stagedPath,
          category: prompt.category,
          destination: chosen,
          remember,
        });
        setFacts((prev) =>
          prev.map((f) => (
            f.id === factId
              ? { ...f, savedStatus: 'saved', savedPath: result.path, updatedAt: new Date().toISOString() }
              : f
          )),
        );
        setRoutingPrompts((prev) => prev.filter((p) => p.factId !== factId));
        // Folder list may have grown if the user typed a new path — refresh.
        if (prompt.customFolder.trim()) setNotesFolders([]);
        announce(`Saved to ${chosen || 'vault root'}.`);
      } catch {
        setFacts((prev) =>
          prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'error' } : f)),
        );
      }
    },
    [routingPrompts, announce],
  );

  const updateRoutingPrompt = useCallback(
    (factId: string, updates: Partial<RoutingPrompt>) => {
      setRoutingPrompts((prev) =>
        prev.map((p) => (p.factId === factId ? { ...p, ...updates } : p)),
      );
    },
    [],
  );

  // Manual retry from the facts panel — re-runs the same routing-aware path.
  const saveFactToVault = useCallback(
    async (factId: string) => {
      const fact = facts.find((f) => f.id === factId);
      if (!fact) return;
      setFacts((prev) =>
        prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'saving' } : f)),
      );
      await persistFactWithRouting(fact);
    },
    [facts, persistFactWithRouting],
  );

  const handleChipClick = useCallback(async (chip: import('./components/BrainstormCard/IdeaCard').IdeaCardChip) => {
    if (chip.type === 'scene') {
      if (onNavigateToScene) {
        const found = await onNavigateToScene(chip.id);
        if (!found) showToast('Entity not found in vault');
      }
      return;
    }
    try {
      const { entities } = await window.api.entityList();
      const match = entities.find((e) => e.name.toLowerCase() === chip.name.toLowerCase());
      if (match && onNavigateToEntity) {
        onNavigateToEntity(match.id);
      } else {
        showToast('Entity not found in vault');
      }
    } catch {
      showToast('Entity not found in vault');
    }
  }, [onNavigateToEntity, onNavigateToScene, showToast]);

  const handleOpenInWritingPanel = useCallback(async (ideaId: string) => {
    const fact = facts.find((f) => f.id === ideaId);
    if (!fact) return;

    // Read manifest once — needed for scene title lookup and no-scenes guard.
    type SceneEntry = { id: string; title: string };
    type ManifestShape = { stories?: Array<{ chapters?: Array<{ scenes?: SceneEntry[] }> }> };
    let sceneMap: Map<string, string>;
    try {
      const manifest = (await window.api.readManifest()) as ManifestShape;
      sceneMap = new Map(
        (manifest.stories ?? []).flatMap((s) =>
          (s.chapters ?? []).flatMap((c) =>
            (c.scenes ?? []).map((sc): [string, string] => [sc.id, sc.title]),
          ),
        ),
      );
    } catch {
      showToast('No scenes found. Create a scene first.');
      return;
    }

    if (sceneMap.size === 0) {
      showToast('No scenes found. Create a scene first.');
      return;
    }

    // Fast-path: idea already linked to a scene — skip the picker.
    if (fact.linkedSceneId) {
      const sceneTitle = sceneMap.get(fact.linkedSceneId) ?? 'scene';
      try {
        const result = await window.api.sceneAppendBrainstormNote?.(fact.linkedSceneId, fact.content);
        if (result?.appended) {
          await onNavigateToScene?.(fact.linkedSceneId);
          showToast(`Opened in ${sceneTitle}.`);
        }
      } catch {
        showToast('Failed to open in writing panel.');
      }
      return;
    }

    setScenePickerIdeaId(ideaId);
  }, [facts, onNavigateToScene, showToast]);

  const handleScenePickerSelect = useCallback(async (sceneId: string, sceneTitle: string) => {
    const ideaId = scenePickerIdeaId;
    setScenePickerIdeaId(null);
    if (!ideaId) return;
    const fact = facts.find((f) => f.id === ideaId);
    if (!fact) return;

    try {
      await window.api.sceneAppendBrainstormNote?.(sceneId, fact.content);
      // Persist linkedSceneId so repeat "open in writing panel" uses the fast path.
      setFacts((prev) => prev.map((f) => f.id === ideaId ? { ...f, linkedSceneId: sceneId } : f));
      await onNavigateToScene?.(sceneId);
      showToast(`Opened in ${sceneTitle}.`);
    } catch {
      showToast('Failed to open in writing panel.');
    }
  }, [scenePickerIdeaId, facts, onNavigateToScene, setFacts, showToast]);

  const handleIdeaMenuAction = useCallback((ideaId: string, action: string) => {
    const fact = facts.find((f) => f.id === ideaId);
    if (!fact) return;
    if (action === 'edit') {
      setDetailDrawerIdeaId(ideaId);
      announce('Idea detail drawer opened.');
    } else if (action === 'delete') {
      setPendingDeleteIds([ideaId]);
      setShowDeleteConfirm(true);
    } else if (action === 'copy-markdown') {
      const md = `# ${fact.name}\n\n${fact.content}`;
      void navigator.clipboard.writeText(md).then(() => showToast('Copied to clipboard'));
    } else if (action === 'copy-vault-path' && fact.savedPath) {
      void navigator.clipboard.writeText(fact.savedPath).then(() => showToast('Copied to clipboard'));
    } else if (action === 'open-in-writing-panel') {
      void handleOpenInWritingPanel(ideaId);
    }
    // link-entity + add-to-scene deferred to v2
  }, [facts, announce, showToast, handleOpenInWritingPanel]);

  const handleProposalConfirm = useCallback(async (proposal: NoteProposal) => {
    setProposals((prev) => prev.filter((p) => p.id !== proposal.id));
    const appearedAt = proposalAppearAt.current.get(proposal.id) ?? Date.now();
    const timeToDecideMs = Date.now() - appearedAt;
    proposalAppearAt.current.delete(proposal.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    try {
      if (typeof api?.brainstormProposalConfirm === 'function') {
        await api.brainstormProposalConfirm({
          proposalId: proposal.id,
          kind: proposal.kind,
          extractionConfidence: proposal.extractionConfidence,
          timeToDecideMs,
          decision: proposal.status === 'edited_and_confirmed' ? 'edit_and_confirm' : 'confirm',
        });
      }
      // SKY-1764/SKY-2306: scene_crafter_card proposals go directly onto the active
      // Scene Crafter board rather than to the notes vault.
      if (proposal.kind === 'scene_crafter_card') {
        if (activeStorySlug && typeof api?.sceneCrafterAddCard === 'function') {
          await api.sceneCrafterAddCard({
            storySlug: activeStorySlug,
            laneIndex: 0,
            card: { wikilink: proposal.title, title: proposal.title, done: false },
          });
        }
      } else if (typeof api?.brainstormWriteNote === 'function') {
        await api.brainstormWriteNote({
          category: proposal.kind,
          name: proposal.title,
          content: proposal.body,
        });
      }
    } catch { /* non-fatal — proposal removed from queue regardless */ }
  }, [activeStorySlug]);

  const handleProposalReject = useCallback((proposalId: string) => {
    setProposals((prev) => prev.filter((p) => p.id !== proposalId));
    const full = proposalsRef.current.find((p) => p.id === proposalId);
    const appearedAt = proposalAppearAt.current.get(proposalId) ?? Date.now();
    proposalAppearAt.current.delete(proposalId);
    if (!full) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    if (typeof api?.brainstormProposalReject === 'function') {
      void api.brainstormProposalReject({
        proposalId,
        title: full.title,
        kind: full.kind,
        extractionConfidence: full.extractionConfidence,
        timeToDecideMs: Date.now() - appearedAt,
      });
    }
  }, []);

  const handleProposalDismissAll = useCallback(() => {
    const current = proposalsRef.current;
    setProposals([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    if (typeof api?.brainstormProposalReject === 'function') {
      const now = Date.now();
      for (const p of current) {
        const appearedAt = proposalAppearAt.current.get(p.id) ?? now;
        proposalAppearAt.current.delete(p.id);
        void api.brainstormProposalReject({
          proposalId: p.id,
          title: p.title,
          kind: p.kind,
          extractionConfidence: p.extractionConfidence,
          timeToDecideMs: now - appearedAt,
        });
      }
    }
  }, []);

  const handleBrowseFolder = useCallback(async (): Promise<string | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    if (typeof api?.chooseVaultFolder !== 'function') return null;
    const result = await api.chooseVaultFolder('Choose destination folder') as { path: string | null; cancelled: boolean };
    return result.path;
  }, []);

  const handleBulkDelete = useCallback(() => {
    setPendingDeleteIds([...selectedIds]);
    setShowDeleteConfirm(true);
  }, [selectedIds]);

  const confirmDelete = useCallback(() => {
    const toDelete = new Set(pendingDeleteIds);
    setFacts((prev) => prev.filter((f) => !toDelete.has(f.id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      toDelete.forEach((id) => next.delete(id));
      return next;
    });
    setShowDeleteConfirm(false);
    setPendingDeleteIds([]);
    if (pendingDeleteIds.length > 1) setIsMultiSelectMode(false);
  }, [pendingDeleteIds]);

  const handleToggleSelect = useCallback((ideaId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ideaId)) {
        next.delete(ideaId);
      } else {
        next.add(ideaId);
      }
      return next;
    });
  }, []);

  const toggleMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const createNewIdea = useCallback(() => {
    const id = `idea-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newFact: DetectedFact = { id, type: 'note', name: 'New idea', content: '', savedStatus: 'unsaved', createdAt: Date.now() };
    triggerElementRef.current = document.activeElement as HTMLElement;
    setFacts((prev) => [...prev, newFact]);
    setDetailDrawerIdeaId(id);
    setPendingNewIdeaId(id);
    announce('New idea — edit details in the drawer.');
  }, [announce]);

  const handleDeleteFocused = useCallback(() => {
    const focused = document.activeElement;
    if (!focused) return;
    const card = (focused as HTMLElement).closest('[data-testid^="idea-card-"]');
    if (!card) return;
    const testId = card.getAttribute('data-testid');
    const ideaId = testId?.replace('idea-card-', '');
    if (ideaId && facts.some((f) => f.id === ideaId)) {
      setPendingDeleteIds([ideaId]);
      setShowDeleteConfirm(true);
    }
  }, [facts]);

  const handleDetailDrawerClose = useCallback(() => {
    if (pendingNewIdeaId) {
      setFacts((prev) => prev.filter((f) => f.id !== pendingNewIdeaId));
      setPendingNewIdeaId(null);
    }
    setDetailDrawerIdeaId(null);
    const el = triggerElementRef.current;
    triggerElementRef.current = null;
    // Restore focus to the card that opened the drawer
    setTimeout(() => el?.focus(), 0);
  }, [pendingNewIdeaId]);

  // Move focused card one position up/down in custom order (Alt+Up / Alt+Down)
  const moveFact = useCallback((id: string, direction: 'up' | 'down') => {
    setCustomOrder((prev) => {
      if (prev.length === 0) return prev;
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  }, []);

  // Keyboard shortcuts: Ctrl/Cmd+N (new idea), Ctrl/Cmd+D (delete focused),
  // Ctrl/Cmd+Shift+A (toggle multi-select), Escape (exit multi-select),
  // Alt+Up / Alt+Down (reorder in custom sort mode)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT';

      // Alt+Up / Alt+Down: move focused card in custom sort mode
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && sortOrder === 'custom' && !isMultiSelectMode && !loading && !inInput) {
        e.preventDefault();
        const card = (document.activeElement as HTMLElement)?.closest('[data-testid^="idea-card-"]');
        const ideaId = card?.getAttribute('data-testid')?.replace('idea-card-', '');
        if (ideaId) moveFact(ideaId, e.key === 'ArrowUp' ? 'up' : 'down');
        return;
      }

      if (meta && !e.shiftKey && e.key === 'n' && !inInput) {
        e.preventDefault();
        createNewIdea();
        return;
      }
      if (meta && !e.shiftKey && e.key === 'd' && !inInput) {
        e.preventDefault();
        handleDeleteFocused();
        return;
      }
      if (meta && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        toggleMultiSelectMode();
      } else if (e.key === 'Escape' && isMultiSelectMode && !showDeleteConfirm) {
        setIsMultiSelectMode(false);
        setSelectedIds(new Set());
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isMultiSelectMode, showDeleteConfirm, sortOrder, loading, toggleMultiSelectMode, createNewIdea, handleDeleteFocused, moveFact]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).api;
        if (typeof api?.suggestionsList === 'function') {
          const result = await api.suggestionsList(undefined, 'archive');
          if (cancelled) return;
          const rows: Record<string, unknown>[] = result?.suggestions ?? [];
          setContinuityIssues(parseContinuityIssues(rows));
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // SKY-1485: load pending brainstorm proposals from DB on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).api;
        if (typeof api?.suggestionsList === 'function') {
          const result = await api.suggestionsList('proposed', 'brainstorm');
          if (cancelled) return;
          const rows: unknown[] = result?.suggestions ?? [];
          const now = Date.now();
          const loaded: NoteProposal[] = rows
            .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
            .flatMap((r) => {
              try {
                const payload = typeof r.payload_json === 'string'
                  ? (JSON.parse(r.payload_json) as Record<string, unknown>)
                  : {};
                const k = payload.kind as string;
                const kind: NoteProposalKind = ['character', 'location', 'item', 'faction', 'scene_card', 'inbox'].includes(k)
                  ? (k as NoteProposalKind) : 'inbox';
                const title = typeof payload.title === 'string' ? payload.title : '';
                if (!title) return [];
                const id = typeof r.id === 'string' ? r.id : String(r.id);
                proposalAppearAt.current.set(id, now);
                return [{
                  id,
                  kind,
                  title,
                  body: typeof payload.body === 'string' ? payload.body : '',
                  destinationPath: typeof r.target === 'string' ? r.target : '',
                  frontmatter: {},
                  sourceConversationTurnId: '',
                  extractionConfidence: typeof r.confidence === 'number' ? r.confidence : 0.8,
                  status: 'pending' as const,
                }];
              } catch { return []; }
            });
          setProposals(loaded);
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // SKY-1485: subscribe to push events from brainstorm:extractProposals
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    if (typeof api?.onBrainstormProposalQueued !== 'function') return;
    const unsub: () => void = api.onBrainstormProposalQueued((data: { proposals: unknown[] }) => {
      const now = Date.now();
      const incoming: NoteProposal[] = (data.proposals ?? [])
        .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
        .flatMap((r) => {
          const k = r.kind as string;
          const kind: NoteProposalKind = ['character', 'location', 'item', 'faction', 'scene_card', 'inbox'].includes(k)
            ? (k as NoteProposalKind) : 'inbox';
          const title = typeof r.title === 'string' ? r.title : '';
          if (!title) return [];
          const id = typeof r.id === 'string' ? r.id : String(r.id);
          return [{
            id,
            kind,
            title,
            body: typeof r.body === 'string' ? r.body : '',
            destinationPath: typeof r.destinationPath === 'string' ? r.destinationPath : '',
            frontmatter: (r.frontmatter && typeof r.frontmatter === 'object'
              ? r.frontmatter : {}) as Record<string, unknown>,
            sourceConversationTurnId: typeof r.sourceConversationTurnId === 'string'
              ? r.sourceConversationTurnId : '',
            extractionConfidence: typeof r.extractionConfidence === 'number'
              ? r.extractionConfidence : 0.8,
            status: 'pending' as const,
          }];
        });
      if (incoming.length === 0) return;
      setProposals((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const fresh = incoming.filter((p) => !existingIds.has(p.id));
        if (fresh.length === 0) return prev;
        for (const p of fresh) proposalAppearAt.current.set(p.id, now);
        return [...prev, ...fresh];
      });
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitContinuityAnswer = useCallback(async (issueId: string) => {
    const issue = continuityIssues.find((i) => i.id === issueId);
    if (!issue) return;
    const draft = answerDrafts[issueId] ?? { kind: 'free-text' as AnswerKind, text: '' };
    const kindLabel: Record<AnswerKind, string> = {
      'fix-note': 'Fix note',
      'suggest-change': 'Suggest story change',
      'free-text': 'Note',
    };
    const msgText = [
      `[Continuity issue] ${issue.description}`,
      draft.text ? `${kindLabel[draft.kind]}: ${draft.text}` : `${kindLabel[draft.kind]}`,
    ].join('\n');

    setContinuityIssues((prev) =>
      prev.map((i) => (i.id === issueId ? { ...i, resolved: true } : i)),
    );
    setExpandedIssueId(null);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).api;
      if (typeof api?.suggestionsAccept === 'function') {
        await api.suggestionsAccept(issueId);
      }
    } catch { /* optimistic already applied */ }

    setPrompt(msgText);
  }, [continuityIssues, answerDrafts]);

  const toggleFactExpanded = useCallback((id: string) => {
    setExpandedFactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setExpandedFactIds(new Set(facts.map((f) => f.id)));
  }, [facts]);

  const handleCollapseAll = useCallback(() => {
    setExpandedFactIds(new Set());
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, factId: string) => {
    dragSourceIdRef.current = factId;
    setDraggingId(factId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, factId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const below = e.clientY > rect.top + rect.height / 2;
    setDragOverId(factId);
    setDropBelow(below);
    dropBelowRef.current = below;
  }, []);

  const handleDragEnd = useCallback(() => {
    dragSourceIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    setDropBelow(false);
    dropBelowRef.current = false;
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = dragSourceIdRef.current;
    if (!sourceId || sourceId === targetId) {
      dragSourceIdRef.current = null;
      setDraggingId(null);
      setDragOverId(null);
      setDropBelow(false);
      return;
    }
    const below = dropBelowRef.current;
    setCustomOrder((prev) => {
      if (prev.length === 0) return prev;
      const fromIdx = prev.indexOf(sourceId);
      const toIdx = prev.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      next.splice(fromIdx, 1);
      // After removing fromIdx, toIdx shifts if fromIdx was before toIdx
      const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
      const insertAt = below ? adjustedTo + 1 : adjustedTo;
      next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, sourceId);
      return next;
    });
    dragSourceIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    setDropBelow(false);
    dropBelowRef.current = false;
  }, []);

  const toggleIssue = useCallback((id: string) => {
    setExpandedIssueId((prev) => (prev === id ? null : id));
  }, []);

  const openIdeaDetail = useCallback((ideaId: string) => {
    triggerElementRef.current = document.activeElement as HTMLElement;
    setDetailDrawerIdeaId(ideaId);
    announce('Idea detail drawer opened.');
  }, [announce]);

  const setDraftKind = useCallback((issueId: string, kind: AnswerKind) => {
    setAnswerDrafts((prev) => ({
      ...prev,
      [issueId]: { kind, text: prev[issueId]?.text ?? '' },
    }));
  }, []);

  const setDraftText = useCallback((issueId: string, text: string) => {
    setAnswerDrafts((prev) => ({
      ...prev,
      [issueId]: { kind: prev[issueId]?.kind ?? 'free-text', text },
    }));
  }, []);

  const detailIdea = detailDrawerIdeaId ? facts.find((fact) => fact.id === detailDrawerIdeaId) : null;

  const handleSaveIdea = useCallback((updated: import('./components/BrainstormCard/IdeaCard').IdeaCardIdea) => {
    setFacts((prev) =>
      prev.map((f) =>
        f.id === updated.id
          ? { ...f, name: updated.title, content: updated.title }
          : f,
      ),
    );
    setPendingNewIdeaId(null);
    setDetailDrawerIdeaId(null);
    const el = triggerElementRef.current;
    triggerElementRef.current = null;
    announce('Idea saved.');
    setTimeout(() => el?.focus(), 0);
  }, [announce]);

  if (!enabled) {
    return (
      <div className="brainstorm-page brainstorm-disabled">
        <div className="brainstorm-disabled-inner">
          <p className="brainstorm-disabled-msg">Brainstorm Agent is disabled. Enable it in Settings.</p>
          <button className="brainstorm-back-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="brainstorm-page">
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveText}
      </span>
      <span aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="voice-alert">
        {alertText}
      </span>

      <Toast message={toastState?.message ?? null} level={toastState?.level} />

      <div className="brainstorm-header">
        <button className="brainstorm-back-btn" onClick={onClose} aria-label="Close brainstorm">
          ← Back
        </button>
        <div className="brainstorm-header-text">
          <div className="brainstorm-title">Brainstorm Agent</div>
          <div className="brainstorm-subtitle">Talk through your story — facts auto-extract to your vault</div>
        </div>
        <div className="brainstorm-header-preset">
          <PresetSelector
            activePresetId={presetId}
            onSelect={(id) => { setPresetId(id); setPresetOverrides({}); saveSessionPreset(id, {}); }}
            onCustomize={() => setShowPresetEditor(true)}
            compact
          />
        </div>
        <div className="brainstorm-header-actions">
          {messages.length > 0 && (
            <button
              className="brainstorm-download-btn"
              onClick={handleDownload}
              aria-label="Download session as markdown"
              type="button"
              title="Download session as Markdown"
            >
              Download
            </button>
          )}
          <button
            className="brainstorm-new-session-btn"
            onClick={handleNewSession}
            aria-label="New session"
            type="button"
          >
            New Session
          </button>
        </div>
      </div>
      {showRecoveryBanner && (
        <div className="brainstorm-recovery-banner" role="status">
          <span>Recovered your previous brainstorm draft from this browser.</span>
          <button
            className="brainstorm-recovery-dismiss-btn"
            onClick={() => setShowRecoveryBanner(false)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}
      {draftSizeWarning && (
        <div className="brainstorm-draft-warning" role="status">
          Session too large to auto-save — download to preserve your work.
        </div>
      )}

      <div className="brainstorm-body">
        <div className="brainstorm-chat-col">
          <div className="brainstorm-messages">
            {messages.length === 0 && (
              <div className="brainstorm-empty">
                <svg className="brainstorm-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3L13.09 8.26L18 9L13.09 9.74L12 15L10.91 9.74L6 9L10.91 8.26L12 3Z"/>
                  <path d="M5 15.5L5.55 17.95L8 18.5L5.55 19.05L5 21.5L4.45 19.05L2 18.5L4.45 17.95L5 15.5Z"/>
                  <path d="M18 2L18.4 3.6L20 4L18.4 4.4L18 6L17.6 4.4L16 4L17.6 3.6L18 2Z"/>
                </svg>
                <span className="brainstorm-empty-headline">Ask about your story</span>
                <span className="brainstorm-empty-desc">Ask about characters, settings, or plot. Facts save automatically to your vault.</span>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`bs-message bs-message-${msg.role}`}>
                {msg.role === 'user' ? (
                  <div className="bs-user-bubble">{msg.text}</div>
                ) : (
                  <div className="bs-assistant-bubble">
                    <div className={`bs-assistant-text${msg.streaming ? ' bs-streaming' : ''}`}>
                      {msg.text}
                      {msg.streaming && <span className="bs-cursor" aria-hidden="true">▍</span>}
                    </div>
                    {!msg.streaming && i === messages.length - 1 && (
                      <RefinementChips
                        effectiveAxes={effectiveAxes}
                        onRefine={handleRefine}
                        disabled={loading}
                        activeChipId={activeRefinementId}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
            {routingPrompts.map((prompt) => (
              <div
                key={prompt.factId}
                className="bs-message bs-message-assistant bs-routing-prompt"
                role="group"
                aria-label={`Where to save ${CATEGORY_LABEL[prompt.category]}s`}
                data-testid={`brainstorm-routing-prompt-${prompt.category}`}
              >
                <div className="bs-assistant-bubble bs-routing-bubble">
                  <p className="bs-routing-question">
                    Where should I put <strong>{CATEGORY_LABEL[prompt.category]}</strong> notes
                    like <em>&ldquo;{prompt.name}&rdquo;</em>?
                  </p>
                  <label className="bs-routing-row">
                    <span className="bs-routing-label">Folder</span>
                    <select
                      className="bs-routing-select"
                      value={prompt.destination}
                      onChange={(e) =>
                        updateRoutingPrompt(prompt.factId, {
                          destination: e.target.value,
                          customFolder: '',
                        })
                      }
                      aria-label="Choose existing folder"
                      data-testid={`brainstorm-routing-select-${prompt.category}`}
                    >
                      <option value="" disabled>
                        Choose a folder…
                      </option>
                      <option value={VAULT_ROOT_SENTINEL}>/ (vault root)</option>
                      {notesFolders
                        .filter((f) => f.path !== '')
                        .map((f) => (
                          <option key={f.path} value={f.path}>
                            {f.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="bs-routing-row">
                    <span className="bs-routing-label">…or create</span>
                    <input
                      className="bs-routing-input"
                      type="text"
                      placeholder="e.g. Worldbuilding/People"
                      value={prompt.customFolder}
                      onChange={(e) =>
                        updateRoutingPrompt(prompt.factId, {
                          customFolder: e.target.value,
                          destination: e.target.value.trim() ? '' : prompt.destination,
                        })
                      }
                      aria-label="Create new folder"
                      data-testid={`brainstorm-routing-input-${prompt.category}`}
                    />
                  </label>
                  <div className="bs-routing-actions">
                    <button
                      className="bs-routing-save-btn"
                      type="button"
                      disabled={!prompt.destination && !prompt.customFolder.trim()}
                      onClick={() => void resolveRoutingPrompt(prompt.factId, true)}
                      data-testid={`brainstorm-routing-save-${prompt.category}`}
                    >
                      Save here & remember
                    </button>
                    <button
                      className="bs-routing-once-btn"
                      type="button"
                      disabled={!prompt.destination && !prompt.customFolder.trim()}
                      onClick={() => void resolveRoutingPrompt(prompt.factId, false)}
                    >
                      Just this once
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {error && (
            <div className="brainstorm-error" role="alert">{error}</div>
          )}

          {streamPhase === 'stalled' && loading && (
            <div className="bs-stalled-panel" role="status" aria-label="Generation stalled">
              <p className="bs-stalled-msg">
                This is taking longer than expected — the network or provider may be slow.
              </p>
              <div className="bs-stalled-actions">
                <button
                  className="bs-stalled-retry-btn"
                  onClick={() => void retryFromStalled()}
                  type="button"
                  aria-label="Retry generation"
                >
                  Retry
                </button>
                <button
                  className="bs-stalled-cancel-btn"
                  onClick={cancelStream}
                  type="button"
                  aria-label="Cancel generation"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div
            className={`voice-transcript-strip${voiceState === 'listening' || voiceState === 'processing' ? ' voice-transcript-strip--visible' : ''}`}
            aria-hidden="true"
            data-testid="voice-transcript-strip"
          >
            <div className="voice-transcript-strip-inner">
              {voiceTranscript.confirmed && <span className="voice-transcript-confirmed">{voiceTranscript.confirmed}</span>}
              {voiceTranscript.interim && <span className="voice-transcript-interim"> {voiceTranscript.interim}</span>}
              {voiceState === 'listening' && !voiceTranscript.confirmed && !voiceTranscript.interim && (
                <span className="voice-transcript-hint">Listening…</span>
              )}
            </div>
          </div>
          <div className="brainstorm-input-area">
            <div className="brainstorm-mic-container">
              <button
                className={`brainstorm-mic-btn brainstorm-mic-btn--${voiceState}${voiceState === 'listening' ? ' brainstorm-mic-btn-recording' : ''}`}
                onClick={handleMicToggle}
                aria-label={MIC_ARIA_LABELS[voiceState]}
                aria-pressed={voiceState !== 'idle'}
                type="button"
                disabled={voiceState === 'processing'}
                title={MIC_ARIA_LABELS[voiceState]}
                data-testid="brainstorm-mic-btn"
              >
                {MIC_ICONS[voiceState]}
              </button>
              {voiceState === 'listening' && silenceSecondsLeft !== null && (
                <>
                  <svg className="voice-countdown-ring" aria-hidden="true" width="38" height="38" viewBox="0 0 38 38">
                    <circle
                      cx="19" cy="19" r={COUNTDOWN_RING_R}
                      fill="none" stroke="var(--state-danger)"
                      strokeWidth="2.5"
                      strokeDasharray={COUNTDOWN_RING_C}
                      strokeDashoffset={COUNTDOWN_RING_C * (silenceSecondsLeft / 3)}
                      style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
                    />
                  </svg>
                  <span className="voice-countdown-text" aria-hidden="true">Sending soon…</span>
                </>
              )}
            </div>
            <div className="brainstorm-input-wrapper">
              <textarea
                className="brainstorm-input"
                value={prompt}
                onChange={(e) => {
                  const next = e.target.value.slice(0, PROMPT_MAX_CHARS);
                  setPrompt(next);
                }}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text');
                  const available = PROMPT_MAX_CHARS - prompt.length;
                  if (pasted.length > available) {
                    setPasteWarning(true);
                    setTimeout(() => setPasteWarning(false), 5000);
                  }
                }}
                onKeyDown={handleKey}
                placeholder="Ask about your story — characters, plot, world-building…"
                rows={3}
                maxLength={PROMPT_MAX_CHARS}
                disabled={loading}
                aria-label="Brainstorm prompt"
              />
              <span
                className={
                  'brainstorm-char-counter' +
                  (prompt.length >= PROMPT_MAX_CHARS
                    ? ' brainstorm-char-counter--error'
                    : prompt.length >= PROMPT_MAX_CHARS * 0.9
                      ? ' brainstorm-char-counter--warning'
                      : '')
                }
                aria-live="polite"
              >
                {prompt.length.toLocaleString()} / {PROMPT_MAX_CHARS.toLocaleString()}
              </span>
              {pasteWarning && (
                <div className="brainstorm-paste-warning" role="alert">
                  Pasted text exceeded {PROMPT_MAX_CHARS.toLocaleString()} chars and was
                  trimmed—please shorten or split your prompt.
                </div>
              )}
            </div>
            {loading ? (
              <button
                className="brainstorm-cancel-btn"
                onClick={cancelStream}
                aria-label="Cancel streaming"
                type="button"
              >
                Cancel
              </button>
            ) : (
              <button
                className="brainstorm-send-btn"
                onClick={() => void send()}
                disabled={!prompt.trim()}
                type="button"
              >
                Send
              </button>
            )}
          </div>
        </div>

        <div className="brainstorm-facts-col">
          {/* Continuity Issues section */}
          <div className="brainstorm-continuity-section">
            <div className="brainstorm-facts-header">
              <span className="brainstorm-facts-title">Continuity</span>
              {continuityIssues.filter((i) => !i.resolved).length > 0 && (
                <span className="brainstorm-facts-count bs-continuity-badge">
                  {continuityIssues.filter((i) => !i.resolved).length}
                </span>
              )}
            </div>
            <ul className="bs-continuity-list" aria-label="Continuity issues">
              {continuityIssues.length === 0 && (
                <li className="brainstorm-facts-empty bs-continuity-empty">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <span>No continuity issues.</span>
                </li>
              )}
              {continuityIssues.map((issue) => {
                const draft = answerDrafts[issue.id] ?? { kind: 'free-text' as AnswerKind, text: '' };
                const isExpanded = expandedIssueId === issue.id;
                return (
                  <li
                    key={issue.id}
                    className={`bs-cont-item${issue.resolved ? ' bs-cont-item-resolved' : ''}`}
                  >
                    <label className="bs-cont-row">
                      <input
                        type="checkbox"
                        className="bs-cont-checkbox"
                        checked={issue.resolved}
                        readOnly
                        aria-label={`Continuity issue: ${issue.description}`}
                      />
                      <button
                        className="bs-cont-label-btn"
                        onClick={() => !issue.resolved && toggleIssue(issue.id)}
                        disabled={issue.resolved}
                        type="button"
                      >
                        {issue.description}
                      </button>
                    </label>
                    {isExpanded && !issue.resolved && (
                      <div className="bs-cont-expand">
                        {issue.anchorText && (
                          <p className="bs-cont-anchor">Near: <em>&ldquo;{issue.anchorText}&rdquo;</em></p>
                        )}
                        <div className="bs-cont-answer-kinds">
                          {(['fix-note', 'suggest-change', 'free-text'] as AnswerKind[]).map((k) => (
                            <button
                              key={k}
                              type="button"
                              className={`bs-cont-kind-btn${draft.kind === k ? ' active' : ''}`}
                              onClick={() => setDraftKind(issue.id, k)}
                            >
                              {k === 'fix-note' ? 'Fix note' : k === 'suggest-change' ? 'Suggest change' : 'Free text'}
                            </button>
                          ))}
                        </div>
                        <textarea
                          className="bs-cont-textarea"
                          value={draft.text}
                          onChange={(e) => setDraftText(issue.id, e.target.value)}
                          placeholder="Describe your resolution…"
                          rows={3}
                          aria-label="Continuity resolution note"
                        />
                        <button
                          type="button"
                          className="bs-cont-submit-btn"
                          onClick={() => void submitContinuityAnswer(issue.id)}
                        >
                          Send to Chat
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* SKY-196: collapsible "Context used" panel */}
          {contextResult && (
            <div className="bs-context-section" data-testid="brainstorm-context-section">
              <button
                className="bs-context-header"
                onClick={() => setContextOpen((o) => !o)}
                aria-expanded={contextOpen}
                aria-controls="bs-context-body"
                type="button"
              >
                <span className="bs-context-title">Context sent</span>
                <span className="bs-context-counts">
                  {contextResult.included.length} item{contextResult.included.length !== 1 ? 's' : ''}
                  {contextResult.excluded.length > 0 && `, ${contextResult.excluded.length} excluded`}
                </span>
                <span className="bs-context-chevron" aria-hidden="true">{contextOpen ? '▲' : '▼'}</span>
              </button>
              {contextOpen && (
                <div id="bs-context-body" className="bs-context-body">
                  <div className="bs-context-budget">
                    {contextResult.usedTokens.toLocaleString()} / {contextResult.budgetTokens.toLocaleString()} tokens
                  </div>
                  {contextResult.included.length === 0 ? (
                    <div className="bs-context-empty">No vault items sent.</div>
                  ) : (
                    <ul className="bs-context-list" aria-label="Context items sent to AI">
                      {contextResult.included.map((item) => (
                        <li key={item.path} className="bs-context-item">
                          <span className="bs-context-item-name">{item.name}</span>
                          <span className={`bs-context-item-type bs-context-type-${item.type}`}>{item.type}</span>
                          <span className="bs-context-item-why">{item.whyIncluded}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {contextResult.excluded.length > 0 && (
                    <div className="bs-context-excluded">
                      {contextResult.excluded.length} item{contextResult.excluded.length !== 1 ? 's' : ''} excluded — token budget reached
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="brainstorm-facts-header brainstorm-facts-header-divider">
            <span className="brainstorm-facts-title">Detected Facts</span>
            {facts.length > 0 && (
              <span className="brainstorm-facts-count" data-testid="bs-facts-count">{facts.length}</span>
            )}
            {facts.length > 0 && (
              <button
                className={`bs-multiselect-toggle${isMultiSelectMode ? ' active' : ''}`}
                type="button"
                onClick={toggleMultiSelectMode}
                aria-pressed={isMultiSelectMode}
                data-testid="bs-multiselect-toggle"
              >
                {isMultiSelectMode ? 'Done selecting' : 'Select multiple'}
              </button>
            )}
            {facts.length > 0 && (
              <div className="bs-fact-header-actions">
                <button
                  className="bs-fact-all-btn"
                  type="button"
                  onClick={handleExpandAll}
                  aria-label="Expand all fact cards"
                >
                  Expand all
                </button>
                <span className="bs-fact-all-sep" aria-hidden="true">/</span>
                <button
                  className="bs-fact-all-btn"
                  type="button"
                  onClick={handleCollapseAll}
                  aria-label="Collapse all fact cards"
                >
                  Collapse all
                </button>
              </div>
            )}
          </div>
          {facts.length > 0 && (
            <div className="bs-facts-controls" data-testid="bs-facts-controls">
              <select
                className="bs-facts-select"
                value={sortOrder}
                onChange={(e) => {
                  const newSort = e.target.value as SortOrder;
                  setSortOrder(newSort);
                  if (newSort === 'custom') {
                    setCustomOrder((prev) => prev.length > 0 ? prev : displayedFacts.map((f) => f.id));
                  }
                }}
                aria-label="Sort ideas"
                data-testid="bs-sort-select"
              >
                {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
                  <option key={key} value={key}>{SORT_LABELS[key]}</option>
                ))}
              </select>
              <select
                className="bs-facts-select"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as FilterType)}
                aria-label="Filter by type"
                data-testid="bs-filter-select"
              >
                {(Object.keys(FILTER_LABELS) as FilterType[]).map((key) => (
                  <option key={key} value={key}>{FILTER_LABELS[key]}</option>
                ))}
              </select>
              {sortOrder !== 'custom' && (
                <>
                  <button
                    className="bs-expand-collapse-btn"
                    type="button"
                    onClick={expandAllGroups}
                    aria-label="Expand all groups"
                    data-testid="bs-expand-all"
                  >
                    ↕ Expand all
                  </button>
                  <button
                    className="bs-expand-collapse-btn"
                    type="button"
                    onClick={collapseAllGroups}
                    aria-label="Collapse all groups"
                    data-testid="bs-collapse-all"
                  >
                    ↕ Collapse all
                  </button>
                </>
              )}
            </div>
          )}
          {isMultiSelectMode && selectedIds.size > 0 && (
            <div className="bs-bulk-toolbar" role="toolbar" aria-label="Bulk actions">
              <span className="bs-bulk-count">{selectedIds.size} selected</span>
              <button
                className="bs-bulk-deselect-btn"
                type="button"
                onClick={() => setSelectedIds(new Set())}
              >
                Deselect all
              </button>
              <button
                className="bs-bulk-delete-btn"
                type="button"
                onClick={handleBulkDelete}
              >
                Delete
              </button>
            </div>
          )}
          {proposals.length > 0 ? (
            <ProposalCard
              proposals={proposals}
              onConfirm={handleProposalConfirm}
              onReject={handleProposalReject}
              onDismissAll={handleProposalDismissAll}
              onBrowseFolder={handleBrowseFolder}
            />
          ) : (
          <div className="brainstorm-facts-list">
            {facts.length === 0 ? (
              <div className="brainstorm-facts-empty">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                <span>No facts yet — mention character names or locations to build your vault.</span>
              </div>
            ) : sortOrder === 'custom' ? (
              /* Custom order: flat list with drag handles */
              <div
                role="list"
                aria-label="Brainstorm ideas (custom order)"
                onDragOver={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  const cards = Array.from(
                    e.currentTarget.querySelectorAll<HTMLElement>('[data-testid^="idea-card-"]'),
                  );
                  if (cards.length === 0) return;
                  const idx = cards.findIndex((c) => c === document.activeElement || c.contains(document.activeElement));
                  const next = e.key === 'ArrowDown'
                    ? Math.min(idx + 1, cards.length - 1)
                    : Math.max(idx - 1, 0);
                  if (next !== idx && next >= 0) {
                    e.preventDefault();
                    cards[next].focus();
                  }
                }}
              >
                {displayedFacts.map((fact) => {
                  const canDrag = !isMultiSelectMode && !loading;
                  return (
                    <Fragment key={fact.id}>
                      {dragOverId === fact.id && !dropBelow && (
                        <div className="bs-drop-indicator" role="separator" aria-hidden="true" />
                      )}
                      <IdeaCard
                        idea={{
                          id: fact.id,
                          title: fact.name,
                          type: fact.type,
                          linkedEntities: [
                            { id: `${fact.id}-entity`, name: fact.name, type: fact.type },
                          ],
                          savedPath: fact.savedPath,
                          updatedAt: fact.updatedAt,
                          savedLabel: fact.savedStatus === 'saved' ? 'Saved ✓' : undefined,
                        }}
                        body={fact.content || undefined}
                        isExpanded={expandedFactIds.has(fact.id)}
                        onToggleExpand={() => toggleFactExpanded(fact.id)}
                        showDragHandle={canDrag}
                        isDragging={draggingId === fact.id}
                        onDragStart={(e) => handleDragStart(e, fact.id)}
                        onDragOver={(e) => handleDragOver(e, fact.id)}
                        onDragEnd={handleDragEnd}
                        onDrop={(e) => handleDrop(e, fact.id)}
                        metaAction={
                          fact.savedStatus === 'saving' ? (
                            <span className="bs-fact-saving">Saving…</span>
                          ) : fact.savedStatus === 'saved' ? (
                            <span className="bs-fact-saved-label">Saved ✓</span>
                          ) : fact.savedStatus === 'pending_review' ? (
                            <span className="bs-fact-pending-review">Pending review →</span>
                          ) : fact.savedStatus === 'error' ? (
                            <span className="bs-fact-save-error">
                              Failed —{' '}
                              <button
                                className="bs-fact-retry-btn"
                                onClick={() => saveFactToVault(fact.id)}
                                type="button"
                              >
                                retry
                              </button>
                            </span>
                          ) : undefined
                        }
                        onOpenDetail={openIdeaDetail}
                        onChipClick={handleChipClick}
                        onMenuAction={handleIdeaMenuAction}
                        isMultiSelect={isMultiSelectMode}
                        isSelected={selectedIds.has(fact.id)}
                        onToggleSelect={handleToggleSelect}
                      />
                      {dragOverId === fact.id && dropBelow && (
                        <div className="bs-drop-indicator" role="separator" aria-hidden="true" />
                      )}
                    </Fragment>
                  );
                })}
              </div>
            ) : (
              /* Grouped view for all other sort orders */
              <div
                role="list"
                aria-label="Brainstorm ideas"
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  const cards = Array.from(
                    e.currentTarget.querySelectorAll<HTMLElement>('[data-testid^="idea-card-"]'),
                  );
                  if (cards.length === 0) return;
                  const idx = cards.findIndex((c) => c === document.activeElement || c.contains(document.activeElement));
                  const next = e.key === 'ArrowDown'
                    ? Math.min(idx + 1, cards.length - 1)
                    : Math.max(idx - 1, 0);
                  if (next !== idx && next >= 0) {
                    e.preventDefault();
                    cards[next].focus();
                  }
                }}
              >
              {visibleTypes.map((type) => {
                const group = displayedFacts.filter((f) => f.type === type);
                const isCollapsed = collapsedGroups.has(type);
                return (
                  <div key={type} className="bs-fact-group">
                    <button
                      className="bs-fact-group-header bs-fact-group-header-btn"
                      type="button"
                      onClick={() => toggleGroup(type)}
                      aria-expanded={!isCollapsed}
                      data-testid={`bs-group-toggle-${type}`}
                    >
                      <span>{FACT_TYPE_LABELS[type]}s</span>
                      <span className="bs-group-count">{group.length}</span>
                      <span className="bs-group-chevron">{isCollapsed ? '▶' : '▼'}</span>
                    </button>
                    {!isCollapsed && group.length === 0 && (
                      <div className="brainstorm-facts-empty brainstorm-facts-empty--type" data-testid={`bs-empty-type-${type}`}>
                        No {FILTER_LABELS[type].toLowerCase()} ideas yet
                      </div>
                    )}
                    {!isCollapsed && group.map((fact) => (
                      <IdeaCard
                        key={fact.id}
                        idea={{
                          id: fact.id,
                          title: fact.name,
                          type: fact.type,
                          linkedEntities: [
                            { id: `${fact.id}-entity`, name: fact.name, type: fact.type },
                          ],
                          savedPath: fact.savedPath,
                          updatedAt: fact.updatedAt,
                          savedLabel: fact.savedStatus === 'saved' ? 'Saved ✓' : undefined,
                        }}
                        body={fact.content || undefined}
                        isExpanded={expandedFactIds.has(fact.id)}
                        onToggleExpand={() => toggleFactExpanded(fact.id)}
                        metaAction={
                          fact.savedStatus === 'saving' ? (
                            <span className="bs-fact-saving">Saving…</span>
                          ) : fact.savedStatus === 'saved' ? (
                            <span className="bs-fact-saved-label">Saved ✓</span>
                          ) : fact.savedStatus === 'pending_review' ? (
                            <span className="bs-fact-pending-review">Pending review →</span>
                          ) : fact.savedStatus === 'error' ? (
                            <span className="bs-fact-save-error">
                              Failed —{' '}
                              <button
                                className="bs-fact-retry-btn"
                                onClick={() => saveFactToVault(fact.id)}
                                type="button"
                              >
                                retry
                              </button>
                            </span>
                          ) : undefined
                        }
                        onOpenDetail={openIdeaDetail}
                        onChipClick={handleChipClick}
                        onMenuAction={handleIdeaMenuAction}
                        isMultiSelect={isMultiSelectMode}
                        isSelected={selectedIds.has(fact.id)}
                        onToggleSelect={handleToggleSelect}
                      />
                    ))}
                  </div>
                );
              })}
              </div>
            )}
          </div>
          )}

          <EntriesQuickAdd />
        </div>
      </div>

      {showPresetEditor && (
        <PresetEditor
          activePresetId={presetId}
          overrides={presetOverrides}
          onApply={(overrides) => {
            setPresetOverrides(overrides);
            saveSessionPreset(presetId, overrides);
          }}
          onClose={() => setShowPresetEditor(false)}
        />
      )}

      {showDeleteConfirm && (
        <div
          className="bs-delete-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Delete idea"
          data-testid="bs-delete-confirm"
        >
          <div className="bs-delete-confirm-dialog">
            <p className="bs-delete-confirm-message">Delete idea?</p>
            <div className="bs-delete-confirm-actions">
              <button
                className="bs-delete-confirm-cancel"
                type="button"
                onClick={() => { setShowDeleteConfirm(false); setPendingDeleteIds([]); }}
              >
                Cancel
              </button>
              <button
                className="bs-delete-confirm-ok"
                type="button"
                onClick={confirmDelete}
                data-testid="bs-delete-confirm-ok"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {detailIdea && (
        <IdeaDetailDrawer
          idea={{
            id: detailIdea.id,
            title: detailIdea.content || detailIdea.name,
            type: detailIdea.type,
            linkedEntities: [{ id: `${detailIdea.id}-entity`, name: detailIdea.name, type: detailIdea.type }],
            savedPath: detailIdea.savedPath,
            updatedAt: detailIdea.updatedAt,
            savedLabel: detailIdea.savedStatus === 'saved' ? 'Saved ✓' : undefined,
          }}
          onClose={handleDetailDrawerClose}
          onSave={handleSaveIdea}
          onChipClick={handleChipClick}
          onOpenInWritingPanel={detailIdea ? () => void handleOpenInWritingPanel(detailIdea.id) : undefined}
        />
      )}

      {scenePickerIdeaId && (
        <ScenePicker
          onSelect={(sceneId, sceneTitle) => void handleScenePickerSelect(sceneId, sceneTitle)}
          onClose={() => setScenePickerIdeaId(null)}
        />
      )}
    </div>
  );
}
