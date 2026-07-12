// SKY-6663: M15 follow-up — Archive Agent in-panel chat (net-new; ArchivePanel.tsx
// is a suggestion-review list, not a conversational surface). Mirrors the
// Writing Assistant chat pattern (await full response + progressive chunk
// events) rather than BrainstormPage's raw stream:* primitive, since the new
// agent:archive channel already gives us Archive's own enabled/budget/
// provider/persona settings — see main.ts registerArchiveHandler.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Scene } from './types';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import type { UseAgentSessionsResult } from './lib/useAgentSessions';
import './ArchiveChatView.css';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

interface Props {
  scene: Scene | null;
  sessionStore: UseAgentSessionsResult;
  displayName: string;
  /** Gates the composer, mirroring WritingAssistantPanel's `enabled` contract. */
  enabled?: boolean;
}

const GREETING = "I'm the Archive Agent — continuity guardian and timeline builder. Ask me to check facts, catch inconsistencies, or build your timeline.";

export default function ArchiveChatView({ scene, sessionStore, displayName, enabled = true }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { announce, liveText } = useLiveAnnounce();
  const requestIdRef = useRef(0);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const clearStreamListener = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  useEffect(() => () => clearStreamListener(), [clearStreamListener]);

  // Switching/creating/duplicating a session clears the visible transcript —
  // the store has no "read session" IPC yet (see useAgentSessions.ts), so
  // there is nothing to restore. This at least makes the picker's actions
  // visibly do something, same as they will once that read path lands.
  useEffect(() => {
    requestIdRef.current += 1;
    clearStreamListener();
    setMessages([]);
    setPrompt('');
    setLoading(false);
    setError(null);
  }, [sessionStore.activeSessionId, clearStreamListener]);

  const send = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    setPrompt('');
    setLoading(true);
    setError(null);
    announce('Generating response…');

    const userMsg: Message = { role: 'user', text: trimmed };
    const assistantMsg: Message = { role: 'assistant', text: '', streaming: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const sceneText = scene
      ? `Scene: "${scene.title}"\n\n${scene.blocks.map((b) => b.content).join('\n\n')}`
      : undefined;

    clearStreamListener();
    unsubscribeRef.current = window.api.onArchiveChunk((chunk) => {
      if (requestIdRef.current !== requestId) return;
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
      const response = await window.api.agentArchive(trimmed, sceneText);
      if (requestIdRef.current !== requestId) return;

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, text: response.text, streaming: false };
        }
        return updated;
      });
      announce('Response ready.');

      const now = new Date().toISOString();
      void sessionStore.appendTurns([
        { role: 'user', text: trimmed, at: now },
        { role: 'agent', text: response.text, at: now },
      ]);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => prev.slice(0, -1)); // drop the empty assistant bubble
      const errorMsg = msg || 'Archive Agent unavailable — check your API key in settings.';
      setError(errorMsg);
      announce(`Error: ${errorMsg}`);
    } finally {
      if (requestIdRef.current === requestId) {
        clearStreamListener();
        setLoading(false);
      }
    }
  }, [announce, clearStreamListener, loading, prompt, scene, sessionStore]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }, [send]);

  if (!enabled) {
    return (
      <div className="archive-chat archive-chat--disabled">
        <p className="archive-chat-disabled-msg">Archive Agent is disabled. Enable it in Settings.</p>
      </div>
    );
  }

  return (
    <div className="archive-chat">
      <span aria-live="polite" aria-atomic="true" className="sr-only">{liveText}</span>

      <div className="archive-chat-messages" role="list">
        {messages.length === 0 && (
          <div className="archive-chat-message archive-chat-message-assistant" role="listitem">
            <div className="archive-chat-bubble archive-chat-bubble-assistant">{GREETING}</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`archive-chat-message archive-chat-message-${msg.role}`} role="listitem">
            {msg.role === 'user' ? (
              <div className="archive-chat-bubble archive-chat-bubble-user">{msg.text}</div>
            ) : (
              <div
                className={`archive-chat-bubble archive-chat-bubble-assistant${msg.streaming ? ' archive-chat-streaming' : ''}`}
                aria-label={`${displayName} response`}
              >
                {msg.text}
                {msg.streaming && <span className="archive-chat-cursor" aria-hidden="true">&#x258c;</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="archive-chat-error" role="alert">{error}</div>
      )}

      <div className="archive-chat-input-area">
        <textarea
          className="archive-chat-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about continuity, timeline, or facts…"
          rows={3}
          disabled={loading}
          aria-label="Archive Agent prompt"
        />
        <button
          type="button"
          className="archive-chat-send-btn"
          onClick={() => void send()}
          disabled={loading || !prompt.trim()}
          aria-label="Send"
        >
          {loading ? 'Thinking…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
