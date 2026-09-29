import type { Page } from '@playwright/test';

/**
 * F4#4: Markdown/Source gear entries are Settings-gated (default off).
 * Enable them via the localStorage bridge NoteViewer reads when the gear opens,
 * then dispatch mythos:notes:viewPrefsChanged so already-open viewers refresh
 * via the live SoT/pub-sub path.
 */
export async function enableNoteViewModes(
  page: Page,
  modes: Array<'markdown' | 'source'> = ['markdown', 'source'],
): Promise<void> {
  await page.evaluate((enabled) => {
    if (enabled.includes('markdown')) {
      window.localStorage.setItem('mythos:notes:showMarkdownView', '1');
    }
    if (enabled.includes('source')) {
      window.localStorage.setItem('mythos:notes:showSourceView', '1');
    }
    window.dispatchEvent(new Event('mythos:notes:viewPrefsChanged'));
  }, modes);
}
