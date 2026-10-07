/**
 * PLAN-058 L6: marks inline images with the vault-relative src for hydration.
 */
import { InlineImageExtension } from './InlineImageExtension';

export function createNoteVaultImageExtension() {
  return InlineImageExtension.extend({
    renderHTML({ HTMLAttributes }) {
      const src = HTMLAttributes.src ?? '';
      return ['img', {
        ...HTMLAttributes,
        class: 'rte-inline-image',
        'data-vault-src': src,
        loading: 'lazy',
        decoding: 'async',
      }];
    },
  });
}
