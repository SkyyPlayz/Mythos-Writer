// #1765 — HTML → RichBlocks. One small tag tokenizer + tree walk for every
// HTML the import hub sees: mammoth's DOCX output (no newlines between
// blocks, `mythos-*` classes from docx.ts's style map), Google Docs "Download
// → Web page" exports (formatting lives in a class table inside <style>),
// ePub XHTML and plain web pages.
//
// Never regex-strips tags: marks come from the element tree (<strong>, <em>,
// <u>, <s>, Google class rules, inline style=), entities are decoded once at
// text level, whitespace collapses the way a browser would.
//
// Pure — no Electron, no fs.

import { isSceneBreakText, type RichBlock, type RichInline } from './blocks.js';

// ─── Entities ────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', prime: '′', Prime: '″',
  mdash: '—', ndash: '–', minus: '−', hellip: '…', bull: '•', middot: '·',
  hyphen: '‐', shy: '\u00ad', zwj: '\u200d', zwnj: '\u200c', thinsp: '\u2009',
  ensp: '\u2002', emsp: '\u2003', copy: '©', reg: '®', trade: '™', deg: '°',
  sect: '§', para: '¶', dagger: '†', Dagger: '‡', loz: '◊', times: '×',
  divide: '÷', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹',
  sup2: '²', sup3: '³', iexcl: '¡', iquest: '¿', cent: '¢', pound: '£',
  euro: '€', yen: '¥', curren: '¤', brvbar: '¦', uml: '¨', ordf: 'ª', ordm: 'º',
  not: '¬', macr: '¯', acute: '´', micro: 'µ', cedil: '¸', larr: '←', rarr: '→',
  uarr: '↑', darr: '↓', harr: '↔', hearts: '♥', spades: '♠', clubs: '♣', diams: '♦',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ',
  Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í',
  Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô',
  Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý', THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã',
  auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê',
  euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', eth: 'ð', ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù',
  uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ', yuml: 'ÿ', OElig: 'Œ',
  oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜',
};

function codePoint(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�';
  return String.fromCodePoint(n);
}

/** Decode named + numeric character references (unknown names stay literal). */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (m, dec?: string, hex?: string, name?: string) => {
    if (dec) return codePoint(Number(dec));
    if (hex) return codePoint(parseInt(hex, 16));
    return (name && (NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()])) || m;
  });
}

// ─── Tokenizer + tree ────────────────────────────────────────────────────────

