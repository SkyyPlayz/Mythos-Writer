export type BookSyncEvent =
  | 'book-file-cas-exhausted'
  | 'book-file-io'
  | 'book-file-malformed'
  | 'book-file-profiles-fence'
  | 'book-file-profiles-duplicate'
  | 'book-file-sync-skipped'
  | 'mythos-file-write-failed';

/** Story skips include a story id. A mythos.json write failure is the event code only. */
export interface BookSyncWarning {
  event: BookSyncEvent;
  storyId?: string;
}

export type ManifestSaveOutcome =
  | { ok: true; warnings: BookSyncWarning[] }
  | { ok: false; source?: 'save' | 'read' };

export const STORY_LIST_READ_FAILURE = 'The story list could not be read.';

/** A manifest read that is not a loaded story list. This is not a save. */
export function failedManifestRead(): ManifestSaveOutcome {
  return { ok: false, source: 'read' };
}

const BOOK_SYNC_EVENTS: readonly BookSyncEvent[] = [
  'book-file-cas-exhausted',
  'book-file-io',
  'book-file-malformed',
  'book-file-profiles-fence',
  'book-file-profiles-duplicate',
  'book-file-sync-skipped',
  'mythos-file-write-failed',
];

function isBookSyncEvent(value: string): value is BookSyncEvent {
  return (BOOK_SYNC_EVENTS as readonly string[]).includes(value);
}

/**
 * A save result is success only when it is the typed `{ ok: true }` outcome.
 * An `{ error }` object is a failure, even though the invoke resolved.
 */
export function manifestSaveOutcome(result: unknown): ManifestSaveOutcome {
  if (!result || typeof result !== 'object') return { ok: false };
  const record = result as { ok?: unknown; error?: unknown; warnings?: unknown; bookSyncWarnings?: unknown };
  if (record.ok !== true || typeof record.error === 'string') return { ok: false };
  const raw = Array.isArray(record.warnings)
    ? record.warnings
    : Array.isArray(record.bookSyncWarnings)
      ? record.bookSyncWarnings
      : [];
  const warnings: BookSyncWarning[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const event = (item as { event?: unknown }).event;
    const storyId = (item as { storyId?: unknown }).storyId;
    if (typeof event !== 'string' || !isBookSyncEvent(event) || /[/\\]/.test(event)) continue;
    if (storyId === undefined) {
      if (event === 'mythos-file-write-failed') warnings.push({ event });
      continue;
    }
    if (typeof storyId !== 'string' || /[/\\]/.test(storyId)) continue;
    warnings.push({ event, storyId });
  }
  return { ok: true, warnings };
}

function noticeText(warning: BookSyncWarning): string {
  if (warning.event === 'mythos-file-write-failed') return 'The story list could not be updated.';
  const id = warning.storyId ?? 'a story';
  switch (warning.event) {
    case 'book-file-cas-exhausted':
      return `Couldn't update the book file for story ${id} just now. The change stays with the story and will be written on the next save.`;
    case 'book-file-malformed':
      return `Couldn't update the book file for story ${id}. The file was left unchanged.`;
    case 'book-file-profiles-fence':
    case 'book-file-profiles-duplicate':
      return `Couldn't update the book file for story ${id}. Its profiles section was left unchanged.`;
    case 'book-file-io':
    case 'book-file-sync-skipped':
      return `Couldn't update the book file for story ${id}. The file was left unchanged.`;
    default: {
      const _exhaustive: never = warning.event;
      return _exhaustive;
    }
  }
}

export function isLoadedManifest(result: unknown): result is { stories: unknown[] } {
  if (!result || typeof result !== 'object') return false;
  const record = result as { error?: unknown; ok?: unknown; stories?: unknown };
  if (typeof record.error === 'string' || record.ok === false) return false;
  return Array.isArray(record.stories);
}

/**
 * Apply a manifest read. An `{ error }` result leaves stories and manifest as they were.
 * Warnings on a real manifest are non-fatal.
 */
export function applyManifestRead<TStories, TManifest>(
  previous: { stories: TStories; manifest: TManifest },
  result: unknown,
): { stories: TStories; manifest: TManifest; save: ManifestSaveOutcome } {
  if (!isLoadedManifest(result)) {
    return { stories: previous.stories, manifest: previous.manifest, save: failedManifestRead() };
  }
  const manifest = result as TManifest & { stories: TStories; bookSyncWarnings?: unknown };
  const warned = manifestSaveOutcome({ ok: true, bookSyncWarnings: manifest.bookSyncWarnings ?? [] });
  return {
    stories: manifest.stories,
    manifest,
    save: warned.ok ? warned : { ok: true, warnings: [] },
  };
}

/**
 * Apply a manifest write. Warnings keep the current stories. An `{ error }` result does too.
 */
export function applyManifestWrite<TStories, TManifest>(
  previous: { stories: TStories; manifest: TManifest },
  result: unknown,
): { stories: TStories; manifest: TManifest; save: ManifestSaveOutcome } {
  return { stories: previous.stories, manifest: previous.manifest, save: manifestSaveOutcome(result) };
}

export function BookSyncNotice({ outcome }: { outcome: ManifestSaveOutcome }) {
  if (!outcome.ok) {
    return (
      <div role="status" aria-live="polite" data-testid="book-sync-warning">
        {outcome.source === 'read' ? STORY_LIST_READ_FAILURE : 'The save did not finish.'}
      </div>
    );
  }
  if (outcome.warnings.length === 0) return null;
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
        lineHeight: 1.4,
      }}
    >
      {outcome.warnings.map((warning) => (
        <p key={`${warning.event}:${warning.storyId}`} style={{ margin: '0 0 4px' }}>{noticeText(warning)}</p>
      ))}
    </div>
  );
}
