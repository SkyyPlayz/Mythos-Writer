/**
 * Notes-tab panel scoping for B7 Story keep-alive.
 *
 * DesktopShell keeps `#app-tabpanel-story` mounted with `display:none` +
 * `aria-hidden=true` when Notes is active. That leaves a second NoteViewer in
 * the DOM, so unscoped `.note-viewer` / `note-title` / `note-cover` / etc.
 * locators resolve to 2 (or hit the hidden clone). Always route Notes editor
 * queries through `notesPanel(page)`.
 */
import type { Locator, Page } from '@playwright/test';

/** Visible Notes-tab center (only mounts inside active NotesTabPanel). */
export function notesPanel(page: Page): Locator {
  return page.locator('[data-testid="notes-tab-center"]');
}

/** `[data-testid=…]` inside the visible notes panel. */
export function noteTestId(page: Page, testId: string): Locator {
  return notesPanel(page).locator(`[data-testid="${testId}"]`);
}

/** `.note-viewer` inside the visible notes panel. */
export function noteViewer(page: Page): Locator {
  return notesPanel(page).locator('.note-viewer');
}
