// SKY-6228: M15 — session dropdown pill per §11.
// Used on every chat surface: Coach panel, Coach page, Brainstorm page, Beta chat, timeline side-chats.

import { useState, useRef, useCallback, useEffect } from 'react';
import type { UseAgentSessionsResult } from '../lib/useAgentSessions';
import { showLnToast } from '../theme/lnToast';
import './AgentSessionPicker.css';

interface Props {
  store: UseAgentSessionsResult;
  /** Extra class applied to the pill root (e.g. for placement overrides). */
  className?: string;
  /**
   * SKY-7076: true while a reply is generating on this surface. Switching or
   * creating a session is disabled for the duration — the in-flight turns
   * are pinned to their origin session regardless, but letting the user swap
   * out from under a generating reply is still confusing UX even when the
   * data stays correct.
   */
  busy?: boolean;
}

export default function AgentSessionPicker({ store, className = '', busy = false }: Props) {
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { sessions, activeSessionId, newSession, renameSession, duplicateSession, deleteSession, switchSession } = store;
  const active = sessions.find((s) => s.id === activeSessionId);

  // §10: newest sorts to the top, except the active session, which stays
  // pinned first regardless of recency (so the open chat doesn't jump
  // position under the user's cursor while it's the one they're using).
  const orderedSessions = [...sessions].sort((a, b) => {
    if (a.id === activeSessionId) return -1;
    if (b.id === activeSessionId) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus rename input when renaming starts
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const toggleOpen = useCallback(() => setOpen((v) => !v), []);

  const startRename = useCallback((id: string, current: string) => {
    setRenamingId(id);
    setRenameValue(current);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    try {
      await renameSession(renamingId, renameValue.trim());
    } catch {
      showLnToast("Couldn't rename this chat — try again.");
    }
    setRenamingId(null);
  }, [renamingId, renameValue, renameSession]);

  const handleDuplicate = useCallback(async (id: string) => {
    try {
      await duplicateSession(id);
    } catch {
      showLnToast("Couldn't duplicate this chat — try again.");
    }
  }, [duplicateSession]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteSession(id);
    } catch {
      showLnToast("Couldn't delete this chat — try again.");
    }
  }, [deleteSession]);

  const handleRenameKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
    if (e.key === 'Escape') { setRenamingId(null); }
  }, [commitRename]);

  const label = active?.title ?? 'Session 1';

  return (
    <div className={`asp-root${className ? ` ${className}` : ''}`} ref={dropdownRef}>
      <button
        type="button"
        className="asp-pill"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Session: ${label}`}
        title={label}
      >
        <span className="asp-pill-label">{label}</span>
        <span className="asp-pill-chevron" aria-hidden="true">▾</span>
      </button>

      {open && (
        <>
          {/* Full-screen backdrop */}
          <div
            className="asp-backdrop"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          />
          <div className="asp-dropdown" role="listbox">
            {/* §10: scrolls independently past ~8 rows — no pagination/search,
                sessions per agent are expected to stay in the tens. */}
            <div className="asp-row-list">
            {orderedSessions.map((s) => (
              <div
                key={s.id}
                className={`asp-row${s.id === activeSessionId ? ' asp-row--active' : ''}`}
                role="option"
                aria-selected={s.id === activeSessionId}
              >
                {renamingId === s.id ? (
                  <input
                    ref={renameInputRef}
                    className="asp-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={handleRenameKey}
                    aria-label="Rename session"
                  />
                ) : (
                  <button
                    type="button"
                    className="asp-row-label"
                    disabled={busy}
                    aria-disabled={busy}
                    title={busy ? 'Wait for the current reply to finish before switching sessions' : undefined}
                    onClick={() => {
                      if (busy) return;
                      void switchSession(s.id);
                      setOpen(false);
                    }}
                  >
                    <span className={`asp-status-dot${s.id === activeSessionId ? ' asp-status-dot--active' : ''}`} aria-hidden="true" />
                    <span className="asp-row-name">{s.title ?? 'Chat'}</span>
                    <span className="asp-row-count">{s.turnCount} msg{s.turnCount !== 1 ? 's' : ''}</span>
                  </button>
                )}
                <div className="asp-row-actions">
                  <button
                    type="button"
                    className="asp-action-btn"
                    title="Rename"
                    aria-label={`Rename session ${s.title ?? 'Chat'}`}
                    onClick={(e) => { e.stopPropagation(); startRename(s.id, s.title ?? 'Chat'); }}
                  >✏</button>
                  <button
                    type="button"
                    className="asp-action-btn"
                    title="Duplicate"
                    aria-label={`Duplicate session ${s.title ?? 'Chat'}`}
                    onClick={(e) => { e.stopPropagation(); void handleDuplicate(s.id); setOpen(false); }}
                  >⎘</button>
                  <button
                    type="button"
                    className="asp-action-btn asp-action-btn--danger"
                    title="Delete"
                    aria-label={`Delete session ${s.title ?? 'Chat'}`}
                    onClick={(e) => { e.stopPropagation(); void handleDelete(s.id); setOpen(false); }}
                  >✕</button>
                </div>
              </div>
            ))}
            </div>

            <div className="asp-divider" role="separator" />
            <button
              type="button"
              className="asp-new-btn"
              disabled={busy}
              aria-disabled={busy}
              title={busy ? 'Wait for the current reply to finish before starting a new chat' : undefined}
              onClick={() => {
                if (busy) return;
                void newSession();
                setOpen(false);
              }}
            >
              + New chat
            </button>
          </div>
        </>
      )}
    </div>
  );
}
