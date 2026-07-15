import { useState, useCallback, useEffect, useRef, useMemo, Fragment, type ReactElement } from 'react';
import { useAgentActivity } from './agents/agentActivity';
import { useVoiceDictation, type VoiceDictationState } from './lib/useVoiceDictation';
import { PanelHeader } from './components/ui/PanelChrome';
import { IdeaCard } from './components/BrainstormCard/IdeaCard';
import { IdeaDetailDrawer } from './components/BrainstormCard/IdeaDetailDrawer';
import { ProposalCard } from './components/BrainstormCard/ProposalCard';
import type { NoteProposal, NoteProposalKind } from './components/BrainstormCard/ProposalCard';
import { ScenePicker } from './components/BrainstormCard/ScenePicker';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import { useTtsPlayer, type TtsEngineSettings, type TtsVoicePrefs } from './hooks/useTtsPlayer';
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
import {
  COLLECTION_ORDER,
  FACT_CATEGORY,
  STARTER_LIBRARY,
  createBoardCard,
  createEmptyBoard,
  extractOpenQuestions,
  migrateDraftFactsToBoard,
  type BrainstormBoardData,
  type LegacyDraftFact,
} from './brainstormBoard';
import { loadBrainstormBoard, saveBrainstormBoard } from './brainstormBoardStore';
import BoardCanvas from './components/BrainstormBoard/BoardCanvas';
import IdeaCollectionsPanel, {
  type CollectionIdea,
} from './components/BrainstormBoard/IdeaCollectionsPanel';
import AgentSessionPicker from './components/AgentSessionPicker';
import { useAgentSessions } from './lib/useAgentSessions';
import { PROMPT_MAX_CHARS } from './promptConstants';
import { useToast } from './hooks/useToast';
import { Toast } from './components/Toast/Toast';
import ContinuityPanel from './ContinuityPanel';
import type { Scene } from './types';
import './BrainstormPage.css';


const BRAINSTORM_SYSTEM_PROMPT = `You are a creative writing assistant helping an author develop their story world. Respond naturally to help develop the story — be generative and specific, offer possibilities rather than prescriptions, and keep replies conversational.

Fact tagging (required): at the end of your response, emit one structured fact tag per named entity using this format:

[FACT:type|Name|Brief description]

Where type is: character, location, item, or note.
Example: [FACT:character|Aria Voss|A young sorceress who discovers her hidden powers]

Tag every named character, location, item, or notable concept in the turn — entities the author mentions and ones you introduce alike. When unsure whether something deserves a tag, emit the tag: the author reviews every detected fact before it is saved, so a missed fact costs more than an extra one. Use note for anything that fits no other type.`;

export const STALL_TIMEOUT_MS = 20_000;
export const HARD_TIMEOUT_MS = 90_000;

const DRAFT_KEY = 'brainstorm:draft';
const MAX_DRAFT_BYTES = 2 * 1024 * 1024; // 2 MB
// M20 (SKY-6663): one-shot marker — the legacy draft transcript has been
// copied into the shared agent-session store (never orphan chat history).
const SESSION_MIGRATED_KEY = 'brainstorm:session-migrated';

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

// M20 (§7.2): TWO pages — Agent Chat (default) and ONE Board. The old
// Board/Map/Clusters visual modes were unified per B4-4; their data (facts +
// type collections + custom order) migrates into the board model on load.
type BrainstormMode = 'chat' | 'board';

const MODE_LABELS: Record<BrainstormMode, string> = {
  chat: 'Agent Chat',
  board: 'Board',
};

const BRAINSTORM_MODES: BrainstormMode[] = ['chat', 'board'];

// M19: composer suggestion chips (prototype bsChips, line 4330). The prototype
// ships demo-story chips; these are story-agnostic starters sent through the
// same real streaming path as typed messages.
const SUGGESTION_CHIPS = [
  'Introduce a new location in my world',
  'Give my protagonist a rival',
  'Suggest a plot twist for the next chapter',
];

// M20: board-page right-panel explore buttons (prototype aiButtons) — each is
// a real prompt sent through the same streaming chat path.
const EXPLORE_PROMPTS: ReadonlyArray<readonly [string, string]> = [
  ['Generate Story Beats', 'Give me 3 story beat ideas for the next chapter.'],
  ['Explore a Theme', 'Help me explore a central theme for my story — suggest three directions.'],
  ['Character Dynamics', 'Suggest an interesting dynamic between two of my characters.'],
  ['Worldbuilding Prompts', 'Give me a worldbuilding prompt to deepen my setting.'],
  ['What If Scenarios', 'Give me three “what if” scenarios that could raise the stakes.'],
  ['Surprise Me', 'Surprise me with an unexpected story idea.'],
] as const;

// M20: chat-stacked board height limits (prototype bsBoardResizeH clamp).
const CHAT_BOARD_MIN_H = 150;
const CHAT_BOARD_MAX_H = 720;
const CHAT_BOARD_DEFAULT_H = 380;

// M19: agent activity feed (prototype right panel, lines 2468–2496). Entries
// mirror real events only — fact extraction, note filing, routing, proposals.
type ActivityKind = 'note' | 'link' | 'prop' | 'scan';

interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  text: string;
}

