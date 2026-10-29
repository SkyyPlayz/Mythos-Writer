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

/**
 * Commit failures after which main has forgotten the preview (its token is
 * spent), so "Import" can only fail again with the expired message. Mirrors
 * electron-main/src/importHub/importHubIpc.ts commitImportToken (the test
 * checks the strings against that file). Every other failure — no vault yet,
 * a write error rolled back — keeps the preview alive for a retry.
 */
export const SPENT_PREVIEW_ERRORS: readonly string[] = [
  'This preview has expired — drop the file again.',
  'The file changed since the preview — drop it again.',
  'Mythos couldn\'t finish the import. Check your vault before importing again.',
];

/** Refusals about runnable content get the reassurance; size / damage refusals don't. */
const RUNNABLE_REFUSAL = /\b(?:programs?|scripts?|macros?)\b|run code/i;

// ─── Excerpt: editor Markdown → React elements ───────────────────────────────
// A tiny, safe subset renderer for the preview excerpt (never HTML injection):
// **bold** / __bold__, *italic* / _italic_, ~~strike~~, <u>underline</u>,
// `\`+newline hard breaks, backslash escapes, the entities the serializer
// writes, ` {.center}` alignment suffixes and `#` headings left in a scene.
//
// Emphasis follows CommonMark's delimiter rules the way markdown-it (the
// editor's parser, via tiptap-markdown) applies them — left/right-flanking
// runs with Unicode punctuation, `_` never splitting a word, the "rule of 3"
// and `~~` pairs — so a marker the editor would show as a literal `*` shows
// as one here too. The panel exists to catch exactly those mistakes.

type MarkName = 'bold' | 'italic' | 'strike' | 'underline';
type DelimChar = '*' | '_' | '~';

/** A delimiter run in the node list; `count` is how many of its chars are still unmatched (literal). */
interface DelimNode { k: 'delim'; ch: DelimChar; count: number }

type InlineNode =
  | { k: 'text'; v: string }
  | { k: 'br' }
  | { k: 'u'; closing: boolean; raw: string }
  | DelimNode
  | { k: 'mark'; mark: MarkName; children: InlineNode[] };

interface Delimiter {
  node: DelimNode;
  ch: DelimChar;
  /** Run length as written, for the rule of 3 (0 for `~~`, like markdown-it). */
  origLen: number;
  canOpen: boolean;
  canClose: boolean;
  active: boolean;
}

const ENTITY_MAP: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
// markdown-it's isWhiteSpace (Unicode Zs plus tab / newline / vt / ff / cr).
const MD_WHITESPACE = /^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$/;
// markdown-it's isPunctChar: Unicode P (punctuation) or S (symbols); covers ASCII punctuation.
const MD_PUNCT = /^[\p{P}\p{S}]$/u;

function decodeEntity(body: string): string | null {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
    return String.fromCodePoint(code);
  }
  return ENTITY_MAP[body.toLowerCase()] ?? null;
}

/** The (whole) character just before index `i`; start of the text counts as a space. */
function charBefore(src: string, i: number): string {
  if (i <= 0) return ' ';
  const lo = src.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = src.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return src.slice(i - 2, i);
  }
  return src[i - 1];
}

/** The (whole) character at index `i`; end of the text counts as a space. */
function charAt(src: string, i: number): string {
  if (i >= src.length) return ' ';
  return String.fromCodePoint(src.codePointAt(i) as number);
}

/** markdown-it's scanDelims: can a run of `len` delimiter chars at `i` open / close? */
function flanking(src: string, i: number, len: number, canSplitWord: boolean): { canOpen: boolean; canClose: boolean } {
  const last = charBefore(src, i);
  const next = charAt(src, i + len);
  const lastPunct = MD_PUNCT.test(last);
  const nextPunct = MD_PUNCT.test(next);
  const lastSpace = MD_WHITESPACE.test(last);
  const nextSpace = MD_WHITESPACE.test(next);
  const left = !nextSpace && (!nextPunct || lastSpace || lastPunct);
  const right = !lastSpace && (!lastPunct || nextSpace || nextPunct);
  return {
    canOpen: left && (canSplitWord || !right || lastPunct),
    canClose: right && (canSplitWord || !left || nextPunct),
  };
}