interface ElementNode {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

interface TextNode {
  type: 'text';
  text: string;
}

type HtmlNode = ElementNode | TextNode;

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
/** Raw-text elements: content is never parsed as markup. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'title', 'textarea', 'xmp']);
/** Opening one of these closes an open <p> (the HTML "implied end tag" rule). */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);
/** Nesting deeper than this is flattened (hostile input must not blow the stack). */
const MAX_DEPTH = 256;

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Find the `>` that ends a tag starting at `from`, skipping quoted attribute values. */
function tagEnd(html: string, from: number): number {
  let quote = '';
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

function parseHtml(html: string): ElementNode {
  const root: ElementNode = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack: ElementNode[] = [root];
  // mammoth writes a Scene Break paragraph as `<hr class="…">* * *</hr>`. An
  // <hr> holds content only when its own `</hr>` comes before the next <hr>;
  // every other <hr> is void. Positions are found once, in one pass each.
  const hrOpens: number[] = [];
  const hrCloses: number[] = [];
  for (const m of html.matchAll(/<hr\b/gi)) hrOpens.push(m.index);
  for (const m of html.matchAll(/<\/hr\b/gi)) hrCloses.push(m.index);
  let nextHrOpen = 0;
  let nextHrClose = 0;
  const hrIsContainer = (at: number, contentFrom: number): boolean => {
    while (nextHrOpen < hrOpens.length && hrOpens[nextHrOpen] <= at) nextHrOpen++;
    while (nextHrClose < hrCloses.length && hrCloses[nextHrClose] < contentFrom) nextHrClose++;
    const close = hrCloses[nextHrClose];
    return close !== undefined && (nextHrOpen >= hrOpens.length || close < hrOpens[nextHrOpen]);
  };
  // Once a quoted attribute runs unclosed to the end of the input, every later
  // tag would rescan to the end too: from then on tags end at the next `>`.
  let quotesBroken = false;
  const top = () => stack[stack.length - 1];
  const appendText = (text: string) => {
    if (!text) return;
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last && last.type === 'text') last.text += text;
    else kids.push({ type: 'text', text });
  };
  const popTo = (tag: string): boolean => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === tag) {
        stack.length = i;
        return true;
      }
    }
    return false;
  };
  const openIs = (tag: string, stopAt: readonly string[] = []): boolean => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === tag) return true;
      if (stopAt.includes(stack[i].tag)) return false;
    }
    return false;
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      appendText(html.slice(i));
      break;
    }
    if (lt > i) appendText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9);
      const raw = html.slice(lt + 9, end === -1 ? html.length : end);
      // CDATA is literal text; escape `&` so the single decode pass leaves it as written.
      appendText(raw.replace(/&/g, '&amp;'));
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const next = html[lt + 1] ?? '';
    if (next === '!' || next === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (next === '/') {
      const m = /^<\/\s*([A-Za-z][\w:.-]*)/.exec(html.slice(lt, lt + 64));
      const end = html.indexOf('>', lt);
      if (m) popTo(m[1].toLowerCase().replace(/^[a-z]+:(?=[a-z])/, ''));
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const nameMatch = /^<([A-Za-z][\w:.-]*)/.exec(html.slice(lt, lt + 64));
    if (!nameMatch) {
      appendText('&lt;');
      i = lt + 1;
      continue;
    }
    // An unbalanced quote must not swallow the rest of the document.
    let end = quotesBroken ? -1 : tagEnd(html, lt + nameMatch[0].length);
    if (end === -1) {
      quotesBroken = true;
      end = html.indexOf('>', lt);
    }
    if (end === -1) {
      i = html.length;
      break;
    }
    // `<html:p>` (namespaced XHTML) reads as `<p>`.
    const tag = nameMatch[1].toLowerCase().replace(/^[a-z]+:(?=[a-z])/, '');
    let attrSrc = html.slice(lt + nameMatch[0].length, end);
    const selfClosing = /\/\s*$/.test(attrSrc);
    if (selfClosing) attrSrc = attrSrc.replace(/\/\s*$/, '');
    const el: ElementNode = { type: 'element', tag, attrs: parseAttrs(attrSrc), children: [] };
    i = end + 1;

    if (RAW_TEXT_TAGS.has(tag)) {
      if (selfClosing) {
        top().children.push(el);
        continue;
      }
      const close = new RegExp(`</${tag}\\s*>`, 'gi');
      close.lastIndex = i;
      const cm = close.exec(html);
      el.children.push({ type: 'text', text: html.slice(i, cm ? cm.index : html.length) });
      top().children.push(el);
      i = cm ? cm.index + cm[0].length : html.length;
      continue;
    }

    // Implied end tags. A <hr> inside a <p> is NOT one: mammoth puts page
    // breaks there and the walker splits the paragraph around it.
    if (CLOSES_P.has(tag) && openIs('p', ['table', 'td', 'th', 'li', 'div', 'blockquote'])) popTo('p');
    if (tag === 'li' && openIs('li', ['ul', 'ol'])) popTo('li');
    if ((tag === 'dt' || tag === 'dd') && (openIs('dt', ['dl']) || openIs('dd', ['dl']))) {
      if (!popTo('dt')) popTo('dd');
    }
    if (tag === 'tr' && openIs('tr', ['table'])) popTo('tr');
    if ((tag === 'td' || tag === 'th') && (openIs('td', ['tr', 'table']) || openIs('th', ['tr', 'table']))) {
      if (!popTo('td')) popTo('th');
    }
    if (/^h[1-6]$/.test(tag)) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (/^h[1-6]$/.test(stack[k].tag)) {
          stack.length = k;
          break;
        }
      }
    }

    top().children.push(el);
    const isVoid = tag === 'hr' ? selfClosing || !hrIsContainer(lt, i) : VOID_TAGS.has(tag);
    if (!selfClosing && !isVoid && stack.length < MAX_DEPTH) stack.push(el);
  }
  return root;
}

