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

const FMTS: { value: ExportFormat; label: string }[] = [
  { value: 'markdown', label: 'Markdown (.md)' },
  { value: 'plaintext', label: 'Plain Text (.txt)' },
  { value: 'docx', label: 'Word Document (.docx)' },
  { value: 'epub', label: 'EPUB (.epub)' },
];
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
          <button className="export-dialog-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="export-dialog-scope">
          <span className="export-dialog-scope-label">{label}</span>
          <span className="export-dialog-stats">{scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · ~{wc.toLocaleString()} words</span>
        </div>
        <fieldset className="export-dialog-formats">
          <legend className="export-dialog-formats-legend">Format</legend>
          {FMTS.map(({ value, label: fl }) => {
            const disabled = value === 'epub' && isEpubDisabled(scope);
            return (
              <label key={value} className="export-dialog-format-option" title={disabled ? 'EPUB requires story scope' : undefined}>
                <input
                  type="radio"
                  name="export-format"
                  value={value}
                  checked={format === value}
                  disabled={disabled}
                  onChange={() => setFormat(value)}
                />
                {fl}
                {disabled && <span className="export-dialog-format-note">EPUB requires story scope</span>}
              </label>
            );
          })}
        </fieldset>
        <div className="export-dialog-actions">
          <button className="export-dialog-btn export-dialog-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="export-dialog-btn export-dialog-btn-primary" onClick={doExport} disabled={busy||scenes.length===0||selectedFormatDisabled}>{busy?'Exporting…':'Export…'}</button>
        </div>
      </div>
    </div>
  );
}
