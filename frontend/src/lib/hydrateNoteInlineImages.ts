import { resolveNoteImageVaultPath } from './noteInlineImages';

/** Paint vault-relative inline images inside a rich-editor root. */
export async function hydrateNoteInlineImages(root: HTMLElement, notePath: string): Promise<void> {
  const imgs = root.querySelectorAll<HTMLImageElement>('img.rte-inline-image[data-vault-src]');
  for (const img of imgs) {
    const raw = img.getAttribute('data-vault-src') ?? '';
    if (!raw) continue;
    const vaultSrc = resolveNoteImageVaultPath(notePath, raw);
    if (/^(https?:|data:|file:|blob:)/i.test(vaultSrc)) {
      img.src = vaultSrc;
      continue;
    }
    const reader = window.api?.notesThumbGet;
    if (typeof reader !== 'function') continue;
    try {
      const result = await reader(vaultSrc);
      if (result?.status === 'ready') {
        img.src = result.dataUrl;
        img.classList.remove('rte-inline-image--broken');
      } else {
        img.classList.add('rte-inline-image--broken');
        img.removeAttribute('src');
      }
    } catch {
      img.classList.add('rte-inline-image--broken');
      img.removeAttribute('src');
    }
  }
}
