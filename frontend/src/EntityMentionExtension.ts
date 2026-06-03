import { Node, mergeAttributes } from '@tiptap/core';

/**
 * TipTap inline node for @entity-mention tokens.
 *
 * Serialises to standard markdown link syntax: [Label](entity://ent_ID)
 * This avoids conflicts with the frontmatter parser (SKY-398/SKY-414) since
 * the mention lives in prose, not YAML. The entity:// protocol is unambiguous.
 *
 * In the editor the node renders as a styled chip: @Label
 * Clicking the chip dispatches a custom event that DesktopShell handles to
 * navigate to the entity detail page.
 */
export const EntityMention = Node.create({
  name: 'entityMention',
  inline: true,
  group: 'inline',
  atom: true,

  addAttributes() {
    return {
      entityId: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-entity-id') ?? '',
      },
      label: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-entity-label') ?? '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-entity-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'entity-mention-chip',
        'data-entity-id': node.attrs.entityId as string,
        'data-entity-label': node.attrs.label as string,
        title: `Go to ${node.attrs.label as string}`,
      }),
      `@${node.attrs.label as string}`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const id = node.attrs.entityId as string;
          const label = node.attrs.label as string;
          state.write(`[${label}](entity://${id})`);
        },
        parse: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setup(md: any) {
            // Inline rule: match [Label](entity://ent_ID)
            // Must run before the standard link rule so we intercept entity:// links.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            md.inline.ruler.before('link', 'entity_mention', (state: any, silent: boolean) => {
              const pos = state.pos;
              // Must start with '['
              if (state.src.charCodeAt(pos) !== 0x5b) return false;

              const closeAt = state.src.indexOf(']', pos + 1);
              if (closeAt < 0) return false;

              // Must be followed by '(entity://'
              if (state.src.charCodeAt(closeAt + 1) !== 0x28) return false; // (
              const urlStart = closeAt + 2;
              if (!state.src.startsWith('entity://', urlStart)) return false;

              const urlEnd = state.src.indexOf(')', urlStart);
              if (urlEnd < 0) return false;

              const label = state.src.slice(pos + 1, closeAt);
              const entityId = state.src.slice(urlStart + 'entity://'.length, urlEnd);

              // Reject empty or suspiciously long ids
              if (!entityId || entityId.length > 200) return false;

              if (!silent) {
                const token = state.push('entity_mention', '', 0);
                token.attrSet('data-entity-id', entityId);
                token.attrSet('data-entity-label', label);
              }

              state.pos = urlEnd + 1;
              return true;
            });

            // Renderer: emit HTML that TipTap's parseHTML can recognise.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            md.renderer.rules['entity_mention'] = (tokens: any[], idx: number) => {
              const id = (tokens[idx].attrGet('data-entity-id') ?? '') as string;
              const label = (tokens[idx].attrGet('data-entity-label') ?? '') as string;
              // Full HTML escape (all four special chars) so label text cannot
              // break out of attribute values or inject tags into the HTML stream.
              const esc = (s: string) =>
                s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
              return `<span data-entity-id="${esc(id)}" data-entity-label="${esc(label)}" class="entity-mention-chip">@${esc(label)}</span>`;
            };
          },
        },
      },
    };
  },
});

/** Returns true if the markdown string contains an entity mention for the given id. */
export function mentionPresentInMarkdown(markdown: string, entityId: string): boolean {
  return markdown.includes(`(entity://${entityId})`);
}