function tokenize(src: string): { nodes: InlineNode[]; delims: Delimiter[] } {
  const nodes: InlineNode[] = [];
  const delims: Delimiter[] = [];
  const text = (v: string) => {
    const last = nodes[nodes.length - 1];
    if (last && last.k === 'text') last.v += v;
    else nodes.push({ k: 'text', v });
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '\n') { nodes.push({ k: 'br' }); i += 2; continue; }
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
      if (m) { nodes.push({ k: 'u', closing: m[1] === '/', raw: m[0] }); i += m[0].length; continue; }
      text(ch); i += 1; continue;
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      let len = 1;
      while (src[i + len] === ch) len++;
      const { canOpen, canClose } = flanking(src, i, len, ch !== '_');
      let count = len;
      if (ch === '~') {
        // Strike needs `~~`; an odd run keeps one literal `~` in front.
        if (len < 2) { text(ch); i += len; continue; }
        if (len % 2) { text(ch); count -= 1; }
      }
      if (canOpen || canClose) {
        const node: DelimNode = { k: 'delim', ch, count };
        nodes.push(node);
        delims.push({ node, ch, origLen: ch === '~' ? 0 : len, canOpen, canClose, active: true });
      } else {
        text(ch.repeat(count));
      }
      i += len;
      continue;
    }
    text(ch);
    i += 1;
  }
  return { nodes, delims };
}

function markFor(ch: DelimChar, n: number): MarkName {
  if (ch === '~') return 'strike';
  return n === 2 ? 'bold' : 'italic';
}

/** Move the nodes strictly between `open` and `close` into a new mark node. */
function wrapBetween(nodes: InlineNode[], open: DelimNode, close: DelimNode | null, mark: MarkName): void {
  const from = nodes.indexOf(open) + 1;
  const to = close ? nodes.indexOf(close) : nodes.length;
  const children = nodes.slice(from, to);
  nodes.splice(from, to - from, { k: 'mark', mark, children });
}

/** CommonMark "process emphasis" over the delimiter list (all active delimiters stay top-level). */
function processEmphasis(nodes: InlineNode[], delims: Delimiter[]): void {
  for (let c = 0; c < delims.length; c++) {
    const closer = delims[c];
    if (!closer.active || !closer.canClose) continue;
    while (closer.node.count > 0) {
      let found = -1;
      for (let o = c - 1; o >= 0; o--) {
        const op = delims[o];
        if (!op.active || op.ch !== closer.ch || !op.canOpen || op.node.count === 0) continue;
        // Rule of 3: a run that can both open and close can't pair when the lengths sum to a multiple of 3.
        if ((op.canClose || closer.canOpen) && (op.origLen + closer.origLen) % 3 === 0
          && (op.origLen % 3 !== 0 || closer.origLen % 3 !== 0)) continue;
        found = o;
        break;
      }
      if (found < 0) break;
      const op = delims[found];
      const n = closer.ch === '~' ? 2 : (op.node.count >= 2 && closer.node.count >= 2 ? 2 : 1);
      op.node.count -= n;
      closer.node.count -= n;
      wrapBetween(nodes, op.node, closer.node, markFor(closer.ch, n));
      for (let d = found + 1; d < c; d++) delims[d].active = false;
    }
    if (closer.node.count === 0 || !closer.canOpen) closer.active = false;
  }
}

/** A cut-off excerpt: marks still open at the cut apply to the rest (the full scene closes them). */
function closeAtEnd(nodes: InlineNode[], delims: Delimiter[]): void {
  for (let d = delims.length - 1; d >= 0; d--) {
    const op = delims[d];
    if (!op.active || !op.canOpen) continue;
    while (op.node.count >= (op.ch === '~' ? 2 : 1)) {
      const n = op.ch === '~' || op.node.count >= 2 ? 2 : 1;
      op.node.count -= n;
      wrapBetween(nodes, op.node, null, markFor(op.ch, n));
    }
  }
}

function wrap(mark: MarkName, children: ReactNode[], key: number): ReactNode {
  switch (mark) {
    case 'bold': return <strong key={key}>{children}</strong>;
    case 'italic': return <em key={key}>{children}</em>;
    case 'strike': return <s key={key}>{children}</s>;
    case 'underline': return <u key={key}>{children}</u>;
  }
}

