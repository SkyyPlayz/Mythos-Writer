import { Node, mergeAttributes } from '@tiptap/core';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * TipTap inline node for [[wiki-link]] and [[wiki-link|Alias]] tokens.
 *
 * tiptap-markdown v0.9 escapes square brackets, so without this extension
 * [[Elara]] serialises as \[\[Elara\]\].  By storing wiki-links as an atom
 * node we bypass the text serialiser entirely and emit them verbatim.
 *
 * `target` is the resolution key (used for click navigation / backlinks);
 * `alias`, when present, is the display text — mirrors the Obsidian
 * `[[Target|Alias]]` convention (SKY-5702 / GH#650 WL-1).
 *
 * The `addStorage().markdown` shape is read by tiptap-markdown's
 * getMarkdownSpec() to wire up both the markdown-it inline parser rule and
 * the ProseMirror serialiser.
 */
export const WikiLink = Node.create({
  name: 'wikiLink',
  inline: true,
  group: 'inline',
  atom: true,

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-wiki-link') ?? '',
      },
      alias: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-wiki-link-alias') || null,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wiki-link]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const target = node.attrs.target as string;
    const alias = node.attrs.alias as string | null;
    const attrs: Record<string, string> = { 'data-wiki-link': target };
    if (alias) attrs['data-wiki-link-alias'] = alias;
    return [
      'span',
      mergeAttributes(HTMLAttributes, attrs),
      `[[${alias || target}]]`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        // Called by tiptap-markdown's MarkdownSerializer to emit the node.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const target = node.attrs.target as string;
          const alias = node.attrs.alias as string | null;
          state.write(alias ? `[[${target}|${alias}]]` : `[[${target}]]`);
        },
        parse: {
          // Called once by MarkdownParser with the markdown-it instance.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setup(md: any) {
            // Inline rule: match [[target]] or [[target|alias]] and emit a custom token.
            md.inline.ruler.before(
              'link',
              'wiki_link',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (state: any, silent: boolean) => {
                const pos = state.pos;
                if (pos + 1 >= state.posMax) return false;
                if (state.src.charCodeAt(pos) !== 0x5b) return false; // [
                if (state.src.charCodeAt(pos + 1) !== 0x5b) return false; // [

                const closeAt = state.src.indexOf(']]', pos + 2);
                if (closeAt < 0) return false;

                if (!silent) {
                  const inner = state.src.slice(pos + 2, closeAt);
                  const pipeAt = inner.indexOf('|');
                  const target = pipeAt < 0 ? inner : inner.slice(0, pipeAt);
                  const alias = pipeAt < 0 ? '' : inner.slice(pipeAt + 1);
                  const token = state.push('wiki_link', '', 0);
                  token.attrSet('data-wiki-link', target);
                  if (alias) token.attrSet('data-wiki-link-alias', alias);
                }

                state.pos = closeAt + 2;
                return true;
              },
            );

            // Render the custom token to an HTML element that TipTap can parse.
            // All four characters that are meaningful in HTML must be escaped:
            // & first (to avoid double-escaping), then < > " for attribute and
            // text contexts.  Without < / > escaping, [[<script>...]] would
            // inject a live element into the editor DOM (XSS -- SKY-234).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            md.renderer.rules['wiki_link'] = (tokens: any[], idx: number) => {
              const target = tokens[idx].attrGet('data-wiki-link') ?? '';
              const alias = tokens[idx].attrGet('data-wiki-link-alias') ?? '';
              const escapedTarget = escapeHtml(target);
              const aliasAttr = alias ? ` data-wiki-link-alias="${escapeHtml(alias)}"` : '';
              const display = escapeHtml(alias || target);
              return `<span data-wiki-link="${escapedTarget}"${aliasAttr}>[[${display}]]</span>`;
            };
          },
        },
      },
    };
  },
});
