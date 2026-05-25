import { useState, useCallback, useEffect, useRef } from 'react';
import type { Scene } from './types';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import { useWritingScheduler } from './hooks/useWritingScheduler';

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
  const unsubscribeRef = useRef<(() => void) | null>(null);
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
    };
  }, []);

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

    // Subscribe to streaming chunks before invoking
    unsubscribeRef.current?.();
    unsubscribeRef.current = window.api.onWritingAssistantChunk((chunk) => {
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
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => prev.slice(0, -1)); // remove the empty assistant bubble
      const errorMsg = msg || 'AI unavailable — check your API key in settings.';
      setError(errorMsg);
      announce(`Error: ${errorMsg}`);
    } finally {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      setLoading(false);
    }
  }, [prompt, loading, scene]);

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
        <button
          className="writing-assistant-btn"
          onClick={ask}
          disabled={!prompt.trim() || loading}
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