/**
 * Inline editor Markdown → React nodes. `cutOff` marks text that was
 * truncated mid-scene, so emphasis still open at the end applies to the rest.
 */
export function renderInlineMarkdown(src: string, { cutOff = false }: { cutOff?: boolean } = {}): ReactNode[] {
  const { nodes, delims } = tokenize(src);
  processEmphasis(nodes, delims);
  if (cutOff) closeAtEnd(nodes, delims);
  let key = 0;
  const render = (list: InlineNode[]): ReactNode[] => {
    // `<u>…</u>` are inline HTML in the editor; pair them within one level.
    const stack: ReactNode[][] = [[]];
    const top = () => stack[stack.length - 1];
    const closeU = () => {
      const children = stack.pop() as ReactNode[];
      top().push(wrap('underline', children, key++));
    };
    for (const n of list) {
      if (n.k === 'text') top().push(n.v);
      else if (n.k === 'br') top().push(<br key={key++} />);
      else if (n.k === 'delim') { if (n.count > 0) top().push(n.ch.repeat(n.count)); }
      else if (n.k === 'mark') top().push(wrap(n.mark, render(n.children), key++));
      else if (n.closing && stack.length > 1) closeU();
      else if (!n.closing) stack.push([]);
      else top().push(n.raw);
    }
    while (stack.length > 1) closeU();
    return stack[0];
  };
  return render(nodes);
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
  // Main cuts a long opening at a word boundary and appends "…".
  const cutOff = excerpt.trimEnd().endsWith('…');
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
          {renderInlineMarkdown(p.text, { cutOff: cutOff && i === paras.length - 1 })}
        </p>
      ))}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

/** `vaultAtPreview`: the open vault when the preview was built ('' when not known yet). */
type Phase =
  | { kind: 'idle' }
  | { kind: 'busy'; name: string | null }
  | { kind: 'preview'; preview: ImportPreview; vaultAtPreview: string }
  | { kind: 'committing'; preview: ImportPreview; vaultAtPreview: string }
  | { kind: 'done'; result: Extract<ImportCommitResult, { ok: true }>; entityTypes: ImportEntityType[] };

type Alert =
  | { kind: 'refused'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'commit-error'; message: string };

/** "3 characters", "2 characters & places", "1 place", or the app's own word, "entities". */
function entityPhrase(n: number, types: readonly ImportEntityType[]): string {
  const kinds = new Set(types);
  if (kinds.size === 1 && kinds.has('character')) return plural(n, 'character');
  if (kinds.size === 1 && kinds.has('location')) return plural(n, 'place');
  if (n > 1 && kinds.size === 2 && kinds.has('character') && kinds.has('location')) {
    return `${n.toLocaleString()} characters & places`;
  }
  return plural(n, 'entity', 'entities');
}

