interface BetaReadSummaryCardProps {
  sceneTitle?: string;
  commentCount: number;
  loading: boolean;
  lastScannedAt: string | null;
}

export default function BetaReadSummaryCard({
  sceneTitle,
  commentCount,
  loading,
  lastScannedAt,
}: BetaReadSummaryCardProps) {
  const status = loading
    ? 'Scanning scene…'
    : commentCount > 0
      ? `${commentCount} anchored ${commentCount === 1 ? 'comment' : 'comments'}`
      : 'No active Beta-Read comments';

  return (
    <section className="br-summary-card" aria-label="Beta-Read summary">
      <p className="br-eyebrow">Beta-Read Mode</p>
      <h3>{sceneTitle ? `Reviewing ${sceneTitle}` : 'Select a scene to begin'}</h3>
      <p className="br-summary-status">{status}</p>
      {lastScannedAt && (
        <p className="br-summary-meta">
          Last scan {new Date(lastScannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </section>
  );
}
