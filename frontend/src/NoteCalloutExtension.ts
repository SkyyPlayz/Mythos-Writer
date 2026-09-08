// M17 (Beta 4 "Refine", FULL-SPEC §6): purple callout cards in the Notes rich
// editor — prototype note blocks `{ k: 'callout', title, text }` (HTML ~1545).
//
// Markdown form (Obsidian callout, SUPPORTED shape only — see notesFidelityGuard):
//
//   > [!Legend]-
//   > Sailors speak of a hum that rises from the depths…
//   > and of the drowned bell that answers it.
//
// CF-11 (Obsidian round-trip stays lossless): only the shape the serializer
// can re-emit byte-identically is parsed into a card. Every other `> [!…]`
// layout is left to the blockquote rule AND keeps its lossy flag in
// notesFidelityGuard, so the Rich fidelity guard still warns before opening.
// The two sides share `supportedCalloutLineCount` so they cannot drift.
//
// Notes-only: mounted via NoteViewer's extraExtensions — the Story editor
// never sees this node, so story serialization is untouched (M6 auto-linker
// and story wiki-link behavior unaffected).
import { Node, mergeAttributes } from '@tiptap/core';
import {
  CALLOUT_TITLE_LINE_RE,
  CALLOUT_BODY_LINE_RE,
  supportedCalloutLineCount,
} from './notesFidelityGuard';

// Prototype callout icon (file/scroll glyph, slot-B purple).
const CALLOUT_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--n2, #9b5fff)" stroke-width="1.7" stroke-linecap="round">' +
  '<path d="M7 3h7l4 4v14H7z"></path><path d="M14 3v4h4"></path><path d="M10 13h5M10 16.5h3"></path></svg>';

