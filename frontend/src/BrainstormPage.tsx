import { useState, useCallback, useEffect, useRef } from 'react';
import './BrainstormPage.css';

interface DetectedFact {
  id: string;
  type: 'character' | 'location' | 'item' | 'concept' | 'other';
  name: string;
  description: string;
  saved: boolean;
  saving: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

const ENTITY_TYPES = ['character', 'location', 'item', 'concept', 'other'] as const;

function parseFacts(text: string): Omit<DetectedFact, 'id' | 'saved' | 'saving'>[] {
  const factRegex = /\[FACT:(\w+)\|([^|]+)\|([^\]]+)\]/g;
  const facts: Omit<DetectedFact, 'id' | 'saved' | 'saving'>[] = [];
  let match: RegExpExecArray | null;
  while ((match = factRegex.exec(text)) !== null) {
    const rawType = match[1].toLowerCase();
    const type = (ENTITY_TYPES.includes(rawType as typeof ENTITY_TYPES[number])
      ? rawType
      : 'other') as DetectedFact['type'];
    facts.push({ type, name: match[2].trim(), description: match[3].trim() });
  }
  return facts;
}

// Strip FACT tags from displayed chat text
function displayText(text: string): string {
  return text.replace(/\[FACT:[^\]]+\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

interface Props {
  onBack: () => void;
}

export default function BrainstormPage({ onBack }: Props) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<DetectedFact[]>([]);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, text: response.text, streaming: false };
        }
        return updated;
      });

      const newFacts = parseFacts(response.text);
      if (newFacts.length > 0) {
        setFacts((prev) => [
          ...prev,
          ...newFacts.map((f) => ({
            ...f,
            id: crypto.randomUUID(),
            saved: false,
            saving: false,
          })),
        ]);
      }

      setHistory((prev) => [
        ...prev,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: response.text },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => prev.slice(0, -1));
      setError(msg || 'AI unavailable — check your ANTHROPIC_API_KEY.');
    } finally {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      setLoading(false);
    }
  }, [prompt, loading, history]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const saveFactToVault = useCallback(
    async (factId: string) => {
      const fact = facts.find((f) => f.id === factId);
      if (!fact || fact.saved || fact.saving) return;

      setFacts((prev) => prev.map((f) => (f.id === factId ? { ...f, saving: true } : f)));
      try {
        await window.api.entityCreate({
          name: fact.name,
          type: fact.type,
          prose: fact.description,
          tags: ['brainstorm'],
        });
        setFacts((prev) =>
          prev.map((f) => (f.id === factId ? { ...f, saving: false, saved: true } : f)),
        );
      } catch {
        setFacts((prev) => prev.map((f) => (f.id === factId ? { ...f, saving: false } : f)));
      }
    },
    [facts],
  );

  return (
    <div className="brainstorm-page">
      <div className="brainstorm-header">
        <button className="brainstorm-back-btn" onClick={onBack}>
          ← Editor
        </button>
        <div className="brainstorm-header-text">
          <h2 className="brainstorm-title">Brainstorm Agent</h2>
          <p className="brainstorm-subtitle">
            Talk through your story, world, and characters. Named facts will appear on the right to
            save to your vault.
          </p>
        </div>
      </div>

      <div className="brainstorm-body">
        {/* Chat column */}
        <div className="brainstorm-chat-col">
          <div className="brainstorm-messages" aria-live="polite">
            {messages.length === 0 && !error && (
              <div className="brainstorm-empty">
                What story are you building? Describe your world, characters, plot ideas, or
                goals — I'll help you develop them and extract key facts as we talk.
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`bs-message bs-message-${msg.role}`}>
                {msg.role === 'user' ? (
                  <div className="bs-user-bubble">{msg.text}</div>
                ) : (
                  <div className="bs-assistant-bubble">
                    <div
                      className={`bs-assistant-text${msg.streaming ? ' bs-streaming' : ''}`}
                      aria-label="Brainstorm agent response"
                    >
                      {displayText(msg.text)}
                      {msg.streaming && (
                        <span className="bs-cursor" aria-hidden="true">
                          ▍
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {error && (
              <div className="brainstorm-error" role="alert">
                {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="brainstorm-input-area">
            <textarea
              className="brainstorm-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Tell me about your protagonist, your world, or your plot ideas…"
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

        {/* Detected Facts panel */}
        <div className="brainstorm-facts-col">
          <div className="brainstorm-facts-header">
            <span className="brainstorm-facts-title">Detected Facts</span>
            {facts.length > 0 && (
              <span className="brainstorm-facts-count">{facts.length}</span>
            )}
          </div>
          <div className="brainstorm-facts-list">
            {facts.length === 0 ? (
              <div className="brainstorm-facts-empty">
                Named characters, locations, and items the agent identifies will appear here.
              </div>
            ) : (
              facts.map((fact) => (
                <div key={fact.id} className={`bs-fact${fact.saved ? ' bs-fact-saved' : ''}`}>
                  <span className={`bs-fact-type bs-fact-type-${fact.type}`}>{fact.type}</span>
                  <div className="bs-fact-name">{fact.name}</div>
                  <div className="bs-fact-desc">{fact.description}</div>
                  {!fact.saved ? (
                    <button
                      className="bs-fact-save-btn"
                      onClick={() => saveFactToVault(fact.id)}
                      disabled={fact.saving}
                    >
                      {fact.saving ? 'Saving…' : 'Save to vault'}
                    </button>
                  ) : (
                    <span className="bs-fact-saved-label">Saved ✓</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
