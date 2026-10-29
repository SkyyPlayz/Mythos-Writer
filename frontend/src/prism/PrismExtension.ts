// Prism (#1764) — the manuscript decoration layer. Extracts the scene's prose
// into PrismParagraphs, runs the rule engine, and draws the results as
// underlines (flag checks) and soft text tints (voice checks). The plugin view
// publishes every scan's findings to prismLiveStore so the sidebar Analytics
// checklist can list them and jump to them.
//
// Prism only marks prose: no AI, no network, no edits to the document.
//
// Cost model: the per-keystroke path only maps the existing DecorationSet
// through the transaction; the full extract + scan runs once the writer pauses
// (PRISM_RESCAN_DEBOUNCE_MS), via a `{ rescan: true }` meta dispatched by the
// plugin view.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { headingFocusKey } from '../HeadingFocusExtension';
import { hiddenRanges } from '../lib/headingFocus';
import { runPrismRules } from './rules';
import { prismLiveStore, type PrismLiveFinding, type PrismLiveSnapshot } from './store';
import {
  PRISM_CHECKS,
  type PrismCheckId,
  type PrismCheckKind,
  type PrismParagraph,
  type PrismResult,
  type PrismSettings,
  type PrismThresholds,
} from './types';
import './prism.css';

export const PRISM_META = 'prismConfig';

export interface PrismEditorConfig {
  storyId: string | null;
  sceneId: string;
  settings: PrismSettings;
}

export type PrismMeta = PrismEditorConfig | { rescan: true };

export const PRISM_RESCAN_DEBOUNCE_MS = 250;

export interface PrismExtraction {
  paragraphs: PrismParagraph[];
  /** Maps (paragraph, offset) -> doc pos. */
  toDoc(paragraph: number, offset: number): number;
}

export interface PrismPluginState {
  /** Null until the host sends a PrismEditorConfig: the plugin is inert. */
  config: PrismEditorConfig | null;
  /** Extraction + result of the last full scan (positions are of that scan's doc). */
  extraction: PrismExtraction | null;
  result: PrismResult | null;
  decorations: DecorationSet;
  /** The doc changed since the last scan; a debounced rescan is due. */
  dirty: boolean;
  /** Bumped on every full scan, so the view knows when to publish. */
  scan: number;
}

export const prismPluginKey = new PluginKey<PrismPluginState>('prism');

const OBJECT_REPLACEMENT = '￼';
const SNIPPET_MAX = 80;

const CHECK_KIND = new Map<PrismCheckId, PrismCheckKind>(PRISM_CHECKS.map((c) => [c.id, c.kind]));

// ─── Pure helpers (exported for unit testing) ──────────────────────────────

/**
 * One PrismParagraph per textblock (headings included, code blocks skipped).
 * Each block's text is 1:1 with its doc positions: text nodes contribute their
 * characters, `code`-marked text becomes spaces of the same length, a hard
 * break becomes "\n" and any other inline node becomes U+FFFC (padded to its
 * nodeSize), so `toDoc(p, o)` is just the block's content start + o.
 */
export function extractPrismParagraphs(doc: PMNode): PrismExtraction {
  const paragraphs: PrismParagraph[] = [];
  const starts: number[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') return false;
    if (!node.isTextblock) return true;

    let text = '';
    const italic: Array<[number, number]> = [];
    node.forEach((child, offset) => {
      let chunk: string;
      if (child.isText) {
        const raw = child.text ?? '';
        chunk = child.marks.some((m) => m.type.name === 'code') ? ' '.repeat(raw.length) : raw;
      } else if (child.type.name === 'hardBreak') {
        chunk = '\n'.padEnd(child.nodeSize, OBJECT_REPLACEMENT);
      } else {
        chunk = OBJECT_REPLACEMENT.repeat(child.nodeSize);
      }
      // `offset` is the child's position inside the block; the chunk always
      // spans exactly child.nodeSize characters, so text index === offset.
      text += chunk;
      if (child.isText && child.marks.some((m) => m.type.name === 'italic')) {
        const end = offset + chunk.length;
        const last = italic[italic.length - 1];
        if (last && last[1] === offset) last[1] = end;
        else italic.push([offset, end]);
      }
    });

    paragraphs.push({ text, italic });
    starts.push(pos + 1);
    return false;
  });

  return {
    paragraphs,
    toDoc: (paragraph, offset) => starts[paragraph] + offset,
  };
}

