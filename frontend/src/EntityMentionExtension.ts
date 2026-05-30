import { Node, mergeAttributes } from '@tiptap/core';

/**
 * TipTap inline atom node for @entity mentions.
 *
 * Serializes to [Label](entity://id) so the SCENE_SAVE handler (SKY-170)
 * can parse entity links from prose and upsert scene_entity_links rows.
 *
 * Deserializes by matching [*](entity://*) links via a markdown-it inline
 * rule inserted before the standard link parser.
 */
export const EntityMentionExtension = Node.create({
  name: 'entityMention',
  inline: true,
  group: 'inline',
  atom: true,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-entity-id') ?? '',
      },
      label: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-entity-label') ?? '',
      },
      entityType: {
        default: 'other',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-entity-type') ?? 'other',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-entity-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-entity-mention': '',
        'data-entity-id': node.attrs.id as string,
        'data-entity-label': node.attrs.label as string,
        'data-entity-type': node.attrs.entityType as string,
        class: `entity-mention entity-mention--${node.attrs.entityType as string}`,
      }),
      `@${node.attrs.label as string}`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const label = (node.attrs.label as string) ?? '';
          const id = (node.attrs.id as string) ?? '';
          state.write(`[${label}](entity://${id})`);
        },
        parse: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setup(md: any) {
            // Match [label](entity://id) before the standard link rule.
            md.inline.ruler.before(
              'link',
              'entity_mention',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (state: any, silent: boolean) => {
                const pos = state.pos;
                if (state.src.charCodeAt(pos) !== 0x5b) return false; // [

                const closeBracket = state.src.indexOf(']', pos + 1);
                if (closeBracket < 0) return false;

                const prefix = '(entity://';
                if (
                  state.src.slice(closeBracket + 1, closeBracket + 1 + prefix.length) !==
                  prefix
                ) {
                  return false;
                }

                const closeParens = state.src.indexOf(')', closeBracket + 1 + prefix.length);
                if (closeParens < 0) return false;

                if (!silent) {
                  const label = state.src.slice(pos + 1, closeBracket);
                  const id = state.src.slice(closeBracket + 1 + prefix.length, closeParens);
                  const token = state.push('entity_mention', '', 0);
                  token.attrSet('data-entity-mention', '');
                  token.attrSet('data-entity-id', id);
                  token.attrSet('data-entity-label', label);
                }

                state.pos = closeParens + 1;
                return true;
              },
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            md.renderer.rules['entity_mention'] = (tokens: any[], idx: number) => {
              const id = tokens[idx].attrGet('data-entity-id') ?? '';
              const label = tokens[idx].attrGet('data-entity-label') ?? '';
              const escId = String(id).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
              const escLabel = String(label)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/"/g, '&quot;');
              return `<span data-entity-mention="" data-entity-id="${escId}" data-entity-label="${escLabel}">@${escLabel}</span>`;
            };
          },
        },
      },
    };
  },
});
