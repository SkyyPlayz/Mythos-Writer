// Beta 4 M14 — Export modal to prototype parity (FULL-SPEC §5.5).
//
// Prototype: "Mythos Writer - Liquid Neon.dc.html" 3823–3878 (modal shell,
// pick/busy/done steps) + exFmtCards/exScopeSeg/exSyn/exSep renderVals
// 6387–6392 + this.exportFmts 4326–4331.
//
// Three steps: pick (format cards · scope seg · toggles · gradient run) →
// busy (animated progress) → done (check, file chip, Show in folder, Done).
// A cancelled save dialog returns to pick — the modal only closes on Done,
// the ✕, or the backdrop.

import { useMemo, useState } from 'react';
import type { Story, Scene, Block } from './types';
import './ExportDialog.css';

export type ExportScope = | { kind: 'scene'; sceneId: string } | { kind: 'chapter'; chapterId: string; storyId: string } | { kind: 'story'; storyId: string } | { kind: 'vault' };
type ExportFormat = 'docx' | 'pdf' | 'epub' | 'markdown' | 'plaintext';
type ExportStep = 'pick' | 'busy' | 'done';

interface Props {
  scope: ExportScope;
  stories: Story[];
  onClose: () => void;
  /**
   * The chapter currently open in the editor — enables the "Current chapter"
   * scope segment when the modal opens story-scoped (Book view / File menu).
   */
  currentChapterId?: string | null;
}

type ExportResult = { path: string | null; cancelled: boolean; bytes?: number; missingSceneIds?: string[] };
interface ExportOptions { includeSynopsis: boolean; sceneSeparators: boolean }

// ─── Persisted compile options (prototype S.sx.expSyn / expSep defaults) ───

const OPTIONS_KEY = 'mythos-export-options-v1';

function loadExportOptions(): ExportOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ExportOptions>;
      return {
        includeSynopsis: parsed.includeSynopsis === true,
        sceneSeparators: parsed.sceneSeparators !== false,
      };
    }
  } catch { /* localStorage unavailable */ }
  // Prototype defaults: synopsis off (exSyn !!expSyn), separators on (expSep !== false)
  return { includeSynopsis: false, sceneSeparators: true };
}

function saveExportOptions(opts: ExportOptions): void {
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(opts)); } catch { /* ignore */ }
}

// ─── Scope helpers ───

function getScopedScenes(scope: ExportScope, stories: Story[]): Scene[] {
  switch (scope.kind) {
    case 'scene': for (const st of stories) for (const ch of st.chapters) { const s = ch.scenes.find((sc) => sc.id === scope.sceneId); if (s) return [s]; } return [];
    case 'chapter': { const st = stories.find((s) => s.id === scope.storyId); const ch = st?.chapters.find((c) => c.id === scope.chapterId); return ch ? [...ch.scenes].sort((a,b)=>a.order-b.order) : []; }
    case 'story': { const st = stories.find((s) => s.id === scope.storyId); return st ? st.chapters.flatMap((ch) => [...ch.scenes].sort((a,b)=>a.order-b.order)) : []; }
    case 'vault': return stories.flatMap((st) => st.chapters.flatMap((ch) => [...ch.scenes].sort((a,b)=>a.order-b.order)));
  }
}

function estimateWords(scenes: Scene[]): number { return scenes.reduce((t,sc)=>t+sc.blocks.reduce((u,b:Block)=>b.type==='note'?u:u+b.content.split(/\s+/).filter(Boolean).length,0),0); }

// SKY-7108 — resolve missing-file scene ids to titles for the Done-state
// warning; falls back to the raw id if the scene can't be found (e.g. it was
// deleted from the manifest between export and render).
function sceneLabel(sceneId: string, stories: Story[]): string {
  for (const st of stories) for (const ch of st.chapters) { const sc = ch.scenes.find((s) => s.id === sceneId); if (sc) return sc.title; }
  return sceneId;
}

function scopeLabel(scope: ExportScope, stories: Story[]): string {
  switch (scope.kind) {
    case 'vault': return 'Entire Vault';
    case 'story': { const st = stories.find((s)=>s.id===scope.storyId); return st ? st.title : 'Story'; }
    case 'chapter': { const st = stories.find((s)=>s.id===scope.storyId); const ch = st?.chapters.find((c)=>c.id===scope.chapterId); return ch ? ch.title : 'Chapter'; }
    case 'scene': for (const st of stories) for (const ch of st.chapters) { const sc = ch.scenes.find((s)=>s.id===scope.sceneId); if (sc) return sc.title; } return 'Scene';
  }
}

