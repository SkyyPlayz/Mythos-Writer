import { useState, useCallback, useEffect, useRef } from 'react';
import type { Scene } from './types';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import { useWritingScheduler } from './hooks/useWritingScheduler';

export const STALL_TIMEOUT_MS = 20_000;
export const HARD_TIMEOUT_MS = 90_000;

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
  scanIntervalSeconds?: number;
  isActive?: boolean;
}

export default function WritingAssistantPanel({
  scene,
  enabled = true,
  scanIntervalSeconds = 60,
  isActive = true,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamPhase, setStreamPhase] = useState<'idle' | 'streaming' | 'stalled'>('idle');
  const [cancelledToast, setCancelledToast] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  // Generation counter: each _doAsk call owns a unique gen; incrementing invalidates older calls.
  const askGenRef = useRef(0);
  const lastTokenAtRef = useRef<number>(0);
  const lastPromptRef = useRef<string>('');
  const lastContextRef = useRef<string | undefined>(undefined);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { announce, liveText } = useLiveAnnounce();

  const { result: scheduledResult } = useWritingScheduler({
    scene,
    enabled,
    scanIntervalSeconds,
    isActive,
  });

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Stall detection: 20 s no-token → warn; 90 s → hard abort (flag-based, no IPC cancel)
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      const sinceLastToken = Date.now() - lastTokenAtRef.current;
      if (sinceLastToken >= HARD_TIMEOUT_MS) {
        askGenRef.current++; // invalidate running _doAsk
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
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

  // Core ask logic — shared by ask() and retryFromStalled().
  // Each call takes a snapshot of the gen counter; stale calls are silently discarded.
  const _doAsk = useCallback(async (askPrompt: string, context: string | undefined) => {
    const myGen = ++askGenRef.current;
    lastTokenAtRef.current = Date.now();
    lastPromptRef.current = askPrompt;
    lastContextRef.current = context;
    setStreamPhase('streaming');

    unsubscribeRef.current?.();
    unsubscribeRef.current = window.api.onWritingAssistantChunk((chunk) => {
      if (myGen !== askGenRef.current) return; // stale call
      lastTokenAtRef.current = Date.now();
      setStreamPhase((prev) => (prev === 'stalled' ? 'streaming' : prev));
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
      const response = await window.api.agentWritingAssistant(askPrompt, context);

      if (myGen !== askGenRef.current) return; // stale — cancelled or superseded

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
      if (myGen !== askGenRef.current) return; // stale
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => prev.slice(0, -1));
      const errorMsg = msg || 'AI unavailable — check your API key in settings.';
      setError(errorMsg);
      announce(`Error: ${errorMsg}`);
    } finally {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      if (myGen === askGenRef.current) {
        setLoading(false);
        setStreamPhase('idle');
      }
    }
  }, [announce]);

  const ask = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setPrompt('');
    announce('Generating response…');

    const userMsg: Message = { role: 'user', text: trimmed };
    const assistantMsg: Message = { role: 'assistant', text: '', streaming: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const context = scene
      ? `Scene: "${scene.title}"\n\n${scene.blocks.map((b) => b.content).join('\n\n')}`
      : undefined;

    await _doAsk(trimmed, context);
  }, [prompt, loading, scene, announce, _doAsk]);

  const cancelAsk = useCallback(() => {
    askGenRef.current++; // invalidate any running _doAsk
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setMessages((prev) => prev.slice(0, -1));
    setLoading(false);
    setStreamPhase('idle');
    setCancelledToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setCancelledToast(false), 3000);
  }, []);

  const retryFromStalled = useCallback(async () => {
    // _doAsk will bump askGenRef, invalidating the old call automatically
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    // Reset the streaming bubble without removing it
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = { ...last, text: '', streaming: true };
      }
      return updated;
    });
    announce('Retrying…');
    await _doAsk(lastPromptRef.current, lastContextRef.current);
  }, [announce, _doAsk]);

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

      {cancelledToast && (
        <div className="wa-cancelled-toast" role="status" aria-live="polite">
          Generation cancelled.
        </div>
      )}

      <div className="writing-assistant-header">
        <p className="writing-assistant-hint">
          {scene
            ? <><strong>Writing Assistant</strong> — context: <em>{scene.title}</em></>
            : <><strong>Writing Assistant</strong> — no scene selected, asking freely.</>}
        </p>
      </div>

      {scheduledResult && scheduledResult.tips.length > 0 && (
        <div className="wa-scheduled-tips" aria-label="Writing tips">
          <p className="wa-tips-heading">Writing tips</p>
          <ul className="wa-tips-list">
            {scheduledResult.tips.map((tip, i) => (
              <li key={i} className="wa-tip-item">{tip}</li>
            ))}
          </ul>
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

      {streamPhase === 'stalled' && loading && (
        <div className="wa-stalled-panel" role="status" aria-label="Generation stalled">
          <p className="wa-stalled-msg">
            This is taking longer than expected — the network or provider may be slow.
          </p>
          <div className="wa-stalled-actions">
            <button
              className="wa-stalled-retry-btn"
              onClick={() => void retryFromStalled()}
              type="button"
              aria-label="Retry generation"
            >
              Retry
            </button>
            <button
              className="wa-stalled-cancel-btn"
              onClick={cancelAsk}
              type="button"
              aria-label="Cancel generation"
            >
              Cancel
            </button>
          </div>
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
        {loading ? (
          <button
            className="writing-assistant-cancel-btn"
            onClick={cancelAsk}
            type="button"
            aria-label="Cancel generation"
          >
            Cancel
          </button>
        ) : (
          <button
            className="writing-assistant-btn"
            onClick={ask}
            disabled={!prompt.trim()}
          >
            Ask
          </button>
        )}
      </div>
    </div>
  );
}
