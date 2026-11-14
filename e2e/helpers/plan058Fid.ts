/**
 * Shared setup and probes for the PLAN-058 Fid-a specs (moved verbatim from
 * e2e/plan058-fid.spec.ts). The specs that use it:
 *   e2e/plan058-fid-setup-bar.spec.ts, e2e/plan058-fid-long-scenes.spec.ts,
 *   e2e/plan058-fid-plan1700.spec.ts
 *
 * Background (from the original spec):
 * PLAN-058 Fid — FD-8 Scene Crafter setup zoom and FD-9 #15 status bar.
 *
 * Fresh profile. Story is created by clicking (reachability). Widths
 * 900 / 936 / 962 / 1024 in one run, with a screenshot at each.
 * FD-9 #10 rail width is not asserted: 44px at 900 breaks notes
 * content-width pins outside this tip's allowlist.
 * FD-9 #15 page-hint margin is not asserted: the margin number is only
 * in DesktopShell pagePrefs, which this allowlist cannot edit.
 * FD-9 #15 is no ship, chip deferred: BottomBar cannot see the real save
 * pipeline (scene:saved is manual-snapshot only; autosave and its errors
 * stay in DesktopShell). The guards below keep the word count, the
 * "Saved just now" label, "Listening", and prev/next fully visible.
 * Those four never shrink. The split string is the one exception: at content
 * 797px and below, split view with voice on uses the label-less pane counts.
 * Donors leave with display:none from container
 * queries: character count, then the stats tail, then the title, then the
 * goal and the draft badge, so the flex gap leaves with them. Below a 900px
 * window "Listening" keeps its mic and the word is sr-only. From content
 * 545px through 720px, wherever the goal is on screen, every count takes
 * the mic. Saved shortens there only through content 557px, where a
 * 100,000-word count with the mic and the full label is under 12px on
 * DejaVu Sans. Above that the full "Saved just now" stays. Split view keeps the full labels
 * above a 900px window. The character count is not in the split bar, and
 * the goal and badge leave through content 748px so a 100,000-word split
 * at 1024px still fits. The split mic covers content through 546px. Saved
 * shortens in split view through content 452px, the 900px window, because
 * the mic alone still overflows on DejaVu Sans. The short label is
 * aria-hidden. Hidden status is a plain sr-only copy. Fully inside rows
 * keep 12px of spare on that face.
 */
import path from 'path';
import fs from 'fs';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './navGuard';

export const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
export const WIDTHS = [900, 936, 962, 1024] as const;

export function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(
      {
        apiKey: '',
        onboardingComplete: true,
        theme: 'dark',
        agents: {
          writingAssistant: { enabled: false },
          brainstorm: { enabled: false },
          archive: { enabled: false },
        },
        snapshots: { maxPerScene: 100, maxAgeDays: 30 },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

export async function setContentSize(app: ElectronApplication, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('no BrowserWindow');
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(size.w, size.h);
  }, { w, h });
  await new Promise((r) => setTimeout(r, 250));
}

export async function mountVoiceStandIn(page: Page): Promise<void> {
  const mounted = await page.evaluate(() => {
    const bar = document.querySelector('.bottom-bar');
    if (!bar) return false;
    document.querySelector('[data-testid="fid-voice-standin"]')?.remove();
    const voice = document.createElement('div');
    voice.className = 'bottom-voice';
    voice.dataset.testid = 'fid-voice-standin';
    voice.setAttribute('aria-label', 'Voice input active');
    voice.setAttribute('role', 'status');
    const dot = document.createElement('span');
    dot.className = 'bottom-voice-dot';
    dot.setAttribute('aria-hidden', 'true');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'bottom-voice-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const micHead = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    micHead.setAttribute('d', 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z');
    const micStem = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    micStem.setAttribute('d', 'M5 11a7 7 0 0 0 14 0M12 18v3');
    icon.append(micHead, micStem);
    const wrap = document.createElement('span');
    wrap.className = 'bottom-voice-icon-wrap';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.setAttribute('title', 'Listening');
    wrap.append(icon);
    const label = document.createElement('span');
    label.className = 'bottom-voice-label';
    label.textContent = 'Listening';
    voice.append(dot, wrap, label);
    bar.append(voice);
    return voice.getAttribute('style') === null;
  });
  expect(mounted, 'voice stand-in mounted').toBe(true);
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
  }));
}

export async function removeVoiceStandIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('[data-testid="fid-voice-standin"]')?.remove();
  });
}

