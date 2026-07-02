import TiptapParagraph from '@tiptap/extension-paragraph';
import TiptapHeading from '@tiptap/extension-heading';

/**
 * Word-like text alignment (SKY-5705 / GH #642) for paragraphs and headings,
 * persisted through the Markdown vault store.
 *
 * CommonMark has no alignment syntax, so a non-default alignment is recorded
 * as a trailing inline marker — `{.center}` / `{.right}` / `{.justify}` — on
 * the block's own line. `left` (and the unset/default state) never emits a
 * marker, so documents with no alignment set round-trip byte-identical to
 * before this feature existed. On load, the marker is stripped from the text
 * and re-expressed as a `style="text-align: …"` attribute on the parsed
 * `<p>`/`<h1-6>` element, which Tiptap's TextAlign extension already reads
 * via its own `parseHTML`.
 */
const ALIGN_MARKER_RE = /[ \t]*\{\.(center|right|justify)\}[ \t]*$/;

interface CoreToken {
  type: string;
  attrSet: (name: string, value: string) => void;
}

interface InlineToken {
  type: string;
  content: string;
  children: Array<{ type: string; content: string }> | null;
}

interface CoreState {
  tokens: Array<CoreToken | InlineToken>;
}

/** Strip a trailing `{.align}` marker from paragraph/heading text and record it as a `style` attr. */
function stripAlignMarkers(state: CoreState): void {
  const { tokens } = state;
  for (let i = 0; i < tokens.length - 1; i++) {
    const open = tokens[i];
    if (open.type !== 'paragraph_open' && open.type !== 'heading_open') continue;

    const inline = tokens[i + 1] as InlineToken;
    if (inline.type !== 'inline' || !inline.children?.length) continue;

    const last = inline.children[inline.children.length - 1];
    if (last.type !== 'text') continue;

    const match = ALIGN_MARKER_RE.exec(last.content);
    if (!match) continue;

    last.content = last.content.slice(0, match.index);
    inline.content = inline.content.slice(0, inline.content.length - match[0].length);
    (open as CoreToken).attrSet('style', `text-align: ${match[1]}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setupAlignMarkerParsing(md: any): void {
  // Idempotent: once a marker is stripped it no longer matches, so re-running
  // this rule (tiptap-markdown re-registers `parse.setup` on every parse call)
  // is a harmless no-op on subsequent passes.
  md.core.ruler.push('align_marker', stripAlignMarkers);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeAlignedBlock(state: any, node: any, writeOpen?: () => void): void {
  writeOpen?.();
  state.renderInline(node);
  const align = node.attrs.textAlign as string | null | undefined;
  if (align && align !== 'left') {
    state.write(` {.${align}}`);
  }
  state.closeBlock(node);
}

export const AlignedParagraph = TiptapParagraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: unknown, node: unknown) {
          serializeAlignedBlock(state, node);
        },
        parse: { setup: setupAlignMarkerParsing },
      },
    };
  },
});

export const AlignedHeading = TiptapHeading.extend({
  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          serializeAlignedBlock(state, node, () => state.write(`${state.repeat('#', node.attrs.level)} `));
        },
        parse: { setup: setupAlignMarkerParsing },
      },
    };
  },
});