/** Feed icons ported from the prototype actMeta paths (lines 4331–4336). */
const ACTIVITY_ICON_PATHS: Record<ActivityKind, ReactElement> = {
  note: (
    <>
      <path d="M7 3.5h7l4 4v13H7z" />
      <path d="M14 3.5v4h4" />
      <path d="M10.5 13h5M13 10.5v5" />
    </>
  ),
  link: (
    <>
      <path d="M9.5 14.5l5-5" />
      <path d="M11 7l1.5-1.5a3.5 3.5 0 0 1 5 5L16 12M8 12l-1.5 1.5a3.5 3.5 0 0 0 5 5L13 17" />
    </>
  ),
  prop: (
    <>
      <path d="M4.5 7.5h15M4.5 16.5h15" />
      <circle cx="9.5" cy="7.5" r="2.4" />
      <circle cx="14.5" cy="16.5" r="2.4" />
    </>
  ),
  scan: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20.5 20.5L16 16" />
    </>
  ),
};

const ACTIVITY_FEED_CAP = 50;

/** Avatar initials for character cards (prototype `av: 'MV'`, line 3001). */
function ideaInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

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
  /** Voice input is feature-flagged off by default; Settings must opt in. */
  voiceEnabled?: boolean;
  /** SKY-2585: gate Archive Continuity panel. Defaults true (feature on). */
  archiveContinuityEnabled?: boolean;
  /** SKY-2585: active scene forwarded to ContinuityPanel for scene-scoped issue listing. */
  activeScene?: Scene | null;
  /** SKY-3623: compact mode — hides the facts column for narrow sidebar contexts (~300-340px). */
  compact?: boolean;
  /** SKY-3201: pre-fill the prompt with this text on first mount (Notes/Story Assist context seeding).
   *  Overrides any saved draft. User still must press Send to submit. */
  seedPrompt?: string;
  /** Part G: TTS engine config for "Hear" reply playback. When absent or
   *  unconfigured, OS speechSynthesis is used as the zero-config default. */
  ttsSettings?: TtsEngineSettings;
  /** Part G: user voice prefs (volume/rate/voiceId/persistentMute + mic/language).
   *  Field names match VoiceSettings — pass appSettings.voice straight through. */
  voicePrefs?: TtsVoicePrefs & { micDeviceId?: string; inputLanguage?: string };
}

const MIC_ARIA_LABELS: Record<VoiceDictationState, string> = {
  idle: 'Start voice input',
  listening: 'Stop voice input — listening',
  processing: 'Processing speech…',
  error: 'Voice error — click to retry',
};

const MIC_ICONS: Record<VoiceDictationState, string> = {
  idle: '🎤', listening: '🎤', processing: '⏳', error: '⚠',
};