/** Mic stays painted inside the content box; the word "Listening" is sr-only. */
export async function listeningIcon(page: Page): Promise<{
  iconDisplay: string;
  iconWidth: number;
  iconHeight: number;
  insideContent: boolean;
  insideBorder: boolean;
  labelPosition: string;
  labelText: string | null;
} | null> {
  return page.evaluate(() => {
    const bar = document.querySelector('.bottom-bar');
    const icon = document.querySelector('.bottom-voice-icon-wrap');
    const label = document.querySelector('.bottom-voice-label');
    if (!(bar instanceof HTMLElement) || !(icon instanceof HTMLElement) || !label) return null;
    const barCs = getComputedStyle(bar);
    const padL = parseFloat(barCs.paddingLeft) || 0;
    const padR = parseFloat(barCs.paddingRight) || 0;
    const barRect = bar.getBoundingClientRect();
    const box = icon.getBoundingClientRect();
    const labelCs = getComputedStyle(label);
    return {
      iconDisplay: getComputedStyle(icon).display,
      iconWidth: box.width,
      iconHeight: box.height,
      insideContent: box.width >= 11
        && box.left >= barRect.left + padL - 0.5
        && box.right <= barRect.right - padR + 0.5,
      insideBorder: box.width >= 11
        && box.left >= barRect.left - 0.5
        && box.right <= barRect.right + 0.5,
      labelPosition: labelCs.position,
      labelText: label.textContent,
    };
  });
}

export async function fixedSetFit(page: Page): Promise<{ content: number; occupied: number } | null> {
  return page.evaluate(() => {
    const bar = document.querySelector('.bottom-bar');
    if (!(bar instanceof HTMLElement)) return null;
    const cs = getComputedStyle(bar);
    const gap = parseFloat(cs.columnGap || cs.gap) || 0;
    const content = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const sels = [
      '.bottom-nav',
      '[data-testid="bottom-stats-lead"]',
      '[data-testid="split-word-counts"]',
      '[data-testid="bottom-saved"]',
      '[data-testid="fid-voice-standin"]',
    ];
    const widths = sels.map((sel) => {
      const el = document.querySelector(sel);
      if (!el || getComputedStyle(el).display === 'none') return 0;
      return el.getBoundingClientRect().width;
    });
    const chars = document.querySelector('[data-testid="bottom-stats-chars"]');
    const charsWidth = chars && getComputedStyle(chars).display !== 'none'
      ? chars.getBoundingClientRect().width
      : 0;
    const visible = widths.filter((w) => w > 0).length;
    const occupied = widths.reduce((sum, w) => sum + w, 0) + charsWidth + gap * Math.max(0, visible - 1);
    return { content, occupied };
  });
}

export async function barContentWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bar = document.querySelector('.bottom-bar');
    if (!(bar instanceof HTMLElement)) return 0;
    const cs = getComputedStyle(bar);
    return bar.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  });
}

/** Nudge the window until the status bar content box is the target width. */
export async function setBarContent(app: ElectronApplication, page: Page, target: number): Promise<number> {
  let win = target + 462;
  let content = 0;
  for (let i = 0; i < 8; i += 1) {
    await setContentSize(app, Math.max(640, Math.round(win)), 900);
    content = await barContentWidth(page);
    if (Math.abs(content - target) <= 1.5) return content;
    win += target - content;
  }
  return content;
}

/** Step 2 fires at this content-box width and below, split view with voice on.
 *  797 is the last width where "Pane 1: 999,999 words · Pane 2: 999,999 words"
 *  still has under 12px of DejaVu Sans spare (11.7px). Content 798 has 12.7px. */
export const STEP2_MAX = 797;

export async function reachBarContent(
  app: ElectronApplication,
  page: Page,
  hint: number,
  accept: (content: number) => boolean,
): Promise<number> {
  let win = Math.max(640, Math.round(hint + 461));
  let content = 0;
  for (let i = 0; i < 24; i += 1) {
    await setContentSize(app, win, 900);
    content = await barContentWidth(page);
    if (accept(content)) return content;
    const delta = hint - content;
    if (Math.abs(delta) < 1) win += delta >= 0 ? 1 : -1;
    else win = Math.max(640, Math.round(win + delta));
  }
  throw new Error(`content ${content} missed the band near ${hint}`);
}