function checkVisible(settings: PrismSettings, id: PrismCheckId): boolean {
  if (!settings.checks[id]) return false;
  return CHECK_KIND.get(id) === 'tint' ? settings.proseColors : settings.flags;
}

interface VisibleFlag {
  from: number;
  to: number;
  checkId: PrismCheckId;
  message: string;
}

/** `outer` covers `inner` and is strictly wider. */
const strictlyContains = (outer: VisibleFlag, inner: VisibleFlag): boolean =>
  outer.from <= inner.from && inner.to <= outer.to && outer.to - outer.from > inner.to - inner.from;

/**
 * Flag decorations, cut so the hover tooltip never depends on how
 * ProseMirror nests overlapping spans (that order flips when a wider flag
 * ends on the same character as a word flag inside it, e.g. a dialogue tag
 * ending on its adverb).
 *
 * Every flag is split at the boundaries of the other flags inside it, so
 * each piece covers one segment whose covering flags never change. Exactly
 * one piece per segment carries `title`: the message(s) of the innermost
 * flag(s) there, i.e. those that do not contain another flag covering the
 * segment (partial overlaps list both, narrowest first). The other pieces of
 * that segment carry no title, so `closest('[title]')` always finds it.
 */
function flagDecorations(flags: VisibleFlag[]): Decoration[] {
  if (!flags.length) return [];
  const bounds = Array.from(new Set(flags.flatMap((f) => [f.from, f.to]))).sort((a, b) => a - b);
  const indexOf = new Map(bounds.map((b, i) => [b, i]));
  // Segment start index -> flags covering that segment.
  const covering = new Map<number, VisibleFlag[]>();
  for (const f of flags) {
    for (let i = indexOf.get(f.from) ?? 0; bounds[i] < f.to; i++) {
      const list = covering.get(i);
      if (list) list.push(f);
      else covering.set(i, [f]);
    }
  }
  const decos: Decoration[] = [];
  for (const [i, cover] of covering) {
    const inner = cover
      .filter((f) => !cover.some((g) => g !== f && strictlyContains(f, g)))
      .sort((a, b) => a.to - a.from - (b.to - b.from));
    const carrier = inner[0];
    const title = inner.map((f) => f.message).join(' · ');
    // Narrowest first: ProseMirror wraps equal ranges in array order, so the
    // word flag usually renders innermost (only the title is load-bearing).
    cover.sort((a, b) => a.to - a.from - (b.to - b.from));
    for (const f of cover) {
      decos.push(
        Decoration.inline(bounds[i], bounds[i + 1], {
          nodeName: 'span',
          class: `prism-flag prism-flag--${f.checkId}`,
          'data-prism-flag': f.checkId,
          ...(f === carrier ? { title } : {}),
        })
      );
    }
  }
  return decos;
}

/**
 * Decorations for the findings the settings let through: a flag check is
 * drawn iff `flags && checks[id]`, a tint iff `proseColors && checks[id]`.
 *
 * Every decoration renders its own `<span>` (`nodeName`), so overlapping
 * findings NEST instead of being merged into one element: a word-level flag
 * inside a long sentence keeps its own class, underline and
 * `data-prism-flag`, and a flag inside dialogue keeps `data-prism-flag` next
 * to the dialogue span's `data-prism-tint`. Tooltips: see flagDecorations.
 */
