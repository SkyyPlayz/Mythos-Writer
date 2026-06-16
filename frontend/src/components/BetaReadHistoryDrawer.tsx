interface BetaReadHistoryDrawerProps {
  open: boolean;
  comments: BetaReadComment[];
  onClose: () => void;
}

export default function BetaReadHistoryDrawer({ open, comments, onClose }: BetaReadHistoryDrawerProps) {
  if (!open) return null;

  return (
    <aside className="br-history-drawer" aria-label="Beta-Read history drawer">
      <div className="br-history-header">
        <h3>Beta-Read History</h3>
        <button type="button" className="br-action-btn" onClick={onClose} aria-label="Close Beta-Read history">
          Close
        </button>
      </div>
      {comments.length === 0 ? (
        <p className="br-empty-state">No Beta-Read runs for this scene yet.</p>
      ) : (
        <ol className="br-history-list">
          {comments.map((comment) => (
            <li key={comment.id}>
              <time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString()}</time>
              <span>{comment.anchor_text}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
