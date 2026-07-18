// Beta 4 M12 — the Writing Coach's page (§5.2; prototype "Writing Coach" screen).
//
// Header (grad-cap icon tile, `…never ghost-writes` sub, session pill, 3 skill
// chips) · 760px-centered chat feed (user/coach bubbles, lesson cards with
// drill footers, analysis cards) · typing dots · chips row · input · footer ·
// right rail SUGGESTIONS (collapsible General + per-chapter groups, current
// marked, click prefills `Teach me: …`).
//
// Agent contract (§2, §14.6): the coach TEACHES — no code path from this page
// may generate manuscript prose or write into scenes. Locked by
// coachNoGhostwriting.test.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Scene, Story } from '../types';
import type { NamedAgentId } from '../agents/agentIdentity';
import { resolveAgentDisplayName } from '../agents/agentIdentity';
import AgentSessionPicker from '../components/AgentSessionPicker';
import type { UnifiedSuggestion } from '../SuggestionDetailPane';
import { useCoachConversation } from './useCoachConversation';
import { useSceneAnalysisPending } from './sceneAnalysis';
import type { CoachMessage } from './coachMessages';
import {
  buildCoachSuggestionGroups,
  defaultOpenGroups,
  teachMePrompt,
} from './coachSuggestions';
import './CoachPage.css';

const SUGGESTION_POLL_MS = 30_000;

// Prototype `coachSkills` (HTML 7257): [key, value, color] — exact hex values.
const SKILL_CHIPS: Array<[string, string, string]> = [
  ['Dialogue', 'Strong', '#4ade80'],
  ['Pacing', 'Improving', '#ffd319'],
  ['Description', 'Focus area', '#ff9db4'],
];

// Prototype `coachChips` (HTML 7256).
const PROMPT_CHIPS = [
  'Review my open scene like a teacher',
  'Teach me pacing with my own text',
  'Why does my dialogue feel flat?',
  'Give me a 10-minute writing drill',
];

interface Props {
  scene: Scene | null;
  story: Story | null;
  currentChapterId: string | null;
  agentNames?: Partial<Record<NamedAgentId, string>>;
}

/** Poll the unified suggestion feed for the coach's right rail. */
function useCoachRailSuggestions(): UnifiedSuggestion[] {
  const [items, setItems] = useState<UnifiedSuggestion[]>([]);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    if (typeof api?.suggestionsUnifiedList !== 'function') return;
    let cancelled = false;
    const poll = () => {
      (api.suggestionsUnifiedList({ status: 'proposed', limit: 100 }) as Promise<{ items?: UnifiedSuggestion[] }>)
        .then((r) => { if (!cancelled) setItems(r.items ?? []); })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, SUGGESTION_POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);
  return items;
}

