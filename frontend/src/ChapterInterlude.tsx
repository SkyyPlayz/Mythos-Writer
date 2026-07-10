import { useCallback, useEffect, useRef, useState } from 'react';
import RichTextEditor from './RichTextEditor';
import { splitFrontmatter } from './lib/frontmatter';
import type { Chapter } from './types';
import './ChapterInterlude.css';

// GH #631: chapter-owned prose ("interlude" text that belongs to the chapter
// itself, not to any scene). It lives in the chapter folder's chapter.md —
// already persisted by the vault layer (SKY-10) but never surfaced in the UI
// until now. The frontmatter block is preserved byte-for-byte; only the prose
// below it is edited, so scene files and version backups are untouched.
// W0.2: the split is delegated to the shared lib/frontmatter engine.

export function splitChapterMeta(content: string): { fmRaw: string | null; prose: string } {
  const { frontmatter, body } = splitFrontmatter(content);
  return { fmRaw: frontmatter || null, prose: body };
}

/** Mirror of electron-main serializeFrontmatter for a chapter.md that does not exist yet. */
export function buildChapterFrontmatter(chapter: Chapter, storyId?: string): string {
  const lines = ['---', `id: ${chapter.id}`, `title: ${chapter.title}`];
  if (storyId) lines.push(`storyId: ${storyId}`);
  lines.push(`order: ${chapter.order}`, 'schemaVersion: 1', `updatedAt: ${new Date().toISOString()}`, '---', '');
  return lines.join('\n');
}

export interface ChapterInterludeProps {
  chapter: Chapter;
  storyId?: string;
}

type LoadState = 'loading' | 'ready' | 'error';

// vault:read is a non-enveloped IPC channel (preload.ts calls it via a raw
// ipcRenderer.invoke, not invokeEnvelope): the main process never lets it
// reject, it always resolves — with `{ content, path }` on success or with
// `{ error }` on failure (see sanitizeIpcError in electron-main/src/ipcErrors.ts).
// "File not found." is the one fixed message that means "chapter.md genuinely
// doesn't exist yet"; every other error string (permission denied, oversized
// file, internal error, ...) means the real content is unknown, not absent.
const VAULT_READ_NOT_FOUND_MESSAGE = 'File not found.';

function isVaultReadError(res: unknown): res is { error: string } {
  return typeof res === 'object' && res !== null && typeof (res as { error?: unknown }).error === 'string';
}

export default function ChapterInterlude({ chapter, storyId }: ChapterInterludeProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [prose, setProse] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  // Frontmatter is kept verbatim so a round-trip through this editor never
  // reorders or reformats chapter metadata.
  const fmRawRef = useRef<string | null>(null);

  const metaPath = `${chapter.path.replace(/\\/g, '/')}/chapter.md`;

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setLoadErrorMessage(null);
    setSaveStatus('idle');
    window.api.readVault(metaPath)
      .then((res) => {
        if (cancelled) return;
        if (isVaultReadError(res)) {
          if (res.error === VAULT_READ_NOT_FOUND_MESSAGE) {
            // chapter.md does not exist yet (pre-SKY-10 vaults, or chapters
            // created before interlude support) — start empty and create it
            // on first save.
            fmRawRef.current = null;
            setProse('');
            setLoadState('ready');
            return;
          }
          // A real read failure (permission denied, oversized file, internal
          // error, ...) — do NOT start an editable empty session, since the
          // first save would overwrite whatever content actually exists.
          setLoadErrorMessage(res.error);
          setLoadState('error');
          return;
        }
        const { fmRaw, prose: p } = splitChapterMeta(res.content);
        fmRawRef.current = fmRaw;
        setProse(p);
        setLoadState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadErrorMessage(err instanceof Error ? err.message : 'Unknown error');
        setLoadState('error');
      });
    return () => { cancelled = true; };
  }, [metaPath]);

  const handleChange = useCallback((markdown: string) => {
    const fm = fmRawRef.current ?? buildChapterFrontmatter(chapter, storyId);
    fmRawRef.current = fm;
    window.api.writeVault(metaPath, fm + markdown)
      .then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('error'));
  }, [metaPath, chapter, storyId]);

  if (loadState === 'loading') {
    return <div className="chapter-interlude chapter-interlude--loading" aria-busy="true" />;
  }

  if (loadState === 'error') {
    return (
      <section
        className="chapter-interlude chapter-interlude--error"
        aria-label={`Chapter text for ${chapter.title}`}
        data-testid="chapter-interlude"
      >
        <div className="chapter-interlude__error" role="alert">
          Couldn&apos;t load chapter text ({loadErrorMessage ?? 'unknown error'}). Editing is disabled to avoid overwriting existing content.
        </div>
      </section>
    );
  }

  return (
    <section className="chapter-interlude" aria-label={`Chapter text for ${chapter.title}`} data-testid="chapter-interlude">
      <header className="chapter-interlude__header">
        <span className="chapter-interlude__label">Chapter text</span>
        <span className="chapter-interlude__hint">Prose that belongs to the chapter itself — an interlude, epigraph, or note before the scenes.</span>
        <span className="chapter-interlude__status" role="status" aria-live="polite">
          {saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Save failed — retry by editing' : ''}
        </span>
      </header>
      <div className="chapter-interlude__editor">
        <RichTextEditor
          key={metaPath}
          content={prose}
          onChangeMarkdown={handleChange}
          suppressInitialChange
          autofocus={false}
        />
      </div>
    </section>
  );
}