/** Sanitize an edited title so it stays serializable inside `[!…]`. */
export function sanitizeCalloutTitle(raw: string): string {
  return raw.replace(/[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

interface MarkdownItTokenLike {
  attrSet: (name: string, value: string) => void;
  map: [number, number] | null;
  content: string;
  children: unknown[] | null;
}

interface MarkdownItBlockStateLike {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  line: number;
  lineMax: number;
  parentType: string;
  push: (type: string, tag: string, nesting: number) => MarkdownItTokenLike;
}

function rawLine(state: MarkdownItBlockStateLike, line: number): string {
  return state.src.slice(state.bMarks[line], state.eMarks[line]);
}

/**
 * markdown-it block rule: convert the supported callout shape into a
 * `<div data-note-callout>` token pair TipTap parses into a noteCallout node.
 * Runs before `blockquote`; unsupported shapes fall through untouched.
 */
function noteCalloutBlockRule(
  state: MarkdownItBlockStateLike,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  // Top level only — nested/indented quotes keep today's blockquote behavior.
  if (state.parentType !== 'root') return false;
  if (state.tShift[startLine] > 0) return false;

  // A callout ends at the first blank line, so it's enough to read forward
  // one line past it (or to EOF) — never the whole remaining document, which
  // would make this rule (it runs at nearly every block-start line) O(n^2)
  // over a plain-prose note.
  const lines: (string | undefined)[] = [rawLine(state, startLine)];
  for (let i = startLine + 1; i < endLine; i++) {
    const line = rawLine(state, i);
    lines.push(line);
    if (line.trim() === '') break;
  }
  const span = supportedCalloutLineCount(lines, 0);
  if (span === 0) return false;
  if (silent) return true;

  const match = CALLOUT_TITLE_LINE_RE.exec(lines[0] as string)!;
  const title = match[1];
  const fold = match[2];
  const open = state.push('note_callout_open', 'div', 1);
  open.attrSet('data-note-callout', '');
  open.attrSet('data-callout-title', title);
  if (fold) open.attrSet('data-callout-fold', fold);
  open.map = [startLine, startLine + span];

  for (let i = 1; i < span; i++) {
    const body = CALLOUT_BODY_LINE_RE.exec(lines[i] as string)![1];
    state.push('paragraph_open', 'p', 1);
    const inline = state.push('inline', '', 0);
    inline.content = body;
    inline.map = [startLine + i, startLine + i + 1];
    inline.children = [];
    state.push('paragraph_close', 'p', -1);
  }

  state.push('note_callout_close', 'div', -1);
  state.line = startLine + span;
  return true;
}

export const NoteCallout = Node.create({
  name: 'noteCallout',
  group: 'block',
  // Each source body line is its own paragraph child, so N raw `> ` lines
  // round-trip as N paragraphs — not the usual blank-line-delimited grouping.
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return {
      title: {
        default: 'Note',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-callout-title') || 'Note',
      },
      // Obsidian's collapsed (`-`) / expandable (`+`) fold marker. `null` =
      // no marker in the source (not foldable). Handled by hand (not the
      // per-attribute renderHTML) so it's omitted from the DOM entirely when
      // absent instead of round-tripping as an empty attribute.
      fold: {
        default: null,
        parseHTML: (el) => {
          const raw = (el as HTMLElement).getAttribute('data-callout-fold');
          return raw === '-' || raw === '+' ? raw : null;
        },
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-note-callout]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const fold = node.attrs.fold as string | null;
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-note-callout': '',
        'data-callout-title': node.attrs.title as string,
        ...(fold ? { 'data-callout-fold': fold } : {}),
        class: 'note-callout',
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'note-callout';
      dom.setAttribute('data-note-callout', '');
      dom.setAttribute('data-callout-title', node.attrs.title as string);
      // Fold state round-trips losslessly but isn't interactively
      // collapsible from the card yet — no UI to toggle it.
      if (node.attrs.fold) dom.setAttribute('data-callout-fold', node.attrs.fold as string);
      dom.setAttribute('data-testid', 'note-callout');

      const icon = document.createElement('div');
      icon.className = 'note-callout-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = CALLOUT_ICON_SVG; // static markup, no user content

      const main = document.createElement('div');
      main.className = 'note-callout-main';

      const titleEl = document.createElement('div');
      titleEl.className = 'note-callout-title';
      titleEl.setAttribute('data-testid', 'note-callout-title');
      titleEl.setAttribute('role', 'textbox');
      titleEl.setAttribute('aria-label', 'Callout title');
      titleEl.setAttribute('contenteditable', editor.isEditable ? 'true' : 'false');
      titleEl.spellcheck = false;
      titleEl.textContent = node.attrs.title as string;

      let currentTitle = node.attrs.title as string;

      const commitTitle = () => {
        const next = sanitizeCalloutTitle(titleEl.textContent ?? '');
        if (!next || next === currentTitle) {
          titleEl.textContent = currentTitle; // revert empty/unchanged edits
          return;
        }
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number') return;
        const live = editor.state.doc.nodeAt(pos);
        if (!live || live.type.name !== 'noteCallout') return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, { ...live.attrs, title: next }),
        );
      };

      titleEl.addEventListener('blur', commitTitle);
      titleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          titleEl.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          titleEl.textContent = currentTitle;
          titleEl.blur();
        }
      });

      const contentDOM = document.createElement('div');
      contentDOM.className = 'note-callout-body';

      main.append(titleEl, contentDOM);
      dom.append(icon, main);

      return {
        dom,
        contentDOM,
        // The title element is managed by hand — keep ProseMirror out of it.
        stopEvent: (event: Event) => titleEl.contains(event.target as globalThis.Node | null),
        ignoreMutation: (mutation) => {
          const target = (mutation as MutationRecord).target as globalThis.Node | null;
          return target != null && (target === titleEl || titleEl.contains(target));
        },
        update: (updated) => {
          if (updated.type.name !== 'noteCallout') return false;
          const nextTitle = updated.attrs.title as string;
          if (nextTitle !== currentTitle) {
            currentTitle = nextTitle;
            dom.setAttribute('data-callout-title', nextTitle);
            if (document.activeElement !== titleEl) titleEl.textContent = nextTitle;
          }
          return true;
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const fold = node.attrs.fold as string | null;
          state.write(`> [!${node.attrs.title as string}]${fold ?? ''}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          node.forEach((para: any) => {
            if (para.content.size === 0) return; // title-only callout's auto-filled empty paragraph
            state.ensureNewLine();
            state.write('> ');
            state.renderInline(para);
          });
          state.closeBlock(node);
        },
        parse: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setup(md: any) {
            md.block.ruler.before('blockquote', 'note_callout', noteCalloutBlockRule);
          },
        },
      },
    };
  },
});
