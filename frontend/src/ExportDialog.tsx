import { useState, useMemo } from 'react';
import type { Story, Scene, Block } from './types';
import './ExportDialog.css';

export type ExportScope = | { kind: 'scene'; sceneId: string } | { kind: 'chapter'; chapterId: string; storyId: string } | { kind: 'story'; storyId: string } | { kind: 'vault' };
type ExportFormat = 'markdown' | 'plaintext' | 'docx' | 'epub';
interface Props { scope: ExportScope; stories: Story[]; onClose: () => void; }

type ExportResult = { path: string | null; cancelled: boolean };

function getScopedScenes(scope: ExportScope, stories: Story[]): Scene[] {
  switch (scope.kind) {
    case 'scene': for (const st of stories) for (const ch of st.chapters) { const s = ch.scenes.find((sc) => sc.id === scope.sceneId); if (s) return [s]; } return [];
    case 'chapter': { const st = stories.find((s) => s.id === scope.storyId); const ch = st?.chapters.find((c) => c.id === scope.chapterId); return ch ? [...ch.scenes].sort((a,b)=>a.order-b.order) : []; }
    case 'story': { const st = stories.find((s) => s.id === scope.storyId); return st ? st.chapters.flatMap((ch) => [...ch.scenes].sort((a,b)=>a.order-b.order)) : []; }
    case 'vault': return stories.flatMap((st) => st.chapters.flatMap((ch) => [...ch.scenes].sort((a,b)=>a.order-b.order)));
  }
}
function estimateWords(scenes: Scene[]): number { return scenes.reduce((t,sc)=>t+sc.blocks.reduce((u,b:Block)=>b.type==='note'?u:u+b.content.split(/\s+/).filter(Boolean).length,0),0); }
function scopeLabel(scope: ExportScope, stories: Story[]): string {
  switch (scope.kind) {
    case 'vault': return 'Entire Vault';
    case 'story': { const st = stories.find((s)=>s.id===scope.storyId); return st ? `Story: ${st.title}` : 'Story'; }
    case 'chapter': { const st = stories.find((s)=>s.id===scope.storyId); const ch = st?.chapters.find((c)=>c.id===scope.chapterId); return ch ? `Chapter: ${ch.title}` : 'Chapter'; }
    case 'scene': for (const st of stories) for (const ch of st.chapters) { const sc = ch.scenes.find((s)=>s.id===scope.sceneId); if (sc) return `Scene: ${sc.title}`; } return 'Scene';
  }
}
function isEpubDisabled(scope: ExportScope): boolean { return scope.kind === 'scene' || scope.kind === 'chapter'; }

async function exportEpub(scope: ExportScope, stories: Story[]): Promise<ExportResult> {
  if (scope.kind === 'story') return window.api.exportEpub(scope.storyId);
  if (scope.kind !== 'vault') throw new Error('EPUB requires story scope');

  const storyIds = stories.filter((story) => story.chapters.some((chapter) => chapter.scenes.length > 0)).map((story) => story.id);
  const exportedPaths: string[] = [];

  for (const storyId of storyIds) {
    const result = await window.api.exportEpub(storyId);
    if (result.cancelled) return { path: exportedPaths.join('\n') || null, cancelled: true };
    if (result.path) exportedPaths.push(result.path);
  }

  return { path: exportedPaths.join('\n') || null, cancelled: false };
}

// ─── Format cards (Beta 3 M14) — prototype export modal 2733–2737, exFmtCards
// renderVals 4424–4428, icon paths from this.exportFmts (prototype 3153–3158). ───

interface FormatCard {
  value: ExportFormat;
  /** Visible name — kept as "<Name> (.ext)" so scope/format E2E selectors keep matching. */
  label: string;
  desc: string;
  icon: string;
}

const FMTS: FormatCard[] = [
  { value: 'docx', label: 'Word Document (.docx)', desc: 'Word manuscript', icon: 'M7 3.5h7l4 4v13H7z M14 3.5v4h4 M9.5 12l1.4 5 1.6-5 1.6 5 1.4-5' },
  { value: 'epub', label: 'EPUB (.epub)', desc: 'E-reader', icon: 'M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-3.5L5 21z' },
  { value: 'markdown', label: 'Markdown (.md)', desc: 'Markdown vault', icon: 'M3.5 6h17v12h-17z M6.5 15v-6l2.5 3 2.5-3v6 M16 9v6 M16 15l-2-2.2 M16 15l2-2.2' },
  { value: 'plaintext', label: 'Plain Text (.txt)', desc: 'Universal text', icon: 'M7 3.5h7l4 4v13H7z M14 3.5v4h4 M9.5 12h5 M9.5 15.5h5' },
];

/** PDF is prototype card #2; window.api.exportPdf does not exist yet, so it renders disabled. */
const PDF_CARD = { label: 'PDF (.pdf)', desc: 'Print-ready', icon: 'M7 3.5h7l4 4v13H7z M14 3.5v4h4 M9.5 16.5v-4h1.4a1.3 1.3 0 0 1 0 2.6H9.5' };
const PDF_DISABLED_REASON = 'Coming with the print pipeline';