function successLine(r: Extract<ImportCommitResult, { ok: true }>, entityTypes: readonly ImportEntityType[]): string {
  const extras: string[] = [];
  if (r.noteCount > 0) extras.push(plural(r.noteCount, 'note'));
  if (r.entityCount > 0) extras.push(entityPhrase(r.entityCount, entityTypes));
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
  destinationName,
  vaultChanged,
  vaultSwitched,
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
  /** The open vault's name, when known — where Import will write. */
  destinationName?: string;
  /** A vault was opened since the preview (main re-checks it at commit). */
  vaultChanged: boolean;
  /** …and a different vault was already open when the preview was built. */
  vaultSwitched: boolean;
}) {
  const { story, notes, entities } = preview;
  const hasStory = story !== null;
  const hasNotes = notes.length + entities.length > 0;
  const sceneCount = story ? story.chapters.reduce((n, c) => n + c.scenes.length, 0) : 0;
  const nothingSelected = (!hasStory || !includeStory) && (!hasNotes || !includeNotes);
  // canCommit is main's snapshot from preview time. Once a vault has been
  // opened since, let the writer try: commit re-checks the vault and a
  // "no vault" failure keeps the preview for another go.
  const blocked = !preview.canCommit && !vaultChanged;

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
      {destinationName && !blocked && (
        <p className="settings-hint" data-testid="import-destination">
          {vaultSwitched
            ? `You switched vaults since this preview — it will go into “${destinationName}”.`
            : `It will go into “${destinationName}”.`}
        </p>
      )}

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

export interface ImportSectionProps {
  /** The open vault's root (MythosVaultsSection's live activeRoot); '' / undefined while unknown. */
  activeVaultRoot?: string;
  /** Its display name, shown as the import destination. */
  activeVaultName?: string;
}

export default function ImportSection({ activeVaultRoot, activeVaultName }: ImportSectionProps = {}) {
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
  const vaultRootRef = useRef(activeVaultRoot ?? '');
  vaultRootRef.current = activeVaultRoot ?? '';
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
      setPhase({ kind: 'preview', preview: result.preview, vaultAtPreview: vaultRootRef.current });
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

  // A file dropped anywhere outside the zone must not reach Chromium's default
  // drop either: that navigates the window to the file (a near miss on this
  // section, or on the rest of Settings, would replace the app with it). Only
  // file drags are touched, and only when no real drop target took them.
  useEffect(() => {
    const guard = (e: globalThis.DragEvent) => {
      if (e.defaultPrevented || !Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      e.preventDefault();
      if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
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
    const { preview, vaultAtPreview } = current;
    const hasStory = preview.story !== null;
    const hasNotes = preview.notes.length + preview.entities.length > 0;
    const options: ImportCommitOptions = {
      story: hasStory && includeStory,
      notes: hasNotes && includeNotes,
    };
    const id = ++reqIdRef.current;
    setAlert(null);
    setPhase({ kind: 'committing', preview, vaultAtPreview });
    let result: ImportCommitResult;
    try {
      result = await bridge.commit(preview.token, options);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!mountedRef.current || id !== reqIdRef.current) return;
    if (!result.ok) {
      const message = result.error || 'The import did not finish.';
      if (SPENT_PREVIEW_ERRORS.includes(message)) {
        // Main has forgotten this preview: a retry can't work, so start over.
        setPhase({ kind: 'idle' });
        setAlert({ kind: 'error', message });
        return;
      }
      // Nothing was written and main kept the preview: the writer can retry.
      setPhase({ kind: 'preview', preview, vaultAtPreview });
      setAlert({ kind: 'commit-error', message });
      return;
    }
    const entityTypes = options.notes ? preview.entities.map((e) => e.type) : [];
    setPhase({ kind: 'done', result, entityTypes });
    showLnToast(result.storyTitle ? `Imported “${result.storyTitle}”` : 'Import finished');
  }, [includeStory, includeNotes]);

  const reset = useCallback(() => {
    reqIdRef.current += 1;
    setAlert(null);
    setMultiHint(false);
    setPhase({ kind: 'idle' });
  }, []);

  // Outside the zone a drop does nothing (the zone is the only place that starts a preview).
  const onSectionDrag = useCallback((e: DragEvent<HTMLElement>) => {
    if (e.isDefaultPrevented()) return;
    e.preventDefault();
    if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  }, []);

  const shownVault = phase.kind === 'preview' || phase.kind === 'committing' ? phase.vaultAtPreview : '';
  const currentVault = activeVaultRoot ?? '';
  const vaultChanged = currentVault !== '' && currentVault !== shownVault;

  const statusText = busy
    ? (phase.name ? `Reading ${phase.name}…` : 'Reading your selection…')
    : '';

  return (
    <section
      className="settings-section"
      aria-labelledby="section-import"
      data-settings-cat="vaults"
      data-testid="import-section"
      onDragOver={onSectionDrag}
      onDrop={onSectionDrag}
    >
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
          {RUNNABLE_REFUSAL.test(alert.message)
            ? `${withStop(alert.message)} Mythos never opens programs, scripts or macro files.`
            : alert.message}
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
          destinationName={activeVaultName}
          vaultChanged={vaultChanged}
          vaultSwitched={vaultChanged && shownVault !== ''}
        />
      )}

      {phase.kind === 'done' && (
        <div className="import-done" data-testid="import-done" role="status" aria-live="polite">
          <h4 className="import-done__heading" ref={doneHeadingRef} tabIndex={-1}>{successLine(phase.result, phase.entityTypes)}</h4>
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
