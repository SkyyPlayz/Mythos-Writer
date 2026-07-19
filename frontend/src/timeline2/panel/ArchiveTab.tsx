// Beta 4 M25 — Archive tab (§8.6): gold blurb + quick-add ("Add the festival
// from Ch. 4…" → the agent dates & plots it), RECENTLY AUTO-ADDED with undo,
// the FLAGS section (design spec §2 — same component vocabulary as
// ArchivePanel's continuity cards, timeline-scoped data), and a mini chat on
// the SHARED Archive session (M15 / §11).
import { useState } from 'react';
import type { TimelineFlag } from '../../archive/timelineFlags';
import ArchiveConfirmDialog from '../../ArchiveConfirmDialog';
import { useMiniAgentChat, type MiniChatInvoke } from './useMiniAgentChat';
import MiniAgentChat from './MiniAgentChat';

export interface RecentAutoAdd {
  eventId: string;
  label: string;
}

export interface ArchiveTabProps {
  flags: TimelineFlag[];
  recentAutoAdds: RecentAutoAdd[];
  onQuickAdd: (text: string) => Promise<void>;
  onUndoAutoAdd: (eventId: string) => void;
  onJumpTo: (itemId: string) => void;
  onFlagResolved: (flag: TimelineFlag) => void;
  busy: boolean;
  showToast: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

const invokeArchive: MiniChatInvoke = async (prompt, history) => {
  const api = window.api;
  if (typeof api?.agentArchive !== 'function') {
    throw new Error('Archive agent unavailable — check your provider settings.');
  }
  const response = await api.agentArchive(prompt, history);
  return response.text;
};

const FLAG_KIND_LABEL: Record<TimelineFlag['kind'], string> = {
  contradiction: 'CONTRADICTION',
  gap: 'GAP',
  ordering_skip: 'ORDER SKIP',
};

export default function ArchiveTab(props: ArchiveTabProps) {
  const { flags, recentAutoAdds, onQuickAdd, onUndoAutoAdd, onJumpTo, onFlagResolved, busy, showToast } = props;
  const chat = useMiniAgentChat('archive', invokeArchive);
  const [quickAdd, setQuickAdd] = useState('');
  const [resolving, setResolving] = useState<TimelineFlag | null>(null);

  const submitQuickAdd = () => {
    const text = quickAdd.trim();
    if (!text || busy) return;
    setQuickAdd('');
    void onQuickAdd(text);
  };

  return (
    <div className="trp-stack" data-testid="trp-archive-tab">
      <div className="trp-blurb trp-blurb--archive">
        <div className="trp-blurb-title">Archive Agent — timeline builder</div>
        <div className="trp-blurb-sub">
          Auto-builds this timeline from your manuscript and vault. Tell it what to add — it dates
          and plots it for you.
        </div>
        <div className="trp-quickadd-row">
          <input
            className="trp-chat-input trp-quickadd-input"
            value={quickAdd}
            placeholder="Add the festival from Ch. 4…"
            onChange={(e) => setQuickAdd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitQuickAdd(); }}
            aria-label="Describe an event to add"
            data-testid="trp-quickadd-input"
          />
          <button
            type="button"
            className="trp-quickadd-btn"
            onClick={submitQuickAdd}
            disabled={busy || !quickAdd.trim()}
            data-testid="trp-quickadd-btn"
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>

      <div className="trp-card">
        <div className="trp-label">RECENTLY AUTO-ADDED</div>
        {recentAutoAdds.length === 0 ? (
          <div className="trp-hint" data-testid="trp-recent-empty">
            Nothing yet — quick-add above, and auto-built events land here.
          </div>
        ) : (
          <div className="trp-recent" data-testid="trp-recent-list">
            {recentAutoAdds.map((r) => (
              <div key={r.eventId} className="trp-recent-row">
                <span className="trp-recent-check" aria-hidden="true">✓</span>
                <button
                  type="button"
                  className="trp-recent-label"
                  onClick={() => onJumpTo(r.eventId)}
                  title="Jump to it on the timeline"
                  data-testid={`trp-recent-${r.eventId}`}
                >
                  {r.label}
                </button>
                <button
                  type="button"
                  className="trp-recent-undo"
                  onClick={() => onUndoAutoAdd(r.eventId)}
                  data-testid={`trp-recent-undo-${r.eventId}`}
                >
                  Undo
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {flags.length > 0 && (
        <div className="trp-card" data-testid="trp-flags-section">
          <div className="trp-label">
            FLAGS <span className="trp-flag-count">{flags.length}</span>
          </div>
          <div className="trp-flags">
            {flags.map((flag) => (
              <div key={flag.id} className="trp-flag" data-testid={`trp-flag-${flag.id}`}>
                <div className="trp-flag-kind">{FLAG_KIND_LABEL[flag.kind]}</div>
                <div className="trp-flag-desc">{flag.description}</div>
                <div className="trp-flag-anchor">{flag.anchor}</div>
                <div className="trp-flag-actions">
                  <button
                    type="button"
                    className="trp-flag-btn"
                    onClick={() => onJumpTo(flag.affectedItemId)}
                    data-testid={`trp-flag-jump-${flag.id}`}
                  >
                    Jump to scene
                  </button>
                  {flag.kind === 'contradiction' && (
                    <button
                      type="button"
                      className="trp-flag-btn trp-flag-btn--resolve"
                      onClick={() => setResolving(flag)}
                      data-testid={`trp-flag-resolve-${flag.id}`}
                    >
                      Resolve…
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <MiniAgentChat
        chat={chat}
        accent="archive"
        placeholder="Ask about your timeline…"
        testidPrefix="trp-archive"
      />

      {resolving && (
        <ArchiveConfirmDialog
          suggestionId={resolving.id}
          rationale={resolving.description}
          anchorText={resolving.anchor}
          resolve={async (action) => {
            // Contradiction flags are continuity items — resolve through the
            // continuity backend, not the scan-suggestion one.
            const api = window.api;
            if (typeof api?.archiveResolveContinuity !== 'function') {
              throw new Error('Continuity resolution unavailable.');
            }
            const mapped =
              action === 'match_archive' ? 'match_archive_to_story' : action;
            const result = await api.archiveResolveContinuity(resolving.id, mapped);
            if (!result.ok) throw new Error('Could not resolve the flag.');
          }}
          onClose={() => setResolving(null)}
          onResolved={() => {
            const flag = resolving;
            setResolving(null);
            onFlagResolved(flag);
            showToast('Flag resolved');
          }}
        />
      )}
    </div>
  );
}
