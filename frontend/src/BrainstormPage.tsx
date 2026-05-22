import { useState, useCallback, useEffect, useRef } from 'react';
import './BrainstormPage.css';

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
  savedStatus: 'unsaved' | 'saving' | 'saved' | 'error';
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
}

export default function BrainstormPage({ onClose }: Props) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [facts, setFacts] = useState<DetectedFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = messagesEndRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  const send = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setPrompt('');

    const userMsg: Message = { role: 'user', text: trimmed };
    const assistantMsg: Message = { role: 'assistant', text: '', streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const history = messages.map((m) => ({ role: m.role, content: m.text }));

    unsubscribeRef.current?.();
    unsubscribeRef.current = window.api.onBrainstormChunk((chunk) => {
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
      const response = await window.api.agentBrainstorm(trimmed, history);

      const extracted = extractFacts(response.text);
      if (extracted.length > 0) {
        setFacts((prev) => [
          ...prev,
          ...extracted.map((f) => ({
            ...f,
            id: `fact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            savedStatus: 'unsaved' as const,
          })),
        ]);
      }

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            text: stripFactTags(response.text) || response.text,
            streaming: false,
          };
        }
        return updated;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => prev.slice(0, -1));
      setError(msg || 'AI unavailable — check your API key in settings.');
    } finally {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      setLoading(false);
    }
  }, [prompt, loading, messages]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const saveFactToVault = useCallback(async (factId: string) => {
    const fact = facts.find((f) => f.id === factId);
    if (!fact) return;

    setFacts((prev) =>
      prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'saving' } : f)),
    );

    try {
      await window.api.entityCreate({
        name: fact.name,
        type: fact.type === 'note' ? 'other' : fact.type,
        prose: fact.content,
        tags: ['brainstorm'],
      });
      setFacts((prev) =>
        prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'saved' } : f)),
      );
    } catch {
      setFacts((prev) =>
        prev.map((f) => (f.id === factId ? { ...f, savedStatus: 'error' } : f)),
      );
    }
  }, [facts]);

  return (
    <div className="brainstorm-page">
      <div className="brainstorm-header">
        <div className="brainstorm-title">
          <span className="brainstorm-icon">🧠</span>
          <h2>Brainstorm Agent</h2>
          <span className="brainstorm-subtitle">Talk through your story — facts auto-extract to your vault</span>
        </div>
        <button className="brainstorm-close-btn" onClick={onClose} aria-label="Close brainstorm">
          ✕
        </button>
      </div>

      <div className="brainstorm-body">
        <div className="brainstorm-chat">
          <div className="brainstorm-messages" aria-live="polite">
            {messages.length === 0 && (
              <div className="brainstorm-empty">
                <p>Tell me about your story. Who are the main characters? What world is it set in? What&apos;s the central conflict?</p>
                <p className="brainstorm-empty-sub">Named characters, locations, and world-building notes will appear in the Facts panel — save them to your vault with one click.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`brainstorm-msg brainstorm-msg-${msg.role}`}>
                {msg.role === 'user' ? (
                  <div className="brainstorm-user-bubble">{msg.text}</div>
                ) : (
                  <div className="brainstorm-assistant-bubble">
                    <div className={`brainstorm-assistant-text${msg.streaming ? ' brainstorm-streaming' : ''}`}>
                      {msg.text}
                      {msg.streaming && <span className="brainstorm-cursor" aria-hidden="true">▍</span>}
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
            <button
              className="brainstorm-send-btn"
              onClick={send}
              disabled={!prompt.trim() || loading}
            >
              {loading ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </div>

        <div className="brainstorm-facts-panel">
          <div className="brainstorm-facts-header">
            Detected Facts
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
                <div key={fact.id} className={`brainstorm-fact brainstorm-fact-${fact.savedStatus}`}>
                  <div className="brainstorm-fact-header">
                    <span className={`brainstorm-fact-type brainstorm-type-${fact.type}`}>
                      {FACT_TYPE_LABELS[fact.type]}
                    </span>
                    <span className="brainstorm-fact-name">{fact.name}</span>
                  </div>
                  <p className="brainstorm-fact-content">{fact.content}</p>
                  <div className="brainstorm-fact-actions">
                    {fact.savedStatus === 'unsaved' && (
                      <button
                        className="brainstorm-save-btn"
                        onClick={() => saveFactToVault(fact.id)}
                        aria-label={`Save ${fact.name} to vault`}
                      >
                        Save to Vault
                      </button>
                    )}
                    {fact.savedStatus === 'saving' && (
                      <span className="brainstorm-saving">Saving…</span>
                    )}
                    {fact.savedStatus === 'saved' && (
                      <span className="brainstorm-saved">Saved ✓</span>
                    )}
                    {fact.savedStatus === 'error' && (
                      <span className="brainstorm-save-error">
                        Failed —{' '}
                        <button className="brainstorm-retry-btn" onClick={() => saveFactToVault(fact.id)}>
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
