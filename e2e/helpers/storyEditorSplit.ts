import type { Page } from '@playwright/test';

/** PLAN-058 L5: split toggle removed from toolbar — use the keyboard chord. */
export async function toggleStoryEditorSplit(page: Page): Promise<void> {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+Shift+2`);
}
