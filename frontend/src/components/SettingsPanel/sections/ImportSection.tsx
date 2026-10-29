// #1765 — Settings → Vault & Files "Import your writing" (FULL-SPEC.md:204:
// import sits right after the Mythos vaults cards). One drop zone plus two
// native pick buttons → main safety-checks + detects the source and returns a
// path-free ImportPreview → the writer reviews chapters / scenes / notes /
// entities and an excerpt with its formatting → only then import:commit
// writes into the open Mythos vault.
//
// The renderer never sees a filesystem path: picks happen in main, and a
// dropped File is resolved by preload (webUtils.getPathForFile).
//
// This section shows no stored data. The import options (both checkboxes on)
// are shipped defaults that reset with every new preview — nothing persists.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, ReactNode, RefObject } from 'react';
import { showLnToast } from '../../../theme/lnToast';
import type {
  ImportCommitOptions,
  ImportCommitResult,
  ImportEntityType,
  ImportPreview,
  ImportPreviewResult,
  StructureSource,
} from '../../../importHubTypes';
import './M24Sections.css';
import './ImportSection.css';

/** The preload bridge (window.api.importHub) — optional, feature-detected. */
export interface ImportHubBridge {
  pick: (mode: 'file' | 'folder') => Promise<ImportPreviewResult>;
  previewDropped: (file: File) => Promise<ImportPreviewResult>;
  commit: (token: string, options?: ImportCommitOptions) => Promise<ImportCommitResult>;
}

/** The one place the bridge is read (swap for the typed window.api path once global.d.ts settles). */
function getImportHub(): ImportHubBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { api?: { importHub?: ImportHubBridge } }).api?.importHub;
}

const FORMATS_TEXT = 'Word (.docx), Google Docs, Markdown files or folders, Scrivener, ePub, RTF, plain text';

const STRUCTURE_TEXT: Record<StructureSource, string> = {
  headings: 'Chapters found from your headings',
  patterns: 'Chapters found from lines like “Chapter One”',
  pagebreaks: 'Chapters found from page breaks',
  binder: 'Chapters from your Scrivener binder',
  files: 'One chapter per file',
  none: 'No chapters found — it will come in as one chapter you can split later',
};

const ENTITY_ORDER: readonly ImportEntityType[] = ['character', 'location', 'faction', 'item', 'event', 'concept'];
const ENTITY_LABEL: Record<ImportEntityType, string> = {
  character: 'Characters',
  location: 'Locations',
  faction: 'Factions',
  item: 'Items',
  event: 'Events',
  concept: 'Concepts',
};

const NOTE_TITLES_SHOWN = 8;
const ENTITY_TITLES_SHOWN = 6;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// ─── Excerpt: editor Markdown → React elements ───────────────────────────────
// A tiny, safe subset renderer for the preview excerpt (never HTML injection):
// **bold** / __bold__, *italic* / _italic_, ~~strike~~, <u>underline</u>,
// `\`+newline hard breaks, backslash escapes, the entities the serializer
// writes, ` {.center}` alignment suffixes and `#` headings left in a scene.

type MarkName = 'bold' | 'italic' | 'strike' | 'underline';

/**
 * `run` is a whole run of `*`, `_` or `~` (so `***x***` nests like the
 * serializer wrote it); `u` is an explicit `<u>` / `</u>` tag.
 */
type Token =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'run'; ch: '*' | '_' | '~'; len: number; open: boolean; close: boolean }
  | { t: 'u'; closing: boolean; raw: string };

const ENTITY_MAP: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

