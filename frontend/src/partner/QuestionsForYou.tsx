// Slice B — Questions-for-you (Notes & Analysis).
// Sub-tabs: Agent Activity · Notes Questions · Story Questions.
// Answer on card → appends to note; asks which note when target is ambiguous.

import { useCallback, useMemo, useState } from 'react';
import './QuestionsForYou.css';

export type QuestionsSubTab = 'activity' | 'notes' | 'story';

export interface PartnerQuestion {
  id: string;
  heading: string;
  detail: string;
  /** Note path when known; null/undefined = ambiguous → ask. */
  targetNotePath?: string | null;
  source: 'notes' | 'story' | 'activity';
}

interface Props {
  activityItems?: Array<{ id: string; text: string; at?: string }>;
  notesQuestions?: PartnerQuestion[];
  storyQuestions?: PartnerQuestion[];
  /** Known note paths for the ambiguous picker. */
  noteOptions?: Array<{ path: string; title: string }>;
  onAppendToNote?: (args: { notePath: string; heading: string; answer: string }) => void | Promise<void>;
  /** Optional: click a collapsed question to send it into partner chat (Idea Board). */
  onAskInChat?: (question: string) => void;
}

const SUB_TABS: { id: QuestionsSubTab; label: string }[] = [
  { id: 'activity', label: 'Agent Activity' },
  { id: 'notes', label: 'Notes Questions' },
  { id: 'story', label: 'Story Questions' },
];

export default function QuestionsForYou({
  activityItems = [],
  notesQuestions = [],
  storyQuestions = [],
  noteOptions = [],
  onAppendToNote,
  onAskInChat,
}: Props) {
  const [subTab, setSubTab] = useState<QuestionsSubTab>('activity');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [pickedNote, setPickedNote] = useState('');
  const [appendError, setAppendError] = useState<string | null>(null);
  const [appendOk, setAppendOk] = useState<string | null>(null);

  const questions = useMemo(() => {
    if (subTab === 'notes') return notesQuestions;
    if (subTab === 'story') return storyQuestions;
    return [];
  }, [subTab, notesQuestions, storyQuestions]);

  const expanded = questions.find((q) => q.id === expandedId) ?? null;

  const handleExpand = useCallback((id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
    setAnswer('');
    setPickedNote('');
    setAppendError(null);
    setAppendOk(null);
  }, []);

  const handleAppend = useCallback(async () => {
    if (!expanded || !onAppendToNote) return;
    const text = answer.trim();
    if (!text) {
      setAppendError('Write an answer first.');
      return;
    }
    const target = expanded.targetNotePath?.trim() || pickedNote.trim();
    if (!target) {
      setAppendError('Which note? Pick a target before appending.');
      return;
    }
    setAppendError(null);
    try {
      await onAppendToNote({ notePath: target, heading: expanded.heading, answer: text });
      setAppendOk(`Appended to ${target}`);
      setAnswer('');
    } catch (err) {
      setAppendError(err instanceof Error ? err.message : 'Could not append.');
    }
  }, [expanded, answer, pickedNote, onAppendToNote]);

  return (
    <section className="qfy-root" data-testid="questions-for-you" aria-label="Questions for you">
      <header className="qfy-header">
        <span className="qfy-eyebrow">QUESTIONS FOR YOU</span>
      </header>
      <div className="qfy-subtabs" role="tablist" aria-label="Questions sub-tabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={subTab === t.id}
            className={`qfy-subtab${subTab === t.id ? ' qfy-subtab--active' : ''}`}
            data-testid={`qfy-subtab-${t.id}`}
            onClick={() => { setSubTab(t.id); setExpandedId(null); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'activity' ? (
        <div className="qfy-activity" data-testid="qfy-activity-list">
          {activityItems.length === 0 ? (
            <p className="qfy-empty">No recent agent activity.</p>
          ) : (
            <ul className="qfy-activity-list">
              {activityItems.map((a) => (
                <li key={a.id} className="qfy-activity-row">
                  <span className="qfy-activity-text">{a.text}</span>
                  {a.at && <span className="qfy-activity-at">{a.at}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : questions.length === 0 ? (
        <p className="qfy-empty" data-testid="qfy-empty">
          {subTab === 'notes' ? 'No open notes questions.' : 'No open story questions.'}
        </p>
      ) : (
        <ul className="qfy-q-list" data-testid="qfy-question-list">
          {questions.map((q) => (
            <li key={q.id} className={`qfy-q-card${expandedId === q.id ? ' qfy-q-card--open' : ''}`}>
              <button
                type="button"
                className="qfy-q-summary"
                onClick={() => {
                  // Idea Board: a collapsed click can send the question into chat.
                  if (onAskInChat && expandedId !== q.id) {
                    onAskInChat(q.detail);
                    return;
                  }
                  handleExpand(q.id);
                }}
                aria-expanded={expandedId === q.id}
                data-testid={`qfy-question-${q.id}`}
              >
                <span className="qfy-q-heading">{q.heading}</span>
                <span className="qfy-q-detail">{q.detail}</span>
              </button>
              {expandedId === q.id && (
                <div className="qfy-q-body" data-testid="qfy-answer-card">
                  <p className="qfy-q-detail-full">{q.detail}</p>
                  {!q.targetNotePath && (
                    <label className="qfy-which-note">
                      <span>Which note?</span>
                      <select
                        value={pickedNote}
                        onChange={(e) => setPickedNote(e.target.value)}
                        data-testid="qfy-note-picker"
                        aria-label="Which note?"
                      >
                        <option value="">Select a note…</option>
                        {noteOptions.map((n) => (
                          <option key={n.path} value={n.path}>{n.title}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {q.targetNotePath && (
                    <p className="qfy-target-line">Target: {q.targetNotePath}</p>
                  )}
                  <textarea
                    className="qfy-answer"
                    data-testid="qfy-answer-input"
                    placeholder="Your answer…"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    rows={3}
                  />
                  <button
                    type="button"
                    className="qfy-append-btn"
                    data-testid="qfy-append"
                    onClick={() => void handleAppend()}
                  >
                    Append to notes
                  </button>
                  {appendError && <p className="qfy-msg qfy-msg--err" role="alert">{appendError}</p>}
                  {appendOk && <p className="qfy-msg qfy-msg--ok">{appendOk}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