function findAll(node: HtmlNode, pred: (el: ElementNode) => boolean, out: ElementNode[] = []): ElementNode[] {
  if (node.type !== 'element') return out;
  if (pred(node)) out.push(node);
  for (const c of node.children) findAll(c, pred, out);
  return out;
}

function textOf(node: HtmlNode): string {
  if (node.type === 'text') return node.text;
  return node.children.map(textOf).join('');
}

// ─── CSS (Google Docs class table + inline style=) ───────────────────────────

interface StyleMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: 'center' | 'right' | 'justify' | 'left';
  hidden?: boolean;
  pageBreakBefore?: boolean;
}

function parseDeclarations(decl: string): StyleMarks {
  const out: StyleMarks = {};
  for (const part of decl.split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    let value = part.slice(idx + 1).trim().toLowerCase();
    if (value.endsWith('!important')) value = value.slice(0, -'!important'.length).trimEnd();
    switch (prop) {
      case 'font-weight': {
        const n = Number(value);
        if (value === 'bold' || value === 'bolder' || (Number.isFinite(n) && n >= 600)) out.bold = true;
        else if (value === 'normal' || value === 'lighter' || (Number.isFinite(n) && n < 600)) out.bold = false;
        break;
      }
      case 'font-style':
        if (value === 'italic' || value.startsWith('oblique')) out.italic = true;
        else if (value === 'normal') out.italic = false;
        break;
      case 'text-decoration':
      case 'text-decoration-line':
        // Decorations only ever add: CSS can't remove an ancestor's underline.
        if (value.includes('underline')) out.underline = true;
        if (value.includes('line-through')) out.strike = true;
        break;
      case 'text-align':
        if (value === 'center' || value === 'right' || value === 'justify') out.align = value;
        else if (value === 'left' || value === 'start') out.align = 'left';
        else if (value === 'end') out.align = 'right';
        break;
      case 'display':
        if (value === 'none') out.hidden = true;
        break;
      case 'page-break-before':
      case 'break-before':
        if (value === 'always' || value === 'page' || value === 'left' || value === 'right') out.pageBreakBefore = true;
        break;
    }
  }
  return out;
}

/** Remove CSS comments in one forward pass (an unclosed one runs to the end). */
function stripCssComments(css: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const open = css.indexOf('/*', i);
    if (open === -1) return out + css.slice(i);
    out += css.slice(i, open);
    const close = css.indexOf('*/', open + 2);
    if (close === -1) return out;
    i = close + 2;
  }
}

/**
 * `.c3{font-weight:700}` rules from <style> blocks → class → marks (later
 * rules win). One forward scan with indexOf — the CSS is untrusted, so no
 * backtracking regex ever runs over it. At-rules (`@import`, `@media {…}`)
 * are skipped; rules nested in `@media` are not read.
 */