function decodeEntity(body: string): string | null {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
    return String.fromCodePoint(code);
  }
  return ENTITY_MAP[body.toLowerCase()] ?? null;
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const text = (v: string) => {
    const last = out[out.length - 1];
    if (last && last.t === 'text') last.v += v;
    else out.push({ t: 'text', v });
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '\n') { out.push({ t: 'br' }); i += 2; continue; }
      if (next !== undefined && ASCII_PUNCT.test(next)) { text(next); i += 2; continue; }
      text(ch); i += 1; continue;
    }
    if (ch === '\n') { text(' '); i += 1; continue; }
    if (ch === '&') {
      const m = /^&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/.exec(src.slice(i));
      const decoded = m ? decodeEntity(m[1]) : null;
      if (m && decoded !== null) { text(decoded); i += m[0].length; continue; }
      text(ch); i += 1; continue;
    }
    if (ch === '<') {
      const m = /^<(\/?)u>/i.exec(src.slice(i));
      if (m) { out.push({ t: 'u', closing: m[1] === '/', raw: m[0] }); i += m[0].length; continue; }
      text(ch); i += 1; continue;
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      let len = 1;
      while (src[i + len] === ch) len++;
      const before = src[i - 1];
      const after = src[i + len];
      let open = !isSpace(after);
      let close = !isSpace(before);
      // `_` never opens or closes inside a word (snake_case stays literal).
      if (ch === '_') {
        open = open && !isWordChar(before);
        close = close && !isWordChar(after);
      }
      // A single `~` is plain text; strike needs `~~`.
      if ((open || close) && !(ch === '~' && len < 2)) out.push({ t: 'run', ch, len, open, close });
      else text(ch.repeat(len));
      i += len;
      continue;
    }
    text(ch);
    i += 1;
  }
  return out;
}

interface Frame {
  mark: MarkName | null;
  /** The delimiter that opened it (`*`, `_`, `~`, `<u>`) and how many chars it took. */
  ch: string;
  size: number;
  children: ReactNode[];
}

function wrap(mark: MarkName, children: ReactNode[], key: number): ReactNode {
  switch (mark) {
    case 'bold': return <strong key={key}>{children}</strong>;
    case 'italic': return <em key={key}>{children}</em>;
    case 'strike': return <s key={key}>{children}</s>;
    case 'underline': return <u key={key}>{children}</u>;
  }
}

/** Inline editor Markdown → React nodes. Unclosed marks (a truncated excerpt) still apply to the rest. */
export function renderInlineMarkdown(src: string): ReactNode[] {
  const stack: Frame[] = [{ mark: null, ch: '', size: 0, children: [] }];
  let key = 0;
  const top = () => stack[stack.length - 1];
  const closeTop = () => {
    const f = stack.pop() as Frame & { mark: MarkName };
    top().children.push(wrap(f.mark, f.children, key++));
  };
  /** Index of the innermost open frame for this delimiter, or -1. */
  const innermost = (ch: string) => {
    for (let k = stack.length - 1; k > 0; k--) if (stack[k].ch === ch) return k;
    return -1;
  };
  for (const tok of tokenize(src)) {
    if (tok.t === 'text') { top().children.push(tok.v); continue; }
    if (tok.t === 'br') { top().children.push(<br key={key++} />); continue; }
    if (tok.t === 'u') {
      const idx = innermost('<u>');
      if (tok.closing && idx > 0) while (stack.length > idx) closeTop();
      else if (!tok.closing && idx < 0) stack.push({ mark: 'underline', ch: '<u>', size: 0, children: [] });
      else top().children.push(tok.raw);
      continue;
    }
    let n = tok.len;
    // Close inner-first: `***x***` closes the italic, then the bold.
    if (tok.close) {
      for (;;) {
        const idx = innermost(tok.ch);
        if (idx < 0 || stack[idx].size > n) break;
        n -= stack[idx].size;
        while (stack.length > idx) closeTop();
      }
    }
    // Open outer-first, matching the serializer's bold → italic nesting.
    if (tok.open) {
      while (n > 0) {
        if (tok.ch === '~') {
          if (n < 2) break;
          stack.push({ mark: 'strike', ch: '~', size: 2, children: [] });
          n -= 2;
        } else if (n >= 2) {
          stack.push({ mark: 'bold', ch: tok.ch, size: 2, children: [] });
          n -= 2;
        } else {
          stack.push({ mark: 'italic', ch: tok.ch, size: 1, children: [] });
          n -= 1;
        }
      }
    }
    if (n > 0) top().children.push(tok.ch.repeat(n));
  }
  while (stack.length > 1) closeTop();
  return stack[0].children;
}

