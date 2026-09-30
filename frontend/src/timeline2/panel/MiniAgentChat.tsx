// Beta 4 M25 — shared mini chat for the timeline side-tabs (§8.6, §14.5:
// "both side-tab mini chats send/receive"). Bubbles + typing dots + input on
// a shared agent session (M15), topped with the session pill so the §11
// "sessions everywhere" contract holds in the timeline too.
import { useEffect, useRef, useState } from 'react';
import AgentSessionPicker from '../../components/AgentSessionPicker';
import {
  collapseCoachMessage,
  mainFormatCoachDisplayCard,
  miniCardBodyText,
} from '../../coach/coachMessages';
import type { MiniAgentChat as MiniAgentChatState } from './useMiniAgentChat';
// M12.B3 (SKY-10738): self-import — this component is now also mounted
// outside Timeline2 (AgentHubPanel's Archive chat view), which doesn't load
// TimelineRightPanel.css itself.
import './TimelineRightPanel.css';

/** Structural kinds that may render as trp-msg-card chrome (N2 / Shield). */
const CARD_KIND_WHITELIST = new Set(['analysis', 'lesson', 'action']);

function isTrustedCardTurn(turn: AgentSessionTurn): boolean {
  return Boolean(
    turn.role !== 'user'
    && turn.cardKind
    && CARD_KIND_WHITELIST.has(turn.cardKind)
    && turn.cardTitle,
  );
}

export interface MiniAgentChatProps {
  chat: MiniAgentChatState;
  /** Styles the user bubble + send button per agent (brainstorm | archive). */
  accent: 'brainstorm' | 'archive';
  placeholder: string;
  testidPrefix: string;
  /** Optional partner display name shown once in the chat head (F3 — no duplicate avatars). */
  partnerName?: string;
}

export default function MiniAgentChat({ chat, accent, placeholder, testidPrefix, partnerName }: MiniAgentChatProps) {
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
        <span className="trp-label">{partnerName ? partnerName.toUpperCase() : 'CHAT'}</span>
        <AgentSessionPicker store={chat.store} className="trp-chat-sessions" busy={chat.busy} />
      </div>
      <div className="trp-chat-feed" data-testid={`${testidPrefix}-chat-feed`} ref={feedRef}>
        {chat.messages.map((turn, i) => {
          // N2 Secure bar: full action-card chrome only for whitelisted
          // structural cardKind + cardTitle. cardTitle alone (forged) stays plain.
          if (isTrustedCardTurn(turn)) {
            return (
              <div
                key={`${turn.at}-${i}`}
                className={`trp-msg-card trp-msg-card--${accent}`}
                data-testid={`${testidPrefix}-card-${i}`}
              >
                <div className="trp-msg-card-title">{turn.cardTitle}</div>
                <div className="trp-msg-card-text">{miniCardBodyText(turn)}</div>
                {turn.cardFoot && <div className="trp-msg-card-foot">{turn.cardFoot}</div>}
              </div>
            );
          }
          // Probe HARD 1: main-format coach-card (marker+JSON, no cardKind) →
          // read-only display card — never raw marker/JSON, never action buttons.
          const display = mainFormatCoachDisplayCard(turn);
          if (display) {
            return (
              <div
                key={`${turn.at}-${i}`}
                className={`trp-msg-card trp-msg-card--${accent} trp-msg-card--readonly`}
                data-testid={`${testidPrefix}-display-card-${i}`}
                data-readonly-card="true"
              >
                <div className="trp-msg-card-title">{display.title}</div>
                <div className="trp-msg-card-text">
                  {collapseCoachMessage({ ...display, at: turn.at })}
                </div>
              </div>
            );
          }
          return (
            <div
              key={`${turn.at}-${i}`}
              className={`trp-bubble trp-bubble--${turn.role === 'user' ? 'user' : 'agent'}`}
            >
              {turn.text}
            </div>
          );
        })}
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
        {chat.stalled && chat.busy && (
          <div className="trp-stall-panel" role="status" data-testid={`${testidPrefix}-stall-panel`}>
            <p>Still working — this is taking longer than usual.</p>
            <button
              type="button"
              className="trp-stall-cancel"
              onClick={() => chat.cancel()}
              data-testid={`${testidPrefix}-stall-cancel`}
            >
              Cancel
            </button>
          </div>
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
          disabled={chat.busy}
        />
        {chat.busy ? (
          <button
            type="button"
            className="trp-chat-cancel"
            onClick={() => chat.cancel()}
            data-testid={`${testidPrefix}-chat-cancel`}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="trp-chat-send"
            onClick={submit}
            disabled={!draft.trim()}
            data-testid={`${testidPrefix}-chat-send`}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