function parseClassTable(css: string): Map<string, StyleMarks> {
  const table = new Map<string, StyleMarks>();
  const clean = stripCssComments(css);
  let i = 0;
  while (i < clean.length) {
    const open = clean.indexOf('{', i);
    if (open === -1) break;
    // The selector is whatever follows the last `}` or `;` before this `{`.
    let selStart = i;
    for (let k = open - 1; k >= i; k--) {
      if (clean[k] === ';') { selStart = k + 1; break; }
    }
    const selector = clean.slice(selStart, open);
    const close = clean.indexOf('}', open + 1);
    const nested = clean.indexOf('{', open + 1);
    if (close === -1) break;
    if (selector.trimStart().startsWith('@') && nested !== -1 && nested < close) {
      // `@media … {` — skip to the end of the block (one level of nesting).
      let depth = 1;
      let k = open + 1;
      while (k < clean.length && depth > 0) {
        const c = clean[k];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        k++;
      }
      i = k;
      continue;
    }
    i = close + 1;
    if (nested !== -1 && nested < close) continue; // malformed: `a { b { … }`
    const marks = parseDeclarations(clean.slice(open + 1, close));
    if (Object.keys(marks).length === 0) continue;
    for (const sel of selector.split(',')) {
      if (sel.length > 200) continue;
      const cls = /^\s*(?:[a-z0-9]*)\.([A-Za-z_][\w-]*)\s*$/.exec(sel);
      if (!cls) continue;
      table.set(cls[1], { ...table.get(cls[1]), ...marks });
    }
  }
  return table;
}

// ─── Detection ───────────────────────────────────────────────────────────────

/** True for Google Docs HTML (the "Web page" export or copied-from-Docs HTML). */
export function isGoogleDocsHtml(html: string): boolean {
  const head = html.slice(0, 200_000);
  return /class="[^"]*\bdoc-content\b/i.test(head)
    || /id="docs-internal-guid-/i.test(head)
    || hasGoogleMeta(head)
    || /\.lst-kix_[\w-]+/.test(head);
}

/** A `<meta>` naming Google Docs — each tag is sliced out by indexOf, never regex-scanned to its end. */
function hasGoogleMeta(html: string): boolean {
  const re = /<meta\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const end = html.indexOf('>', m.index);
    if (end === -1) return false;
    if (/google-docs|docs\.google\.com/i.test(html.slice(m.index, end))) return true;
    re.lastIndex = end + 1;
  }
  return false;
}

// ─── Walk ────────────────────────────────────────────────────────────────────

interface Ctx {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  pre: boolean;
}

type BlockKind =
  | { kind: 'paragraph'; align?: 'center' | 'right' | 'justify' }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; part: boolean }
  | { kind: 'title' };

interface BlockFrame {
  kind: BlockKind;
  /** Emit an 'empty' block when this element produced nothing (a real <p>). */
  countsAsParagraph: boolean;
  emitted: boolean;
}

const SKIP_TAGS = new Set([
  'head', 'script', 'style', 'title', 'noscript', 'template', 'nav', 'object', 'iframe', 'video', 'audio',
  'canvas', 'map', 'select', 'textarea', 'button', 'input', 'math', 'xmp',
]);
const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'section', 'article', 'aside', 'header',
  'footer', 'main', 'figure', 'figcaption', 'caption', 'dl', 'dt', 'dd', 'ul', 'ol', 'pre', 'address', 'body',
  'html', 'center', 'fieldset', 'legend', 'details', 'summary', 'table', 'tbody', 'thead', 'tfoot',
]);
const PARAGRAPH_TAGS = new Set(['p', 'li', 'dt', 'dd', 'figcaption', 'caption', 'pre', 'address', 'legend', 'summary']);

const NOTE_REF_HREF = /^#(?:ftnt\d|cmnt\d|footnote-\d|endnote-\d|comment-\d|ftnt_ref|cmnt_ref|footnote-ref-|endnote-ref-|comment-ref-)/i;

