import { useCallback, useEffect, useRef, useState } from 'react';
import RichTextEditor from './RichTextEditor';
import type { Chapter } from './types';
import './ChapterInterlude.css';

// GH #631: chapter-owned prose ("interlude" text that belongs to the chapter
// itself, not to any scene). It lives in the chapter folder's chapter.md —
// already persisted by the vault layer (SKY-10) but never surfaced in the UI
// until now. The frontmatter block is preserved byte-for-byte; only the prose
// below it is edited, so scene files and version backups are untouched.

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\n---\r?\n?/;

export function splitChapterMeta(content: string): { fmRaw: string | null; prose: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { fmRaw: null, prose: content };
  return { fmRaw: match[0], prose: content.slice(match[0].length) };
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

export default function ChapterInterlude({ chapter, storyId }: ChapterInterludeProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [prose, setProse] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  // Frontmatter is kept verbatim so a round-trip through this editor never
  // reorders or reformats chapter metadata.
  const fmRawRef = useRef<string | null>(null);

  const metaPath = `${chapter.path.replace(/\\/g, '/')}/chapter.md`;

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setSaveStatus('idle');
    window.api.readVault(metaPath)
      .then((res) => {
        if (cancelled) return;
        const { fmRaw, prose: p } = splitChapterMeta(res.content);
        fmRawRef.current = fmRaw;
        setProse(p);
        setLoadState('ready');
      })
      .catch(() => {
        // chapter.md does not exist yet (pre-SKY-10 vaults, or chapters created
        // before interlude support) — start empty and create it on first save.
        if (cancelled) return;
        fmRawRef.current = null;
        setProse('');
        setLoadState('ready');
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