// ─── EPUB dispatch (story scope direct; vault scope = every non-empty story) ───

async function exportEpub(scope: ExportScope, stories: Story[], options: ExportOptions): Promise<ExportResult> {
  if (scope.kind === 'story') return window.api.exportEpub(scope.storyId, undefined, undefined, options);
  if (scope.kind !== 'vault') throw new Error('EPUB requires story scope');

  const storyIds = stories.filter((story) => story.chapters.some((chapter) => chapter.scenes.length > 0)).map((story) => story.id);
  const exportedPaths: string[] = [];
  const missingSceneIds: string[] = [];
  let totalBytes = 0;

  for (const storyId of storyIds) {
    const result = await window.api.exportEpub(storyId, undefined, undefined, options);
    if (result.cancelled) return { path: exportedPaths.join('\n') || null, cancelled: true };
    if (result.path) { exportedPaths.push(result.path); totalBytes += result.bytes ?? 0; }
    if (result.missingSceneIds) missingSceneIds.push(...result.missingSceneIds);
  }

  return {
    path: exportedPaths.join('\n') || null,
    cancelled: false,
    bytes: totalBytes || undefined,
    missingSceneIds: missingSceneIds.length ? missingSceneIds : undefined,
  };
}

// ─── Format cards (prototype exportFmts 4326–4331 + carried-over MD/TXT) ───

interface FormatCard {
  value: ExportFormat;
  /** Card title (prototype card name). */
  name: string;
  desc: string;
  icon: string;
  /** Accessible radio label — "<Name> (.ext)" keeps E2E/AT selectors stable. */
  aria: string;
}

const FMTS: FormatCard[] = [
  { value: 'docx', name: 'DOCX', desc: 'Word manuscript', aria: 'Word Document (.docx)', icon: 'M7 3.5h7l4 4v13H7z M14 3.5v4h4 M9.5 12l1.4 5 1.6-5 1.6 5 1.4-5' },
  { value: 'pdf', name: 'PDF', desc: 'Print-ready', aria: 'PDF (.pdf)', icon: 'M7 3.5h7l4 4v13H7z M14 3.5v4h4 M9.5 16.5v-4h1.4a1.3 1.3 0 0 1 0 2.6H9.5' },
  { value: 'epub', name: 'EPUB', desc: 'E-reader', aria: 'EPUB (.epub)', icon: 'M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-3.5L5 21z' },
  { value: 'markdown', name: 'MD', desc: 'Markdown vault', aria: 'Markdown (.md)', icon: 'M3.5 6h17v12h-17z M6.5 15v-6l2.5 3 2.5-3v6 M16 9v6 M16 15l-2-2.2 M16 15l2-2.2' },
  { value: 'plaintext', name: 'TXT', desc: 'Plain text', aria: 'Plain Text (.txt)', icon: 'M7 3.5h7l4 4v13H7z M14 3.5v4h4 M9.5 12h5 M9.5 15.5h5' },
];

