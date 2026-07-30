// Beta 4 M25 — shared mini chat for the timeline side-tabs (§8.6, §14.5:
// "both side-tab mini chats send/receive"). Bubbles + typing dots + input on
// a shared agent session (M15), topped with the session pill so the §11
// "sessions everywhere" contract holds in the timeline too.
import { useEffect, useRef, useState } from 'react';
import AgentSessionPicker from '../../components/AgentSessionPicker';
import type { MiniAgentChat as MiniAgentChatState } from './useMiniAgentChat';

export interface MiniAgentChatProps {
  chat: MiniAgentChatState;
  /** Styles the user bubble + send button per agent (brainstorm | archive). */
  accent: 'brainstorm' | 'archive';
  placeholder: string;
  testidPrefix: string;
}

export default function MiniAgentChat({ chat, accent, placeholder, testidPrefix }: MiniAgentChatProps) {
  const [draft, setDraft] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.pendingPrompt]);

  const submit = () => {
    const text = draft.trim();
    if (!text || chat.busy) return;
    setDraft('');
    void chat.send(text);
  };

  return (
    <div className={`trp-chat trp-chat--${accent}`} data-testid={`${testidPrefix}-chat`}>
      <div className="trp-chat-head">
        <span className="trp-label">CHAT</span>
        <AgentSessionPicker store={chat.store} className="trp-chat-sessions" busy={chat.busy} />
      </div>
      <div className="trp-chat-feed" data-testid={`${testidPrefix}-chat-feed`} ref={feedRef}>
        {chat.messages.map((turn, i) => (
          turn.role !== 'user' && turn.cardTitle ? (
            <div
              key={`${turn.at}-${i}`}
              className={`trp-msg-card trp-msg-card--${accent}`}
              data-testid={`${testidPrefix}-card-${i}`}
            >
              <div className="trp-msg-card-title">{turn.cardTitle}</div>
              <div className="trp-msg-card-text">{turn.text}</div>
              {turn.cardFoot && <div className="trp-msg-card-foot">{turn.cardFoot}</div>}
            </div>
          ) : (
            <div
              key={`${turn.at}-${i}`}
              className={`trp-bubble trp-bubble--${turn.role === 'user' ? 'user' : 'agent'}`}
            >
              {turn.text}
            </div>
          )
        ))}
        {chat.pendingPrompt !== null && (
          <>
            <div className="trp-bubble trp-bubble--user">{chat.pendingPrompt}</div>
            <div className="trp-typing" data-testid={`${testidPrefix}-typing`} aria-label="Agent is typing">
              <span className="trp-typing-dot" />
              <span className="trp-typing-dot trp-typing-dot--d2" />
              <span className="trp-typing-dot trp-typing-dot--d3" />
            </div>
          </>
        )}
        {chat.error && (
          <div className="trp-chat-error" role="alert" data-testid={`${testidPrefix}-chat-error`}>
            {chat.error}
          </div>
        )}
      </div>
      <div className="trp-chat-input-row">
        <input
          className="trp-chat-input"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          aria-label={placeholder}
          data-testid={`${testidPrefix}-chat-input`}
        />
        <button
          type="button"
          className="trp-chat-send"
          onClick={submit}
          disabled={chat.busy || !draft.trim()}
          data-testid={`${testidPrefix}-chat-send`}
        >
          Send
        </button>
      </div>
    </div>
  );
}