export async function setSplit(page: Page, on: boolean): Promise<void> {
  await page.locator('.ProseMirror').first().click();
  const split = page.getByTestId('split-word-counts');
  const visible = (await split.count()) > 0;
  if (visible === on) return;
  await page.keyboard.press('Control+Shift+2');
  if (on) await expect(split).toBeVisible({ timeout: 8_000 });
  else await expect(split).toHaveCount(0, { timeout: 8_000 });
}

export async function savedVoiceEdges(page: Page): Promise<{
  content: number;
  font: string;
  saved: { display: string; pastRight: number; pastLeft: number; width: number } | null;
  voice: { display: string; pastRight: number; pastLeft: number; width: number } | null;
} | null> {
  return page.evaluate(() => {
    const bar = document.querySelector('.bottom-bar');
    if (!(bar instanceof HTMLElement)) return null;
    const cs = getComputedStyle(bar);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const rect = bar.getBoundingClientRect();
    const right = rect.right - padR;
    const left = rect.left + padL;
    const read = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        display: getComputedStyle(el).display,
        pastRight: Math.round((box.right - right) * 10) / 10,
        pastLeft: Math.round((left - box.left) * 10) / 10,
        width: Math.round(box.width * 10) / 10,
      };
    };
    return {
      content: Math.round((bar.clientWidth - padL - padR) * 10) / 10,
      font: cs.fontFamily,
      saved: read('[data-testid="bottom-saved"]'),
      voice: read('.bottom-voice'),
    };
  });
}

export function expectSavedVoiceInside(
  edges: Awaited<ReturnType<typeof savedVoiceEdges>>,
  label: string,
): void {
  expect(edges, `${label} edges missing`).not.toBeNull();
  for (const [name, item] of [['saved', edges!.saved], ['voice', edges!.voice]] as const) {
    expect(item, `${label} ${name} missing`).not.toBeNull();
    expect(item!.display, `${label} ${name} hidden`).not.toBe('none');
    expect(item!.width, `${label} ${name} has no box`).toBeGreaterThan(0);
    expect(item!.pastLeft, `${label} ${name} past left ${item!.pastLeft}`).toBeLessThanOrEqual(0.5);
    expect(item!.pastRight, `${label} ${name} past right ${item!.pastRight}`).toBeLessThanOrEqual(0.5);
  }
}

export async function splitForms(page: Page): Promise<{
  full: { display: string; position: string; width: string; height: string; text: string; title: string | null; hidden: string | null; role: string | null; live: string | null } | null;
  step2: { display: string; text: string; title: string | null; hidden: string | null } | null;
  fallback: { display: string; position: string; width: string; height: string; text: string; title: string | null; role: string | null; live: string | null } | null;
  splitTitle: string | null;
}> {
  return page.evaluate(() => {
    const read = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        display: cs.display,
        position: cs.position,
        width: cs.width,
        height: cs.height,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        title: el.getAttribute('title'),
        hidden: el.getAttribute('aria-hidden'),
        role: el.getAttribute('role'),
        live: el.getAttribute('aria-live'),
      };
    };
    return {
      full: read('.bottom-split-full'),
      step2: read('.bottom-split-short--step2'),
      fallback: read('.bottom-status-fallback--split'),
      splitTitle: document.querySelector('[data-testid="split-word-counts"]')?.getAttribute('title') ?? null,
    };
  });
}

export async function savedLabel(page: Page): Promise<{
  fullPosition: string;
  fullText: string | null;
  shortDisplay: string;
  shortHidden: string | null;
} | null> {
  return page.evaluate(() => {
    const full = document.querySelector('.bottom-saved-full');
    const shortLabel = document.querySelector('.bottom-saved-short');
    if (!full || !shortLabel) return null;
    return {
      fullPosition: getComputedStyle(full).position,
      fullText: full.textContent,
      shortDisplay: getComputedStyle(shortLabel).display,
      shortHidden: shortLabel.getAttribute('aria-hidden'),
    };
  });
}

