import './BetaReadMargin.css';

interface Props {
  comments: BetaReadComment[];
  onDismiss: (id: string) => void;
}

export default function BetaReadMargin({ comments, onDismiss }: Props) {
  if (comments.length === 0) return null;

  return (
    <div className="br-margin" aria-label="Beta-read comments" data-testid="beta-read-margin">
      {comments.map((c) => (
        <div key={c.id} className="br-comment" data-anchor={c.anchor_text}>
          <div className="br-comment-anchor" title={c.anchor_text}>
            <span className="br-anchor-icon" aria-hidden="true">⌦</span>
            <span className="br-anchor-text">{c.anchor_text.slice(0, 60)}{c.anchor_text.length > 60 ? '…' : ''}</span>
          </div>
          <div className="br-comment-body">{c.comment_text}</div>
          <div className="br-comment-footer">
            <span className="br-comment-time">
              {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <button
              className="br-dismiss-btn"
              onClick={() => onDismiss(c.id)}
              aria-label={`Dismiss beta-read comment: ${c.anchor_text.slice(0, 30)}`}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