function classList(el: ElementNode): string[] {
  return (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
}

function epubType(el: ElementNode): string {
  return `${el.attrs['epub:type'] ?? ''} ${el.attrs.role ?? ''}`.toLowerCase();
}

/**
 * HTML → blocks. Handles mammoth output (and the `mythos-*` classes
 * docx.ts maps Word styles to), Google Docs exports (class table, title /
 * subtitle, page-break <hr>, footnote + comment trailers), ePub XHTML and
 * plain HTML. `title` is the document's <title>, when it has one.
 */
export function htmlToBlocks(html: string): { blocks: RichBlock[]; title?: string; warnings: string[] } {
  const root = parseHtml(html.replace(/^\ufeff/, ''));
  const warnings: string[] = [];

  const styleText = findAll(root, (el) => el.tag === 'style').map(textOf).join('\n');
  const classTable = parseClassTable(styleText);
  const titleEl = findAll(root, (el) => el.tag === 'title')[0];
  const docTitle = titleEl ? decodeEntities(textOf(titleEl)).replace(/\s+/g, ' ').trim() : '';

  // ── Trailers that must never reach the story ──
  const dropped = new Set<ElementNode>();
  let footnotes = 0;
  let comments = 0;
  const parentOf = new Map<ElementNode, ElementNode>();
  (function index(el: ElementNode) {
    for (const c of el.children) {
      if (c.type === 'element') {
        parentOf.set(c, el);
        index(c);
      }
    }
  })(root);
  const closest = (el: ElementNode, tags: readonly string[]): ElementNode | undefined => {
    for (let p = parentOf.get(el); p; p = parentOf.get(p)) if (tags.includes(p.tag)) return p;
    return undefined;
  };
  for (const el of findAll(root, () => true)) {
    const id = el.attrs.id ?? '';
    const type = epubType(el);
    if (el.tag === 'li' && /^(?:footnote|endnote)-/i.test(id)) {
      dropped.add(el);
      footnotes++;
    } else if (el.tag === 'li' && /^comment-/i.test(id)) {
      dropped.add(el);
      comments++;
    } else if (el.tag === 'a' && /^(ftnt|cmnt)\d+$/i.test(id) && /^#(ftnt|cmnt)_ref/i.test(el.attrs.href ?? '')) {
      // Google Docs trailer: <div><p><a href="#ftnt_ref1" id="ftnt1">[1]</a> text</p></div>.
      // Take the small wrapper div when there is one — never a div that wraps the story.
      const p = closest(el, ['p']);
      const div = closest(p ?? el, ['div']);
      const small = div && div.children.every((c) => c.type === 'text' ? !c.text.trim() : c.tag === 'p' || c.tag === 'span')
        && div.children.length <= 12;
      const box = small ? div : p;
      if (box && !dropped.has(box)) {
        dropped.add(box);
        if (/^ftnt/i.test(id)) footnotes++;
        else comments++;
      }
    } else if (/\b(?:footnote|endnote|rearnote|doc-footnote|doc-endnote)\b/.test(type) && el.tag !== 'a') {
      dropped.add(el);
      footnotes++;
    } else if (/\b(?:footnotes|endnotes|rearnotes|doc-endnotes)\b/.test(type)) {
      dropped.add(el);
    }
  }

  const blocks: RichBlock[] = [];
  let inlines: RichInline[] = [];
  const frames: BlockFrame[] = [{ kind: { kind: 'paragraph' }, countsAsParagraph: false, emitted: false }];
  let images = 0;

  const markEmitted = () => { for (const f of frames) f.emitted = true; };
  const flush = () => {
    const runs = normalizeInlines(inlines);
    inlines = [];
    if (runs.length === 0) return;
    const k = frames[frames.length - 1].kind;
    if (k.kind === 'heading') blocks.push({ kind: 'heading', level: k.level, inlines: runs, ...(k.part ? { part: true } : {}) });
    else if (k.kind === 'title') blocks.push({ kind: 'title', inlines: runs });
    else blocks.push({ kind: 'paragraph', inlines: runs, ...(k.align ? { align: k.align } : {}) });
    markEmitted();
  };
  const pushBreak = (kind: 'sceneBreak' | 'pageBreak') => {
    flush();
    blocks.push({ kind });
    markEmitted();
  };

  const elementMarks = (el: ElementNode): StyleMarks => {
    const marks: StyleMarks = {};
    for (const c of classList(el)) Object.assign(marks, classTable.get(c));
    if (el.attrs.style) Object.assign(marks, parseDeclarations(el.attrs.style));
    const alignAttr = (el.attrs.align ?? '').toLowerCase();
    if (marks.align === undefined && (alignAttr === 'center' || alignAttr === 'right' || alignAttr === 'justify')) {
      marks.align = alignAttr;
    }
    if (classList(el).includes('mythos-center')) marks.align = 'center';
    if (classList(el).includes('mythos-right')) marks.align = 'right';
    if (classList(el).includes('mythos-justify')) marks.align = 'justify';
    return marks;
  };

  const childCtx = (el: ElementNode, ctx: Ctx, sm: StyleMarks): Ctx => {
    const next: Ctx = { ...ctx };
    const guidWrapper = el.tag === 'b' && /^docs-internal-guid/i.test(el.attrs.id ?? '');
    if ((el.tag === 'strong' || el.tag === 'b') && !guidWrapper) next.bold = true;
    if (el.tag === 'em' || el.tag === 'i' || el.tag === 'cite' || el.tag === 'dfn' || el.tag === 'var') next.italic = true;
    if (el.tag === 'u' || el.tag === 'ins') next.underline = true;
    if (el.tag === 's' || el.tag === 'strike' || el.tag === 'del') next.strike = true;
    if (el.tag === 'pre') next.pre = true;
    if (sm.bold !== undefined) next.bold = guidWrapper ? ctx.bold : sm.bold;
    if (sm.italic !== undefined) next.italic = sm.italic;
    // Google Docs underlines every link through a class; that's link styling, not the writer's underline.
    if (sm.underline && !isLinkOnly(el)) next.underline = true;
    if (sm.strike) next.strike = true;
    return next;
  };

  const addText = (raw: string, ctx: Ctx) => {
    let text = decodeEntities(raw).replace(/[\u00ad\u200b\ufeff]/g, '');
    if (!ctx.pre) {
      text = text.replace(/[ \t\n\r\f\v]+/g, ' ');
      if (text) inlines.push(runOf(text, ctx));
      return;
    }
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, li) => {
      if (li > 0) inlines.push({ text: '', hardBreak: true });
      if (line) inlines.push(runOf(line.replace(/\t/g, ' '), ctx));
    });
  };

  /** Collect one table cell / flattened subtree as inline runs. */
  const collect = (node: HtmlNode, ctx: Ctx, out: RichInline[]) => {
    if (node.type === 'text') {
      const saved = inlines;
      inlines = out;
      addText(node.text, ctx);
      inlines = saved;
      return;
    }
    if (dropped.has(node) || SKIP_TAGS.has(node.tag)) return;
    if (node.tag === 'img' || node.tag === 'svg') { images++; return; }
    if (node.tag === 'br' || node.tag === 'hr' || BLOCK_TAGS.has(node.tag) || node.tag === 'tr' || node.tag === 'td' || node.tag === 'th') {
      out.push({ text: ' ' });
    }
    if (isNoteRef(node)) return;
    const sm = elementMarks(node);
    if (sm.hidden) return;
    const next = childCtx(node, ctx, sm);
    for (const c of node.children) collect(c, next, out);
  };

  const visit = (node: HtmlNode, ctx: Ctx) => {
    if (node.type === 'text') {
      addText(node.text, ctx);
      return;
    }
    const el = node;
    if (dropped.has(el) || SKIP_TAGS.has(el.tag)) return;
    const classes = classList(el);
    const sm = elementMarks(el);

    if (el.tag === 'hr') {
      const page = classes.includes('mythos-pagebreak') || sm.pageBreakBefore === true || classes.includes('page-break');
      pushBreak(page ? 'pageBreak' : 'sceneBreak');
      // `<hr>* * *</hr>` (mammoth's Scene Break) holds only the marker; any
      // real text inside an <hr>…</hr> is still the writer's and is kept.
      const inner = decodeEntities(textOf(el)).replace(/[\s\u00a0]+/g, ' ').trim();
      if (inner && !isSceneBreakText(inner)) for (const c of el.children) visit(c, ctx);
      return;
    }
    if (sm.hidden) return;
    if (el.tag === 'br') {
      inlines.push({ text: '', hardBreak: true });
      return;
    }
    if (el.tag === 'img' || el.tag === 'svg') {
      images++;
      return;
    }
    if (isNoteRef(el) || /\b(?:pagebreak|doc-pagebreak)\b/.test(epubType(el))) return;
    if (sm.pageBreakBefore && BLOCK_TAGS.has(el.tag)) pushBreak('pageBreak');

    if (el.tag === 'tr') {
      flush();
      const cells = el.children.filter((c): c is ElementNode => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'));
      const row: RichInline[] = [];
      const rowCtx = childCtx(el, ctx, sm);
      for (const cell of cells) {
        const cellRuns = normalizeInlines((() => {
          const out: RichInline[] = [];
          const cellCtx = childCtx(cell, rowCtx, elementMarks(cell));
          for (const c of cell.children) collect(c, cellCtx, out);
          return out;
        })());
        if (cellRuns.length === 0) continue;
        if (row.length) row.push({ text: ' | ' });
        for (const r of cellRuns) row.push(r);
      }
      if (row.length) {
        frames.push({ kind: { kind: 'paragraph' }, countsAsParagraph: false, emitted: false });
        inlines = row;
        flush();
        frames.pop();
      }
      return;
    }

    const next = childCtx(el, ctx, sm);
    if (!BLOCK_TAGS.has(el.tag)) {
      for (const c of el.children) visit(c, next);
      return;
    }

    flush();
    const parent = frames[frames.length - 1];
    let kind: BlockKind = parent.kind;
    const heading = /^h([1-6])$/.exec(el.tag);
    if (classes.includes('mythos-title') || (el.tag === 'p' && classes.includes('title'))) {
      kind = { kind: 'title' };
    } else if (heading) {
      kind = { kind: 'heading', level: Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6, part: classes.includes('mythos-part') };
    } else if (PARAGRAPH_TAGS.has(el.tag) || el.tag === 'div' || el.tag === 'blockquote' || el.tag === 'center') {
      const inherited = parent.kind.kind === 'paragraph' ? parent.kind.align : undefined;
      const own = el.tag === 'center' ? 'center' : sm.align;
      const align = own === undefined ? inherited : own === 'left' ? undefined : own;
      if (parent.kind.kind === 'paragraph' || PARAGRAPH_TAGS.has(el.tag)) kind = { kind: 'paragraph', ...(align ? { align } : {}) };
    }
    const frame: BlockFrame = { kind, countsAsParagraph: PARAGRAPH_TAGS.has(el.tag) || heading !== null, emitted: false };
    frames.push(frame);
    for (const c of el.children) visit(c, next);
    flush();
    frames.pop();
    if (frame.countsAsParagraph && !frame.emitted && kind.kind !== 'title') {
      blocks.push({ kind: 'empty' });
      markEmitted();
    }
  };

  const base: Ctx = { bold: false, italic: false, underline: false, strike: false, pre: false };
  for (const c of root.children) visit(c, base);
  flush();

  if (images > 0) warnings.push(images === 1 ? '1 image was not imported.' : `${images} images were not imported.`);
  if (footnotes > 0) {
    warnings.push(footnotes === 1
      ? '1 footnote was left out of the story — Mythos doesn’t import footnotes yet.'
      : `${footnotes} footnotes were left out of the story — Mythos doesn’t import footnotes yet.`);
  }
  if (comments > 0) warnings.push(comments === 1 ? '1 comment was left out.' : `${comments} comments were left out.`);

  return { blocks: dropBodyWideAlignment(blocks), ...(docTitle ? { title: docTitle } : {}), warnings };
}

