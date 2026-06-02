import { Node, mergeAttributes } from '@tiptap/core';

/**
 * TipTap inline node for @entity mentions.
 *
 * Serialises to markdown: [Label](entity://ent_ID)
 * That format is consumed on scene save by electron-main/src/main.ts
 * (parseMentionEntityIds) to populate scene_entity_links (SKY-170).
 *
 * XSS safety: same escaping strategy as WikiLinkExtension — & first,
 * then < > " for attribute and text contexts (SKY-234 class of bugs).
 */
export const EntityMentionExtension = Node.create({
  name: 'entityMention',
  inline: true,
  group: 'inline',
  atom: true,

  addAttributes() {
    return {
      id: { default: '' },
      label: { default: '' },
      entityType: {
        default: 'other',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-entity-type') ?? 'other',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-entity-id]',
        getAttrs: (el) => ({
          id: (el as HTMLElement).getAttribute('data-entity-id') ?? '',
          label: ((el as HTMLElement).textContent ?? '').replace(/^@/, ''),
          entityType: (el as HTMLElement).getAttribute('data-entity-type') ?? 'other',
        }),
      },
    ];
  },

  renderHTML({ node }) {
    const { id, label, entityType } = node.attrs as {
      id: string;
      label: string;
      entityType: string;
    };
    // Restrict type to known values so it can only produce a safe CSS class name.
    const VALID_TYPES = new Set([
      'character', 'location', 'faction', 'item', 'event', 'concept', 'other',
    ]);
    const safeType = VALID_TYPES.has(entityType) ? entityType : 'other';
    // Text content is passed as a DOMOutputSpec string — TipTap creates a
    // DOM text node (not innerHTML), so no manual escaping is needed here.
    return [
      'span',
      mergeAttributes({
        'data-entity-id': id,
        'data-entity-type': safeType,
        class: `entity-mention entity-mention--${safeType}`,
      }),
      `@${label}`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        // Called by tiptap-markdown's MarkdownSerializer.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const { id, label } = node.attrs as { id: string; label: string };
          // Only ] needs escaping inside a markdown link label.
          const safeLabel = label.replace(/\]/g, '\\]');
          state.write(`[${safeLabel}](entity://${id})`);
        },

        parse: {
          // Called once with the markdown-it instance.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setup(md: any) {
            // Inline rule: match [label](entity://ent_*) before the standard link rule
            // so the link rule does not consume these first.
            md.inline.ruler.before(
              'link',
              'entity_mention',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (state: any, silent: boolean): boolean => {
                const pos = state.pos;
                // Must start with [
                if (state.src.charCodeAt(pos) !== 0x5b) return false;

                // Find the first ] after the opening [
                const closeLabel = state.src.indexOf(']', pos + 1);
                if (closeLabel < 0) return false;

                // The ] must be immediately followed by (entity://
                if (!state.src.startsWith('](entity://', closeLabel)) return false;

                // Everything after entity:// up to the closing )
                const idStart = closeLabel + 11; // skip `](entity://`
                const closeAt = state.src.indexOf(')', idStart);
                if (closeAt < 0) return false;

                const id = state.src.slice(idStart, closeAt);
                if (!id.startsWith('ent_')) return false;

                if (!silent) {
                  const label = state.src.slice(pos + 1, closeLabel);
                  const token = state.push('entity_mention', '', 0);
                  token.attrSet('data-entity-id', id);
                  token.attrSet('data-entity-label', label);
                }

                state.pos = closeAt + 1;
                return true;
              },
            );

            // Render token → HTML so TipTap's parseHTML rule can pick it up.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            md.renderer.rules['entity_mention'] = (tokens: any[], idx: number) => {
              const id = tokens[idx].attrGet('data-entity-id') ?? '';
              const label = tokens[idx].attrGet('data-entity-label') ?? '';
              return `<span data-entity-id="${escHtmlAttr(id)}">@${escHtmlText(label)}</span>`;
            };
          },
        },
      },
    };
  },
});

function escHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
