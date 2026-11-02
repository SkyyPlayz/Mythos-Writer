/** Notices returned on the manifest save/read result when a book file was left unchanged. */
export function bookSyncWarningsFrom(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const record = result as { warnings?: unknown; bookSyncWarnings?: unknown };
  const raw = record.warnings ?? record.bookSyncWarnings;
  if (!Array.isArray(raw)) return [];
  return raw.filter((line): line is string => typeof line === 'string' && line.length > 0);
}

export function BookSyncNotice({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="book-sync-warning"
      style={{
        margin: '8px 12px',
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(255, 196, 72, 0.16)',
        color: 'inherit',
        fontSize: 14,
        lineHeight: 1.4,
      }}
    >
      {messages.map((message) => (
        <p key={message} style={{ margin: '0 0 4px' }}>{message}</p>
      ))}
    </div>
  );
}