const SHORT_NAME: Record<ExportFormat, string> = {
  docx: 'DOCX',
  pdf: 'PDF',
  epub: 'EPUB',
  markdown: 'MD',
  plaintext: 'TXT',
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function basename(p: string): string {
  const first = p.split('\n')[0];
  return first.split(/[\\/]/).pop() ?? first;
}

// ─── Toggle pill (prototype mkToggle) ───

function TogglePill({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`export-toggle${checked ? ' export-toggle--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="export-toggle__knob" />
    </button>
  );
}

// ─── Main component ───

export default function ExportDialog({ scope, stories, onClose, currentChapterId }: Props) {
  const [format, setFormat] = useState<ExportFormat>('docx');
  const [step, setStep] = useState<ExportStep>('pick');
  const [options, setOptions] = useState<ExportOptions>(loadExportOptions);
  const [done, setDone] = useState<{ path: string; bytes?: number; missingSceneIds?: string[] } | null>(null);

  // Scope segment (prototype exScopeSeg: Full book / Current part / Current
  // chapter). Only story- and chapter-scoped opens carry a story context;
  // scene/vault opens keep their fixed scope with a static label.
  const segStory = useMemo(() => {
    if (scope.kind === 'story') return stories.find((s) => s.id === scope.storyId) ?? null;
    if (scope.kind === 'chapter') return stories.find((s) => s.id === scope.storyId) ?? null;
    return null;
  }, [scope, stories]);
  const hasSeg = segStory !== null;
  const segChapterId = useMemo(() => {
    if (scope.kind === 'chapter') return scope.chapterId;
    if (currentChapterId && segStory?.chapters.some((c) => c.id === currentChapterId)) return currentChapterId;
    return null;
  }, [scope, currentChapterId, segStory]);
  const [scopeSeg, setScopeSeg] = useState<'book' | 'chapter'>(scope.kind === 'chapter' ? 'chapter' : 'book');

  const effectiveScope: ExportScope = useMemo(() => {
    if (!hasSeg || !segStory) return scope;
    if (scopeSeg === 'chapter' && segChapterId) return { kind: 'chapter', chapterId: segChapterId, storyId: segStory.id };
    return { kind: 'story', storyId: segStory.id };
  }, [hasSeg, segStory, scopeSeg, segChapterId, scope]);

  const scenes = useMemo(() => getScopedScenes(effectiveScope, stories), [effectiveScope, stories]);
  const wc = useMemo(() => estimateWords(scenes), [scenes]);
  const label = useMemo(() => scopeLabel(scope, stories), [scope, stories]);

  const epubDisabled = effectiveScope.kind === 'scene' || effectiveScope.kind === 'chapter';
  const selectedFormatDisabled = format === 'epub' && epubDisabled;

  const setOption = (patch: Partial<ExportOptions>) => {
    setOptions((prev) => {
      const next = { ...prev, ...patch };
      saveExportOptions(next);
      return next;
    });
  };

  const doExport = async () => {
    setStep('busy');
    try {
      const api = window.api;
      let res: ExportResult;
      if (format === 'markdown') res = await api.exportMarkdown(effectiveScope);
      else if (format === 'plaintext') res = await api.exportPlaintext(effectiveScope);
      else if (format === 'pdf') res = await api.exportPdf(effectiveScope, options);
      else if (format === 'epub') res = await exportEpub(effectiveScope, stories, options);
      else res = await api.exportDocx(undefined, effectiveScope, options);
      if (res.cancelled || !res.path) {
        // Save dialog dismissed — back to the pick step, keep the modal open.
        setStep('pick');
        return;
      }
      setDone({ path: res.path, bytes: res.bytes, missingSceneIds: res.missingSceneIds });
      setStep('done');
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`);
      setStep('pick');
    }
  };

  return (
    <div className="export-dialog-overlay" onClick={step === 'busy' ? undefined : onClose} role="presentation">
      <div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" onClick={(e) => e.stopPropagation()}>
        <div className="export-dialog-header">
          <h2 id="export-dialog-title" className="export-dialog-title">Export — {label}</h2>
          <button className="export-dialog-close" aria-label="Close" onClick={onClose}>
            <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
          </button>
        </div>

        {step === 'busy' && (
          /* Busy step — prototype exBusy (3854–3859) */
          <div className="export-dialog-busy" role="status">
            <div className="export-dialog-busy-track"><div className="export-dialog-busy-fill" /></div>
            <div className="export-dialog-busy-text">
              Compiling {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · applying styles · building table of contents…
            </div>
          </div>
        )}

        {step === 'done' && done && (
          /* Done step — prototype exDone (3860–3876) */
          <div className="export-dialog-done" role="status">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16.5 9.5" /></svg>
            <div className="export-dialog-done-title">Export complete</div>
            <div className="export-dialog-file-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4" /></svg>
              <span className="export-dialog-file-name" title={done.path}>{basename(done.path)}</span>
              {done.bytes !== undefined && <span className="export-dialog-file-size">{formatBytes(done.bytes)}</span>}
            </div>
            {done.missingSceneIds && done.missingSceneIds.length > 0 && (
              // SKY-7108 — surface scenes whose .md file was missing so a broken
              // export is never mistaken for a complete one.
              <div className="export-dialog-done-warning" role="alert">
                {done.missingSceneIds.length === 1 ? '1 scene had' : `${done.missingSceneIds.length} scenes had`} no prose file and {done.missingSceneIds.length === 1 ? 'was' : 'were'} exported empty: {done.missingSceneIds.map((id) => sceneLabel(id, stories)).join(', ')}
              </div>
            )}
            <div className="export-dialog-done-actions">
              <button className="export-dialog-reveal" onClick={() => { void window.api.exportRevealLast?.(); }}>Show in folder</button>
              <button className="export-dialog-done-btn" onClick={onClose}>Done</button>
            </div>
          </div>
        )}

        {step === 'pick' && (
          <>
            <p className="export-dialog-sub">Compiles from your headings — parts, chapters and scenes stay intact.</p>
            <fieldset className="export-dialog-formats">
              <legend className="export-dialog-formats-legend">Format</legend>
              {FMTS.map(({ value, name, desc, icon, aria }) => {
                const disabled = value === 'epub' && epubDisabled;
                const selected = format === value;
                return (
                  <label
                    key={value}
                    className={[
                      'export-fmt-card',
                      selected ? 'export-fmt-card--selected' : '',
                      disabled ? 'export-fmt-card--disabled' : '',
                    ].filter(Boolean).join(' ')}
                    title={disabled ? 'EPUB requires full-book scope' : undefined}
                  >
                    <input
                      type="radio"
                      className="export-fmt-card__input"
                      name="export-format"
                      value={value}
                      aria-label={aria}
                      checked={selected}
                      disabled={disabled}
                      onChange={() => setFormat(value)}
                    />
                    <FormatIcon paths={icon} />
                    <span className="export-fmt-card__name">{name}</span>
                    <span className="export-fmt-card__desc">{desc}</span>
                    {disabled && <span className="export-fmt-card__note">EPUB requires story scope</span>}
                  </label>
                );
              })}
            </fieldset>

            {/* Scope — prototype exScopeSeg (3839–3844): seg for story-context
                opens, static label for scene/vault opens. */}
            <div className="export-dialog-scope">
              <span className="export-dialog-scope-key">Scope</span>
              {hasSeg ? (
                <div className="export-scope-seg" role="group" aria-label="Export scope">
                  <button
                    type="button"
                    className={`export-scope-seg__btn${scopeSeg === 'book' ? ' export-scope-seg__btn--active' : ''}`}
                    aria-pressed={scopeSeg === 'book'}
                    onClick={() => setScopeSeg('book')}
                  >
                    Full book
                  </button>
                  <button
                    type="button"
                    className="export-scope-seg__btn"
                    aria-pressed={false}
                    disabled
                    title="This story has no parts yet"
                  >
                    Current part
                  </button>
                  <button
                    type="button"
                    className={`export-scope-seg__btn${scopeSeg === 'chapter' ? ' export-scope-seg__btn--active' : ''}`}
                    aria-pressed={scopeSeg === 'chapter'}
                    disabled={!segChapterId}
                    title={segChapterId ? undefined : 'Open a chapter in the editor first'}
                    onClick={() => setScopeSeg('chapter')}
                  >
                    Current chapter
                  </button>
                </div>
              ) : (
                <span className="export-dialog-scope-label">{label}</span>
              )}
              <span className="export-dialog-stats">{scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · ~{wc.toLocaleString()} words</span>
            </div>

            {/* Compile options — prototype 3846–3851, live since Beta 4 M14. */}
            <div className="export-dialog-toggle-row">
              <span className="export-dialog-toggle-label">Include synopsis page</span>
              <TogglePill
                label="Include synopsis page"
                checked={options.includeSynopsis}
                onChange={(v) => setOption({ includeSynopsis: v })}
              />
            </div>
            <div className="export-dialog-toggle-row">
              <span className="export-dialog-toggle-label">Scene separators (◆ ◆ ◆)</span>
              <TogglePill
                label="Scene separators"
                checked={options.sceneSeparators}
                onChange={(v) => setOption({ sceneSeparators: v })}
              />
            </div>

            <button
              className="export-dialog-run"
              onClick={doExport}
              disabled={scenes.length === 0 || selectedFormatDisabled}
            >
              Export {SHORT_NAME[format]}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