/** An <a>, or an element whose only content is one <a>. */
function isLinkOnly(el: ElementNode): boolean {
  if (el.tag === 'a') return true;
  const kids = el.children.filter((c) => c.type === 'element' || c.text.trim() !== '');
  return kids.length === 1 && kids[0].type === 'element' && kids[0].tag === 'a';
}

function isNoteRef(el: ElementNode): boolean {
  if (el.tag === 'a') {
    if (NOTE_REF_HREF.test(el.attrs.href ?? '')) return true;
    if (/\bnoteref\b|\bdoc-noteref\b|\bbacklink\b|\bdoc-backlink\b/.test(epubType(el))) return true;
  }
  if (el.tag === 'sup') {
    const links = findAll(el, (x) => x.tag === 'a');
    if (links.length > 0 && links.every(isNoteRef) && textOf(el).replace(/\s+/g, '') === links.map(textOf).join('').replace(/\s+/g, '')) {
      return true;
    }
  }
  return false;
}

function runOf(text: string, ctx: Ctx): RichInline {
  const r: RichInline = { text };
  if (ctx.bold) r.bold = true;
  if (ctx.italic) r.italic = true;
  if (ctx.underline) r.underline = true;
  if (ctx.strike) r.strike = true;
  return r;
}

/**
 * Browser-style whitespace: NBSP becomes a plain space, runs of spaces
 * collapse across run boundaries, the paragraph (and each hard-broken line) is
 * trimmed — so leading tabs / NBSP indents disappear. Empty runs go.
 */