export default function CoachPage({ scene, story, currentChapterId, agentNames }: Props) {
  const conversation = useCoachConversation(scene);
  // M13: a Full Scene Analysis kicked off from the right panel shows the same
  // typing dots while the coach's AI read is being fetched.
  const analysisPending = useSceneAnalysisPending();
  const [input, setInput] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const displayName = resolveAgentDisplayName('writingAssistant', agentNames);

  const railSuggestions = useCoachRailSuggestions();
  const groups = useMemo(
    () => buildCoachSuggestionGroups(story, currentChapterId, railSuggestions),
    [story, currentChapterId, railSuggestions],
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean> | null>(null);
  const effectiveOpen = openGroups ?? defaultOpenGroups(groups);

  const toggleGroup = useCallback((key: string) => {
    setOpenGroups((prev) => {
      const base = prev ?? defaultOpenGroups(groups);
      return { ...base, [key]: !base[key] };
    });
  }, [groups]);

  // Keep the feed pinned to the newest message.
  const messageCount = conversation.messages.length + (conversation.pendingPrompt ? 1 : 0);
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount, conversation.busy, analysisPending]);

  const send = useCallback((text?: string) => {
    const value = (text ?? input).trim();
    if (!value || conversation.busy) return;
    if (text === undefined) setInput('');
    void conversation.send(value);
  }, [conversation, input]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  // Right-rail click: prefill the input with `Teach me: …` and focus it.
  const pickSuggestion = useCallback((title: string) => {
    setInput(teachMePrompt({ title }));
    inputRef.current?.focus();
  }, []);

  return (
    <div className="coach-page" data-testid="coach-page">
      {/* ── Header ── */}
      <div className="coach-header">
        <div className="coach-icon-tile" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--n2, #9b5fff)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 10L12 5 2 10l10 5z" />
            <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
            <path d="M22 10v6" />
          </svg>
        </div>
        <div>
          <div className="coach-title">{displayName}</div>
          <div className="coach-sub">Teaches you to write better using your own pages — it never ghost-writes</div>
        </div>
        <AgentSessionPicker store={conversation.store} className="coach-session-pill" />
        <div className="coach-header-spacer" />
        <div className="coach-skills" data-testid="coach-skills">
          {SKILL_CHIPS.map(([k, v, color]) => (
            <div
              key={k}
              className="coach-skill-chip"
              style={{
                background: hexA(color, 0.08),
                border: `1px solid ${hexA(color, 0.4)}`,
              }}
            >
              <span
                className="coach-skill-dot"
                style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                aria-hidden="true"
              />
              <span className="coach-skill-name">{k}</span>
              <span className="coach-skill-value" style={{ color }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="coach-body">
        {/* ── Feed column ── */}
        <div className="coach-feed-col">
          <div className="coach-feed" ref={feedRef} data-testid="coach-feed">
            <div className="coach-feed-inner">
              {conversation.messages.map((m, i) => (
                <CoachFeedMessage key={i} message={m} />
              ))}
              {conversation.pendingPrompt !== null && (
                <div className="coach-row coach-row--user">
                  <div className="coach-bubble coach-bubble--user">{conversation.pendingPrompt}</div>
                </div>
              )}
              {(conversation.busy || analysisPending) && (
                <div className="coach-row" data-testid="coach-typing">
                  <div className="coach-typing">
                    <span className="coach-typing-dot" />
                    <span className="coach-typing-dot coach-typing-dot--d2" />
                    <span className="coach-typing-dot coach-typing-dot--d3" />
                  </div>
                </div>
              )}
              {conversation.error && (
                <div className="coach-error" role="alert">{conversation.error}</div>
              )}
            </div>
          </div>

          {/* ── Chips + input ── */}
          <div className="coach-composer">
            <div className="coach-composer-inner">
              <div className="coach-chips" data-testid="coach-chips">
                {PROMPT_CHIPS.map((t) => (
                  <button key={t} type="button" className="coach-chip" onClick={() => send(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="coach-input-row">
                <textarea
                  ref={inputRef}
                  className="coach-input"
                  data-testid="coach-input"
                  placeholder="Ask your coach anything — it teaches with examples from your own manuscript…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  aria-label="Ask your writing coach"
                />
                <button
                  type="button"
                  className="coach-send"
                  data-testid="coach-send"
                  onClick={() => send()}
                  aria-label="Send to coach"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0b0d17" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                  </svg>
                </button>
              </div>
              <div className="coach-footer">
                Lessons reference your open scene · drills are 5–10 minutes · your coach never writes prose for you
              </div>
            </div>
          </div>
        </div>

        {/* ── Right rail: SUGGESTIONS ── */}
        <div className="coach-rail" data-testid="coach-suggestions-rail">
          <div className="coach-rail-eyebrow">SUGGESTIONS</div>
          {groups.map((g) => (
            <div key={g.key}>
              <button
                type="button"
                className="coach-rail-group"
                onClick={() => toggleGroup(g.key)}
                aria-expanded={!!effectiveOpen[g.key]}
                data-testid={`coach-sug-group-${g.key}`}
              >
                <span className={`coach-rail-chev${effectiveOpen[g.key] ? ' coach-rail-chev--open' : ''}`} aria-hidden="true">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
                <span className="coach-rail-group-label">{g.label}</span>
                <span className="coach-rail-group-count">{g.items.length}</span>
              </button>
              {effectiveOpen[g.key] && g.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="coach-rail-item"
                  title="Ask the coach to teach this"
                  onClick={() => pickSuggestion(item.title)}
                >
                  <span className="coach-rail-item-title">{item.title}</span>
                  <span className="coach-rail-item-detail">{item.detail}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="coach-rail-hint">Click a suggestion and the coach turns it into a lesson.</div>
        </div>
      </div>
    </div>
  );
}

// ── Feed message renderers ──────────────────────────────────────────────────

function CoachFeedMessage({ message }: { message: CoachMessage }) {
  if (message.kind === 'user') {
    return (
      <div className="coach-row coach-row--user">
        <div className="coach-bubble coach-bubble--user">{message.text}</div>
      </div>
    );
  }
  if (message.kind === 'coach') {
    return (
      <div className="coach-row">
        <div className="coach-bubble coach-bubble--coach">{message.text}</div>
      </div>
    );
  }
  if (message.kind === 'lesson') {
    return (
      <div className="coach-lesson-card" data-testid="coach-lesson-card">
        <div className="coach-lesson-title">{message.title}</div>
        <div className="coach-lesson-text">{message.text}</div>
        {message.points.length > 0 && (
          <div className="coach-lesson-points">
            {message.points.map((p, i) => (
              <div key={i} className="coach-lesson-point">
                <span className="coach-lesson-arrow" aria-hidden="true">→</span>
                <span>{p}</span>
              </div>
            ))}
          </div>
        )}
        {message.drill && <DrillFooter drill={message.drill} />}
      </div>
    );
  }
  // analysis (§5.4 — M13 fills the data; M12 ships the renderer)
  return (
    <div className="coach-analysis-card" data-testid="coach-analysis-card">
      <div className="coach-analysis-title">{message.title}</div>
      <div className="coach-analysis-badge-row">
        <span className="coach-badge coach-badge--computed">COMPUTED · LOCAL · FREE</span>
        <span className="coach-badge-note">no AI needed</span>
      </div>
      <div className="coach-analysis-grid">
        {message.computed.map(([k, v]) => (
          <div key={k} className="coach-analysis-stat">
            <span className="coach-analysis-stat-k">{k}</span>
            <span className="coach-analysis-stat-v">{v}</span>
          </div>
        ))}
      </div>
      <div className="coach-analysis-badge-row">
        <span className="coach-badge coach-badge--read">COACH&#39;S READ · AI</span>
        <span className="coach-badge-note">judgment calls — needs a model</span>
      </div>
      {message.read.length > 0 && (
        <div className="coach-analysis-reads">
          {message.read.map(([k, v]) => (
            <div key={k} className="coach-analysis-read">
              <span className="coach-analysis-read-k">{k}</span>
              <span className="coach-analysis-read-v">{v}</span>
            </div>
          ))}
        </div>
      )}
      {message.readNote && (
        /* M13: honest state when the coach's read is unavailable — the
           computed section above still rendered in full. */
        <div className="coach-analysis-read-note" data-testid="coach-read-unavailable">
          {message.readNote}
        </div>
      )}
      {message.takeaway && <div className="coach-analysis-takeaway">{message.takeaway}</div>}
      {message.drill && <DrillFooter drill={message.drill} />}
    </div>
  );
}

function DrillFooter({ drill }: { drill: string }) {
  return (
    <div className="coach-drill" data-testid="coach-drill">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffd319" strokeWidth="1.8" strokeLinecap="round" className="coach-drill-icon" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
      <span>{drill}</span>
    </div>
  );
}

// Prototype hexA helper — hex color + alpha to rgba().
function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
