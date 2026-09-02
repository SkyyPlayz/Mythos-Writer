// SessionHistoryViewer — per-agent Settings-page session browser (SKY-10954).
//
// Second half of the SKY-10949 owner ruling: agent chat sessions now live as
// files under `Agent Vault/Sessions/` (SKY-10952). This surfaces them where
// the owner asked for them — the agent's Settings card — as a read-only
// list-by-date + open-transcript view.
//
// Deliberately reads via window.api.agentSessions directly instead of the
// shared useAgentSessions() store: that store is a live, mutable session
// (switchSession changes what every mounted chat surface renders). Browsing
// history from Settings must never change which conversation is active in
// the Brainstorm/Coach/Beta Reader chat surfaces.

import { useCallback, useEffect, useState } from 'react';
import type { NamedAgentId } from '../../agents/agentIdentity';

// Maps the Settings-page agent id to the session-store agent key used by
// createSession/listSessions (electron-main/src/mythosFormat/agentSessions.ts).
// Mirrors the mapping already used at each chat surface: CoachPage /
// AgentHubPanel coach chat -> 'coach', BrainstormPage/BrainstormTab ->
// 'brainstorm', ArchiveTab -> 'archive', BetaReaderPage -> 'beta-reader'.
const SESSION_AGENT_KEY: Record<NamedAgentId, string> = {
  writingAssistant: 'coach',
  brainstorm: 'brainstorm',
  archive: 'archive',
  betaReader: 'beta-reader',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function SessionHistoryViewer({ agentName }: { agentName: NamedAgentId }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<AgentSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<AgentSessionFile | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  const sessionAgent = SESSION_AGENT_KEY[agentName];

  const loadSessions = useCallback(async () => {
    const api = window.api?.agentSessions;
    if (!api) { setError('Session history unavailable.'); return; }
    try {
      const { sessions: list } = await api.list(sessionAgent);
      setSessions(list);
    } catch {
      setError('Could not load session history.');
    }
  }, [sessionAgent]);

  useEffect(() => {
    if (!open || sessions !== null) return;
    void loadSessions();
  }, [open, sessions, loadSessions]);

  const selectSession = useCallback(async (id: string) => {
    setSelectedId(id);
    setTranscript(null);
    setTranscriptLoading(true);
    try {
      const api = window.api?.agentSessions;
      const res = await api?.read(id);
      setTranscript(res?.session ?? null);
    } finally {
      setTranscriptLoading(false);
    }
  }, []);

  const panelId = `session-history-panel-${agentName}`;

  return (
    <div className="settings-session-history">
      <button
        type="button"
        className="settings-persona-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`session-history-toggle-${agentName}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="settings-persona-chevron">{open ? '▾' : '▸'}</span>
        Session history
      </button>
      {open && (
        <div id={panelId} className="settings-session-history-panel">
          {error && <p className="settings-persona-error">{error}</p>}
          {!error && sessions === null && <p className="settings-persona-loading">Loading…</p>}
          {!error && sessions !== null && sessions.length === 0 && (
            <p className="settings-help-text">No saved conversations yet.</p>
          )}
          {!error && sessions !== null && sessions.length > 0 && (
            <div className="settings-session-history-body">
              <ul
                className="settings-session-history-list"
                aria-label="Session history"
                data-testid={`session-history-list-${agentName}`}
              >
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`settings-session-history-item${selectedId === s.id ? ' settings-session-history-item--active' : ''}`}
                      aria-pressed={selectedId === s.id}
                      onClick={() => void selectSession(s.id)}
                      data-testid={`session-history-item-${s.id}`}
                    >
                      <span className="settings-session-history-item-title">
                        {s.title || formatDate(s.startedAt)}
                      </span>
                      <span className="settings-session-history-item-meta">
                        {formatDate(s.updatedAt)} · {s.turnCount} {s.turnCount === 1 ? 'turn' : 'turns'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {selectedId && (
                <div
                  className="settings-session-history-transcript"
                  role="region"
                  aria-label="Session transcript"
                  data-testid="session-history-transcript"
                >
                  {transcriptLoading && <p className="settings-persona-loading">Loading transcript…</p>}
                  {!transcriptLoading && transcript && (
                    <div className="settings-session-history-turns">
                      {transcript.turns.length === 0 && (
                        <p className="settings-help-text">This conversation has no turns yet.</p>
                      )}
                      {transcript.turns.map((t, i) => (
                        <div
                          key={i}
                          className={`settings-session-history-turn settings-session-history-turn--${t.role}`}
                        >
                          <span className="settings-session-history-turn-role">
                            {t.role === 'user' ? 'You' : 'Agent'}
                          </span>
                          <p className="settings-session-history-turn-text">{t.cardTitle ?? t.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {!transcriptLoading && !transcript && (
                    <p className="settings-persona-error">Transcript unavailable.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