function normalizeInlines(runs: RichInline[]): RichInline[] {
  const out: RichInline[] = [];
  let lineStart = true;
  for (const r of runs) {
    if (r.hardBreak) {
      const last = out[out.length - 1];
      if (last && !last.hardBreak) last.text = last.text.replace(/ +$/, '');
      out.push({ text: '', hardBreak: true });
      lineStart = true;
      continue;
    }
    let text = r.text.replace(/[\u00a0\u2007]/g, ' ').replace(/ {2,}/g, ' ');
    const prev = out[out.length - 1];
    if (lineStart || (prev && !prev.hardBreak && prev.text.endsWith(' '))) text = text.replace(/^ +/, '');
    if (!text) continue;
    out.push({ ...r, text });
    lineStart = false;
  }
  // Drop hard breaks and spaces at the end, hard breaks at the start.
  for (;;) {
    const last = out[out.length - 1];
    if (!last) break;
    if (!last.hardBreak) last.text = last.text.replace(/ +$/, '');
    if (last.hardBreak || !last.text) out.pop();
    else break;
  }
  while (out.length && out[0].hardBreak) out.shift();
  return out;
}

/**
 * A manuscript justified (or, in a right-to-left book, right-aligned) from top
 * to bottom is a page-layout choice, not per-paragraph emphasis: when most body
 * paragraphs share that alignment, drop it — otherwise every paragraph would
 * carry a ` {.justify}` marker. Centering is always kept.
 */
export function dropBodyWideAlignment(blocks: RichBlock[]): RichBlock[] {
  const paras = blocks.filter((b): b is RichBlock & { kind: 'paragraph' } => b.kind === 'paragraph');
  const bodyWide = new Set<string>();
  for (const align of ['justify', 'right'] as const) {
    const n = paras.filter((b) => b.align === align).length;
    if (n > 0 && n * 2 >= paras.length) bodyWide.add(align);
  }
  if (bodyWide.size === 0) return blocks;
  return blocks.map((b) => {
    if (b.kind !== 'paragraph' || !b.align || !bodyWide.has(b.align)) return b;
    return { kind: 'paragraph', inlines: b.inlines };
  });
}