const SHORT_NAME: Record<ExportFormat, string> = {
  markdown: 'Markdown',
  plaintext: 'Plain Text',
  docx: 'DOCX',
  epub: 'EPUB',
};

function FormatIcon({ paths }: { paths: string }) {
  return (
    <svg
      className="export-fmt-card__icon"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.split(' M').map((p, i) => (
        <path key={i} d={i === 0 ? p : `M${p}`} />
      ))}
    </svg>
  );
}

export default function ExportDialog({ scope, stories, onClose }: Props) {
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [busy, setBusy] = useState(false);
  const scenes = useMemo(() => getScopedScenes(scope, stories), [scope, stories]);
  const wc = useMemo(() => estimateWords(scenes), [scenes]);
  const label = useMemo(() => scopeLabel(scope, stories), [scope, stories]);
  const selectedFormatDisabled = format === 'epub' && isEpubDisabled(scope);
  const doExport = async () => {
    setBusy(true);
    try {
      const api = window.api;
      let res: ExportResult;
      if (format === 'markdown') res = await api.exportMarkdown(scope);
      else if (format === 'plaintext') res = await api.exportPlaintext(scope);
      else if (format === 'epub') res = await exportEpub(scope, stories);
      else res = await api.exportDocx(undefined, scope);
      if (!res.cancelled && res.path) alert(`Exported to:\n${res.path}`);
      onClose();
    } catch (err) { alert(`Export failed: ${(err as Error).message}`); } finally { setBusy(false); }
  };
  return (
    <div className="export-dialog-overlay" onClick={onClose} role="presentation">
      <div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" onClick={(e) => e.stopPropagation()}>
        <div className="export-dialog-header">
          <h2 id="export-dialog-title" className="export-dialog-title">Export</h2>
          <button className="export-dialog-close" aria-label="Close" onClick={onClose}>
            <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
          </button>
        </div>
        {busy ? (
          /* Busy step — prototype exBusy (2754–2759) */
          <div className="export-dialog-busy" role="status">
            <div className="export-dialog-busy-track"><div className="export-dialog-busy-fill" /></div>
            <div className="export-dialog-busy-text">
              Compiling {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · applying styles…
            </div>
          </div>
        ) : (
          <>
            <p className="export-dialog-sub">Compiles from your headings — parts, chapters and scenes stay intact.</p>
            <fieldset className="export-dialog-formats">
              <legend className="export-dialog-formats-legend">Format</legend>
              {FMTS.map(({ value, label: fl, desc, icon }) => {
                const disabled = value === 'epub' && isEpubDisabled(scope);
                const selected = format === value;
                return (
                  <label
                    key={value}
                    className={[
                      'export-fmt-card',
                      selected ? 'export-fmt-card--selected' : '',
                      disabled ? 'export-fmt-card--disabled' : '',
                    ].filter(Boolean).join(' ')}
                    title={disabled ? 'EPUB requires story scope' : undefined}
                  >
                    <input
                      type="radio"
                      className="export-fmt-card__input"
                      name="export-format"
                      value={value}
                      checked={selected}
                      disabled={disabled}
                      onChange={() => setFormat(value)}
                    />
                    <FormatIcon paths={icon} />
                    <span className="export-fmt-card__name">{fl}</span>
                    <span className="export-fmt-card__desc">{desc}</span>
                    {disabled && <span className="export-fmt-card__note">EPUB requires story scope</span>}
                  </label>
                );
              })}
              <label
                className="export-fmt-card export-fmt-card--disabled"
                title={PDF_DISABLED_REASON}
              >
                <input
                  type="radio"
                  className="export-fmt-card__input"
                  name="export-format"
                  value="pdf"
                  checked={false}
                  disabled
                  readOnly
                />
                <FormatIcon paths={PDF_CARD.icon} />
                <span className="export-fmt-card__name">{PDF_CARD.label}</span>
                <span className="export-fmt-card__desc">{PDF_CARD.desc}</span>
              </label>
            </fieldset>
            <div className="export-dialog-scope">
              <span className="export-dialog-scope-key">Scope</span>
              <span className="export-dialog-scope-label">{label}</span>
              <span className="export-dialog-stats">{scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · ~{wc.toLocaleString()} words</span>
            </div>
            {/* Compile options — prototype 2744–2751; disabled until the compile
                pipeline accepts options (main-process export IPC takes none yet). */}
            <div className="export-dialog-toggle-row">
              <span className="export-dialog-toggle-label">Include synopsis page</span>
              <button type="button" role="switch" aria-checked="false" aria-label="Include synopsis page" disabled className="export-toggle" title={PDF_DISABLED_REASON}>
                <span className="export-toggle__knob" />
              </button>
            </div>
            <div className="export-dialog-toggle-row">
              <span className="export-dialog-toggle-label">Scene separators (◆ ◆ ◆)</span>
              <button type="button" role="switch" aria-checked="true" aria-label="Scene separators" disabled className="export-toggle export-toggle--on" title={PDF_DISABLED_REASON}>
                <span className="export-toggle__knob" />
              </button>
            </div>
            <div className="export-dialog-actions">
              <button className="export-dialog-cancel" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="export-dialog-run" onClick={doExport} disabled={busy || scenes.length === 0 || selectedFormatDisabled}>
                Export {SHORT_NAME[format]}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
