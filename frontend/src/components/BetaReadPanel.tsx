import { useState } from 'react';
import type { Scene } from '../types';
import BetaReadSummaryCard from './BetaReadSummaryCard';
import BetaReadCommentCard from './BetaReadCommentCard';
import BetaReadHistoryDrawer from './BetaReadHistoryDrawer';
import './BetaReadPanel.css';

interface BetaReadPanelProps {
  scene: Scene | null;
  comments: BetaReadComment[];
  loading: boolean;
  error: string | null;
  lastScannedAt: string | null;
  onRunScan: () => Promise<void> | void;
  onDismiss: (id: string) => Promise<void> | void;
}

export default function BetaReadPanel({
  scene,
  comments,
  loading,
  error,
  lastScannedAt,
  onRunScan,
  onDismiss,
}: BetaReadPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const canRun = Boolean(scene) && !loading;

  return (
    <section className="br-panel" aria-label="Beta-Read Mode">
      <div className="br-panel-header">
        <BetaReadSummaryCard
          sceneTitle={scene?.title}
          commentCount={comments.length}
          loading={loading}
          lastScannedAt={lastScannedAt}
        />
        <div className="br-panel-actions">
          <button
            type="button"
            className="br-primary-btn"
            onClick={onRunScan}
            aria-disabled={!canRun}
          >
            {loading ? 'Scanning…' : 'Beta-Read'}
          </button>
          <button
            type="button"
            className="br-action-btn"
            onClick={() => setHistoryOpen(true)}
            aria-label="Open Beta-Read history"
          >
            ⋯
          </button>
        </div>
      </div>

      {loading && (
        <p className="br-loading-state" role="status">
          Reading for pacing, clarity, and continuity…
        </p>
      )}

      {error && <p className="br-error-state" role="alert">{error}</p>}

      {!loading && !error && comments.length === 0 && (
        <p className="br-empty-state">No Beta-Read comments yet — run a scan when you want deeper scene feedback.</p>
      )}

      {comments.length > 0 && (
        <div className="br-comment-list">
          {comments.map((comment) => (
            <BetaReadCommentCard key={comment.id} comment={comment} onDismiss={onDismiss} />
          ))}
        </div>
      )}

      <BetaReadHistoryDrawer open={historyOpen} comments={comments} onClose={() => setHistoryOpen(false)} />
    </section>
  );
}
