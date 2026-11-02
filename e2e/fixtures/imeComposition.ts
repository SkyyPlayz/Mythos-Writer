// Drives a real IME composition into the focused element over CDP (Input.imeSetComposition + Input.insertText) and records the composition events it caused.
import type { CDPSession, Page } from '@playwright/test';

export interface CompositionProbe {
  starts: number;
  updates: number;
  ends: number;
  /** `data` of every compositionend, in order. */
  committed: string[];
}

/**
 * Counts composition events on the element `selector` matches (capture phase, so
 * the editor's own handlers cannot hide them). Call before `composeWithIme`.
 */
export async function installCompositionProbe(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`imeComposition: no element for ${sel}`);
    const probe = { starts: 0, updates: 0, ends: 0, committed: [] as string[] };
    (window as unknown as { __imeProbe?: typeof probe }).__imeProbe = probe;
    el.addEventListener('compositionstart', () => { probe.starts += 1; }, true);
    el.addEventListener('compositionupdate', () => { probe.updates += 1; }, true);
    el.addEventListener('compositionend', (e) => {
      probe.ends += 1;
      probe.committed.push((e as CompositionEvent).data ?? '');
    }, true);
  }, selector);
}

export async function readCompositionProbe(page: Page): Promise<CompositionProbe> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __imeProbe?: CompositionProbe }).__imeProbe;
    if (!probe) throw new Error('imeComposition: probe not installed');
    return { starts: probe.starts, updates: probe.updates, ends: probe.ends, committed: [...probe.committed] };
  });
}

/**
 * Types `steps` as successive composition (pre-edit) strings, then commits `commit`,
 * the way a Japanese/Chinese IME does. Targets whatever element has focus.
 */
export async function composeWithIme(page: Page, steps: readonly string[], commit: string): Promise<void> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  try {
    for (const text of steps) {
      await cdp.send('Input.imeSetComposition', {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });
    }
    await cdp.send('Input.insertText', { text: commit });
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}
