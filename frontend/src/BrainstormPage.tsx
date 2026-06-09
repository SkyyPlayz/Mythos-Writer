import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
}

export default function BrainstormPage({ onClose, enabled = true }: Props) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [facts, setFacts] = useState<DetectedFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pasteWarning, setPasteWarning] = useState(false);
  const [continuityIssues, setContinuityIssues] = useState<ContinuityIssue[]>([]);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, ContinuityAnswerDraft>>({});
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

  // SKY-196: vault context surfaced in the "Context used" panel
  const [contextResult, setContextResult] = useState<ContextResult | null>(null);
  const [contextOpen, setContextOpen] = useState(false);

  const streamIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef<string>('');
  const cleanupStreamRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTokenAtRef = useRef<number>(0);
  const lastApiMessagesRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  // Holds the system prompt augmented with vault context for the current/last request.
  const contextSystemRef = useRef<string>(BRAINSTORM_SYSTEM_PROMPT);
  const { announce, liveText } = useLiveAnnounce();
  const effectiveAxes = useMemo(
    () => getEffectiveAxes(presetId, presetOverrides),
    [presetId, presetOverrides],
  );

  // Restore draft from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft: { v?: number; messages?: Message[]; facts?: DetectedFact[]; prompt?: string } = JSON.parse(raw);
        const draftMessages = Array.isArray(draft.messages)
          ? draft.messages.map((m) => ({ ...m, streaming: false }))
          : [];
        const draftFacts = Array.isArray(draft.facts) ? draft.facts : [];
        const draftPrompt = typeof draft.prompt === 'string' ? draft.prompt : '';

        if ((draft.v === 1 || draft.v === 2) && (draftMessages.length > 0 || draftFacts.length > 0 || draftPrompt.trim())) {
          setMessages(draftMessages);
          setFacts(draftFacts);
          setPrompt(draftPrompt);
          setShowRecoveryBanner(true);
        }
      }
    } catch { /* ignore malformed draft */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist draft whenever prompt, messages, or facts change.
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
    };
    const serialized = JSON.stringify(draft);
    if (serialized.length > MAX_DRAFT_BYTES) {
      setDraftSizeWarning(true);
      return;
    }
    setDraftSizeWarning(false);
    try {
      localStorage.setItem(DRAFT_KEY, serialized);
    } catch { /* quota exceeded — silently skip */ }
  }, [prompt, messages, facts]);

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

  // ESC closes the page, matching the same capture-phase pattern as GlobalSearchPanel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  useEffect(() => {
    const el = messagesEndRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    const unsub = window.api.onSttResult?.((text: string) => {
      setPrompt((prev) => (prev ? prev + ' ' + text : text));
      setIsRecording(false);
    });
    return () => { unsub?.(); };
  }, []);

  useEffect(() => {
    const unsub = window.api.onVaultNotesUpdated?.((data: { count: number }) => {
      const msg = `Vault notes updated (${data.count} note${data.count !== 1 ? 's' : ''})`;
      setToast(msg);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 3000);
    });
    return () => { unsub?.(); };
  }, []);

  useEffect(() => {
    return () => {
      cleanupStreamRef.current?.();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
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
    setToast('Generation cancelled');
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const handleNewSession = useCallback(() => {
    if (streamIdRef.current) {
      void window.api.streamCancel(streamIdRef.current);
    }
    cleanupStreamRef.current?.();
    setMessages([]);
    setFacts([]);
    setPrompt('');
    setError(null);
    setLoading(false);
    setDraftSizeWarning(false);
    setShowRecoveryBanner(false);
    setRoutingPrompts([]);
    setContextResult(null);
    setContextOpen(false);
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
        const newFacts: DetectedFact[] = extracted.map((f) => ({
          ...f,
          id: `fact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          savedStatus: 'saving' as const,
        }));
        setFacts((prev) => [...prev, ...newFacts]);
        for (const fact of newFacts) {
          void persistFactWithRoutingRef.current?.(fact);
        }
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
  }, [prompt, loading, messages, announce, _runStream, effectiveAxes]);

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

  const handleMic = useCallback(() => {
    if (isRecording) {
      window.api.sttStop?.();
      setIsRecording(false);
    } else {
      window.api.sttStart?.();
      setIsRecording(true);
    }
  }, [isRecording]);

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
            prev.map((f) => (f.id === fact.id ? { ...f, savedStatus: 'saved' } : f)),
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
        await window.api.brainstormResolveRouting({
          stagedPath: prompt.stagedPath,
          category: prompt.category,
          destination: chosen,
          remember,
        });
        setFacts((prev) =>
          prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'saved' } : f)),
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

  const toggleIssue = useCallback((id: string) => {
    setExpandedIssueId((prev) => (prev === id ? null : id));
  }, []);

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

      {toast && (
        <div className="brainstorm-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

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
                <p>Tell me about your story. Who are the main characters? What world is it set in? What&apos;s the central conflict?</p>
                <p>Named characters, locations, and world-building notes will appear in the Facts panel — save them to your vault with one click.</p>
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

          <div className="brainstorm-input-area">
            <button
              className={`brainstorm-mic-btn${isRecording ? ' brainstorm-mic-btn-recording' : ''}`}
              onClick={handleMic}
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              title={isRecording ? 'Stop recording' : 'Voice input'}
              type="button"
            >
              🎤
            </button>
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
                placeholder="Tell me about your story world, characters, or plot ideas…"
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
                <li className="brainstorm-facts-empty bs-continuity-empty">No continuity issues flagged.</li>
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
              <span className="brainstorm-facts-count">{facts.length}</span>
            )}
          </div>
          <div className="brainstorm-facts-list">
            {facts.length === 0 ? (
              <div className="brainstorm-facts-empty">
                Named facts will appear here as Claude identifies them.
              </div>
            ) : (
              FACT_TYPE_ORDER.map((type) => {
                const group = facts.filter((f) => f.type === type);
                if (group.length === 0) return null;
                return (
                  <div key={type} className="bs-fact-group">
                    <div className="bs-fact-group-header">{FACT_TYPE_LABELS[type]}s</div>
                    {group.map((fact) => (
                      <div
                        key={fact.id}
                        className={`bs-fact${fact.savedStatus === 'saved' ? ' bs-fact-saved' : ''}`}
                      >
                        <div className="bs-fact-name">{fact.name}</div>
                        <p className="bs-fact-desc">{fact.content}</p>
                        <div className="bs-fact-actions">
                          {fact.savedStatus === 'saving' && (
                            <span className="bs-fact-saving">Saving…</span>
                          )}
                          {fact.savedStatus === 'saved' && (
                            <span className="bs-fact-saved-label">Saved ✓</span>
                          )}
                          {fact.savedStatus === 'pending_review' && (
                            <span className="bs-fact-pending-review">Pending review →</span>
                          )}
                          {fact.savedStatus === 'error' && (
                            <span className="bs-fact-save-error">
                              Failed —{' '}
                              <button
                                className="bs-fact-retry-btn"
                                onClick={() => saveFactToVault(fact.id)}
                              >
                                retry
                              </button>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>

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
    </div>
  );
}