type Align = 'center' | 'right' | 'justify';

/** The excerpt's paragraphs (blank-line separated) with their alignment / heading flag. */
export function excerptParagraphs(excerpt: string): { text: string; align?: Align; heading: boolean }[] {
  return excerpt
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\s+$/g, ''))
    .filter((p) => p.length > 0)
    .map((p) => {
      let text = p;
      let align: Align | undefined;
      const am = / \{\.(center|right|justify)\}$/.exec(text);
      if (am) {
        align = am[1] as Align;
        text = text.slice(0, am.index);
      }
      const hm = /^#{1,6} +/.exec(text);
      if (hm) text = text.slice(hm[0].length);
      return { text, align, heading: Boolean(hm) };
    });
}

function Excerpt({ excerpt }: { excerpt: string }) {
  const paras = excerptParagraphs(excerpt);
  if (paras.length === 0) return null;
  return (
    <div className="import-excerpt" data-testid="import-excerpt">
      <p className="import-excerpt__label">How the opening will look</p>
      {paras.map((p, i) => (
        <p
          key={i}
          className={[
            'import-excerpt__p',
            p.heading ? 'import-excerpt__p--heading' : '',
            p.align ? `import-excerpt__p--${p.align}` : '',
          ].filter(Boolean).join(' ')}
        >
          {renderInlineMarkdown(p.text)}
        </p>
      ))}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy'; name: string | null }
  | { kind: 'preview'; preview: ImportPreview }
  | { kind: 'committing'; preview: ImportPreview }
  | { kind: 'done'; result: Extract<ImportCommitResult, { ok: true }> };

type Alert =
  | { kind: 'refused'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'commit-error'; message: string };

function successLine(r: Extract<ImportCommitResult, { ok: true }>): string {
  const extras: string[] = [];
  if (r.noteCount > 0) extras.push(plural(r.noteCount, 'note'));
  if (r.entityCount > 0) extras.push(`${r.entityCount.toLocaleString()} characters & places`);
  if (r.storyTitle) {
    const head = `Imported “${r.storyTitle}” — ${plural(r.chapterCount, 'chapter')}, ${plural(r.sceneCount, 'scene')}`;
    return extras.length ? `${head}, ${extras.join(', ')}` : head;
  }
  return extras.length ? `Imported ${extras.join(', ')}` : 'Import finished';
}

/** End a main-supplied sentence with a full stop so a second sentence can follow. */
function withStop(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

function WarningList({ warnings, testId }: { warnings: string[]; testId: string }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="import-warnings" data-testid={testId}>
      {warnings.map((w, i) => <li key={i}>{w}</li>)}
    </ul>
  );
}

function PreviewView({
  preview,
  committing,
  includeStory,
  includeNotes,
  setIncludeStory,
  setIncludeNotes,
  commitError,
  onConfirm,
  onCancel,
  headingRef,
}: {
  preview: ImportPreview;
  committing: boolean;
  includeStory: boolean;
  includeNotes: boolean;
  setIncludeStory: (v: boolean) => void;
  setIncludeNotes: (v: boolean) => void;
  commitError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  const { story, notes, entities } = preview;
  const hasStory = story !== null;
  const hasNotes = notes.length + entities.length > 0;
  const sceneCount = story ? story.chapters.reduce((n, c) => n + c.scenes.length, 0) : 0;
  const nothingSelected = (!hasStory || !includeStory) && (!hasNotes || !includeNotes);
  const blocked = !preview.canCommit;

  const entityGroups = ENTITY_ORDER
    .map((type) => ({ type, titles: entities.filter((e) => e.type === type).map((e) => e.title) }))
    .filter((g) => g.titles.length > 0);

  return (
    <div className="import-preview" data-testid="import-preview">
      <h4 className="import-preview__heading" ref={headingRef} tabIndex={-1}>
        Preview — nothing is saved yet
      </h4>
      <p className="import-preview__source" data-testid="import-preview-source">
        {preview.source.label} · {preview.source.name}
      </p>

      {story && (
        <div className="import-block" data-testid="import-preview-story">
          <h5 className="import-block__title">Story</h5>
          <p className="import-story-title" data-testid="import-story-title">{story.title}</p>
          <p className="settings-hint" data-testid="import-structure">{STRUCTURE_TEXT[story.structure]}</p>
          <p className="import-totals" data-testid="import-totals">
            {plural(story.chapters.length, 'chapter')} · {plural(sceneCount, 'scene')} · {plural(story.words, 'word')}
            {story.partCount > 0 ? ` · ${plural(story.partCount, 'part')}` : ''}
          </p>
          {story.chapters.length > 0 && (
            <ol className="import-chapters" data-testid="import-chapters">
              {story.chapters.map((c, ci) => (
                <li key={ci} className="import-chapter">
                  <details>
                    <summary>
                      <span className="import-chapter__title">{c.title}</span>
                      <span className="import-chapter__meta">
                        {plural(c.scenes.length, 'scene')} · {plural(c.words, 'word')}
                      </span>
                    </summary>
                    <ul className="import-scenes">
                      {c.scenes.map((s, si) => (
                        <li key={si}>
                          <span className="import-scene__title">{s.title}</span>
                          <span className="import-chapter__meta">{plural(s.words, 'word')}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ol>
          )}
          {story.excerpt && <Excerpt excerpt={story.excerpt} />}
        </div>
      )}

      {notes.length > 0 && (
        <div className="import-block" data-testid="import-preview-notes">
          <h5 className="import-block__title">Notes · {notes.length.toLocaleString()}</h5>
          <ul className="import-list">
            {notes.slice(0, NOTE_TITLES_SHOWN).map((n, i) => <li key={i}>{n.title}</li>)}
          </ul>
          {notes.length > NOTE_TITLES_SHOWN && (
            <p className="settings-hint">and {(notes.length - NOTE_TITLES_SHOWN).toLocaleString()} more</p>
          )}
        </div>
      )}

      {entityGroups.length > 0 && (
        <div className="import-block" data-testid="import-preview-entities">
          <h5 className="import-block__title">Characters, places &amp; more</h5>
          <ul className="import-list">
            {entityGroups.map((g) => (
              <li key={g.type} data-testid={`import-entities-${g.type}`}>
                <span className="import-entity__label">{ENTITY_LABEL[g.type]} · {g.titles.length.toLocaleString()}</span>
                {' '}
                <span className="import-entity__names">
                  {g.titles.slice(0, ENTITY_TITLES_SHOWN).join(', ')}
                  {g.titles.length > ENTITY_TITLES_SHOWN ? `, and ${g.titles.length - ENTITY_TITLES_SHOWN} more` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasStory && !hasNotes && (
        <p className="settings-hint" data-testid="import-preview-empty">Nothing to import was found in this source.</p>
      )}

      <WarningList warnings={preview.warnings} testId="import-preview-warnings" />

      {hasStory && hasNotes && (
        <fieldset className="import-options">
          <legend className="import-options__legend">What to import</legend>
          <label className="import-option">
            <input
              type="checkbox"
              data-testid="import-opt-story"
              checked={includeStory}
              disabled={committing}
              onChange={(e) => setIncludeStory(e.target.checked)}
            />
            Import the manuscript
          </label>
          <label className="import-option">
            <input
              type="checkbox"
              data-testid="import-opt-notes"
              checked={includeNotes}
              disabled={committing}
              onChange={(e) => setIncludeNotes(e.target.checked)}
            />
            Import notes &amp; characters
          </label>
        </fieldset>
      )}

      {commitError && (
        <p className="settings-error-msg" role="alert" data-testid="import-commit-error">{commitError}</p>
      )}

      {blocked && preview.commitBlockedReason && (
        <p className="settings-hint" id="import-blocked-reason" data-testid="import-blocked-reason">
          {preview.commitBlockedReason}
        </p>
      )}

      <div className="import-actions">
        <button
          type="button"
          className="m24-btn m24-btn--primary"
          data-testid="import-confirm"
          disabled={committing || blocked || nothingSelected}
          aria-describedby={blocked && preview.commitBlockedReason ? 'import-blocked-reason' : undefined}
          onClick={onConfirm}
        >
          {committing ? 'Importing…' : 'Import'}
        </button>
        <button type="button" className="m24-btn" data-testid="import-cancel" disabled={committing} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function ImportSection() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [alert, setAlert] = useState<Alert | null>(null);
  const [multiHint, setMultiHint] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // Shipped defaults: import both halves (reset on every new preview).
  const [includeStory, setIncludeStory] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);

  const mountedRef = useRef(true);
  const reqIdRef = useRef(0);
  const dragDepthRef = useRef(0);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Focus follows the flow: the preview heading when a preview appears, the
  // success heading when the import is done.
  const previewToken = phase.kind === 'preview' ? phase.preview.token : null;
  useEffect(() => {
    if (previewToken) previewHeadingRef.current?.focus();
  }, [previewToken]);
  useEffect(() => {
    if (phase.kind === 'done') doneHeadingRef.current?.focus();
  }, [phase.kind]);

  const hub = getImportHub();
  const busy = phase.kind === 'busy';
  const committing = phase.kind === 'committing';

  const runPreview = useCallback(async (name: string | null, request: () => Promise<ImportPreviewResult>) => {
    const id = ++reqIdRef.current;
    const before = phaseRef.current;
    setAlert(null);
    setPhase({ kind: 'busy', name });
    let result: ImportPreviewResult;
    try {
      result = await request();
    } catch (err) {
      result = { ok: false, refused: false, error: err instanceof Error ? err.message : String(err) };
    }
    // A newer drop/pick (or Cancel) superseded this one, or the section is gone.
    if (!mountedRef.current || id !== reqIdRef.current) return;
    if (result.ok) {
      setIncludeStory(true);
      setIncludeNotes(true);
      setPhase({ kind: 'preview', preview: result.preview });
      return;
    }
    if ('cancelled' in result) {
      // Picker dismissed: put back whatever was on screen before.
      setPhase(before.kind === 'busy' || before.kind === 'committing' ? { kind: 'idle' } : before);
      return;
    }
    setPhase({ kind: 'idle' });
    setAlert(result.refused
      ? { kind: 'refused', message: result.reason }
      : { kind: 'error', message: result.error });
  }, []);

  const onPick = useCallback((mode: 'file' | 'folder') => {
    const bridge = getImportHub();
    if (!bridge) return;
    setMultiHint(false);
    void runPreview(null, () => bridge.pick(mode));
  }, [runPreview]);

  const isFileDrag = (e: DragEvent<HTMLDivElement>) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isFileDrag(e)) return;
    dragDepthRef.current += 1;
    setDragActive(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Always: without it Electron navigates the window to the dropped file.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = getImportHub() && phaseRef.current.kind !== 'committing' ? 'copy' : 'none';
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isFileDrag(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Always: without it Electron navigates the window to the dropped file.
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const bridge = getImportHub();
    if (!bridge || phaseRef.current.kind === 'committing') return;
    const files = e.dataTransfer?.files;
    const first = files && files.length > 0 ? files[0] : null;
    if (!first) return;
    setMultiHint(files.length > 1);
    void runPreview(first.name || null, () => bridge.previewDropped(first));
  }, [runPreview]);

  const onConfirm = useCallback(async () => {
    const current = phaseRef.current;
    const bridge = getImportHub();
    if (current.kind !== 'preview' || !bridge) return;
    const { preview } = current;
    const hasStory = preview.story !== null;
    const hasNotes = preview.notes.length + preview.entities.length > 0;
    const options: ImportCommitOptions = {
      story: hasStory && includeStory,
      notes: hasNotes && includeNotes,
    };
    const id = ++reqIdRef.current;
    setAlert(null);
    setPhase({ kind: 'committing', preview });
    let result: ImportCommitResult;
    try {
      result = await bridge.commit(preview.token, options);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!mountedRef.current || id !== reqIdRef.current) return;
    if (!result.ok) {
      // Keep the preview so the writer can retry.
      setPhase({ kind: 'preview', preview });
      setAlert({ kind: 'commit-error', message: result.error || 'The import did not finish.' });
      return;
    }
    setPhase({ kind: 'done', result });
    showLnToast(result.storyTitle ? `Imported “${result.storyTitle}”` : 'Import finished');
  }, [includeStory, includeNotes]);

  const reset = useCallback(() => {
    reqIdRef.current += 1;
    setAlert(null);
    setMultiHint(false);
    setPhase({ kind: 'idle' });
  }, []);

  const statusText = busy
    ? (phase.name ? `Reading ${phase.name}…` : 'Reading your selection…')
    : '';

  return (
    <section className="settings-section" aria-labelledby="section-import" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-import">Import your writing</h3>
      <p className="settings-hint">
        Bring in a book or notes from Word, Google Docs, Markdown, Scrivener, ePub, RTF or plain text.
        You&apos;ll see a preview before anything is saved.
      </p>

      <div
        className={`import-dropzone${dragActive ? ' import-dropzone--active' : ''}`}
        data-testid="import-dropzone"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <p className="import-dropzone__title">Drop a file or folder here</p>
        <p className="import-dropzone__formats">{FORMATS_TEXT}</p>
        <div className="import-dropzone__actions">
          <button
            type="button"
            className="m24-btn m24-btn--primary"
            data-testid="import-pick-file"
            disabled={!hub || busy || committing}
            onClick={() => onPick('file')}
          >
            Choose a file…
          </button>
          <button
            type="button"
            className="m24-btn"
            data-testid="import-pick-folder"
            disabled={!hub || busy || committing}
            onClick={() => onPick('folder')}
          >
            Choose a folder…
          </button>
        </div>
        <p className="import-dropzone__formats">Use a folder for Markdown folders and Scrivener projects.</p>
      </div>

      {!hub && (
        <p className="settings-hint" data-testid="import-unavailable">
          Import isn&apos;t available in this version of Mythos yet.
        </p>
      )}

      <p className="import-status" role="status" aria-live="polite" data-testid="import-status">{statusText}</p>

      {multiHint && (
        <p className="settings-hint" data-testid="import-multi-hint">One at a time — importing the first item.</p>
      )}

      {alert?.kind === 'refused' && (
        <p className="settings-error-msg" role="alert" data-testid="import-refused">
          {withStop(alert.message)} Mythos never opens programs, scripts or macro files.
        </p>
      )}
      {alert?.kind === 'error' && (
        <p className="settings-error-msg" role="alert" data-testid="import-error">{alert.message}</p>
      )}

      {(phase.kind === 'preview' || phase.kind === 'committing') && (
        <PreviewView
          preview={phase.preview}
          committing={committing}
          includeStory={includeStory}
          includeNotes={includeNotes}
          setIncludeStory={setIncludeStory}
          setIncludeNotes={setIncludeNotes}
          commitError={alert?.kind === 'commit-error' ? alert.message : null}
          onConfirm={() => { void onConfirm(); }}
          onCancel={reset}
          headingRef={previewHeadingRef}
        />
      )}

      {phase.kind === 'done' && (
        <div className="import-done" data-testid="import-done" role="status" aria-live="polite">
          <h4 className="import-done__heading" ref={doneHeadingRef} tabIndex={-1}>{successLine(phase.result)}</h4>
          {phase.result.planNotePath && (
            <p className="settings-hint" data-testid="import-plan-note">
              A Story Plan note was added to your Notes Vault ({phase.result.planNotePath}).
            </p>
          )}
          <WarningList warnings={phase.result.warnings} testId="import-done-warnings" />
          <div className="import-actions">
            <button type="button" className="m24-btn" data-testid="import-again" onClick={reset}>
              Import something else
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
