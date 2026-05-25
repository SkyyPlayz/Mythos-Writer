import { useState, useCallback, useEffect, useRef } from 'react';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
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

const DRAFT_KEY = 'brainstorm:draft';
const MAX_DRAFT_BYTES = 2 * 1024 * 1024; // 2 MB

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
  savedStatus: 'unsaved' | 'saving' | 'saved' | 'error' | 'pending_review';
}

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
  const [continuityIssues, setContinuityIssues] = useState<ContinuityIssue[]>([]);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, ContinuityAnswerDraft>>({});
  const [draftSizeWarning, setDraftSizeWarning] = useState(false);
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);

  const streamIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef<string>('');
  const cleanupStreamRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { announce, liveText } = useLiveAnnounce();

  // Restore draft from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft: Partial<BrainstormDraft> & { v?: number } = JSON.parse(raw);
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

  const cancelStream = useCallback(() => {
    const sid = streamIdRef.current;
    if (!sid) return;
    void window.api.streamCancel(sid);
    cleanupStreamRef.current?.();
    setMessages((prev) => prev.slice(0, -1));
    setLoading(false);
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

    streamingTextRef.current = '';

    const unsubToken = window.api.onStreamToken(({ streamId: sid, token }) => {
      if (sid !== streamIdRef.current) return;
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
          (async () => {
            try {
              const listResult = await window.api.entityList();
              const existingEntities: Array<{ id: string; name: string; path: string }> =
                (listResult as { entities?: Array<{ id: string; name: string; path: string }> })?.entities ?? [];
              const existing = existingEntities.find(
                (e) => e.name.toLowerCase() === fact.name.toLowerCase(),
              );
              if (existing) {
                const suggestionId = crypto.randomUUID();
                const now = new Date().toISOString();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (window.api as any).suggestionsUpsert({
                  id: suggestionId,
                  source_agent: 'brainstorm',
                  confidence: 0.8,
                  rationale: `Brainstorm proposes updating "${fact.name}" (${fact.type}): ${fact.content}`,
                  target_kind: 'vault',
                  target_path: existing.path,
                  target_anchor: null,
                  payload_json: JSON.stringify({ prose: `# ${fact.name}\n\n${fact.content}\n` }),
                  status: 'proposed',
                  created_at: now,
                  applied_at: null,
                  applied_run_id: null,
                  budget_exceeded: 0,
                });
                setFacts((prev) =>
                  prev.map((f2) => (f2.id === fact.id ? { ...f2, savedStatus: 'pending_review' } : f2)),
                );
              } else {
                await window.api.entityCreate({
                  name: fact.name,
                  type: fact.type === 'note' ? 'other' : fact.type,
                  prose: fact.content,
                  tags: ['brainstorm'],
                });
                setFacts((prev) =>
                  prev.map((f2) => (f2.id === fact.id ? { ...f2, savedStatus: 'saved' } : f2)),
                );
              }
            } catch {
              setFacts((prev) =>
                prev.map((f2) => (f2.id === fact.id ? { ...f2, savedStatus: 'error' } : f2)),
              );
            }
          })();
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

    const unsubError = window.api.onStreamError(({ streamId: sid, message }) => {
      if (sid !== streamIdRef.current) return;
      cleanupStreamRef.current?.();
      setMessages((prev) => prev.slice(0, -1));
      const msg = message || 'AI unavailable — check your API key in settings.';
      setError(msg);
      announce(`Error: ${msg}`);
      setLoading(false);
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
        system: BRAINSTORM_SYSTEM_PROMPT,
      });
      streamIdRef.current = sid;
    } catch (err) {
      cleanupStreamRef.current?.();
      setMessages((prev) => prev.slice(0, -1));
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'AI unavailable — check your API key in settings.');
      announce(`Error: ${msg}`);
      setLoading(false);
    }
  }, [prompt, loading, messages, announce]);

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

  const saveFactToVault = useCallback(
    async (factId: string) => {
      const fact = facts.find((f) => f.id === factId);
      if (!fact) return;

      setFacts((prev) =>
        prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'saving' } : f)),
      );

      try {
        // Check if an entity with the same name already exists.
        // If it does, the edit must go through the suggestion/confirmation flow.
        const listResult = await window.api.entityList();
        const existingEntities: Array<{ id: string; name: string; path: string }> =
          (listResult as { entities?: Array<{ id: string; name: string; path: string }> })?.entities ?? [];
        const existing = existingEntities.find(
          (e) => e.name.toLowerCase() === fact.name.toLowerCase(),
        );

        if (existing) {
          const suggestionId = crypto.randomUUID();
          const now = new Date().toISOString();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (window.api as any).suggestionsUpsert({
            id: suggestionId,
            source_agent: 'brainstorm',
            confidence: 0.8,
            rationale: `Brainstorm proposes updating "${fact.name}" (${fact.type}): ${fact.content}`,
            target_kind: 'vault',
            target_path: existing.path,
            target_anchor: null,
            payload_json: JSON.stringify({ prose: `# ${fact.name}\n\n${fact.content}\n` }),
            status: 'proposed',
            created_at: now,
            applied_at: null,
            applied_run_id: null,
            budget_exceeded: 0,
          });
          setFacts((prev) =>
            prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'pending_review' } : f)),
          );
        } else {
          await window.api.entityCreate({
            name: fact.name,
            type: fact.type === 'note' ? 'other' : fact.type,
            prose: fact.content,
            tags: ['brainstorm'],
          });
          setFacts((prev) =>
            prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'saved' } : f)),
          );
        }
      } catch {
        setFacts((prev) =>
          prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'error' } : f)),
        );
      }
    },
    [facts],
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
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {error && (
            <div className="brainstorm-error" role="alert">{error}</div>
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
            <textarea
              className="brainstorm-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Tell me about your story world, characters, or plot ideas…"
              rows={3}
              disabled={loading}
              aria-label="Brainstorm prompt"
            />
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
              facts.map((fact) => (
                <div
                  key={fact.id}
                  className={`bs-fact${fact.savedStatus === 'saved' ? ' bs-fact-saved' : ''}`}
                >
                  <span className={`bs-fact-type bs-fact-type-${fact.type === 'note' ? 'other' : fact.type}`}>
                    {FACT_TYPE_LABELS[fact.type]}
                  </span>
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
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