export default function BrainstormPage({ onClose, enabled = true, onFirstSubmit, onNavigateToEntity, onNavigateToScene, activeStorySlug, voiceEnabled = false, archiveContinuityEnabled = false, activeScene = null, compact = false, seedPrompt, ttsSettings, voicePrefs }: Props) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [facts, setFacts] = useState<DetectedFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertText, setAlertText] = useState('');
  // Beta 3 M22: brainstorm streaming lights the workspace tab strip's agents chip.
  useAgentActivity(loading);
  // Stable refs so the hook callbacks can reference values declared later in the component.
  const voiceTranscriptHandlerRef = useRef<(text: string) => void>(() => { /* filled below */ });
  const voiceErrorHandlerRef = useRef<(msg: string) => void>(() => { /* filled below */ });
  const { state: voiceState, start: startVoiceDictation, stop: stopVoiceDictation, cancel: cancelVoiceDictation } =
    useVoiceDictation({
      onTranscript: useCallback((text: string) => { voiceTranscriptHandlerRef.current(text); }, []),
      onError: useCallback((msg: string) => { voiceErrorHandlerRef.current(msg); }, []),
      micDeviceId: voicePrefs?.micDeviceId,
      inputLanguage: voicePrefs?.inputLanguage,
    });
  const { toast: toastState, showToast } = useToast(3000);
  const [pasteWarning, setPasteWarning] = useState(false);
  const [detailDrawerIdeaId, setDetailDrawerIdeaId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<NoteProposal[]>([]);
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
  // M20: Brainstorm page — Agent Chat (default) or the ONE Board.
  const [mode, setMode] = useState<BrainstormMode>('chat');
  // M20: board search ("Search ideas…" in the Board-page header).
  const [ideaQuery, setIdeaQuery] = useState('');
  // M20 (B4-4): capture the legacy draft ONCE, synchronously, before any
  // effect runs — the draft-persist effect deletes/overwrites the key on
  // mount while state is still empty, so later reads would lose the data the
  // migration must preserve.
  const [legacyDraft] = useState<{ facts: LegacyDraftFact[]; customOrder?: string[]; messages: Message[] }>(() => {
    let draftFacts: LegacyDraftFact[] = [];
    let draftOrder: string[] | undefined;
    let draftMessages: Message[] = [];
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as { facts?: LegacyDraftFact[]; customOrder?: string[]; messages?: Message[] };
        if (Array.isArray(draft?.facts)) draftFacts = draft.facts;
        if (Array.isArray(draft?.customOrder)) draftOrder = draft.customOrder;
        if (Array.isArray(draft?.messages)) draftMessages = draft.messages;
      }
    } catch { /* malformed draft — nothing to migrate */ }
    return { facts: draftFacts, customOrder: draftOrder, messages: draftMessages };
  });
  // M20: the unified board (persisted on M5 vault storage; null until loaded).
  const [board, setBoard] = useState<BrainstormBoardData | null>(null);
  const [boardSynced, setBoardSynced] = useState(true);
  const boardLoadedRef = useRef(false);
  const boardSaveTimerRef = useRef<number | null>(null);
  const lastPersistedBoardRef = useRef<string | null>(null);
  // M20: chat-page Board toggle — canvas stacked under the chat, drag-bar height.
  const [chatBoardOpen, setChatBoardOpen] = useState(false);
  const [chatBoardHeight, setChatBoardHeight] = useState(CHAT_BOARD_DEFAULT_H);
  // M20: vault-note titles on cards underline + open the note.
  const [noteIndex, setNoteIndex] = useState<Map<string, string>>(new Map());
  // M20: board-page right panel QUICK GENERATE box.
  const [quickGenText, setQuickGenText] = useState('');
  // M20 (SKY-6663): Brainstorm chat lives on the shared M15 agent-session store.
  const sessionStore = useAgentSessions('brainstorm');
  const sessionStoreRef = useRef(sessionStore);
  sessionStoreRef.current = sessionStore;
  const syncedSessionIdRef = useRef<string | null>(null);
  const hadDraftMessagesRef = useRef(false);
  const pendingUserTextRef = useRef('');
  // M19: agent activity feed — newest entry first, capped.
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
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

  // Part G: optional TTS "Hear" playback for assistant replies — mirrors WA.
  const tts = useTtsPlayer(ttsSettings, voicePrefs);

  // Wire stable refs now that announce + setPrompt are in scope.
  voiceTranscriptHandlerRef.current = (text: string) => {
    setPrompt((prev) => (prev ? `${prev} ${text}` : text));
    announce(`Transcribed: ${text}`);
  };
  voiceErrorHandlerRef.current = (msg: string) => {
    setAlertText(`Voice error: ${msg}`);
    announce(`Voice error: ${msg}`);
  };

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

  // M20: left IDEA COLLECTIONS pool — agent-filed session facts first, then
  // the preloaded starter library (prototype bsPool `Starter` entries).
  const collectionsPool: CollectionIdea[] = useMemo(() => {
    const factIdeas: CollectionIdea[] = facts.map((f) => ({
      key: `fact-${f.id}`,
      cat: FACT_CATEGORY[f.type] ?? 'loose',
      title: f.name,
      desc: f.content,
      chips: [FACT_TYPE_LABELS[f.type]],
      ...(f.type === 'character' ? { av: ideaInitials(f.name) } : {}),
      factId: f.id,
    }));
    const starters: CollectionIdea[] = COLLECTION_ORDER.flatMap((cat) =>
      STARTER_LIBRARY[cat].map((s, i) => ({
        key: `starter-${cat}-${i}`,
        cat,
        title: s.title,
        desc: s.desc,
        chips: [...s.chips],
      })),
    );
    return [...factIdeas, ...starters];
  }, [facts]);

  // Lowercase card titles already on the board — drives the `+` / `✓` glyphs.
  const placedTitles = useMemo(
    () => new Set((board?.cards ?? []).map((c) => c.title.trim().toLowerCase())),
    [board],
  );

  // ── M20 board mutators (persisted via the debounced save effect below) ──
  const moveBoardCard = useCallback((id: string, x: number, y: number) => {
    setBoard((b) => (b ? { ...b, cards: b.cards.map((c) => (c.id === id ? { ...c, x, y } : c)) } : b));
  }, []);

  const editBoardCard = useCallback((id: string, updates: { title: string; desc: string }) => {
    setBoard((b) => (b
      ? { ...b, cards: b.cards.map((c) => (c.id === id ? { ...c, title: updates.title, desc: updates.desc } : c)) }
      : b));
  }, []);

  const addBoardLink = useCallback((from: string, to: string) => {
    setBoard((b) => {
      if (!b) return b;
      const exists = b.links.some(
        (l) => (l.from === from && l.to === to) || (l.from === to && l.to === from),
      );
      return exists ? b : { ...b, links: [...b.links, { from, to }] };
    });
  }, []);
  // M20: activity stats row (prototype bsStatsRow: Notes / Links / Props) —
  // real counters: notes written to the vault, board connections, proposals.
  const savedNoteCount = useMemo(
    () => facts.filter((f) => f.savedStatus === 'saved').length,
    [facts],
  );

  // M20: QUESTIONS FOR YOU — open questions from the latest agent reply;
  // clicking one sends it into the chat (§7.2).
  const openQuestions = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && !msg.streaming && msg.text.trim()) {
        return extractOpenQuestions(msg.text);
      }
    }
    return [];
  }, [messages]);

  // M20: SAVED PROMPTS (board-page right panel) — the last three distinct
  // prompts the user actually sent; clicking one re-sends it in the chat.
  const savedPrompts = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = messages.length - 1; i >= 0 && out.length < 3; i--) {
      const msg = messages[i];
      if (msg.role !== 'user') continue;
      const text = msg.text.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
    return out;
  }, [messages]);

  // M20: NOTES THAT NEED WORK — captured ideas without a vault note yet
  // (MISSING) and saved notes that are still stubs (NEEDS WORK).
  const needsWorkRows = useMemo(() => {
    const rows: Array<{ id: string; title: string; sub: string; kind: 'MISSING' | 'NEEDS WORK' }> = [];
    for (const fact of facts) {
      if (rows.length === 4) break;
      if (fact.savedStatus === 'error' || fact.savedStatus === 'needs_routing' || fact.savedStatus === 'unsaved') {
        rows.push({ id: fact.id, title: fact.name, sub: 'captured in chat — no note yet', kind: 'MISSING' });
      } else if (fact.savedStatus === 'saved' && fact.content.trim().length < 80) {
        rows.push({ id: fact.id, title: fact.name, sub: 'stub note — a few words so far', kind: 'NEEDS WORK' });
      }
    }
    return rows;
  }, [facts]);

  // M19: append to the agent activity feed (newest first, capped) — every
  // entry corresponds to a real vault/proposal event, never mocked.
  const pushActivity = useCallback((kind: ActivityKind, text: string) => {
    setActivity((prev) => [
      { id: `act-${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, text },
      ...prev,
    ].slice(0, ACTIVITY_FEED_CAP));
  }, []);

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

  // Restore draft from localStorage on mount. seedPrompt takes priority — skip draft restore when provided.
  useEffect(() => {
    if (seedPrompt) {
      setPrompt(seedPrompt);
      return;
    }
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
          hadDraftMessagesRef.current = draftMessages.length > 0;
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

  // M20: load the unified board from the vault. B4-4: before the old
  // Board/Map/Clusters views were deleted, their data — the draft's facts with
  // their type collections and custom order — migrates into the board model
  // exactly once (the one-shot flag lives in the board file itself).
  useEffect(() => {
    let cancelled = false;
    const finish = (loaded: BrainstormBoardData | null) => {
      if (cancelled) return;
      let next = loaded ?? createEmptyBoard();
      if (!next.draftMigrated) {
        next = migrateDraftFactsToBoard(next, legacyDraft.facts, legacyDraft.customOrder);
        lastPersistedBoardRef.current = JSON.stringify(next, null, 2);
        void saveBrainstormBoard(next);
      } else {
        lastPersistedBoardRef.current = JSON.stringify(next, null, 2);
      }
      setBoard(next);
      boardLoadedRef.current = true;
    };
    if (typeof window.api?.readNotesVault !== 'function') {
      // No vault bridge (unit tests / degraded startup): resolve synchronously
      // so the mount stays act-clean; the board lives in memory only.
      finish(null);
    } else {
      void loadBrainstormBoard().then(finish);
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // M20: debounced write-back — positions survive restart (M5 vault storage).
  useEffect(() => {
    if (!board || !boardLoadedRef.current) return;
    // No vault bridge (unit tests / degraded startup): the board lives in
    // memory only, so skip the timer + sync-state churn entirely.
    if (typeof window.api?.writeNotesVault !== 'function') return;
    const serialized = JSON.stringify(board, null, 2);
    if (serialized === lastPersistedBoardRef.current) return;
    setBoardSynced(false);
    if (boardSaveTimerRef.current !== null) window.clearTimeout(boardSaveTimerRef.current);
    boardSaveTimerRef.current = window.setTimeout(() => {
      boardSaveTimerRef.current = null;
      lastPersistedBoardRef.current = serialized;
      void saveBrainstormBoard(board).then(() => setBoardSynced(true));
    }, 400);
    return () => {
      if (boardSaveTimerRef.current !== null) {
        window.clearTimeout(boardSaveTimerRef.current);
        boardSaveTimerRef.current = null;
      }
    };
  }, [board]);

  // M20: vault-note titles on board cards underline → open the note. Load the
  // entity index lazily whenever a canvas is visible.
  useEffect(() => {
    if (mode !== 'board' && !chatBoardOpen) return;
    if (typeof window.api?.entityList !== 'function') return;
    let cancelled = false;
    void (async () => {
      try {
        const { entities } = await window.api.entityList();
        // Skip the no-op update — an empty vault should not churn state.
        if (!cancelled && entities.length > 0) {
          setNoteIndex(new Map(entities.map((e) => [e.name.trim().toLowerCase(), e.id])));
        }
      } catch { /* vault unavailable — titles just render un-linked */ }
    })();
    return () => { cancelled = true; };
  }, [mode, chatBoardOpen]);

  // M20 (SKY-6663): sync the chat feed with the shared agent-session store.
  // First adoption keeps a restored draft (and migrates it into the session so
  // no chat history is ever orphaned); later id changes = real session
  // switches, which replace the feed with the session's turns.
  useEffect(() => {
    const active = sessionStore.activeSession;
    const activeId = sessionStore.activeSessionId;
    if (!activeId) return;
    if (!active || active.id !== activeId) return;
    if (syncedSessionIdRef.current === active.id) return;
    const firstAdoption = syncedSessionIdRef.current === null;
    syncedSessionIdRef.current = active.id;

    if (firstAdoption && hadDraftMessagesRef.current) {
      // The restored draft is the working transcript. Migrate it into the
      // session store once so the history survives localStorage loss.
      try {
        if (localStorage.getItem(SESSION_MIGRATED_KEY) !== '1' && active.turns.length <= 1) {
          const at = new Date().toISOString();
          const turns = legacyDraft.messages
            .filter((m) => m.text.trim())
            .map((m) => ({
              role: m.role === 'user' ? ('user' as const) : ('agent' as const),
              text: m.text,
              at,
            }));
          if (turns.length > 0) void sessionStoreRef.current.appendTurns(turns);
          localStorage.setItem(SESSION_MIGRATED_KEY, '1');
        }
      } catch { /* draft unreadable — nothing to migrate */ }
      return;
    }

    // Fresh mount without a draft, or a real session switch: hydrate the feed.
    if (streamIdRef.current) void window.api.streamCancel(streamIdRef.current);
    cleanupStreamRef.current?.();
    setLoading(false);
    setStreamPhase('idle');
    setError(null);
    setMessages(active.turns.map((t) => ({
      role: t.role === 'user' ? ('user' as const) : ('assistant' as const),
      text: t.text,
    })));
  }, [sessionStore.activeSession, sessionStore.activeSessionId, legacyDraft]);

  // M20: place a collection idea (starter or agent-filed fact) on the board.
  const placeIdeaOnBoard = useCallback((idea: CollectionIdea) => {
    setBoard((b) => {
      const base = b ?? createEmptyBoard();
      return {
        ...base,
        cards: [...base.cards, createBoardCard(base.cards, {
          cat: idea.cat,
          title: idea.title,
          desc: idea.desc,
          chips: idea.chips,
          ...(idea.av ? { av: idea.av } : {}),
          ...(idea.factId ? { factId: idea.factId } : {}),
        })],
      };
    });
    setMode('board');
    showToast(`“${idea.title}” added to the board`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // M20: `+ Idea` header button (prototype bsAddIdea) — lands near Loose Ideas.
  const addLooseIdea = useCallback(() => {
    setBoard((b) => {
      const base = b ?? createEmptyBoard();
      return {
        ...base,
        cards: [...base.cards, createBoardCard(base.cards, {
          cat: 'loose',
          title: 'New idea',
          desc: 'Drag me anywhere — expand me with the Agent chat.',
          chips: ['New'],
        })],
      };
    });
    showToast('Idea captured — landed near Loose Ideas');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // M20: chat-page stacked board drag-bar (prototype bsBoardResizeH).
  const handleChatBoardResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = chatBoardHeight;
    const move = (ev: MouseEvent) => {
      setChatBoardHeight(Math.max(
        CHAT_BOARD_MIN_H,
        Math.min(CHAT_BOARD_MAX_H, startHeight - (ev.clientY - startY)),
      ));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [chatBoardHeight]);

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
    const unsub = window.api.onVaultNotesUpdated?.((data: { count: number }) => {
      const msg = `Vault notes updated (${data.count} note${data.count !== 1 ? 's' : ''})`;
      showToast(msg);
    });
    return () => { unsub?.(); };
  }, [showToast]);

  useEffect(() => {
    return () => {
      cleanupStreamRef.current?.();
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
    setActivity([]);
    setIdeaQuery('');
    dragSourceIdRef.current = null;
    contextSystemRef.current = BRAINSTORM_SYSTEM_PROMPT;
    localStorage.removeItem(DRAFT_KEY);
    // M20 (SKY-6663): a fresh chat is a fresh shared-store session; the old
    // one stays in the session dropdown. The sync effect hydrates its greeting.
    hadDraftMessagesRef.current = false;
    void sessionStoreRef.current.newSession();
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
    // Audit P4: if a previous stream is still live (re-entry before its end/
    // error event), tear down its listeners first — otherwise the assignment
    // to cleanupStreamRef below overwrites them without ever unsubscribing,
    // orphaning three ipcRenderer listeners per re-entry. The cleanup closure
    // nulls the ref itself, so this is a no-op when nothing is live.
    cleanupStreamRef.current?.();

    lastApiMessagesRef.current = apiMessages;
    // M20 (SKY-6663): remember the user turn so the completed exchange can be
    // appended to the shared agent-session store when the stream ends.
    const lastApi = apiMessages[apiMessages.length - 1];
    pendingUserTextRef.current = lastApi?.role === 'user' ? lastApi.content : '';
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
        pushActivity(
          'scan',
          `Detected ${extracted.length} fact${extracted.length !== 1 ? 's' : ''} — filing to your vault`,
        );
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

      // M20 (SKY-6663): persist the completed exchange to the shared session
      // store (fire-and-forget — the localStorage draft still covers crashes).
      const userText = pendingUserTextRef.current;
      const agentText = stripFactTags(fullText) || fullText;
      pendingUserTextRef.current = '';
      if (agentText.trim()) {
        const at = new Date().toISOString();
        void sessionStoreRef.current.appendTurns([
          ...(userText.trim() ? [{ role: 'user' as const, text: userText, at }] : []),
          { role: 'agent' as const, text: agentText, at },
        ]);
      }

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
      // 2048 (the IPC cap) doubles the old 1024 default so long replies keep
      // room for the required trailing [FACT:...] tags. Thinking stays off:
      // this surface's stall/hard-timeout timers reset only on visible tokens,
      // and a silent thinking phase would trip them (and share this budget).
      const { streamId: sid } = await window.api.streamStart({
        messages: apiMessages,
        system: contextSystemRef.current,
        maxTokens: 2048,
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
  }, [announce, pushActivity]);

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

  // M19: shared submit path — used by the composer (clears the input) and the
  // suggestion chips (leave the input untouched, prototype sendBs line 3761).
  const submitText = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    onFirstSubmit?.();
    setLoading(true);
    setError(null);
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
  }, [loading, messages, announce, _runStream, effectiveAxes, onFirstSubmit]);

  const send = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;
    setPrompt('');
    await submitText(trimmed);
  }, [prompt, loading, submitText]);

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

  const cancelVoice = useCallback(() => {
    cancelVoiceDictation();
    announce('Voice input cancelled.');
    setAlertText('Voice input cancelled.');
  }, [cancelVoiceDictation, announce]);

  const handleMicToggle = useCallback(() => {
    if (voiceState === 'idle') void startVoiceDictation();
    else if (voiceState === 'listening') stopVoiceDictation();
    else if (voiceState === 'error') void startVoiceDictation();
    // processing: ignore clicks
  }, [voiceState, startVoiceDictation, stopVoiceDictation]);

  // Voice Escape: registered on window in capture phase so it fires before the
  // page-close ESC handler (which uses document capture). When voice is active,
  // cancel it and swallow the event so the page does not close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && voiceState !== 'idle') {
        e.stopPropagation();
        cancelVoice();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [cancelVoice, voiceState]);

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
          pushActivity(
            'note',
            `Created note — “${fact.name}” (${FACT_TYPE_LABELS[fact.type]})`,
          );
          return;
        }
        // status === 'needs_routing' — main staged the file; we ask the user.
        await ensureNotesFolders();
        setFacts((prev) =>
          prev.map((f) => (f.id === fact.id ? { ...f, savedStatus: 'needs_routing' } : f)),
        );
        pushActivity(
          'prop',
          `Waiting for a destination — “${result.name}” (${CATEGORY_LABEL[result.category as NoteCategory]})`,
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
        pushActivity('scan', `Couldn’t save “${fact.name}” — retry from the facts panel`);
      }
    },
    [announce, ensureNotesFolders, pushActivity],
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
        pushActivity('link', `Filed “${prompt.name}” → ${chosen || 'vault root'}`);
        announce(`Saved to ${chosen || 'vault root'}.`);
      } catch {
        setFacts((prev) =>
          prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'error' } : f)),
        );
      }
    },
    [routingPrompts, announce, pushActivity],
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
                const kind: NoteProposalKind = ['character', 'location', 'item', 'faction', 'scene_card', 'scene_crafter_card', 'inbox'].includes(k)
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
          const kind: NoteProposalKind = ['character', 'location', 'item', 'faction', 'scene_card', 'scene_crafter_card', 'inbox'].includes(k)
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
        for (const p of fresh) pushActivity('prop', `Proposal queued — “${p.title}”`);
        return [...prev, ...fresh];
      });
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


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

  const openIdeaDetail = useCallback((ideaId: string) => {
    triggerElementRef.current = document.activeElement as HTMLElement;
    setDetailDrawerIdeaId(ideaId);
    announce('Idea detail drawer opened.');
  }, [announce]);

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

      <PanelHeader
        className={compact ? 'brainstorm-header brainstorm-header--compact' : 'brainstorm-header'}
        icon={
          <button className="brainstorm-back-btn" onClick={onClose} aria-label="Close brainstorm">
            ← Back
          </button>
        }
        title={
          mode === 'chat' && !compact ? (
            <span className="bs-title-row">
              Brainstorm Agent
              {/* M20 (§7.2 + §11): session dropdown pill on the shared store. */}
              <AgentSessionPicker store={sessionStore} className="bs-session-pill" />
            </span>
          ) : mode === 'chat' ? 'Brainstorm Agent' : 'Brainstorm Center'
        }
        subtitle={
          mode === 'chat'
            ? 'Talk your world into existence — the vault builds itself.'
            : 'Capture. Connect. Develop.'
        }
        actions={
          <>
            {/* M20: page segment — Agent Chat (default) | Board (prototype
                bsPages). Hidden in compact sidebar contexts where only the
                chat fits. */}
            {!compact && (
              <div className="bsc-seg" role="group" aria-label="Brainstorm page">
                {BRAINSTORM_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`bsc-seg-btn${mode === m ? ' bsc-seg-btn--active' : ''}`}
                    aria-pressed={mode === m}
                    onClick={() => setMode(m)}
                    data-testid={`bsc-mode-${m}`}
                  >
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            )}
            {/* M20: chat-page Board toggle — stacks the canvas under the chat
                with a drag-bar height (prototype bsBoardToggle). */}
            {!compact && mode === 'chat' && (
              <div className="bs-board-toggle-wrap" title="Show the idea board below the chat">
                <span>Board</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={chatBoardOpen}
                  aria-label="Show board under chat"
                  className={`bs-board-toggle${chatBoardOpen ? ' bs-board-toggle--on' : ''}`}
                  onClick={() => setChatBoardOpen((v) => !v)}
                  data-testid="bs-chat-board-toggle"
                >
                  <span className="bs-board-toggle-knob" aria-hidden="true" />
                </button>
              </div>
            )}
            {/* M19: live extraction badge (prototype lines 1330–1335) — shown
                while a reply is streaming and facts may be extracted. */}
            {mode === 'chat' && loading && (
              <div className="bs-extract-badge" data-testid="bs-extract-badge" role="status">
                <span className="bs-extract-dot" aria-hidden="true" />
                Extracting facts to vault
              </div>
            )}
            {/* M20: Board page adds `+ Idea` + `Search ideas…` (§7.2). */}
            {!compact && mode === 'board' && (
              <>
                <button
                  type="button"
                  className="bsc-add-idea-btn"
                  onClick={addLooseIdea}
                  data-testid="bsc-add-idea"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Idea
                </button>
                <div className="bsc-search">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="M20.5 20.5L16 16" />
                  </svg>
                  <input
                    value={ideaQuery}
                    onChange={(e) => setIdeaQuery(e.target.value)}
                    placeholder="Search ideas…"
                    aria-label="Search ideas"
                    data-testid="bsc-search-input"
                  />
                </div>
              </>
            )}
            <div className="brainstorm-header-preset">
              <PresetSelector
                activePresetId={presetId}
                onSelect={(id) => { setPresetId(id); setPresetOverrides({}); saveSessionPreset(id, {}); }}
                onCustomize={() => setShowPresetEditor(true)}
                compact
              />
            </div>
            <div className="brainstorm-header-actions">
              {/* AC-V-06: session mute toggle — same contract as the WA header */}
              <button
                className={`brainstorm-mute-btn${tts.sessionMuted ? ' brainstorm-mute-btn--muted' : ''}`}
                onClick={() => tts.toggleMute(announce)}
                aria-label={tts.sessionMuted ? 'Unmute voice playback' : 'Mute voice playback'}
                aria-pressed={tts.sessionMuted}
                type="button"
              >
                {tts.sessionMuted ? 'Unmute' : 'Mute'}
              </button>
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
          </>
        }
      />
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

      {mode === 'chat' && (
      <div className={`brainstorm-layout${compact ? ' brainstorm-layout--compact' : ''}`}>
        {/* M20: left IDEA COLLECTIONS panel (§7.2) — starter library + the
            agent's captured ideas, placeable onto the board. */}
        {!compact && (
          <IdeaCollectionsPanel
            pool={collectionsPool}
            placedTitles={placedTitles}
            onPlace={placeIdeaOnBoard}
            showToast={showToast}
          />
        )}
      <div className={`brainstorm-body${compact ? ' brainstorm-body--compact' : ''}`}>
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
                    {/* AC-V-07: per-reply TTS button; one reply plays at a time */}
                    {!msg.streaming && msg.text.trim() !== '' && (() => {
                      const mid = `bs-msg-${i}`;
                      const isPlaying = tts.playingCardId === mid;
                      return (
                        <button
                          className={`bs-hear-btn${isPlaying ? ' bs-hear-btn--playing' : ''}`}
                          onClick={() => {
                            if (isPlaying) {
                              tts.cancelCurrent(announce);
                            } else {
                              tts.speakCard(msg.text, mid, announce);
                            }
                          }}
                          aria-label={isPlaying ? 'Stop voice playback' : 'Hear suggestion aloud'}
                          aria-pressed={isPlaying}
                          type="button"
                        >
                          {isPlaying ? '■ Stop' : '▶ Hear'}
                        </button>
                      );
                    })()}
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

          {voiceEnabled && (
            <div
              className={`voice-transcript-strip${voiceState === 'listening' || voiceState === 'processing' ? ' voice-transcript-strip--visible' : ''}`}
              aria-hidden="true"
              data-testid="voice-transcript-strip"
            >
              <div className="voice-transcript-strip-inner">
                {voiceState === 'processing' && <span className="voice-transcript-hint">Processing…</span>}
                {voiceState === 'listening' && <span className="voice-transcript-hint">Listening…</span>}
              </div>
            </div>
          )}
          {/* M19: suggestion chips (prototype bsChips row, lines 1349–1354) —
              each sends its text through the same streaming path as typing. */}
          <div className="bs-chips-row">
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="bs-suggest-chip"
                onClick={() => void submitText(chip)}
                disabled={loading}
                data-testid="bs-suggest-chip"
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="brainstorm-input-area">
            {voiceEnabled && (
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
              </div>
            )}
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
          {/* M19: composer footnote (prototype line 1362). */}
          <div className="bs-composer-note">
            Named characters, locations and rules are extracted automatically — watch the
            activity feed on the right.
          </div>
          <EntriesQuickAdd />
          {compact && proposals.length > 0 && (
            <ProposalCard
              proposals={proposals}
              onConfirm={handleProposalConfirm}
              onReject={handleProposalReject}
              onDismissAll={handleProposalDismissAll}
              onBrowseFolder={handleBrowseFolder}
            />
          )}
          {/* M20: Board toggle — the ONE canvas stacked under the chat with a
              drag-bar height (prototype bsChatBoard / bsBoardResizeH). */}
          {!compact && chatBoardOpen && board && (
            <>
              <div
                className="bs-board-resize"
                onMouseDown={handleChatBoardResize}
                title="Drag to resize the board"
                data-testid="bs-board-resize"
              >
                <div className="bs-board-resize-grip" aria-hidden="true" />
              </div>
              <BoardCanvas
                cards={board.cards}
                links={board.links}
                onMoveCard={moveBoardCard}
                onEditCard={editBoardCard}
                onAddLink={addBoardLink}
                noteIndex={noteIndex}
                onOpenNote={onNavigateToEntity}
                showToast={showToast}
                synced={boardSynced}
                stackedHeight={chatBoardHeight}
              />
            </>
          )}
        </div>

        <div className="brainstorm-facts-col">
          {/* M19: agent activity feed (prototype right panel, lines 2468–2496)
              — LIVE header, real counters, and a feed of actual vault events. */}
          <div className="bs-activity-section" data-testid="bs-activity-section">
            <div className="bs-activity-header">
              <span className="bs-activity-dot" aria-hidden="true" />
              <span className="bs-activity-title">Agent Activity</span>
              <span className="bs-activity-live">LIVE</span>
            </div>
            <div className="bs-activity-stats">
              <div className="bs-activity-stat">
                <span className="bs-activity-stat-v" data-testid="bs-stat-notes">{savedNoteCount}</span>
                <span className="bs-activity-stat-k">Notes</span>
              </div>
              <div className="bs-activity-stat">
                <span className="bs-activity-stat-v" data-testid="bs-stat-links">{board?.links.length ?? 0}</span>
                <span className="bs-activity-stat-k">Links</span>
              </div>
              <div className="bs-activity-stat">
                <span className="bs-activity-stat-v" data-testid="bs-stat-props">{proposals.length}</span>
                <span className="bs-activity-stat-k">Props</span>
              </div>
            </div>
            <div className="bs-activity-label">BEHIND THE SCENES</div>
            <div className="bs-activity-feed" data-testid="bs-activity-feed">
              {activity.length === 0 ? (
                <div className="bs-activity-empty">
                  Agent actions land here as facts are filed to your vault.
                </div>
              ) : (
                activity.map((entry) => (
                  <div key={entry.id} className="bs-activity-item">
                    <span className={`bs-activity-icon bs-activity-icon--${entry.kind}`} aria-hidden="true">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        {ACTIVITY_ICON_PATHS[entry.kind]}
                      </svg>
                    </span>
                    <span className="bs-activity-text">{entry.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* M20 (§7.2): QUESTIONS FOR YOU — click sends the question to the chat. */}
          {openQuestions.length > 0 && (
            <div className="bs-questions-section" data-testid="bs-questions-section">
              <div className="bs-side-label">QUESTIONS FOR YOU</div>
              {openQuestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  className="bs-question-row"
                  title="Answer it in the chat"
                  onClick={() => void submitText(question)}
                  disabled={loading}
                  data-testid="bs-question-row"
                >
                  <span className="bs-question-mark" aria-hidden="true">?</span>
                  <span>{question}</span>
                </button>
              ))}
            </div>
          )}

          {/* M20 (§7.2): NOTES THAT NEED WORK — MISSING / NEEDS WORK chips;
              clicking sends a drafting prompt into the chat. */}
          {needsWorkRows.length > 0 && (
            <div className="bs-needs-section" data-testid="bs-needs-section">
              <div className="bs-side-label">NOTES THAT NEED WORK</div>
              {needsWorkRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="bs-needs-row"
                  onClick={() => void submitText(`Let’s flesh out “${row.title}” — what do we know so far, and what’s missing?`)}
                  disabled={loading}
                  data-testid={`bs-needs-row-${row.id}`}
                >
                  <span className="bs-needs-main">
                    <span className="bs-needs-title">{row.title}</span>
                    <span className="bs-needs-sub">{row.sub}</span>
                  </span>
                  <span className={`bs-needs-chip${row.kind === 'MISSING' ? ' bs-needs-chip--missing' : ' bs-needs-chip--work'}`}>
                    {row.kind}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* SKY-2585/SKY-2588: ContinuityPanel always rendered; enabled prop gates disabled state */}
          <div className="brainstorm-continuity-section">
            <ContinuityPanel scene={activeScene} enabled={archiveContinuityEnabled} />
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
          {!compact && proposals.length > 0 ? (
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
        </div>
      </div>
      </div>
      )}

      {/* M20 (§7.2): the ONE Board page — collections, canvas, agent side panel. */}
      {mode === 'board' && (
      <div className="brainstorm-layout">
        {/* M20: left IDEA COLLECTIONS panel — shared with the chat page. */}
        {!compact && (
          <IdeaCollectionsPanel
            pool={collectionsPool}
            placedTitles={placedTitles}
            onPlace={placeIdeaOnBoard}
            showToast={showToast}
          />
        )}
        <div className="bsc-body">
          {board && (
            <BoardCanvas
              cards={board.cards}
              links={board.links}
              query={ideaQuery}
              onMoveCard={moveBoardCard}
              onEditCard={editBoardCard}
              onAddLink={addBoardLink}
              noteIndex={noteIndex}
              onOpenNote={onNavigateToEntity}
              showToast={showToast}
              synced={boardSynced}
            />
          )}
        </div>
        {/* M20 (§7.2): board-page right panel — explore buttons, saved
            prompts, quick-generate. Every action runs through the real chat
            streaming path. */}
        {!compact && (
          <aside className="bs-board-side" data-testid="bs-board-side">
            <div className="bs-board-side-head">
              <span className="bs-activity-dot" aria-hidden="true" />
              <span className="bs-board-side-title">Brainstorm Agent</span>
              <span className="bs-activity-live">LIVE</span>
            </div>
            <div className="bs-board-side-scroll">
              <div className="bs-side-label">WHAT WOULD YOU LIKE TO EXPLORE?</div>
              {EXPLORE_PROMPTS.map(([label, promptText]) => (
                <button
                  key={label}
                  type="button"
                  className="bs-explore-btn"
                  onClick={() => { setMode('chat'); void submitText(promptText); }}
                  disabled={loading}
                  data-testid="bs-explore-btn"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 4l1.5 4L17.5 9.5l-4 1.5L12 15l-1.5-4-4-1.5 4-1.5z" />
                  </svg>
                  {label}
                </button>
              ))}
              <div className="bs-side-label">SAVED PROMPTS</div>
              {savedPrompts.length === 0 ? (
                <div className="bs-side-empty">Prompts you send in the chat reappear here.</div>
              ) : (
                savedPrompts.map((saved) => (
                  <button
                    key={saved}
                    type="button"
                    className="bs-saved-prompt"
                    onClick={() => { setMode('chat'); void submitText(saved); }}
                    disabled={loading}
                    data-testid="bs-saved-prompt"
                  >
                    {saved}
                  </button>
                ))
              )}
            </div>
            <div className="bs-quick-gen">
              <div className="bs-side-label">QUICK GENERATE</div>
              <div className="bs-quick-gen-row">
                <textarea
                  value={quickGenText}
                  onChange={(e) => setQuickGenText(e.target.value)}
                  placeholder="Give me 3 story beat ideas for the next chapter."
                  aria-label="Quick generate prompt"
                  data-testid="bs-quick-gen-input"
                />
                <button
                  type="button"
                  className="bs-quick-gen-send"
                  aria-label="Send quick generate prompt"
                  disabled={loading || !quickGenText.trim()}
                  onClick={() => {
                    const text = quickGenText.trim();
                    if (!text) return;
                    setQuickGenText('');
                    setMode('chat');
                    void submitText(text);
                  }}
                  data-testid="bs-quick-gen-send"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                  </svg>
                </button>
              </div>
              <div className="bs-quick-gen-note">AI responses may vary. Review for accuracy.</div>
            </div>
          </aside>
        )}
      </div>
      )}

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