export function buildPrismDecorations(
  doc: PMNode,
  extraction: PrismExtraction,
  result: PrismResult,
  settings: PrismSettings
): DecorationSet {
  if (!settings.flags && !settings.proseColors) return DecorationSet.empty;
  const max = doc.content.size;
  const decos: Decoration[] = [];
  const flags: VisibleFlag[] = [];
  for (const f of result.findings) {
    if (!checkVisible(settings, f.checkId)) continue;
    const from = Math.max(0, Math.min(max, extraction.toDoc(f.paragraph, f.from)));
    const to = Math.max(0, Math.min(max, extraction.toDoc(f.paragraph, f.to)));
    if (from >= to) continue;
    if (CHECK_KIND.get(f.checkId) === 'tint') {
      decos.push(
        Decoration.inline(from, to, {
          nodeName: 'span',
          class: `prism-tint prism-tint--${f.checkId}`,
          'data-prism-tint': f.checkId,
        })
      );
    } else {
      flags.push({ from, to, checkId: f.checkId, message: f.message });
    }
  }
  decos.push(...flagDecorations(flags));
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/** Read the current Prism plugin state from any ProseMirror EditorState. */
export function getPrismState(state: EditorState): PrismPluginState | undefined {
  return prismPluginKey.getState(state) ?? undefined;
}

// ─── Snapshot (published to prismLiveStore) ────────────────────────────────

/** Display text for inline atoms inside a snippet (wiki link alias/target, mention label). */
function leafText(node: PMNode): string {
  if (node.type.name === 'hardBreak') return ' ';
  const a = node.attrs as Record<string, unknown>;
  for (const key of ['alias', 'label', 'target', 'name']) {
    const v = a[key];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

const SENTENCE_END_RE = /[.!?…]+["'”’)\]]*\s+/g;

/** Sentence break offsets of a paragraph: each is the index where a new sentence starts. */
function sentenceStarts(text: string): number[] {
  const out: number[] = [];
  SENTENCE_END_RE.lastIndex = 0;
  for (let m = SENTENCE_END_RE.exec(text); m; m = SENTENCE_END_RE.exec(text)) {
    out.push(m.index + m[0].length);
  }
  return out;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ');

/** Per-paragraph snippet inputs, computed once per scan for paragraphs with findings. */
interface SnippetSource {
  breaks: number[];
  /**
   * The block's display text when it is 1:1 with the extracted text (no
   * inline atoms; code text shown as written): sliced directly, which keeps a
   * dense scene's thousands of snippets cheap. Null → read through the doc.
   */
  plain: string | null;
}

function snippetSource(doc: PMNode, extraction: PrismExtraction, paragraph: number): SnippetSource {
  const text = extraction.paragraphs[paragraph].text;
  let plain: string | null = null;
  if (!text.includes(OBJECT_REPLACEMENT)) {
    const shown = doc.textBetween(
      extraction.toDoc(paragraph, 0),
      extraction.toDoc(paragraph, text.length),
      ' ',
      leafText
    );
    if (shown.length === text.length) plain = shown;
  }
  return { breaks: sentenceStarts(text), plain };
}

/**
 * ≤ SNIPPET_MAX chars of the finding's sentence, keeping the finding itself
 * and trimming context evenly on both sides, with "…" where text was cut.
 */
function buildSnippet(
  doc: PMNode,
  extraction: PrismExtraction,
  source: SnippetSource,
  paragraph: number,
  from: number,
  to: number
): string {
  const text = extraction.paragraphs[paragraph].text;
  let sFrom = 0;
  let sTo = text.length;
  for (const b of source.breaks) {
    if (b <= from) sFrom = b;
    else if (b >= to) {
      sTo = b;
      break;
    }
  }
  const { plain } = source;
  const pos = (o: number) => extraction.toDoc(paragraph, o);
  const between = (a: number, b: number) => {
    if (a >= b) return '';
    return plain !== null ? plain.slice(a, b) : doc.textBetween(pos(a), pos(b), ' ', leafText);
  };
  let before = collapse(between(sFrom, from)).trimStart();
  let mid = collapse(between(from, to));
  let after = collapse(between(to, sTo)).trimEnd();
  if (!before && !after) mid = mid.trim();

  if (mid.length >= SNIPPET_MAX) return `${mid.slice(0, SNIPPET_MAX - 1).trimEnd()}…`;
  const room = SNIPPET_MAX - mid.length;
  if (before.length + after.length <= room) return before + mid + after;

  // Share the room evenly, giving any slack one side cannot use to the other.
  // Each cut side spends one character on its ellipsis.
  let beforeRoom = Math.floor(room / 2);
  let afterRoom = room - beforeRoom;
  if (before.length < beforeRoom) {
    afterRoom += beforeRoom - before.length;
    beforeRoom = before.length;
  } else if (after.length < afterRoom) {
    beforeRoom += afterRoom - after.length;
    afterRoom = after.length;
  }
  if (before.length > beforeRoom) {
    before =
      beforeRoom < 2
        ? '…'.repeat(beforeRoom)
        : `…${before.slice(before.length - (beforeRoom - 1)).trimStart()}`;
  }
  if (after.length > afterRoom) {
    after = afterRoom < 2 ? '…'.repeat(afterRoom) : `${after.slice(0, afterRoom - 1).trimEnd()}…`;
  }
  return before + mid + after;
}

function buildLiveFindings(
  doc: PMNode,
  extraction: PrismExtraction,
  result: PrismResult
): PrismLiveFinding[] {
  const sources = new Map<number, SnippetSource>();
  return result.findings.map((f) => {
    let source = sources.get(f.paragraph);
    if (!source) {
      source = snippetSource(doc, extraction, f.paragraph);
      sources.set(f.paragraph, source);
    }
    return {
      ...f,
      docFrom: extraction.toDoc(f.paragraph, f.from),
      docTo: extraction.toDoc(f.paragraph, f.to),
      snippet: buildSnippet(doc, extraction, source, f.paragraph, f.from, f.to),
    };
  });
}

function sameLiveFindings(a: readonly PrismLiveFinding[], b: readonly PrismLiveFinding[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.checkId !== y.checkId ||
      x.docFrom !== y.docFrom ||
      x.docTo !== y.docTo ||
      x.paragraph !== y.paragraph ||
      x.from !== y.from ||
      x.to !== y.to ||
      x.message !== y.message ||
      x.snippet !== y.snippet
    ) {
      return false;
    }
  }
  return true;
}

function sameSnapshot(a: PrismLiveSnapshot | null, b: PrismLiveSnapshot): boolean {
  return (
    !!a &&
    a.storyId === b.storyId &&
    a.sceneId === b.sceneId &&
    a.reveal === b.reveal &&
    a.stats.words === b.stats.words &&
    a.stats.sentences === b.stats.sentences &&
    a.stats.avgSentenceWords === b.stats.avgSentenceWords &&
    a.stats.readingEase === b.stats.readingEase &&
    sameLiveFindings(a.findings, b.findings)
  );
}

// ─── ProseMirror plugin ────────────────────────────────────────────────────

function sameThresholds(a: PrismThresholds, b: PrismThresholds): boolean {
  return (
    a.longSentenceWords === b.longSentenceWords &&
    a.overusedMinRepeats === b.overusedMinRepeats &&
    a.overusedWindowWords === b.overusedWindowWords
  );
}

function fullScan(doc: PMNode, config: PrismEditorConfig, prevScan: number): PrismPluginState {
  const extraction = extractPrismParagraphs(doc);
  const result = runPrismRules(extraction.paragraphs, config.settings.thresholds);
  return {
    config,
    extraction,
    result,
    decorations: buildPrismDecorations(doc, extraction, result, config.settings),
    dirty: false,
    scan: prevScan + 1,
  };
}

const INERT_STATE: PrismPluginState = {
  config: null,
  extraction: null,
  result: null,
  decorations: DecorationSet.empty,
  dirty: false,
  scan: 0,
};

/** Plugin view: debounced rescans + publishing to prismLiveStore. */
class PrismView {
  private timer: number | null = null;
  private destroyed = false;
  private publishedScan = -1;
  private published: PrismLiveSnapshot | null = null;

  constructor(private readonly view: EditorView) {
    view.dom.addEventListener('focus', this.onFocus);
    // Plugin views are rebuilt when the editor reconfigures; a state that
    // already carries a scan must be republished by the new view.
    this.publish();
  }

  /** Stable per editor, so the store can tell this editor's snapshot apart. */
  private readonly reveal = (from: number, to: number): void => {
    if (this.destroyed || this.view.isDestroyed) return;
    // Focus first: ProseMirror only writes the DOM selection into a focused
    // editor, and selection listeners (the Beta-Read bubble) read the DOM
    // selection while handling the dispatch below.
    this.view.focus();
    const { state } = this.view;
    const max = state.doc.content.size;
    const a = Math.max(0, Math.min(max, Math.min(from, to)));
    const b = Math.max(0, Math.min(max, Math.max(from, to)));
    const selection = TextSelection.between(state.doc.resolve(a), state.doc.resolve(b));
    const tr = state.tr.setSelection(selection);
    // Heading focus (GH #631) hides blocks outside the active section; a
    // finding there would be selected invisibly, so show the whole scene.
    const focus = headingFocusKey.getState(state);
    if (
      focus &&
      focus.level !== null &&
      hiddenRanges(state.doc, focus.level, focus.index).some((r) => a < r.to && b > r.from)
    ) {
      tr.setMeta(headingFocusKey, { level: null, index: 0 });
    }
    this.view.dispatch(tr.scrollIntoView());
  };

  /** The writer is using this editor: "Go to" should target it. */
  private readonly onFocus = (): void => {
    if (this.published) prismLiveStore.touch(this.published.sceneId, this.reveal);
  };

  update(view: EditorView, prevState: EditorState): void {
    const next = getPrismState(view.state);
    const prev = getPrismState(prevState);
    if (!next?.config) return;
    if (next.dirty) {
      if (view.state.doc !== prevState.doc) this.schedule();
    } else {
      this.cancel();
    }
    if (
      next.scan !== prev?.scan ||
      next.config.sceneId !== prev?.config?.sceneId ||
      next.config.storyId !== prev?.config?.storyId
    ) {
      this.publish();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.cancel();
    this.view.dom.removeEventListener('focus', this.onFocus);
    if (this.published) prismLiveStore.clear(this.published.sceneId, this.reveal);
    this.published = null;
  }

  private schedule(): void {
    this.cancel();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.destroyed || this.view.isDestroyed) return;
      const st = getPrismState(this.view.state);
      if (!st?.config || !st.dirty) return;
      const meta: PrismMeta = { rescan: true };
      this.view.dispatch(
        this.view.state.tr.setMeta(PRISM_META, meta).setMeta('addToHistory', false)
      );
    }, PRISM_RESCAN_DEBOUNCE_MS);
  }

  private cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private publish(): void {
    const st = getPrismState(this.view.state);
    if (!st?.config || !st.extraction || !st.result) return;
    const { storyId, sceneId } = st.config;
    // The scene this editor shows changed: drop the old scene's snapshot.
    if (this.published && this.published.sceneId !== sceneId) {
      prismLiveStore.clear(this.published.sceneId, this.reveal);
      this.published = null;
    }
    if (
      this.publishedScan === st.scan &&
      this.published?.storyId === storyId &&
      this.published.sceneId === sceneId
    ) {
      return;
    }
    this.publishedScan = st.scan;
    const snapshot: PrismLiveSnapshot = {
      storyId,
      sceneId,
      findings: buildLiveFindings(this.view.state.doc, st.extraction, st.result),
      stats: st.result.stats,
      reveal: this.reveal,
    };
    // Typing that does not move any finding (e.g. a rescan after an undo back
    // to the scanned text) must not wake every checklist subscriber.
    if (this.published && sameSnapshot(this.published, snapshot)) return;
    this.published = snapshot;
    prismLiveStore.publish(snapshot);
    // An editor that already has focus (autofocus ran before the first scan)
    // is the one the writer is using.
    if (this.view.hasFocus()) prismLiveStore.touch(sceneId, this.reveal);
  }
}

export const PrismExtension = Extension.create({
  name: 'prism',

  addProseMirrorPlugins() {
    return [
      new Plugin<PrismPluginState>({
        key: prismPluginKey,
        state: {
          init() {
            return INERT_STATE;
          },
          apply(tr, prev) {
            const meta = tr.getMeta(PRISM_META) as PrismMeta | undefined;

            if (meta && 'rescan' in meta) {
              if (!prev.config) return prev;
              return fullScan(tr.doc, prev.config, prev.scan);
            }

            if (meta) {
              // Settings-only change on an already-scanned, unchanged doc:
              // findings don't depend on display settings, so only redraw.
              if (
                tr.docChanged ||
                prev.dirty ||
                !prev.config ||
                !prev.extraction ||
                !prev.result ||
                !sameThresholds(prev.config.settings.thresholds, meta.settings.thresholds)
              ) {
                return fullScan(tr.doc, meta, prev.scan);
              }
              if (prev.config.settings === meta.settings) return { ...prev, config: meta };
              return {
                ...prev,
                config: meta,
                decorations: buildPrismDecorations(
                  tr.doc,
                  prev.extraction,
                  prev.result,
                  meta.settings
                ),
              };
            }

            if (!tr.docChanged || !prev.config) return prev;
            return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc), dirty: true };
          },
        },
        view: (view) => new PrismView(view),
        props: {
          decorations(state) {
            return prismPluginKey.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});
