import { useState, useCallback, useEffect, useRef } from 'react';
import type { Scene } from './types';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import { useMicButton } from './hooks/useMicButton';

const STALLED_TIMEOUT_MS = 30_000;

const WA_DRAFT_PREFIX = 'mythos-wa-draft';
function waDraftKey(sceneId: string | null) {
  return `${WA_DRAFT_PREFIX}-${sceneId ?? 'global'}`;
}

interface WritingAssistantSuggestion {
  id: string;
  source_agent: 'writing-assistant';
  text: string;
  confidence: number;
  rationale: string;
  timestamp: string;
  status: 'proposed' | 'accepted' | 'rejected';
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  suggestion?: WritingAssistantSuggestion;
}

interface Props {
  scene: Scene | null;
  enabled?: boolean;
  micDeviceId?: string;
}

function downloadConversation(messages: Message[], sceneName?: string) {
  const lines = messages
    .filter((m) => !m.streaming)
    .map((m) =>
      m.role === 'user'
        ? `## You\n\n${m.text}`
        : `## Writing Assistant\n\n${m.text}`
    )
    .join('\n\n---\n\n');
  const blob = new Blob([lines], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const suffix = sceneName ? `-${sceneName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}` : '';
  a.download = `writing-assistant${suffix}-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function WritingAssistantPanel({ scene, enabled = true, micDeviceId }: Props) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const generationIdRef = useRef(0);
  const stalledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { announce, liveText } = useLiveAnnounce();

  const { micState, startRecording } = useMicButton({
    micDeviceId,
    onTranscript: (text, isFinal) => {
      if (isFinal) setPrompt((p) => (p ? p + ' ' + text : text));
      else setPrompt(text);
    },
    onError: (msg) => setError(msg),
  });

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  // Warn on browser close/refresh when generation is in progress
  useEffect(() => {
    if (!loading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [loading]);

  // Restore draft when scene changes
  useEffect(() => {
    const key = waDraftKey(scene?.id ?? null);
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed: Message[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed.map((m) => ({ ...m, streaming: false })));
          setDraftRestored(true);
          return;
        }
      }
    } catch {
      // ignore corrupt draft
    }
    setMessages([]);
    setDraftRestored(false);
  }, [scene?.id]);

  // Persist messages to localStorage on change
  useEffect(() => {
    if (messages.length === 0) return;
    const settled = messages.filter((m) => !m.streaming);
    if (settled.length === 0) return;
    const key = waDraftKey(scene?.id ?? null);
    try {
      localStorage.setItem(key, JSON.stringify(settled));
    } catch {
      // storage quota — silently ignore
    }
  }, [messages, scene?.id]);

  const cancelGeneration = useCallback(() => {
    generationIdRef.current++;
    if (stalledTimerRef.current) {
      clearTimeout(stalledTimerRef.current);
      stalledTimerRef.current = null;
    }
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setStalled(false);
    setLoading(false);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        if (last.text) {
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        }
        return prev.slice(0, -2);
      }
      return prev;
    });
    announce('Generation cancelled.');
  }, [announce]);

  const ask = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    const myGen = ++generationIdRef.current;
    const isMine = () => generationIdRef.current === myGen;

    setLoading(true);
    setStalled(false);
    setError(null);
    setPrompt('');
    announce('Generating response…');

    const userMsg: Message = { role: 'user', text: trimmed };
    const assistantMsg: Message = { role: 'assistant', text: '', streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const context = scene
      ? `Scene: "${scene.title}"\n\n${scene.blocks.map((b) => b.content).join('\n\n')}`
      : undefined;

    const resetStalledTimer = () => {
      if (stalledTimerRef.current) clearTimeout(stalledTimerRef.current);
      stalledTimerRef.current = setTimeout(() => {
        if (isMine()) setStalled(true);
      }, STALLED_TIMEOUT_MS);
    };
    resetStalledTimer();

    // Subscribe to streaming chunks before invoking
    unsubscribeRef.current?.();
    unsubscribeRef.current = window.api.onWritingAssistantChunk((chunk) => {
      if (!isMine()) return;
      resetStalledTimer();
      setStalled(false);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          updated[updated.length - 1] = { ...last, text: last.text + chunk };
        }
        return updated;
      });
    });

    try {
      const response = await window.api.agentWritingAssistant(trimmed, context);

      if (!isMine()) return;

      const suggestion: WritingAssistantSuggestion = {
        id: `wa-${Date.now()}`,
        source_agent: 'writing-assistant',
        text: response.text,
        confidence: 0.85,
        rationale: 'User-requested writing advice',
        timestamp: new Date().toISOString(),
        status: 'proposed',
      };

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, text: response.text, streaming: false, suggestion };
        }
        return updated;
      });
      announce('Response ready.');
    } catch (err) {
      if (!isMine()) return;
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => prev.slice(0, -1)); // remove the empty assistant bubble
      const errorMsg = msg || 'AI unavailable — check your API key in settings.';
      setError(errorMsg);
      announce(`Error: ${errorMsg}`);
    } finally {
      if (isMine()) {
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        if (stalledTimerRef.current) {
          clearTimeout(stalledTimerRef.current);
          stalledTimerRef.current = null;
        }
        setStalled(false);
        setLoading(false);
      }
    }
  }, [prompt, loading, scene, announce]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  const applySuggestionStatus = (id: string, status: 'accepted' | 'rejected') => {
    setMessages((prev) =>
      prev.map((m) =>
        m.suggestion?.id === id
          ? { ...m, suggestion: { ...m.suggestion, status } }
          : m,
      ),
    );
  };

  if (!enabled) {
    return (
      <div className="writing-assistant-panel writing-assistant-disabled">
        <p className="writing-assistant-disabled-msg">Writing Assistant is disabled. Enable it in Settings.</p>
      </div>
    );
  }

  return (
    <div className="writing-assistant-panel">
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveText}
      </span>

      <div className="writing-assistant-header">
        <p className="writing-assistant-hint">
          {scene
            ? <><strong>Writing Assistant</strong> — context: <em>{scene.title}</em></>
            : <><strong>Writing Assistant</strong> — no scene selected, asking freely.</>}
        </p>
        {messages.length > 0 && (
          <div className="wa-header-actions">
            <button
              className="wa-download-btn"
              onClick={() => downloadConversation(messages, scene?.title)}
              aria-label="Download conversation"
              title="Download as Markdown"
            >
              Download
            </button>
            <button
              className="wa-clear-btn"
              onClick={() => {
                localStorage.removeItem(waDraftKey(scene?.id ?? null));
                setMessages([]);
                setDraftRestored(false);
              }}
              aria-label="Clear conversation"
              title="Clear conversation"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {draftRestored && (
        <div className="wa-draft-banner" role="status" aria-label="Draft restored">
          Conversation restored from last session.{' '}
          <button className="wa-draft-dismiss" onClick={() => setDraftRestored(false)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="writing-assistant-messages">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`wa-message wa-message-${msg.role}`}
          >
            {msg.role === 'user' ? (
              <div className="wa-user-bubble">{msg.text}</div>
            ) : (
              <div className="wa-assistant-bubble">
                <div
                  className={`wa-assistant-text${msg.streaming ? ' wa-streaming' : ''}`}
                  aria-label="Writing assistant response"
                >
                  {msg.text}
                  {msg.streaming && <span className="wa-cursor" aria-hidden="true">▍</span>}
                </div>
                {!msg.streaming && msg.suggestion && msg.suggestion.status === 'proposed' && (
                  <div className="wa-suggestion-actions">
                    <button
                      className="wa-btn wa-btn-accept"
                      onClick={() => applySuggestionStatus(msg.suggestion!.id, 'accepted')}
                      aria-label="Accept suggestion"
                    >
                      Accept
                    </button>
                    <button
                      className="wa-btn wa-btn-reject"
                      onClick={() => applySuggestionStatus(msg.suggestion!.id, 'rejected')}
                      aria-label="Reject suggestion"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {!msg.streaming && msg.suggestion && msg.suggestion.status !== 'proposed' && (
                  <div className={`wa-suggestion-status wa-status-${msg.suggestion.status}`}>
                    {msg.suggestion.status === 'accepted' ? 'Accepted' : 'Dismissed'}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {messages.length === 0 && !error && (
          <div className="writing-assistant-empty">
            Ask for writing advice — pacing, voice, clarity, what to try next.
          </div>
        )}
      </div>

      {error && (
        <div className="writing-assistant-error" role="alert">
          {error}
        </div>
      )}

      {stalled && (
        <div className="wa-stalled" role="status">
          Generation appears stalled — no response for {STALLED_TIMEOUT_MS / 1000}s.{' '}
          <button className="wa-stalled-cancel" onClick={cancelGeneration}>
            Cancel and retry
          </button>
        </div>
      )}

      <div className="writing-assistant-input-area">
        <textarea
          className="writing-assistant-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKey}
          placeholder="How can I make this scene more tense?"
          rows={3}
          disabled={loading}
          aria-label="Writing assistant prompt"
        />
        <div className="writing-assistant-input-actions">
          {loading && (
            <button
              className="wa-cancel-btn"
              onClick={cancelGeneration}
              aria-label="Cancel generation"
            >
              Cancel
            </button>
          )}
          <button
            className={`wa-mic-btn${micState === 'recording' ? ' wa-mic-btn--recording' : ''}${micState === 'error' ? ' wa-mic-btn--error' : ''}`}
            onClick={startRecording}
            disabled={loading}
            aria-label={micState === 'recording' ? 'Stop recording' : 'Start voice input'}
            title={micState === 'recording' ? 'Stop recording' : 'Voice input'}
          >
            {micState === 'recording' ? '⏹' : '🎤'}
          </button>
          <button
            className="writing-assistant-btn"
            onClick={ask}
            disabled={!prompt.trim() || loading}
          >
            {loading ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}