export async function contentPlacement(page: Page, sels = [
  '.bottom-nav',
  'button[title="Previous scene"]',
  'button[title="Next scene"]',
  '[data-testid="bottom-stats-lead"]',
  '[data-testid="bottom-saved"]',
  '[data-testid="fid-voice-standin"]',
  '[data-testid="bottom-daily-goal"]',
  '.bottom-draft',
]): Promise<{
  content: number;
  font: string;
  items: Array<{
    sel: string;
    missing: boolean;
    display: string | null;
    pastLeft: number;
    pastRight: number;
    width: number;
  }>;
} | null> {
  return page.evaluate((selectors) => {
    const bar = document.querySelector('.bottom-bar');
    if (!(bar instanceof HTMLElement)) return null;
    const cs = getComputedStyle(bar);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const rect = bar.getBoundingClientRect();
    const left = rect.left + padL;
    const right = rect.right - padR;
    return {
      content: bar.clientWidth - padL - padR,
      font: cs.fontFamily,
      items: selectors.map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { sel, missing: true, display: null, pastLeft: 0, pastRight: 0, width: 0 };
        const box = el.getBoundingClientRect();
        return {
          sel,
          missing: false,
          display: getComputedStyle(el).display,
          pastLeft: Math.round((left - box.left) * 10) / 10,
          pastRight: Math.round((box.right - right) * 10) / 10,
          width: Math.round(box.width * 10) / 10,
        };
      }),
    };
  }, sels);
}

export function expectInsideContent(
  placed: Awaited<ReturnType<typeof contentPlacement>>,
  label: string,
): void {
  expect(placed, `${label} placement missing`).not.toBeNull();
  for (const item of placed!.items) {
    expect(item.missing, `${item.sel} missing ${label}`).toBe(false);
    expect(item.display, `${item.sel} hidden ${label}`).not.toBe('none');
    expect(item.pastLeft, `${item.sel} enters the left padding ${label} (${item.pastLeft})`).toBeLessThanOrEqual(0.5);
    expect(item.pastRight, `${item.sel} enters the right padding ${label} (${item.pastRight})`).toBeLessThanOrEqual(0.5);
  }
}

/** Right edge of Listening stays 12px inside the content box. */
export function expectSpare(
  placed: Awaited<ReturnType<typeof contentPlacement>>,
  label: string,
): void {
  const voice = placed?.items.find((item) => item.sel === '[data-testid="fid-voice-standin"]');
  expect(voice, `voice missing ${label}`).toBeTruthy();
  expect(voice!.pastRight, `${label} spare ${-voice!.pastRight}px`).toBeLessThanOrEqual(-12);
}

export async function openAddedScene(page: Page, title: string): Promise<void> {
  await clickStoryNav(page);
  await page.getByRole('button', { name: 'Add scene' }).first().click();
  const prompt = page.locator('.prompt-modal-input');
  await expect(prompt).toBeVisible({ timeout: 8_000 });
  await prompt.fill(title);
  await page.locator('.prompt-modal-ok').click();
  const row = page.locator('.nav-scene-row', { hasText: title });
  await expect(row).toBeVisible({ timeout: 8_000 });
  await row.click();
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 8_000 });
}

/** Insert a 6-digit scene once. A second insert becomes 7 digits. */
export async function ensureSixDigitScene(page: Page): Promise<void> {
  const words = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="bottom-stats-lead"]');
    const match = el?.textContent?.match(/([\d,]+) words/);
    return match ? Number(match[1].replace(/,/g, '')) : 0;
  });
  if (words >= 100_000) return;
  const editor = page.locator('.ProseMirror');
  await editor.click();
  let left = 100_000 - words;
  while (left > 0) {
    const n = Math.min(20_000, left);
    await page.keyboard.insertText('me '.repeat(n));
    left -= n;
  }
  await expect.poll(async () => page.getByTestId('bottom-stats-lead').textContent(), {
    timeout: 30_000,
  }).toMatch(/^\d{3},\d{3} words$/);
}

/** Insert the five-digit scene once. A second insert becomes six digits. */
export async function ensureLongScene(page: Page): Promise<void> {
  const words = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="bottom-stats-lead"]');
    const match = el?.textContent?.match(/([\d,]+) words/);
    return match ? Number(match[1].replace(/,/g, '')) : 0;
  });
  if (words >= 10_000) return;
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.insertText('me '.repeat(22_222));
  await expect.poll(async () => {
    const lead = await page.getByTestId('bottom-stats-lead').textContent();
    const chars = await page.getByTestId('bottom-stats-chars').textContent();
    return `${lead ?? ''}|${(chars ?? '').replace(/\s+/g, ' ').trim()}`;
  }, { timeout: 15_000 }).toMatch(/^\d{2},\d{3} words\|· \d{2},\d{3} characters$/);
}

/** Fixed status items stay flex-shrink 0 and are not overflow-clipped. */
export async function fixedItemStyle(page: Page, selector: string): Promise<{
  flexShrink: string;
  overflowX: string;
} | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { flexShrink: cs.flexShrink, overflowX: cs.overflowX };
  }, selector);
}

/** Visible text and icons vs the status bar's content box, padding excluded.
 *  Sr-only children stay out of the range so a mic or a shortened save label
 *  is judged by what is actually painted. */
export async function textFullyVisible(page: Page, selector: string): Promise<{
  text: string | null;
  full: boolean;
  width: number;
  visible: number;
  lines: number;
  whiteSpace: string | null;
} | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const visuallyHidden = (node: Element) => {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
      if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
      if (/^rect\(\s*0/.test(cs.clip)) return true;
      return cs.overflow === 'hidden' && parseFloat(cs.width) <= 1 && parseFloat(cs.height) <= 1;
    };
    const hidden = (node: Node) => {
      let p: Node | null = node.parentNode;
      while (p instanceof Element) {
        if (visuallyHidden(p)) return true;
        if (p === el) break;
        p = p.parentNode;
      }
      return false;
    };
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    const tops = new Set<number>();
    const push = (r: DOMRect, countLine: boolean) => {
      if (r.width <= 0 || r.height <= 0) return;
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
      if (countLine) tops.add(Math.round(r.top));
    };
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      if (textNode.textContent?.trim() && !hidden(textNode)) {
        range.selectNodeContents(textNode);
        for (const r of range.getClientRects()) push(r, true);
      }
      textNode = walker.nextNode();
    }
    el.querySelectorAll('svg, img').forEach((node) => {
      if (!hidden(node)) push(node.getBoundingClientRect(), false);
    });
    const width = Number.isFinite(left) ? right - left : 0;
    const height = Number.isFinite(top) ? bottom - top : 0;
    const clips = (v: string) => v === 'hidden' || v === 'clip' || v === 'scroll' || v === 'auto';
    let clipLeft = -1e9;
    let clipRight = 1e9;
    let clipTop = -1e9;
    let clipBottom = 1e9;
    let p: HTMLElement | null = el instanceof HTMLElement ? el : el.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      if (clips(cs.overflowX) || clips(cs.overflowY) || clips(cs.overflow)) {
        const r = p.getBoundingClientRect();
        const padL = p.classList.contains('bottom-bar') ? parseFloat(cs.paddingLeft) || 0 : 0;
        const padR = p.classList.contains('bottom-bar') ? parseFloat(cs.paddingRight) || 0 : 0;
        const padT = p.classList.contains('bottom-bar') ? parseFloat(cs.paddingTop) || 0 : 0;
        const padB = p.classList.contains('bottom-bar') ? parseFloat(cs.paddingBottom) || 0 : 0;
        clipLeft = Math.max(clipLeft, r.left + padL);
        clipRight = Math.min(clipRight, r.right - padR);
        clipTop = Math.max(clipTop, r.top + padT);
        clipBottom = Math.min(clipBottom, r.bottom - padB);
      }
      p = p.parentElement;
    }
    const visibleW = width > 0
      ? Math.max(0, Math.min(right, clipRight) - Math.max(left, clipLeft))
      : 0;
    const visibleH = height > 0
      ? Math.max(0, Math.min(bottom, clipBottom) - Math.max(top, clipTop))
      : 0;
    return {
      text: el.textContent,
      full: width > 0 && height > 0
        && visibleW >= width - 0.5
        && visibleH >= height - 0.5,
      width,
      visible: visibleW,
      lines: tops.size,
      whiteSpace: getComputedStyle(el).whiteSpace,
    };
  }, selector);
}

export async function openEditor(page: Page): Promise<void> {
  await clickStoryNav(page);
  const sceneRow = page.locator('.nav-scene-row').first();
  await sceneRow.click();
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 8_000 });
}

export async function renameSceneLong(page: Page): Promise<void> {
  const longTitle = 'Midnight market of the drowned lanterns and the cartographer who would not leave';
  const shown = page.locator('.bottom-scene-name');
  if (await shown.count() > 0 && (await shown.first().textContent()) === longTitle) return;
  const sceneRow = page.locator('.nav-scene-row').first();
  await sceneRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename scene…' }).click();
  const prompt = page.locator('.prompt-modal-input');
  await expect(prompt).toBeVisible({ timeout: 8_000 });
  await prompt.fill(longTitle);
  await page.locator('.prompt-modal-ok').click();
  await expect(page.locator('.bottom-scene-name')).toHaveText(longTitle, { timeout: 8_000 });
}

export async function saveScene(page: Page): Promise<void> {
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('bottom-saved')).toContainText('Saved just now', { timeout: 8_000 });
}
