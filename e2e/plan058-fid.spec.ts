/**
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
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';
import { createStoryFromNavAdd } from './helpers/newStoryModal';
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const WIDTHS = [900, 936, 962, 1024] as const;
const SHOT_DIR = '/opt/cursor/artifacts/screenshots';

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
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

async function setContentSize(app: ElectronApplication, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('no BrowserWindow');
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(size.w, size.h);
  }, { w, h });
  await new Promise((r) => setTimeout(r, 250));
}

async function mountVoiceStandIn(page: Page): Promise<void> {
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

async function removeVoiceStandIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('[data-testid="fid-voice-standin"]')?.remove();
  });
}

/** Mic stays painted inside the content box; the word "Listening" is sr-only. */
async function listeningIcon(page: Page): Promise<{
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

async function fixedSetFit(page: Page): Promise<{ content: number; occupied: number } | null> {
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

async function barContentWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bar = document.querySelector('.bottom-bar');
    if (!(bar instanceof HTMLElement)) return 0;
    const cs = getComputedStyle(bar);
    return bar.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  });
}

/** Nudge the window until the status bar content box is the target width. */
async function setBarContent(app: ElectronApplication, page: Page, target: number): Promise<number> {
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
const STEP2_MAX = 797;

async function reachBarContent(
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

async function setSplit(page: Page, on: boolean): Promise<void> {
  await page.locator('.ProseMirror').first().click();
  const split = page.getByTestId('split-word-counts');
  const visible = (await split.count()) > 0;
  if (visible === on) return;
  await page.keyboard.press('Control+Shift+2');
  if (on) await expect(split).toBeVisible({ timeout: 8_000 });
  else await expect(split).toHaveCount(0, { timeout: 8_000 });
}

async function savedVoiceEdges(page: Page): Promise<{
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

function expectSavedVoiceInside(
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

async function splitForms(page: Page): Promise<{
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

async function savedLabel(page: Page): Promise<{
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

async function contentPlacement(page: Page, sels = [
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

function expectInsideContent(
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
function expectSpare(
  placed: Awaited<ReturnType<typeof contentPlacement>>,
  label: string,
): void {
  const voice = placed?.items.find((item) => item.sel === '[data-testid="fid-voice-standin"]');
  expect(voice, `voice missing ${label}`).toBeTruthy();
  expect(voice!.pastRight, `${label} spare ${-voice!.pastRight}px`).toBeLessThanOrEqual(-12);
}

async function openAddedScene(page: Page, title: string): Promise<void> {
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
async function ensureSixDigitScene(page: Page): Promise<void> {
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
async function ensureLongScene(page: Page): Promise<void> {
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
async function fixedItemStyle(page: Page, selector: string): Promise<{
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
async function textFullyVisible(page: Page, selector: string): Promise<{
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

async function openEditor(page: Page): Promise<void> {
  await clickStoryNav(page);
  const sceneRow = page.locator('.nav-scene-row').first();
  await sceneRow.click();
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 8_000 });
}

async function renameSceneLong(page: Page): Promise<void> {
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

async function saveScene(page: Page): Promise<void> {
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('bottom-saved')).toContainText('Saved just now', { timeout: 8_000 });
}

test.describe('PLAN-058 Fid-a', () => {
  let app: ElectronApplication | undefined;
  let page: Page;
  let userData = '';
  let vaultDir = '';
  let notesVaultDir = '';

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-fid-ud-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-fid-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-fid-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
    app = await electron.launch({
      args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
      timeout: 60_000,
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
    await setContentSize(app, 1024, 900);
    await clickStoryNav(page);
    await createStoryFromNavAdd(page, 'Fid Story');
    await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 8_000 });
    await page.locator('.nav-story-title').first().click();
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
    await expect(page.locator('.sc-columns')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.scene-crafter-header')).toBeVisible();
    await expect(page.locator('.sc-board-list')).toBeVisible();
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(userData, vaultDir, notesVaultDir);
  });

  test('FD-8 setup column zoom is .9 and header plus board picker stay at 100%', async () => {
    const readZoom = () => page.evaluate(() => {
      const read = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const z = getComputedStyle(el).zoom;
        return z === 'normal' ? 1 : Number(z);
      };
      return {
        setup: read('.sc-col-setup'),
        header: read('.scene-crafter-header'),
        board: read('.sc-board-list'),
      };
    });

    for (const w of WIDTHS) {
      await setContentSize(app!, w, 900);
      const zoom = await readZoom();
      expect(zoom.setup, `FD-8 setup zoom @${w}`).toBeCloseTo(0.9, 2);
      expect(zoom.header, `FD-8 header stays 100% @${w}`).toBeCloseTo(1, 2);
      expect((zoom.setup ?? 0) * (zoom.board ?? 0), `FD-8 board picker stays 100% @${w}`).toBeCloseTo(1, 2);
      const shot = path.join(SHOT_DIR, `plan058-fid-a-${w}.png`);
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    }
  });

  test('FD-9 #15 word count stays readable and clear of the daily-goal chip', async () => {
    // The status bar mounts only in the editor (shell-panels), not on Scene Crafter.
    await clickStoryNav(page);
    const sceneRow = page.locator('.nav-scene-row').first();
    await sceneRow.click();
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 8_000 });
    // A long scene title is what crowds the bar. The word-count lead must stay
    // fully visible anyway; the title is the piece that ellipsizes.
    await sceneRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename scene…' }).click();
    const prompt = page.locator('.prompt-modal-input');
    await expect(prompt).toBeVisible({ timeout: 8_000 });
    const longTitle = 'Midnight market of the drowned lanterns and the cartographer who would not leave';
    await prompt.fill(longTitle);
    await page.locator('.prompt-modal-ok').click();
    await expect(page.locator('.bottom-scene-name')).toHaveText(longTitle, { timeout: 8_000 });

    const measure = () => page.evaluate(() => {
      const lead = document.querySelector('[data-testid="bottom-stats-lead"]');
      const bar = document.querySelector('.bottom-bar');
      const goal = document.querySelector('[data-testid="bottom-daily-goal"]');
      const voice = document.querySelector('.bottom-voice');
      if (!lead || !bar || !(bar instanceof HTMLElement)) return null;
      const range = document.createRange();
      range.selectNodeContents(lead);
      const leadRect = range.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const goalRect = goal?.getBoundingClientRect() ?? null;
      const voiceRect = voice?.getBoundingClientRect() ?? null;
      const clips = (v: string) => v === 'hidden' || v === 'clip' || v === 'scroll' || v === 'auto';
      const clipOf = (start: Element) => {
        let clipLeft = -1e9;
        let clipRight = 1e9;
        let clipTop = -1e9;
        let clipBottom = 1e9;
        let p: HTMLElement | null = start.parentElement;
        while (p) {
          const cs = getComputedStyle(p);
          if (clips(cs.overflowX) || clips(cs.overflowY) || clips(cs.overflow)) {
            const r = p.getBoundingClientRect();
            clipLeft = Math.max(clipLeft, r.left);
            clipRight = Math.min(clipRight, r.right);
            clipTop = Math.max(clipTop, r.top);
            clipBottom = Math.min(clipBottom, r.bottom);
          }
          p = p.parentElement;
        }
        return { clipLeft, clipRight, clipTop, clipBottom };
      };
      const leadClip = clipOf(lead);
      const visibleLeft = Math.max(leadRect.left, leadClip.clipLeft);
      const visibleRight = Math.min(leadRect.right, leadClip.clipRight);
      const fullyInsideClip = (rect: DOMRect, start: Element) => {
        const c = clipOf(start);
        const left = Math.max(rect.left, c.clipLeft);
        const right = Math.min(rect.right, c.clipRight);
        const top = Math.max(rect.top, c.clipTop);
        const bottom = Math.min(rect.bottom, c.clipBottom);
        return rect.width > 0 && rect.height > 0
          && (right - left) >= rect.width - 0.5
          && (bottom - top) >= rect.height - 0.5;
      };
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.right > b.left + 0.5 && a.left < b.right - 0.5
        && a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5;
      const inside = (rect: DOMRect, host: DOMRect) =>
        rect.width > 0
        && rect.left >= host.left - 0.5
        && rect.right <= host.right + 0.5
        && rect.top >= host.top - 0.5
        && rect.bottom <= host.bottom + 0.5;
      const dot = voice?.querySelector('.bottom-voice-dot') ?? null;
      const label = voice?.querySelector('.bottom-voice-label') ?? null;
      const voiceCs = voice ? getComputedStyle(voice) : null;
      const dotCs = dot ? getComputedStyle(dot) : null;
      let colorMatchesDanger = false;
      if (voiceCs && dotCs) {
        const probe = document.createElement('span');
        probe.style.color = 'var(--state-danger)';
        probe.style.position = 'absolute';
        probe.style.left = '-9999px';
        document.body.append(probe);
        const danger = getComputedStyle(probe).color;
        probe.remove();
        colorMatchesDanger = danger !== '' && voiceCs.color === danger && dotCs.backgroundColor === danger;
      }
      return {
        text: lead.textContent,
        leadWidth: leadRect.width,
        visibleWidth: Math.max(0, visibleRight - visibleLeft),
        fullyVisible: leadRect.width > 0 && (visibleRight - visibleLeft) >= leadRect.width - 0.5,
        overlapsGoal: goalRect ? overlaps(leadRect, goalRect) : false,
        goalPresent: goalRect !== null,
        voiceCount: document.querySelectorAll('.bottom-voice').length,
        voicePresent: voiceRect !== null,
        voiceTestId: voice?.getAttribute('data-testid') ?? null,
        voiceInsideBar: voiceRect ? inside(voiceRect, barRect) : true,
        voiceOverflowsWindow: voiceRect ? voiceRect.right > window.innerWidth + 0.5 : false,
        voiceFullyVisible: voice && voiceRect ? fullyInsideClip(voiceRect, voice) : false,
        barOverflowsWindow: barRect.right > window.innerWidth + 0.5 || barRect.left < -0.5,
        barScrolls: bar.scrollWidth > bar.clientWidth + 1,
        voiceClass: voice?.className ?? null,
        voiceInline: voice?.getAttribute('style') ?? null,
        dotInline: dot?.getAttribute('style') ?? null,
        labelInline: label?.getAttribute('style') ?? null,
        voiceDisplay: voiceCs?.display ?? null,
        voiceFlexShrink: voiceCs?.flexShrink ?? null,
        voiceGap: voiceCs?.gap ?? null,
        voiceFontWeight: voiceCs?.fontWeight ?? null,
        dotWidth: dotCs?.width ?? null,
        dotHeight: dotCs?.height ?? null,
        labelText: label?.textContent ?? null,
        colorMatchesDanger,
      };
    });

    for (const w of [900, 1280] as const) {
      await setContentSize(app!, w, 900);
      const box = await measure();
      expect(box, `status bar measured @${w}`).not.toBeNull();
      expect(box!.text, `word count copy @${w}`).toMatch(/^\d[\d,]* words$/);
      expect(box!.fullyVisible, `word count truncated @${w} (visible ${box!.visibleWidth} of ${box!.leadWidth})`).toBe(true);
      expect(box!.overlapsGoal, `word count under the daily-goal chip @${w}`).toBe(false);
      expect(box!.voiceInsideBar, `voice indicator outside the bar @${w}`).toBe(true);
      expect(box!.voiceOverflowsWindow, `voice indicator overflows the window @${w}`).toBe(false);
      if (w === 900) {
        const donors = await page.evaluate(() => {
          const read = (sel: string) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el).display : null;
          };
          return {
            crumb: read('.bottom-breadcrumb'),
            tail: read('.bottom-stats-tail'),
            goal: read('[data-testid="bottom-daily-goal"]'),
            draft: read('.bottom-draft'),
            leadOverflow: (() => {
              const el = document.querySelector('[data-testid="bottom-stats-lead"]');
              return el ? getComputedStyle(el).textOverflow : null;
            })(),
          };
        });
        expect(donors.crumb, 'title hides @900').toBe('none');
        expect(donors.tail, 'stats tail hides @900').toBe('none');
        const charsDisplay = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="bottom-stats-chars"]');
          return el ? getComputedStyle(el).display : null;
        });
        expect(charsDisplay, 'character count hides before the tail @900').toBe('none');
        expect(donors.goal, 'daily-goal hides @900').toBe('none');
        if (donors.draft !== null) {
          expect(donors.draft, 'draft badge hides @900').toBe('none');
        }
        expect(donors.leadOverflow, 'word count must not ellipsize @900').not.toBe('ellipsis');
      }
      const shot = path.join(SHOT_DIR, `plan058-fid-b-${w}.png`);
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    }

    // Voice mounts only after voiceStart succeeds. Stand in the same nodes
    // the component renders, with no inline sizes, so the real .bottom-voice
    // rules are what keep the bar inside 900px.
    await setContentSize(app!, 900, 900);
    await mountVoiceStandIn(page);
    try {
      const box = await measure();
      expect(box, 'status bar measured with voice stand-in @900').not.toBeNull();
      expect(box!.voiceCount, 'voice stand-in missing @900').toBe(1);
      expect(box!.voicePresent, 'voice stand-in missing @900').toBe(true);
      expect(box!.voiceTestId).toBe('fid-voice-standin');
      expect(box!.voiceClass).toBe('bottom-voice');
      expect(box!.voiceInline, 'stand-in must use stylesheet rules').toBeNull();
      expect(box!.dotInline, 'stand-in dot must use stylesheet rules').toBeNull();
      expect(box!.labelInline, 'stand-in label must use stylesheet rules').toBeNull();
      expect(box!.voiceDisplay).toBe('flex');
      expect(box!.voiceFlexShrink).toBe('0');
      expect(box!.voiceGap).toBe('5px');
      expect(box!.voiceFontWeight).toBe('500');
      expect(box!.dotWidth).toBe('6px');
      expect(box!.dotHeight).toBe('6px');
      expect(box!.labelText).toBe('Listening');
      expect(box!.colorMatchesDanger, 'voice stand-in missed .bottom-voice color').toBe(true);
      expect(box!.text, 'word count copy with voice @900').toMatch(/^\d[\d,]* words$/);
      expect(box!.fullyVisible, `word count truncated with voice @900 (visible ${box!.visibleWidth} of ${box!.leadWidth})`).toBe(true);
      expect(box!.voiceFullyVisible, 'voice stand-in clipped @900').toBe(true);
      expect(box!.voiceInsideBar, 'voice stand-in outside the bar @900').toBe(true);
      expect(box!.voiceOverflowsWindow, 'voice stand-in overflows the window @900').toBe(false);
      expect(box!.barOverflowsWindow, 'status bar overflows the window @900').toBe(false);
      expect(box!.barScrolls, 'status bar content overflows @900').toBe(false);
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-900-voice.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await page.evaluate(() => {
        document.querySelector('[data-testid="fid-voice-standin"]')?.remove();
      });
    }
  });

  test('FD-9 #15 word count still updates', async () => {
    await clickStoryNav(page);
    await page.locator('.nav-scene-row').first().click();
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 8_000 });
    await editor.click();
    await editor.type('alpha beta');
    await expect(page.getByTestId('bottom-live-stats')).toContainText('2 words', { timeout: 3_000 });
  });

  test('FD-9 #15 save status is fully visible at 900px with voice after a real save', async () => {
    await openEditor(page);
    await renameSceneLong(page);
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.type('save me');
    await saveScene(page);
    try {
      for (const w of [900, 1024] as const) {
        await setContentSize(app!, w, 900);
        await removeVoiceStandIn(page);
        const plain = await textFullyVisible(page, '[data-testid="bottom-saved"]');
        expect(plain, `save status measured @${w}`).not.toBeNull();
        expect(plain!.text, `save status copy @${w}`).toContain('Saved just now');
        expect(plain!.full, `save status truncated @${w} (visible ${plain!.visible} of ${plain!.width})`).toBe(true);
        expect(plain!.whiteSpace, `save status wraps @${w}`).toBe('nowrap');
        const savedFixed = await fixedItemStyle(page, '[data-testid="bottom-saved"]');
        expect(savedFixed?.flexShrink, `save status shrinks @${w}`).toBe('0');
        expect(savedFixed?.overflowX, `save status clips @${w}`).not.toBe('hidden');
        await mountVoiceStandIn(page);
        const withVoice = await textFullyVisible(page, '[data-testid="bottom-saved"]');
        expect(withVoice, `save status measured with voice @${w}`).not.toBeNull();
        expect(withVoice!.text, `save status copy with voice @${w}`).toContain('Saved just now');
        expect(withVoice!.full, `save status truncated with voice @${w} (visible ${withVoice!.visible} of ${withVoice!.width})`).toBe(true);
        expect(withVoice!.whiteSpace, `save status wraps with voice @${w}`).toBe('nowrap');
        const savedFixedVoice = await fixedItemStyle(page, '[data-testid="bottom-saved"]');
        expect(savedFixedVoice?.flexShrink, `save status shrinks with voice @${w}`).toBe('0');
        expect(savedFixedVoice?.overflowX, `save status clips with voice @${w}`).not.toBe('hidden');
      }
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 word count is fully visible at 900px with voice after a real save', async () => {
    await openEditor(page);
    await renameSceneLong(page);
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.type('alpha beta gamma');
    await saveScene(page);
    await setContentSize(app!, 900, 900);
    await mountVoiceStandIn(page);
    try {
      await expect(page.getByTestId('bottom-saved')).toContainText('Saved just now');
      const lead = await textFullyVisible(page, '[data-testid="bottom-stats-lead"]');
      expect(lead, 'word count measured with voice after save @900').not.toBeNull();
      expect(lead!.text, 'word count copy with voice after save @900').toMatch(/^\d[\d,]* words$/);
      expect(lead!.lines, 'word count wrapped after save @900').toBe(1);
      expect(lead!.whiteSpace, 'word count wraps after save @900').toBe('nowrap');
      expect(lead!.full, `word count truncated with voice after save @900 (visible ${lead!.visible} of ${lead!.width})`).toBe(true);
      const leadFixed = await fixedItemStyle(page, '[data-testid="bottom-stats-lead"]');
      expect(leadFixed?.flexShrink, 'word count shrinks after save @900').toBe('0');
      expect(leadFixed?.overflowX, 'word count clips after save @900').not.toBe('hidden');
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 Listening, word count, and save status are fully inside the bar at 900px after a real save', async () => {
    await openEditor(page);
    await renameSceneLong(page);
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.type('kept whole');
    await saveScene(page);
    await setContentSize(app!, 900, 900);
    await mountVoiceStandIn(page);
    try {
      await expect(page.getByTestId('bottom-saved')).toContainText('Saved just now');
      await expect.poll(async () => {
        const text = await page.getByTestId('bottom-stats-lead').textContent();
        const match = text?.match(/(\d[\d,]*) words/);
        return match ? Number(match[1].replace(/,/g, '')) : 0;
      }, { timeout: 3_000 }).toBeGreaterThan(0);
      const saved = await textFullyVisible(page, '[data-testid="bottom-saved"]');
      const lead = await textFullyVisible(page, '[data-testid="bottom-stats-lead"]');
      const voice = await textFullyVisible(page, '[data-testid="fid-voice-standin"]');
      const table = await page.evaluate(() => {
        const bar = document.querySelector('.bottom-bar');
        const row = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const box = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            box: Math.round(box.width * 10) / 10,
            display: cs.display,
            copy: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          };
        };
        return {
          bar: bar ? Math.round(bar.getBoundingClientRect().width * 10) / 10 : null,
          nav: row('.bottom-nav'),
          title: row('.bottom-breadcrumb'),
          lead: row('[data-testid="bottom-stats-lead"]'),
          tail: row('.bottom-stats-tail'),
          draft: row('.bottom-draft'),
          goal: row('[data-testid="bottom-daily-goal"]'),
          saved: row('[data-testid="bottom-saved"]'),
          voice: row('[data-testid="fid-voice-standin"]'),
        };
      });
      expect(saved, `save status missing after save @900 ${JSON.stringify(table)}`).not.toBeNull();
      expect(saved!.text, 'save status copy after save @900').toContain('Saved just now');
      expect(saved!.full, `save status clipped after save @900 (visible ${saved!.visible} of ${saved!.width}) ${JSON.stringify(table)}`).toBe(true);
      expect(lead, `word count missing after save @900 ${JSON.stringify(table)}`).not.toBeNull();
      expect(lead!.text, 'word count copy after save @900').toMatch(/^\d[\d,]* words$/);
      expect(lead!.lines, 'word count wrapped after save @900').toBe(1);
      expect(lead!.full, `word count clipped after save @900 (visible ${lead!.visible} of ${lead!.width}) ${JSON.stringify(table)}`).toBe(true);
      expect(voice, `voice stand-in missing after save @900 ${JSON.stringify(table)}`).not.toBeNull();
      expect(voice!.text, 'voice stand-in copy after save @900').toContain('Listening');
      expect(voice!.full, `voice stand-in clipped after save @900 (visible ${voice!.visible} of ${voice!.width}) ${JSON.stringify(table)}`).toBe(true);
      const voiceFixed = await fixedItemStyle(page, '[data-testid="fid-voice-standin"]');
      expect(voiceFixed?.flexShrink, 'Listening shrinks after save @900').toBe('0');
      const fit = await fixedSetFit(page);
      expect(fit, 'fixed set measured @900').not.toBeNull();
      expect(fit!.occupied, `fixed set overflows @900 (${fit!.occupied} of ${fit!.content})`).toBeLessThanOrEqual(fit!.content + 0.5);
      test.info().annotations.push({ type: 'widths', description: JSON.stringify(table) });
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 split-view word counts stay on one line at 900px', async () => {
    await openEditor(page);
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+Shift+2');
    const split = page.getByTestId('split-word-counts');
    await expect(split).toBeVisible({ timeout: 8_000 });
    await setContentSize(app!, 900, 900);
    const box = await textFullyVisible(page, '[data-testid="split-word-counts"]');
    expect(box, 'split word counts measured @900').not.toBeNull();
    expect(box!.text, 'split word count copy @900').toMatch(/Pane 1: \d[\d,]* words · Pane 2: \d[\d,]* words/);
    expect(box!.whiteSpace, 'split word counts must stay nowrap @900').toBe('nowrap');
    expect(box!.lines, 'split word counts wrapped @900').toBe(1);
    expect(box!.full, `split word counts clipped @900 (visible ${box!.visible} of ${box!.width})`).toBe(true);
    await page.keyboard.press('Control+Shift+2');
    await expect(split).toHaveCount(0, { timeout: 8_000 });
  });

  test('FD-9 #15 prev/next stays whole and the goal and badge give way first at 1024 and 960', async () => {
    await openEditor(page);
    await renameSceneLong(page);
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await saveScene(page);
    await mountVoiceStandIn(page);
    try {
      for (const w of [1024, 960] as const) {
        await setContentSize(app!, w, 900);
        const prev = await textFullyVisible(page, 'button[title="Previous scene"]');
        const next = await textFullyVisible(page, 'button[title="Next scene"]');
        expect(prev, `prev measured @${w}`).not.toBeNull();
        expect(next, `next measured @${w}`).not.toBeNull();
        expect(prev!.text, `prev copy @${w}`).toContain('Prev');
        expect(next!.text, `next copy @${w}`).toContain('Next');
        expect(prev!.full, `prev clipped @${w} (visible ${prev!.visible} of ${prev!.width})`).toBe(true);
        expect(next!.full, `next clipped @${w} (visible ${next!.visible} of ${next!.width})`).toBe(true);
        const order = await page.evaluate(() => {
          const read = (sel: string) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const cs = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            return {
              display: cs.display,
              flexShrink: cs.flexShrink,
              textOverflow: cs.textOverflow,
              width: Math.round(box.width * 10) / 10,
            };
          };
          const bar = document.querySelector('.bottom-bar');
          const container = bar ? Math.round(bar.clientWidth * 10) / 10 : null;
          return {
            container,
            nav: read('.bottom-nav'),
            prev: read('button[title="Previous scene"]'),
            next: read('button[title="Next scene"]'),
            goal: read('[data-testid="bottom-daily-goal"]'),
            draft: read('.bottom-draft'),
            title: read('.bottom-breadcrumb'),
            tail: read('.bottom-stats-tail'),
            chars: read('[data-testid="bottom-stats-chars"]'),
          };
        });
        expect(order.nav?.flexShrink, `prev/next shrinks @${w}`).toBe('0');
        expect(order.prev?.textOverflow, `prev ellipsizes @${w}`).not.toBe('ellipsis');
        expect(order.next?.textOverflow, `next ellipsizes @${w}`).not.toBe('ellipsis');
        expect(order.goal, `goal missing @${w}`).not.toBeNull();
        expect(order.draft, `badge missing @${w}`).not.toBeNull();
        if (w === 1024) {
          expect(order.goal!.display, `goal stays at 1024 container ${order.container}`).not.toBe('none');
          expect(order.draft!.display, `badge stays at 1024 container ${order.container}`).not.toBe('none');
        } else {
          expect(order.goal!.display, `goal gives way @${w} container ${order.container}`).toBe('none');
          expect(order.draft!.display, `badge gives way @${w} container ${order.container}`).toBe('none');
        }
        expect(order.chars?.display, `character count leaves before the tail @${w}`).toBe('none');
        expect(order.tail?.display, `tail leaves before the goal @${w}`).toBe('none');
        expect(order.title?.display, `title leaves before the goal @${w}`).toBe('none');
        expect(order.nav!.width, `prev/next has no box @${w}`).toBeGreaterThan(40);
        test.info().annotations.push({ type: 'space-order', description: JSON.stringify({ w, ...order }) });
      }
      const fallbacks = await page.evaluate(() => (
        [...document.querySelectorAll('.bottom-status-fallback')].map((el) => ({
          role: el.getAttribute('role'),
          live: el.getAttribute('aria-live'),
          hidden: el.getAttribute('aria-hidden'),
        }))
      ));
      expect(fallbacks.length, 'hidden status copy missing').toBeGreaterThan(0);
      for (const fb of fallbacks) {
        expect(fb.role, 'hidden status copy is a live region').toBeNull();
        expect(fb.live, 'hidden status copy is a live region').toBeNull();
        expect(fb.hidden, 'hidden status copy is aria-hidden').toBeNull();
      }
      const sepsHidden = await page.evaluate(() => (
        [...document.querySelectorAll('.bottom-sep')].every((el) => el.getAttribute('aria-hidden') === 'true')
      ));
      expect(sepsHidden, 'decorative separators are exposed').toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 split view keeps the Listening icon inside at 900px', async () => {
    await openEditor(page);
    await page.locator('.ProseMirror').click();
    await saveScene(page);
    await page.keyboard.press('Control+Shift+2');
    const split = page.getByTestId('split-word-counts');
    await expect(split).toBeVisible({ timeout: 8_000 });
    await setContentSize(app!, 900, 900);
    await mountVoiceStandIn(page);
    try {
      const icon = await listeningIcon(page);
      expect(icon, 'Listening icon missing in split view @900').not.toBeNull();
      expect(icon!.iconDisplay, 'Listening stays a word in split view @900').toBe('block');
      expect(icon!.iconWidth, 'Listening icon has no box in split view @900').toBeGreaterThanOrEqual(11);
      expect(icon!.insideContent, `Listening icon leaves the content box in split view @900 ${JSON.stringify(icon)}`).toBe(true);
      expect(icon!.labelPosition, 'Listening word is still visible in split view @900').toBe('absolute');
      expect(icon!.labelText, 'Listening sr-only label missing in split view @900').toBe('Listening');
      const saved = await textFullyVisible(page, '[data-testid="bottom-saved"]');
      expect(saved?.text, 'save status copy in split view @900').toContain('Saved just now');
      expect(saved?.full, `save status clipped in split view @900 (visible ${saved?.visible} of ${saved?.width})`).toBe(true);
      const savedParts = await savedLabel(page);
      expect(savedParts?.fullText, 'full save label missing in split view @900').toContain('Saved just now');
      expect(savedParts?.fullPosition, 'save label stayed full in split view @900').toBe('absolute');
      expect(savedParts?.shortDisplay, 'save label stayed full in split view @900').toBe('block');
      const counts = await textFullyVisible(page, '[data-testid="split-word-counts"]');
      expect(counts?.lines, 'split counts wrapped @900').toBe(1);
      expect(counts?.full, `split counts clipped @900 (visible ${counts?.visible} of ${counts?.width})`).toBe(true);
      const prev = await textFullyVisible(page, 'button[title="Previous scene"]');
      const next = await textFullyVisible(page, 'button[title="Next scene"]');
      expect(prev?.full, 'prev clipped in split view @900').toBe(true);
      expect(next?.full, 'next clipped in split view @900').toBe(true);
      const fit = await fixedSetFit(page);
      expect(fit, 'split fixed set measured @900').not.toBeNull();
      expect(fit!.occupied, `split fixed set leaves the content box @900 (${fit!.occupied} of ${fit!.content})`).toBeLessThanOrEqual(fit!.content + 0.5);
      const placed900 = await contentPlacement(page);
      expectSpare(placed900, 'split view @900');
      test.info().annotations.push({ type: 'split-900', description: JSON.stringify({ fit, placed900 }) });
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-900-split.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
      await page.keyboard.press('Control+Shift+2');
      await expect(split).toHaveCount(0, { timeout: 8_000 });
    }
  });

  test('FD-9 #15 split view keeps Listening and Saved just now at 1280px', async () => {
    await openEditor(page);
    await page.locator('.ProseMirror').click();
    await saveScene(page);
    await page.keyboard.press('Control+Shift+2');
    const split = page.getByTestId('split-word-counts');
    await expect(split).toBeVisible({ timeout: 8_000 });
    await setContentSize(app!, 1280, 900);
    await mountVoiceStandIn(page);
    try {
      const paneText = ((await split.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      expect(paneText, '1280 split ran after a long scene').toMatch(/^Pane 1: \d+ words/);
      const icon = await listeningIcon(page);
      expect(icon, 'Listening missing in split view @1280').not.toBeNull();
      expect(icon!.iconDisplay, 'Listening stays a mic in split view @1280').toBe('none');
      expect(icon!.labelPosition, 'Listening word is hidden in split view @1280').toBe('static');
      expect(icon!.labelText, 'Listening label missing in split view @1280').toBe('Listening');
      const voice = await textFullyVisible(page, '[data-testid="fid-voice-standin"]');
      expect(voice?.text, 'Listening copy missing in split view @1280').toContain('Listening');
      expect(voice?.full, `Listening clipped in split view @1280 (visible ${voice?.visible} of ${voice?.width})`).toBe(true);
      const savedParts = await savedLabel(page);
      expect(savedParts?.fullText, 'full save label missing in split view @1280').toContain('Saved just now');
      expect(savedParts?.fullPosition, 'save label shortened in split view @1280').toBe('static');
      expect(savedParts?.shortDisplay, 'short save label showing in split view @1280').toBe('none');
      const saved = await textFullyVisible(page, '[data-testid="bottom-saved"]');
      expect(saved?.full, `save status clipped in split view @1280 (visible ${saved?.visible} of ${saved?.width})`).toBe(true);
      const counts = await textFullyVisible(page, '[data-testid="split-word-counts"]');
      expect(counts?.lines, 'split counts wrapped @1280').toBe(1);
      expect(counts?.full, `split counts clipped @1280 (visible ${counts?.visible} of ${counts?.width})`).toBe(true);
      const placed = await contentPlacement(page, [
        '.bottom-nav',
        'button[title="Previous scene"]',
        'button[title="Next scene"]',
        '[data-testid="split-word-counts"]',
        '[data-testid="bottom-saved"]',
        '[data-testid="fid-voice-standin"]',
        '[data-testid="bottom-daily-goal"]',
        '.bottom-draft',
      ]);
      test.info().annotations.push({ type: 'split-1280', description: JSON.stringify(placed) });
      expectInsideContent(placed, 'split view @1280');
      expectSpare(placed, 'split view @1280');
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-1280-split.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
      await page.keyboard.press('Control+Shift+2');
      await expect(split).toHaveCount(0, { timeout: 8_000 });
    }
  });

  test('FD-9 #15 short scene stays inside at 832px', async () => {
    await openEditor(page);
    await page.locator('.ProseMirror').click();
    await saveScene(page);
    await setContentSize(app!, 832, 900);
    await mountVoiceStandIn(page);
    try {
      await expect.poll(async () => page.getByTestId('bottom-stats-lead').textContent(), {
        timeout: 3_000,
      }).toMatch(/^\d+ words$/);
      const icon = await listeningIcon(page);
      expect(icon, 'Listening icon missing on short scene @832').not.toBeNull();
      expect(icon!.iconDisplay, 'Listening stays a word on short scene @832').toBe('block');
      expect(icon!.insideContent, `Listening icon leaves the content box on short scene @832 ${JSON.stringify(icon)}`).toBe(true);
      expect(icon!.insideBorder, `Listening icon is clipped on short scene @832 ${JSON.stringify(icon)}`).toBe(true);
      expect(icon!.labelPosition, 'Listening word is still visible on short scene @832').toBe('absolute');
      expect(icon!.labelText).toBe('Listening');
      const savedParts = await page.evaluate(() => {
        const full = document.querySelector('.bottom-saved-full');
        const shortLabel = document.querySelector('.bottom-saved-short');
        if (!full || !shortLabel) return null;
        return {
          fullPosition: getComputedStyle(full).position,
          fullText: full.textContent,
          shortDisplay: getComputedStyle(shortLabel).display,
        };
      });
      expect(savedParts?.fullText, 'full save label missing @832').toContain('Saved just now');
      expect(savedParts?.fullPosition, 'save label already shortened on short scene @832').toBe('static');
      expect(savedParts?.shortDisplay, 'short save label showing on short scene @832').toBe('none');
      const lead = await textFullyVisible(page, '[data-testid="bottom-stats-lead"]');
      const saved = await textFullyVisible(page, '[data-testid="bottom-saved"]');
      const prev = await textFullyVisible(page, 'button[title="Previous scene"]');
      const next = await textFullyVisible(page, 'button[title="Next scene"]');
      expect(lead?.text, 'short scene grew a thousands separator @832').toMatch(/^\d+ words$/);
      expect(lead?.full, `word count clipped on short scene @832`).toBe(true);
      expect(saved?.full, `save status clipped on short scene @832`).toBe(true);
      expect(prev?.full, 'prev clipped on short scene @832').toBe(true);
      expect(next?.full, 'next clipped on short scene @832').toBe(true);
      const fit = await fixedSetFit(page);
      expect(fit, 'short scene fixed set measured @832').not.toBeNull();
      expect(fit!.occupied, `short scene overflows @832 (${fit!.occupied} of ${fit!.content})`).toBeLessThanOrEqual(fit!.content + 0.5);
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-832-short.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 title stays visible at 1280px and the goal and badge stay at 1024px', async () => {
    await openEditor(page);
    await renameSceneLong(page);
    await page.locator('.ProseMirror').click();
    await saveScene(page);
    await mountVoiceStandIn(page);
    try {
      await setContentSize(app!, 1280, 900);
      const at1280 = await page.evaluate(() => {
        const bar = document.querySelector('.bottom-bar');
        const title = document.querySelector('.bottom-breadcrumb');
        const content = bar instanceof HTMLElement
          ? bar.clientWidth - parseFloat(getComputedStyle(bar).paddingLeft) - parseFloat(getComputedStyle(bar).paddingRight)
          : null;
        return {
          content,
          display: title ? getComputedStyle(title).display : null,
          width: title ? title.getBoundingClientRect().width : 0,
          text: title?.textContent ?? '',
        };
      });
      expect(at1280.display, `title hidden at 1280 (content ${at1280.content})`).not.toBe('none');
      expect(at1280.width, `title has no box at 1280 (content ${at1280.content})`).toBeGreaterThan(40);
      expect(at1280.text.length, 'title copy missing at 1280').toBeGreaterThan(0);
      for (const sel of [
        'button[title="Previous scene"]',
        'button[title="Next scene"]',
        '[data-testid="bottom-stats-lead"]',
        '[data-testid="bottom-saved"]',
        '[data-testid="fid-voice-standin"]',
      ]) {
        const box = await textFullyVisible(page, sel);
        expect(box?.full, `${sel} clipped at 1280 (visible ${box?.visible} of ${box?.width})`).toBe(true);
      }
      const shot1280 = path.join(SHOT_DIR, 'plan058-fid-b-1280-title.png');
      await page.screenshot({ path: shot1280 });
      expect(fs.existsSync(shot1280)).toBe(true);

      await setContentSize(app!, 1024, 900);
      const at1024 = await page.evaluate(() => {
        const read = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const box = el.getBoundingClientRect();
          return { display: getComputedStyle(el).display, right: box.right, width: box.width };
        };
        const bar = document.querySelector('.bottom-bar');
        const barRect = bar?.getBoundingClientRect();
        const padR = bar instanceof HTMLElement ? parseFloat(getComputedStyle(bar).paddingRight) || 0 : 0;
        const contentRight = barRect ? barRect.right - padR : null;
        const voice = read('[data-testid="fid-voice-standin"]');
        return {
          content: bar instanceof HTMLElement
            ? bar.clientWidth - parseFloat(getComputedStyle(bar).paddingLeft) - padR
            : null,
          goal: read('[data-testid="bottom-daily-goal"]'),
          draft: read('.bottom-draft'),
          title: read('.bottom-breadcrumb'),
          voicePast: voice && contentRight !== null ? voice.right - contentRight : null,
        };
      });
      expect(at1024.goal?.display, `goal hidden at 1024 (content ${at1024.content})`).not.toBe('none');
      expect(at1024.draft?.display, `badge hidden at 1024 (content ${at1024.content})`).not.toBe('none');
      expect(at1024.title?.display, `title still showing at 1024 (content ${at1024.content})`).toBe('none');
      expect(at1024.voicePast ?? 1, `Listening leaves the content box at 1024 (${at1024.voicePast})`).toBeLessThanOrEqual(0.5);
      for (const sel of [
        'button[title="Previous scene"]',
        'button[title="Next scene"]',
        '[data-testid="bottom-stats-lead"]',
        '[data-testid="bottom-saved"]',
        '[data-testid="fid-voice-standin"]',
        '[data-testid="bottom-daily-goal"]',
        '.bottom-draft',
      ]) {
        const box = await textFullyVisible(page, sel);
        expect(box?.full, `${sel} clipped at 1024 (visible ${box?.visible} of ${box?.width})`).toBe(true);
      }
      const shot1024 = path.join(SHOT_DIR, 'plan058-fid-b-1024-goal.png');
      await page.screenshot({ path: shot1024 });
      expect(fs.existsSync(shot1024)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 typing triggers no layout work in BottomBar', async () => {
    await openEditor(page);
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.evaluate(() => {
      const w = window as Window & {
        __fidLayout?: { rect: number; offset: number; client: number; mo: number; ro: number };
        __fidLayoutRestore?: () => void;
      };
      w.__fidLayoutRestore?.();
      const state = { rect: 0, offset: 0, client: 0, mo: 0, ro: 0 };
      w.__fidLayout = state;
      const inBar = (node: Node | null) => {
        const bar = document.querySelector('.bottom-bar');
        return !!bar && !!node && (node === bar || bar.contains(node));
      };
      const proto = Element.prototype;
      const origRect = proto.getBoundingClientRect;
      const origRects = proto.getClientRects;
      proto.getBoundingClientRect = function (this: Element) {
        if (inBar(this)) state.rect += 1;
        return origRect.call(this);
      };
      proto.getClientRects = function (this: Element) {
        if (inBar(this)) state.rect += 1;
        return origRects.call(this);
      };
      const offsetDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
      const clientDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
      if (!offsetDesc?.get || !clientDesc?.get) throw new Error('width descriptors missing');
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get() {
          if (inBar(this)) state.offset += 1;
          return offsetDesc.get!.call(this);
        },
      });
      Object.defineProperty(Element.prototype, 'clientWidth', {
        configurable: true,
        get() {
          if (inBar(this)) state.client += 1;
          return clientDesc.get!.call(this);
        },
      });
      const OrigMO = window.MutationObserver;
      const OrigRO = window.ResizeObserver;
      window.MutationObserver = class extends OrigMO {
        observe(target: Node, options?: MutationObserverInit): void {
          if (inBar(target)) state.mo += 1;
          super.observe(target, options);
        }
      };
      window.ResizeObserver = class extends OrigRO {
        observe(target: Element, options?: ResizeObserverOptions): void {
          if (inBar(target)) state.ro += 1;
          super.observe(target, options);
        }
      };
      w.__fidLayoutRestore = () => {
        proto.getBoundingClientRect = origRect;
        proto.getClientRects = origRects;
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetDesc);
        Object.defineProperty(Element.prototype, 'clientWidth', clientDesc);
        window.MutationObserver = OrigMO;
        window.ResizeObserver = OrigRO;
        w.__fidLayoutRestore = undefined;
      };
    });
    const zeroLayout = () => page.evaluate(() => {
      const state = (window as Window & {
        __fidLayout?: { rect: number; offset: number; client: number; mo: number; ro: number };
      }).__fidLayout;
      if (!state) return;
      state.rect = 0;
      state.offset = 0;
      state.client = 0;
      state.mo = 0;
      state.ro = 0;
    });
    try {
      await page.keyboard.press('Control+Shift+F');
      await expect(page.locator('.bottom-bar')).toHaveCount(0, { timeout: 8_000 });
      await zeroLayout();
      await page.keyboard.press('Control+Shift+N');
      await expect(page.locator('.bottom-bar')).toBeVisible({ timeout: 8_000 });
      const mounted = await page.evaluate(() => {
        const hook = window as Window & {
          __fidLayout?: { rect: number; offset: number; client: number; mo: number; ro: number };
        };
        return hook.__fidLayout ?? null;
      });
      expect(mounted, 'layout spy missing after remount').not.toBeNull();
      expect(mounted!.mo, `mount observed mutations in the status bar (${JSON.stringify(mounted)})`).toBe(0);
      expect(mounted!.ro, `mount observed resizes in the status bar (${JSON.stringify(mounted)})`).toBe(0);
      await zeroLayout();
      const beforeWords = await page.evaluate(() => (
        document.querySelector('[data-testid="bottom-stats-lead"]')?.textContent ?? ''
      ));
      await editor.click();
      await editor.type(' zz');
      const wordsOf = (text: string | null) => {
        const match = text?.match(/(\d[\d,]*) words/);
        return match ? Number(match[1].replace(/,/g, '')) : 0;
      };
      await expect.poll(async () => page.evaluate(() => {
        const el = document.querySelector('[data-testid="bottom-stats-lead"]');
        const match = el?.textContent?.match(/(\d[\d,]*) words/);
        return match ? Number(match[1].replace(/,/g, '')) : 0;
      }), { timeout: 3_000 }).toBeGreaterThan(wordsOf(beforeWords));
      const counts = await page.evaluate(() => {
        const hook = window as Window & {
          __fidLayout?: { rect: number; offset: number; client: number; mo: number; ro: number };
        };
        return hook.__fidLayout ?? null;
      });
      expect(counts, 'layout spy missing').not.toBeNull();
      expect(counts!.rect, `typing read layout in the status bar (${JSON.stringify(counts)})`).toBe(0);
      expect(counts!.offset, `typing read offsetWidth in the status bar (${JSON.stringify(counts)})`).toBe(0);
      expect(counts!.client, `typing read clientWidth in the status bar (${JSON.stringify(counts)})`).toBe(0);
      expect(counts!.mo, `typing observed mutations in the status bar (${JSON.stringify(counts)})`).toBe(0);
      expect(counts!.ro, `typing observed resizes in the status bar (${JSON.stringify(counts)})`).toBe(0);
    } finally {
      await page.keyboard.press('Control+Shift+N');
      await page.evaluate(() => {
        const w = window as Window & { __fidLayoutRestore?: () => void };
        w.__fidLayoutRestore?.();
      });
    }
  });

  test('FD-9 #15 long scene counts stay fully inside at 900px with voice after a real save', async () => {
    test.setTimeout(90_000);
    await openEditor(page);
    await renameSceneLong(page);
    await ensureLongScene(page);
    await saveScene(page);
    await setContentSize(app!, 900, 900);
    await mountVoiceStandIn(page);
    try {
      await expect(page.getByTestId('bottom-saved')).toContainText('Saved just now');
      const leadText = (await page.getByTestId('bottom-stats-lead').textContent()) ?? '';
      const charsText = ((await page.getByTestId('bottom-stats-chars').textContent()) ?? '').replace(/\s+/g, ' ').trim();
      const wordMatch = leadText.match(/([\d,]+) words/);
      const charMatch = charsText.match(/([\d,]+) characters/);
      const words = wordMatch ? Number(wordMatch[1].replace(/,/g, '')) : 0;
      const chars = charMatch ? Number(charMatch[1].replace(/,/g, '')) : 0;
      expect(words, `word count must be at least 10,000 (${leadText})`).toBeGreaterThanOrEqual(10_000);
      expect(chars, `character count must be at least 10,000 (${charsText})`).toBeGreaterThanOrEqual(10_000);
      expect(leadText, 'word count is five digits with a comma').toMatch(/^\d{2},\d{3} words$/);
      expect(charsText, 'character count is five digits with a comma').toMatch(/^· \d{2},\d{3} characters$/);

      const table = await page.evaluate(() => {
        const bar = document.querySelector('.bottom-bar');
        if (!bar || !(bar instanceof HTMLElement)) return null;
        const barCs = getComputedStyle(bar);
        const gap = parseFloat(barCs.columnGap || barCs.gap) || 0;
        const padL = parseFloat(barCs.paddingLeft) || 0;
        const padR = parseFloat(barCs.paddingRight) || 0;
        const row = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const box = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            width: Math.round(box.width * 10) / 10,
            display: cs.display,
            flexShrink: cs.flexShrink,
            copy: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          };
        };
        const charsEl = document.querySelector('[data-testid="bottom-stats-chars"]');
        let charsIntrinsic = 0;
        if (charsEl instanceof HTMLElement) {
          const prev = charsEl.style.display;
          charsEl.style.display = 'block';
          charsIntrinsic = Math.round(charsEl.getBoundingClientRect().width * 10) / 10;
          charsEl.style.display = prev;
        }
        const border = Math.round(bar.getBoundingClientRect().width * 10) / 10;
        const content = Math.round((bar.clientWidth - padL - padR) * 10) / 10;
        return {
          bar: border,
          content,
          padding: `${padL} + ${padR}`,
          gap,
          charsIntrinsic,
          prev: row('button[title="Previous scene"]'),
          next: row('button[title="Next scene"]'),
          nav: row('.bottom-nav'),
          lead: row('[data-testid="bottom-stats-lead"]'),
          chars: row('[data-testid="bottom-stats-chars"]'),
          saved: row('[data-testid="bottom-saved"]'),
          voice: row('[data-testid="fid-voice-standin"]'),
          title: row('.bottom-breadcrumb'),
          tail: row('.bottom-stats-tail'),
          draft: row('.bottom-draft'),
          goal: row('[data-testid="bottom-daily-goal"]'),
        };
      });
      expect(table, 'long-scene width table').not.toBeNull();
      const fixed = [table!.nav, table!.lead, table!.saved, table!.voice];
      const fixedSum = fixed.reduce((sum, item) => sum + (item?.width ?? 0), 0);
      const gapCount = fixed.filter((item) => item && item.display !== 'none').length - 1;
      // The character count sits inside the stats run, so it adds width and no bar gap.
      const charsWidth = table!.chars && table!.chars.display !== 'none' ? table!.chars.width : 0;
      const occupied = Math.round((fixedSum + charsWidth + gapCount * table!.gap) * 10) / 10;
      const overflow = Math.round((occupied - table!.content) * 10) / 10;
      const report = { ...table, fixedSum: Math.round(fixedSum * 10) / 10, gapCount, occupied, overflow };
      fs.writeFileSync('/tmp/fid-long-widths.json', JSON.stringify(report, null, 2));
      test.info().annotations.push({ type: 'long-scene-widths', description: JSON.stringify(report) });

      const prev = await textFullyVisible(page, 'button[title="Previous scene"]');
      const next = await textFullyVisible(page, 'button[title="Next scene"]');
      const lead = await textFullyVisible(page, '[data-testid="bottom-stats-lead"]');
      const saved = await textFullyVisible(page, '[data-testid="bottom-saved"]');
      const voice = await textFullyVisible(page, '[data-testid="fid-voice-standin"]');
      expect(prev?.full, `prev clipped on long scene @900 ${JSON.stringify(report)}`).toBe(true);
      expect(next?.full, `next clipped on long scene @900 ${JSON.stringify(report)}`).toBe(true);
      expect(lead?.full, `word count clipped on long scene @900 (visible ${lead?.visible} of ${lead?.width}) ${JSON.stringify(report)}`).toBe(true);
      expect(saved?.full, `save status clipped on long scene @900 (visible ${saved?.visible} of ${saved?.width}) ${JSON.stringify(report)}`).toBe(true);
      expect(voice?.full, `Listening clipped on long scene @900 (visible ${voice?.visible} of ${voice?.width}) ${JSON.stringify(report)}`).toBe(true);
      expect(lead?.text, 'long-scene word count copy').toMatch(/^\d{2},\d{3} words$/);
      expect(saved?.text, 'long-scene save copy').toContain('Saved just now');
      expect(voice?.text, 'long-scene voice copy').toContain('Listening');
      expect(overflow, `fixed set overflows the content box by ${overflow}px`).toBeLessThanOrEqual(0);
      expect(table!.chars?.display, 'character count stays on the long-scene line').toBe('none');
      const charsFallback = await page.evaluate(() => {
        const el = document.querySelector('.bottom-status-fallback--chars');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          display: cs.display,
          role: el.getAttribute('role'),
          live: el.getAttribute('aria-live'),
        };
      });
      expect(charsFallback, 'character-count fallback missing').not.toBeNull();
      expect(charsFallback!.text, 'character-count fallback copy').toMatch(/^\d{2},\d{3} characters$/);
      expect(charsFallback!.display, 'character-count fallback hidden while the count is hidden').not.toBe('none');
      expect(charsFallback!.role, 'character-count fallback is a live region').toBeNull();
      expect(charsFallback!.live, 'character-count fallback is a live region').toBeNull();
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-900-long.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);

      // Content box between the tail breakpoint (1192) and the character-count
      // breakpoint (1249): the tail is still on the line, the count is not.
      await setContentSize(app!, 1680, 900);
      const order = await page.evaluate(() => {
        const bar = document.querySelector('.bottom-bar');
        const read = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).display : null;
        };
        const content = bar instanceof HTMLElement
          ? bar.clientWidth - parseFloat(getComputedStyle(bar).paddingLeft) - parseFloat(getComputedStyle(bar).paddingRight)
          : null;
        return {
          content,
          chars: read('[data-testid="bottom-stats-chars"]'),
          tail: read('.bottom-stats-tail'),
        };
      });
      expect(order.content, `order probe content box ${order.content}`).toBeGreaterThan(1192);
      expect(order.content, `order probe content box ${order.content}`).toBeLessThanOrEqual(1249);
      expect(order.chars, `character count still showing at content ${order.content}`).toBe('none');
      expect(order.tail, `stats tail already gone at content ${order.content}`).not.toBe('none');
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 long scene stays inside at 832px', async () => {
    test.setTimeout(90_000);
    await openEditor(page);
    await renameSceneLong(page);
    await ensureLongScene(page);
    await saveScene(page);
    await setContentSize(app!, 832, 900);
    await mountVoiceStandIn(page);
    try {
      await expect(page.getByTestId('bottom-saved')).toContainText('Saved just now');
      const leadText = (await page.getByTestId('bottom-stats-lead').textContent()) ?? '';
      expect(leadText, '832 long word count').toMatch(/^\d{2},\d{3} words$/);
      const icon = await listeningIcon(page);
      expect(icon, 'Listening icon missing on long scene @832').not.toBeNull();
      expect(icon!.iconDisplay, 'Listening stays a word on long scene @832').toBe('block');
      expect(icon!.insideContent, `Listening icon leaves the content box on long scene @832 ${JSON.stringify(icon)}`).toBe(true);
      expect(icon!.insideBorder, `Listening icon is clipped on long scene @832 ${JSON.stringify(icon)}`).toBe(true);
      expect(icon!.labelPosition, 'Listening word is still visible on long scene @832').toBe('absolute');
      expect(icon!.labelText).toBe('Listening');
      const savedParts = await page.evaluate(() => {
        const full = document.querySelector('.bottom-saved-full');
        const shortLabel = document.querySelector('.bottom-saved-short');
        if (!full || !shortLabel) return null;
        return {
          fullPosition: getComputedStyle(full).position,
          fullText: full.textContent,
          shortDisplay: getComputedStyle(shortLabel).display,
        };
      });
      expect(savedParts?.fullText, 'full save label missing on long scene @832').toContain('Saved just now');
      expect(savedParts?.fullPosition, 'save label already shortened on long scene @832').toBe('static');
      expect(savedParts?.shortDisplay, 'short save label showing on long scene @832').toBe('none');
      const lead = await textFullyVisible(page, '[data-testid="bottom-stats-lead"]');
      const saved = await textFullyVisible(page, '[data-testid="bottom-saved"]');
      const prev = await textFullyVisible(page, 'button[title="Previous scene"]');
      const next = await textFullyVisible(page, 'button[title="Next scene"]');
      expect(lead?.full, `word count clipped on long scene @832 (visible ${lead?.visible} of ${lead?.width})`).toBe(true);
      expect(saved?.full, `save status clipped on long scene @832 (visible ${saved?.visible} of ${saved?.width})`).toBe(true);
      expect(saved?.text, 'save status copy on long scene @832').toContain('Saved just now');
      expect(prev?.full, 'prev clipped on long scene @832').toBe(true);
      expect(next?.full, 'next clipped on long scene @832').toBe(true);
      const fit = await fixedSetFit(page);
      expect(fit, 'long scene fixed set measured @832').not.toBeNull();
      expect(fit!.occupied, `long scene overflows @832 (${fit!.occupied} of ${fit!.content})`).toBeLessThanOrEqual(fit!.content + 0.5);
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-832-long.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 long scene keeps the goal and the fixed set inside the content box at 1024px', async () => {
    test.setTimeout(90_000);
    await openEditor(page);
    await renameSceneLong(page);
    await ensureLongScene(page);
    await saveScene(page);
    await setContentSize(app!, 1024, 900);
    await mountVoiceStandIn(page);
    try {
      await expect(page.getByTestId('bottom-saved')).toContainText('Saved just now');
      const leadText = (await page.getByTestId('bottom-stats-lead').textContent()) ?? '';
      expect(leadText, '1024 long word count').toMatch(/^\d{2},\d{3} words$/);
      const icon = await listeningIcon(page);
      expect(icon, 'Listening icon missing on long scene @1024').not.toBeNull();
      expect(icon!.iconDisplay, 'Listening stays a word on long scene @1024').toBe('block');
      expect(icon!.insideContent, `Listening icon leaves the content box on long scene @1024 ${JSON.stringify(icon)}`).toBe(true);
      expect(icon!.labelPosition, 'Listening word is still visible on long scene @1024').toBe('absolute');
      expect(icon!.labelText).toBe('Listening');
      const placed = await page.evaluate(() => {
        const bar = document.querySelector('.bottom-bar');
        if (!(bar instanceof HTMLElement)) return null;
        const cs = getComputedStyle(bar);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padR = parseFloat(cs.paddingRight) || 0;
        const rect = bar.getBoundingClientRect();
        const left = rect.left + padL;
        const right = rect.right - padR;
        const sels = [
          '.bottom-nav',
          'button[title="Previous scene"]',
          'button[title="Next scene"]',
          '[data-testid="bottom-stats-lead"]',
          '[data-testid="bottom-saved"]',
          '[data-testid="fid-voice-standin"]',
          '[data-testid="bottom-daily-goal"]',
          '.bottom-draft',
        ];
        return {
          content: bar.clientWidth - padL - padR,
          items: sels.map((sel) => {
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
      });
      expect(placed, '1024 long placement missing').not.toBeNull();
      expect(placed!.content, `1024 content box ${placed!.content}`).toBeGreaterThan(545);
      test.info().annotations.push({ type: 'widths', description: JSON.stringify(placed) });
      for (const item of placed!.items) {
        expect(item.missing, `${item.sel} missing on long scene @1024`).toBe(false);
        expect(item.display, `${item.sel} hidden on long scene @1024`).not.toBe('none');
        expect(item.pastLeft, `${item.sel} enters the left padding @1024 (${item.pastLeft})`).toBeLessThanOrEqual(0.5);
        expect(item.pastRight, `${item.sel} enters the right padding @1024 (${item.pastRight})`).toBeLessThanOrEqual(0.5);
      }
      for (const sel of [
        'button[title="Previous scene"]',
        'button[title="Next scene"]',
        '[data-testid="bottom-stats-lead"]',
        '[data-testid="bottom-saved"]',
        '[data-testid="fid-voice-standin"]',
        '[data-testid="bottom-daily-goal"]',
      ]) {
        const box = await textFullyVisible(page, sel);
        expect(box?.full, `${sel} leaves the content box on long scene @1024 (visible ${box?.visible} of ${box?.width})`).toBe(true);
      }
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-1024-long.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 shortened save status is read once', async () => {
    await openEditor(page);
    await page.locator('.ProseMirror').click();
    await saveScene(page);
    const content = await setBarContent(app!, page, 300);
    expect(content, `narrow content box ${content}`).toBeLessThan(324);
    await mountVoiceStandIn(page);
    try {
      const savedParts = await savedLabel(page);
      expect(savedParts?.fullPosition, 'save label not shortened below 324px').toBe('absolute');
      expect(savedParts?.shortDisplay, 'short save label hidden below 324px').toBe('block');
      const snap = await page.getByTestId('bottom-saved').ariaSnapshot();
      const fullCopies = snap.match(/Saved just now/g) ?? [];
      const withoutFull = snap.replace(/Saved just now/g, '');
      expect(fullCopies.length, `save status read ${fullCopies.length} times: ${snap}`).toBe(1);
      expect(withoutFull, `short save label also exposed: ${snap}`).not.toContain('Saved');
      expect(savedParts?.shortHidden, 'short save label is in the accessibility tree').toBe('true');
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-narrow-saved.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 a 6-digit scene keeps the fixed set and the goal inside the content box', async () => {
    test.setTimeout(180_000);
    await openAddedScene(page, 'Hundred thousand');
    await ensureSixDigitScene(page);
    await saveScene(page);
    await mountVoiceStandIn(page);
    try {
      const leadText = (await page.getByTestId('bottom-stats-lead').textContent()) ?? '';
      expect(leadText, '6-digit word count').toMatch(/^\d{3},\d{3} words$/);
      for (const target of [548, 640, 716] as const) {
        const content = await setBarContent(app!, page, target);
        expect(content, `content box ${content} left the 546–720 band`).toBeGreaterThan(545);
        expect(content, `content box ${content} left the 546–720 band`).toBeLessThanOrEqual(720);
        const icon = await listeningIcon(page);
        expect(icon, `Listening icon missing on 6-digit scene @${target}`).not.toBeNull();
        expect(icon!.iconDisplay, `Listening stays a word on a 6-digit scene @${target}`).toBe('block');
        expect(icon!.insideContent, `Listening icon leaves the content box on a 6-digit scene @${target} ${JSON.stringify(icon)}`).toBe(true);
        expect(icon!.labelPosition, `Listening word still visible on a 6-digit scene @${target}`).toBe('absolute');
        const placed = await contentPlacement(page);
        test.info().annotations.push({ type: 'six-digit', description: JSON.stringify({ target, placed }) });
        expect(placed!.items.find((item) => item.sel === '[data-testid="bottom-daily-goal"]')?.display, `goal hidden on a 6-digit scene @${target}`).not.toBe('none');
        expectInsideContent(placed, `6-digit scene @${target}`);
        expectSpare(placed, `6-digit scene @${target}`);
        for (const sel of [
          'button[title="Previous scene"]',
          'button[title="Next scene"]',
          '[data-testid="bottom-stats-lead"]',
          '[data-testid="bottom-saved"]',
          '[data-testid="fid-voice-standin"]',
          '[data-testid="bottom-daily-goal"]',
        ]) {
          const box = await textFullyVisible(page, sel);
          expect(box?.full, `${sel} leaves the content box on a 6-digit scene @${target} (visible ${box?.visible} of ${box?.width})`).toBe(true);
        }
      }
      await setContentSize(app!, 1024, 900);
      const at1024 = await barContentWidth(page);
      expect(at1024, `1024 content box ${at1024}`).toBeGreaterThan(545);
      const icon = await listeningIcon(page);
      expect(icon, 'Listening icon missing on 6-digit scene @1024').not.toBeNull();
      expect(icon!.iconDisplay, 'Listening stays a word on a 6-digit scene @1024').toBe('block');
      expect(icon!.insideContent, `Listening icon leaves the content box on a 6-digit scene @1024 ${JSON.stringify(icon)}`).toBe(true);
      const placed = await contentPlacement(page);
      test.info().annotations.push({ type: 'six-digit-1024', description: JSON.stringify(placed) });
      expectInsideContent(placed, '6-digit scene @1024');
      expectSpare(placed, '6-digit scene @1024');
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-1024-six.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 a 999-word scene keeps the Listening mic inside at 1024px', async () => {
    test.setTimeout(90_000);
    await openAddedScene(page, 'Boundary');
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.insertText('me '.repeat(999));
    await expect.poll(async () => page.getByTestId('bottom-stats-lead').textContent(), {
      timeout: 15_000,
    }).toBe('999 words');
    await saveScene(page);
    await setContentSize(app!, 1024, 900);
    await mountVoiceStandIn(page);
    try {
      const icon = await listeningIcon(page);
      expect(icon, 'Listening missing on 999-word scene @1024').not.toBeNull();
      expect(icon!.iconDisplay, 'Listening stays a word on a 999-word scene @1024').toBe('block');
      expect(icon!.insideContent, `Listening icon leaves the content box on a 999-word scene @1024 ${JSON.stringify(icon)}`).toBe(true);
      expect(icon!.labelPosition, 'Listening word still visible on a 999-word scene @1024').toBe('absolute');
      expect(icon!.labelText).toBe('Listening');
      const voice = await textFullyVisible(page, '[data-testid="fid-voice-standin"]');
      expect(voice?.text, 'Listening copy missing on 999-word scene @1024').toContain('Listening');
      expect(voice?.full, `Listening clipped on a 999-word scene @1024 (visible ${voice?.visible} of ${voice?.width})`).toBe(true);
      const savedParts = await savedLabel(page);
      expect(savedParts?.fullText, 'full save label missing on a 999-word scene @1024').toContain('Saved just now');
      expect(savedParts?.fullPosition, 'save label shortened on a 999-word scene @1024').toBe('static');
      expect(savedParts?.shortDisplay, 'short save label showing on a 999-word scene @1024').toBe('none');
      const placed = await contentPlacement(page);
      test.info().annotations.push({ type: 'words-999', description: JSON.stringify(placed) });
      expect(placed!.content, `1024 content box ${placed!.content}`).toBeGreaterThan(545);
      expect(placed!.content, `1024 content box ${placed!.content}`).toBeLessThanOrEqual(720);
      expect(placed!.items.find((item) => item.sel === '[data-testid="bottom-daily-goal"]')?.display, 'goal hidden on a 999-word scene @1024').not.toBe('none');
      expectInsideContent(placed, '999-word scene @1024');
      expectSpare(placed, '999-word scene @1024');
      for (const sel of [
        'button[title="Previous scene"]',
        'button[title="Next scene"]',
        '[data-testid="bottom-stats-lead"]',
        '[data-testid="bottom-saved"]',
        '[data-testid="fid-voice-standin"]',
        '[data-testid="bottom-daily-goal"]',
      ]) {
        const box = await textFullyVisible(page, sel);
        expect(box?.full, `${sel} leaves the content box on a 999-word scene @1024 (visible ${box?.visible} of ${box?.width})`).toBe(true);
      }
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-1024-999.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 a 999-word scene keeps the Listening mic inside from content 546 through 561', async () => {
    test.setTimeout(90_000);
    await openAddedScene(page, 'Short count');
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.insertText('me '.repeat(999));
    await expect.poll(async () => page.getByTestId('bottom-stats-lead').textContent(), {
      timeout: 15_000,
    }).toBe('999 words');
    await saveScene(page);
    await mountVoiceStandIn(page);
    try {
      for (const target of [548, 560] as const) {
        const content = await setBarContent(app!, page, target);
        expect(content, `content box ${content} left 546–562`).toBeGreaterThan(545);
        expect(content, `content box ${content} left 546–562`).toBeLessThanOrEqual(562);
        const icon = await listeningIcon(page);
        expect(icon, `Listening icon missing on 999 words @${target}`).not.toBeNull();
        expect(icon!.iconDisplay, `Listening stays a word on 999 words @${target}`).toBe('block');
        expect(icon!.insideContent, `Listening icon leaves the content box on 999 words @${target} ${JSON.stringify(icon)}`).toBe(true);
        expect(icon!.labelPosition, `Listening word still visible on 999 words @${target}`).toBe('absolute');
        expect(icon!.labelText).toBe('Listening');
        const placed = await contentPlacement(page);
        test.info().annotations.push({ type: 'words-999-band', description: JSON.stringify({ target, placed }) });
        expect(placed!.items.find((item) => item.sel === '[data-testid="bottom-daily-goal"]')?.display, `goal hidden on 999 words @${target}`).not.toBe('none');
        expectInsideContent(placed, `999 words @${target}`);
        expectSpare(placed, `999 words @${target}`);
        const voice = await textFullyVisible(page, '[data-testid="fid-voice-standin"]');
        expect(voice?.full, `Listening icon clipped on 999 words @${target}`).toBe(true);
      }
      await setContentSize(app!, 1008, 900);
      const at1008 = await barContentWidth(page);
      expect(at1008, `1008 content box ${at1008}`).toBeGreaterThan(545);
      expect(at1008, `1008 content box ${at1008}`).toBeLessThanOrEqual(562);
      const icon1008 = await listeningIcon(page);
      expect(icon1008, 'Listening icon missing on 999 words @1008').not.toBeNull();
      expect(icon1008!.iconDisplay, 'Listening stays a word on 999 words @1008').toBe('block');
      expect(icon1008!.insideContent, `Listening icon leaves the content box on 999 words @1008 ${JSON.stringify(icon1008)}`).toBe(true);
      expect(icon1008!.labelPosition, 'Listening word still visible on 999 words @1008').toBe('absolute');
      const placed1008 = await contentPlacement(page);
      test.info().annotations.push({ type: 'words-999-1008', description: JSON.stringify(placed1008) });
      expect(placed1008!.items.find((item) => item.sel === '[data-testid="bottom-daily-goal"]')?.display, 'goal hidden on 999 words @1008').not.toBe('none');
      expectInsideContent(placed1008, '999 words @1008');
      expectSpare(placed1008, '999 words @1008');
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-546-999.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('FD-9 #15 a 100,000-word scene keeps the mic inside at a 790px window', async () => {
    test.setTimeout(180_000);
    await openAddedScene(page, 'Narrow hundred');
    await ensureSixDigitScene(page);
    await saveScene(page);
    await setContentSize(app!, 790, 900);
    await mountVoiceStandIn(page);
    try {
      const leadText = (await page.getByTestId('bottom-stats-lead').textContent()) ?? '';
      expect(leadText, '790 word count').toMatch(/^\d{3},\d{3} words$/);
      const content = await barContentWidth(page);
      expect(content, `790 content box ${content}`).toBeGreaterThan(300);
      expect(content, `790 content box ${content}`).toBeLessThanOrEqual(360);
      const icon = await listeningIcon(page);
      expect(icon, 'Listening icon missing on 100k @790').not.toBeNull();
      expect(icon!.iconDisplay, 'Listening stays a word on 100k @790').toBe('block');
      expect(icon!.insideContent, `Listening icon leaves the content box on 100k @790 ${JSON.stringify(icon)}`).toBe(true);
      const savedParts = await savedLabel(page);
      expect(savedParts?.shortDisplay, 'save label stayed full on 100k @790').toBe('block');
      expect(savedParts?.fullPosition, 'full save label still painted on 100k @790').toBe('absolute');
      const placed = await contentPlacement(page, [
        '.bottom-nav',
        'button[title="Previous scene"]',
        'button[title="Next scene"]',
        '[data-testid="bottom-stats-lead"]',
        '[data-testid="bottom-saved"]',
        '[data-testid="fid-voice-standin"]',
      ]);
      test.info().annotations.push({ type: 'hundred-790', description: JSON.stringify({ content, placed }) });
      expectInsideContent(placed, '100k @790');
      expectSpare(placed, '100k @790');
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-790-100k.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });


  test('FD-9 #15 a 100,000-word split keeps the full labels inside at 1024px', async () => {
    test.setTimeout(180_000);
    await openAddedScene(page, 'Split hundred');
    await ensureSixDigitScene(page);
    await saveScene(page);
    await page.keyboard.press('Control+Shift+2');
    const split = page.getByTestId('split-word-counts');
    await expect(split).toBeVisible({ timeout: 8_000 });
    await setContentSize(app!, 1024, 900);
    await mountVoiceStandIn(page);
    try {
      const paneText = ((await split.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      expect(paneText, '1024 split word count').toMatch(/Pane 1: \d{3},\d{3} words/);
      expect(await page.getByTestId('bottom-stats-chars').count(), 'character count still in the split bar').toBe(0);
      const content = await barContentWidth(page);
      expect(content, `1024 split content ${content}`).toBeGreaterThan(545);
      expect(content, `1024 split content ${content}`).toBeLessThanOrEqual(760);
      const icon = await listeningIcon(page);
      expect(icon, 'Listening missing on 100k split @1024').not.toBeNull();
      expect(icon!.iconDisplay, 'Listening turned into the mic on 100k split @1024').toBe('none');
      expect(icon!.labelPosition, 'Listening word is hidden on 100k split @1024').toBe('static');
      expect(icon!.labelText).toBe('Listening');
      const donors = await page.evaluate(() => {
        const read = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).display : null;
        };
        return {
          goal: read('[data-testid="bottom-daily-goal"]'),
          badge: read('.bottom-draft'),
        };
      });
      expect(donors.goal, 'goal stayed on for 100k split @1024').toBe('none');
      expect(donors.badge, 'badge stayed on for 100k split @1024').toBe('none');
      const voice = await textFullyVisible(page, '[data-testid="fid-voice-standin"]');
      expect(voice?.text, 'Listening copy missing on 100k split @1024').toContain('Listening');
      expect(voice?.full, `Listening clipped on 100k split @1024 (visible ${voice?.visible} of ${voice?.width})`).toBe(true);
      const savedParts = await savedLabel(page);
      expect(savedParts?.fullText, 'full save label missing on 100k split @1024').toContain('Saved just now');
      expect(savedParts?.fullPosition, 'save label shortened on 100k split @1024').toBe('static');
      expect(savedParts?.shortDisplay, 'short save label showing on 100k split @1024').toBe('none');
      const saved = await textFullyVisible(page, '[data-testid="bottom-saved"]');
      expect(saved?.full, `save status clipped on 100k split @1024 (visible ${saved?.visible} of ${saved?.width})`).toBe(true);
      const placed = await contentPlacement(page, [
        '.bottom-nav',
        'button[title="Previous scene"]',
        'button[title="Next scene"]',
        '[data-testid="split-word-counts"]',
        '[data-testid="bottom-saved"]',
        '[data-testid="fid-voice-standin"]',
      ]);
      test.info().annotations.push({ type: 'split-100k-1024', description: JSON.stringify({ content, placed, donors }) });
      expectInsideContent(placed, '100k split @1024');
      expectSpare(placed, '100k split @1024');
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-1024-split-100k.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
      await page.keyboard.press('Control+Shift+2');
      await expect(split).toHaveCount(0, { timeout: 8_000 });
    }
  });


  test('FD-9 #15 a 100,000-word scene keeps Saved just now in the 545–720 band', async () => {
    test.setTimeout(180_000);
    await openAddedScene(page, 'Full saved hundred');
    await ensureSixDigitScene(page);
    await saveScene(page);
    await mountVoiceStandIn(page);
    try {
      const leadText = (await page.getByTestId('bottom-stats-lead').textContent()) ?? '';
      expect(leadText, 'full-saved word count').toMatch(/^\d{3},\d{3} words$/);
      for (const label of ['640', '1024'] as const) {
        if (label === '640') await setBarContent(app!, page, 640);
        else await setContentSize(app!, 1024, 900);
        const content = await barContentWidth(page);
        expect(content, `${label} content box ${content}`).toBeGreaterThan(557);
        expect(content, `${label} content box ${content}`).toBeLessThanOrEqual(720);
        const icon = await listeningIcon(page);
        expect(icon, `Listening icon missing on 100k full saved @${label}`).not.toBeNull();
        expect(icon!.iconDisplay, `Listening stays a word on 100k full saved @${label}`).toBe('block');
        expect(icon!.insideContent, `Listening icon leaves the content box on 100k full saved @${label}`).toBe(true);
        const savedParts = await savedLabel(page);
        expect(savedParts?.fullText, `full save label missing on 100k @${label}`).toContain('Saved just now');
        expect(savedParts?.fullPosition, `save label shortened on 100k @${label}`).toBe('static');
        expect(savedParts?.shortDisplay, `short save label showing on 100k @${label}`).toBe('none');
        const placed = await contentPlacement(page);
        test.info().annotations.push({ type: 'full-saved-band', description: JSON.stringify({ label, content, placed }) });
        expect(placed!.items.find((item) => item.sel === '[data-testid="bottom-daily-goal"]')?.display, `goal hidden on 100k full saved @${label}`).not.toBe('none');
        expectInsideContent(placed, `100k full saved @${label}`);
        expectSpare(placed, `100k full saved @${label}`);
        const saved = await textFullyVisible(page, '[data-testid="bottom-saved"]');
        expect(saved?.full, `Saved just now clipped on 100k @${label}`).toBe(true);
      }
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-1024-full-saved.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('PLAN-1700 roundingMode truncates in the Electron renderer', async () => {
    const line = await page.evaluate(() => {
      const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, roundingMode: 'trunc' });
      return `${fmt.resolvedOptions().roundingMode} ${fmt.format(12.99)}`;
    });
    console.log(`roundingMode ${line}`);
    expect(line, `roundingMode runtime ${line}`).toBe('trunc 12.9');
  });

  test('PLAN-1700 P4 the Listening title sits on the icon wrapper', async () => {
    await openEditor(page);
    await saveScene(page);
    await setSplit(page, true);
    await setContentSize(app!, 900, 900);
    await mountVoiceStandIn(page);
    try {
      const status = page.getByTestId('fid-voice-standin');
      await expect(status).toHaveAccessibleName('Voice input active');
      await expect(status).toHaveAccessibleDescription('');
      await expect(status).not.toHaveAttribute('title');
      const wrap = status.locator('.bottom-voice-icon-wrap');
      await expect(wrap).toHaveAttribute('aria-hidden', 'true');
      await expect(wrap).toHaveAttribute('title', 'Listening');
      const display = await wrap.evaluate((el) => getComputedStyle(el).display);
      expect(display, 'mic wrapper hidden at 900 split').toBe('block');
    } finally {
      await removeVoiceStandIn(page);
      await setSplit(page, false);
    }
  });

  test('PLAN-1700 P1 an 800px split with voice keeps Saved and the mic inside', async () => {
    test.setTimeout(120_000);
    await openAddedScene(page, 'Followup empty');
    await saveScene(page);
    await setSplit(page, true);
    await mountVoiceStandIn(page);
    try {
      await setContentSize(app!, 900, 900);
      const at900 = await page.evaluate(() => {
        const read = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).display : null;
        };
        return {
          nav: read('.bottom-nav'),
          split: read('[data-testid="split-word-counts"]'),
          saved: read('[data-testid="bottom-saved"]'),
          voice: read('.bottom-voice'),
          savedShort: read('.bottom-saved-short'),
          wrap: read('.bottom-voice-icon-wrap'),
          full: read('.bottom-split-full'),
        };
      });
      await setContentSize(app!, 800, 900);
      const edges = await savedVoiceEdges(page);
      expect(edges!.content, `800 content ${edges!.content}`).toBeGreaterThan(320);
      expect(edges!.content, `800 content ${edges!.content}`).toBeLessThanOrEqual(360);
      expectSavedVoiceInside(edges, 'P1 800 split');
      expect(edges!.voice!.pastRight, `P1 spare ${-edges!.voice!.pastRight}px`).toBeLessThanOrEqual(-12);
      const forms = await splitForms(page);
      expect(forms.full?.display, 'full split string stayed painted at 800').toBe('none');
      expect(forms.step2?.display, 'step 2 hidden at 800').toBe('inline');
      expect(forms.step2?.text).toBe('0 · 0');
      expect(forms.fallback?.text).toBe('Pane 1: 0 words · Pane 2: 0 words');
      const at800 = await page.evaluate(() => {
        const read = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).display : null;
        };
        return {
          nav: read('.bottom-nav'),
          split: read('[data-testid="split-word-counts"]'),
          saved: read('[data-testid="bottom-saved"]'),
          voice: read('.bottom-voice'),
          savedShort: read('.bottom-saved-short'),
          wrap: read('.bottom-voice-icon-wrap'),
          full: read('.bottom-split-full'),
        };
      });
      for (const key of ['nav', 'split', 'saved', 'voice', 'savedShort', 'wrap'] as const) {
        expect(at900[key], `${key} hidden at 900`).not.toBe('none');
        expect(at800[key], `${key} newly hidden at 800`).not.toBe('none');
      }
      expect(at900.full, 'full string painted at 900').toBe('none');
      const shot = test.info().outputPath('plan1700-followup-800-split-voice.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
      await setSplit(page, false);
    }
  });

  test('PLAN-1700 P1b step 2 shortens pane counts only while voice is on', async () => {
    test.setTimeout(120_000);
    await openAddedScene(page, 'Followup twelve');
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.insertText('me '.repeat(12403));
    await expect.poll(async () => page.getByTestId('bottom-stats-lead').textContent(), {
      timeout: 15_000,
    }).toBe('12,403 words');
    await saveScene(page);
    await setSplit(page, true);
    const fullText = 'Pane 1: 12,403 words · Pane 2: 0 words';
    await mountVoiceStandIn(page);
    try {
      const content = await reachBarContent(app!, page, STEP2_MAX, (value) => value <= STEP2_MAX && value > STEP2_MAX - 1);
      expect(content, `P1b content ${content}`).toBeLessThanOrEqual(STEP2_MAX);
      expect(content, `P1b content ${content}`).toBeGreaterThan(STEP2_MAX - 1);
      const forms = await splitForms(page);
      expect(forms.step2?.display).toBe('inline');
      expect(forms.step2?.text).toBe('12.4k · 0');
      expect(forms.step2?.hidden).toBe('true');
      expect(forms.step2?.title).toBe(fullText);
      expect(forms.full?.display).toBe('none');
      expect(forms.fallback?.display).toBe('block');
      expect(forms.fallback?.position).toBe('absolute');
      expect(forms.fallback?.width).toBe('1px');
      expect(forms.fallback?.height).toBe('1px');
      expect(forms.fallback?.text).toBe(fullText);
      expect(forms.fallback?.title).toBeNull();
      expect(forms.fallback?.role).toBeNull();
      expect(forms.fallback?.live).toBeNull();
      expect(forms.splitTitle).toBeNull();
      expectSavedVoiceInside(await savedVoiceEdges(page), 'P1b step 2');
      await removeVoiceStandIn(page);
      const off = await splitForms(page);
      expect(off.full?.display, 'step 2 fired with voice off').not.toBe('none');
      expect(off.full?.text).toBe(fullText);
      expect(off.step2?.display, 'step 2 visible with voice off').toBe('none');
      expect(off.fallback?.display, 'split fallback visible with voice off').toBe('none');
    } finally {
      await removeVoiceStandIn(page);
      await setSplit(page, false);
    }
  });

  test('PLAN-1700 P1d the unsplit word count stays full', async () => {
    test.setTimeout(120_000);
    await openAddedScene(page, 'Followup unsplit');
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.insertText('me '.repeat(12403));
    await expect.poll(async () => page.getByTestId('bottom-stats-lead').textContent(), {
      timeout: 15_000,
    }).toBe('12,403 words');
    await saveScene(page);
    await setSplit(page, false);
    await mountVoiceStandIn(page);
    try {
      const check = async (label: string, place: () => Promise<number>) => {
        const content = await place();
        const lead = await textFullyVisible(page, '[data-testid="bottom-stats-lead"]');
        expect(lead?.text, `${label} lead`).toBe('12,403 words');
        expect(lead?.full, `${label} lead clipped`).toBe(true);
        const shown = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="bottom-stats-lead"]');
          return el ? getComputedStyle(el).display : null;
        });
        expect(shown, `${label} lead hidden`).not.toBe('none');
        expect(await page.locator('.bottom-split-short').count(), `${label} short wrapper`).toBe(0);
        const edges = await savedVoiceEdges(page);
        expect(edges!.content, `${label} content ${content}`).toBe(content);
        expectSavedVoiceInside(edges, label);
      };
      await check('P1d 800', async () => {
        await setContentSize(app!, 800, 900);
        return barContentWidth(page);
      });
      for (const hint of [STEP2_MAX - 1, STEP2_MAX, STEP2_MAX + 1]) {
        await check(`P1d content ${hint}`, () => reachBarContent(
          app!,
          page,
          hint,
          (value) => (hint === STEP2_MAX + 1
            ? value > STEP2_MAX && value <= STEP2_MAX + 1.5
            : value <= hint && value > hint - 1),
        ));
      }
    } finally {
      await removeVoiceStandIn(page);
    }
  });

  test('PLAN-1700 P2 step 2 applies at 796 and 797 and not at 798', async () => {
    test.setTimeout(180_000);
    await openAddedScene(page, 'Followup band');
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.insertText('me '.repeat(999_999));
    await expect.poll(async () => page.getByTestId('bottom-stats-lead').textContent()).toBe('999,999 words');
    await saveScene(page);
    const fullText = 'Pane 1: 999,999 words · Pane 2: 999,999 words';
    const shortText = '999.9k · 999.9k';
    const armWorstSplit = async () => {
      await setSplit(page, true);
      const split = page.getByTestId('split-word-counts');
      const current = ((await split.textContent()) ?? '').replace(/\s+/g, ' ');
      if (current.includes('Pane 2: 999,999 words')) return;
      await page.getByTestId('spe-scene-btn').nth(1).click();
      await page.locator('.spe-scene-option', { hasText: 'Followup band' }).click();
      await expect.poll(async () => ((await split.textContent()) ?? '').replace(/\s+/g, ' '), {
        timeout: 8_000,
      }).toContain('Pane 2: 999,999 words');
    };
    const bands = [
      { name: 'B-1', hint: STEP2_MAX - 1, on: true },
      { name: 'B', hint: STEP2_MAX, on: true },
      { name: 'B+1', hint: STEP2_MAX + 1, on: false },
    ] as const;
    const acceptFor = (hint: number) => (value: number) => (
      hint === STEP2_MAX + 1
        ? value > STEP2_MAX && value <= STEP2_MAX + 1.5
        : value <= hint && value > hint - 1
    );
    try {
      for (const band of bands) {
        await armWorstSplit();
        await mountVoiceStandIn(page);
        const content = await reachBarContent(app!, page, band.hint, acceptFor(band.hint));
        expect(content, `${band.name} content ${content}`).toBeGreaterThan(band.hint - 1);
        const forms = await splitForms(page);
        if (band.on) {
          expect(forms.step2?.display, `${band.name} step 2 off at ${content}`).toBe('inline');
          expect(forms.full?.display, `${band.name} full string painted at ${content}`).toBe('none');
          expect(forms.step2?.text).toBe(shortText);
        } else {
          expect(forms.step2?.display, `${band.name} step 2 on at ${content}`).toBe('none');
          expect(forms.full?.display, `${band.name} full string hidden at ${content}`).not.toBe('none');
          expect(forms.full?.text).toBe(fullText);
        }
        expectSavedVoiceInside(await savedVoiceEdges(page), `P2 split ${band.name}`);
        await removeVoiceStandIn(page);
        await setSplit(page, false);
        await mountVoiceStandIn(page);
        const unsplit = await reachBarContent(app!, page, band.hint, acceptFor(band.hint));
        expect(unsplit, `P2 unsplit ${band.name} content ${unsplit}`).toBeGreaterThan(band.hint - 1);
        expect(await page.locator('.bottom-split-short').count(), `P2 unsplit ${band.name} compact`).toBe(0);
        const lead = await textFullyVisible(page, '[data-testid="bottom-stats-lead"]');
        expect(lead?.text, `P2 unsplit ${band.name} lead`).toMatch(/^\d[\d,]* words$/);
        expect(lead?.text, `P2 unsplit ${band.name} shortened`).not.toMatch(/k|M/);
        expect(lead?.full, `P2 unsplit ${band.name} lead clipped`).toBe(true);
        expectSavedVoiceInside(await savedVoiceEdges(page), `P2 unsplit ${band.name}`);
        await removeVoiceStandIn(page);
      }
    } finally {
      await removeVoiceStandIn(page);
      await setSplit(page, false);
    }
  });

  test('PLAN-1700 P3 forced-colors keeps the status dots painted', async () => {
    await openEditor(page);
    await saveScene(page);
    await setSplit(page, false);
    await setContentSize(app!, 1280, 900);
    await mountVoiceStandIn(page);
    try {
      await page.emulateMedia({ forcedColors: 'active' });
      const colors = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.forcedColorAdjust = 'none';
        probe.style.background = 'CanvasText';
        probe.style.width = '8px';
        probe.style.height = '8px';
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const bar = document.querySelector('.bottom-bar');
        const barBg = bar ? getComputedStyle(bar).backgroundColor : '';
        const read = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return {
            width: box.width,
            height: box.height,
            opacity: Number(cs.opacity),
            background: cs.backgroundColor,
          };
        };
        return { expected, barBg, saved: read('.bottom-saved-dot'), voice: read('.bottom-voice-dot') };
      });
      expect(colors.expected, 'CanvasText probe was transparent').not.toBe('rgba(0, 0, 0, 0)');
      expect(colors.expected).not.toBe(colors.barBg);
      for (const [name, dot] of [['saved', colors.saved], ['voice', colors.voice]] as const) {
        expect(dot, `${name} dot missing`).not.toBeNull();
        expect(dot!.width, `${name} dot width`).toBeGreaterThan(0);
        expect(dot!.height, `${name} dot height`).toBeGreaterThan(0);
        expect(dot!.opacity, `${name} dot opacity`).toBeGreaterThan(0);
        expect(dot!.background, `${name} dot ${dot!.background} vs probe ${colors.expected}`).toBe(colors.expected);
        expect(dot!.background).not.toBe(colors.barBg);
      }
    } finally {
      await page.emulateMedia({ forcedColors: 'none' });
      await removeVoiceStandIn(page);
    }
  });

  test('PLAN-1700 P8 forced-colors and reduced motion keep the dots still', async () => {
    await openEditor(page);
    await saveScene(page);
    await setSplit(page, false);
    await setContentSize(app!, 1280, 900);
    await mountVoiceStandIn(page);
    try {
      await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
      const motion = await page.evaluate(() => {
        const read = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return { animation: cs.animationName, width: box.width, opacity: Number(cs.opacity) };
        };
        return { saved: read('.bottom-saved-dot'), voice: read('.bottom-voice-dot') };
      });
      for (const [name, dot] of [['saved', motion.saved], ['voice', motion.voice]] as const) {
        expect(dot, `${name} dot missing`).not.toBeNull();
        expect(dot!.width, `${name} dot hidden`).toBeGreaterThan(0);
        expect(dot!.opacity, `${name} dot faded`).toBeGreaterThan(0);
        expect(dot!.animation, `${name} dot still animating`).toBe('none');
      }
    } finally {
      await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
      await removeVoiceStandIn(page);
    }
  });

  test('PLAN-1700 P5 Liberation Sans renders and the bar stays inside', async () => {
    test.setTimeout(180_000);
    await openEditor(page);
    await saveScene(page);
    const widths = await page.evaluate(() => {
      const measure = (family: string) => {
        const span = document.createElement('span');
        span.textContent = 'Pane 1: 12,403 words · Pane 2: 0 words';
        span.style.fontFamily = family;
        span.style.fontSize = '11px';
        span.style.position = 'absolute';
        span.style.left = '0';
        span.style.top = '0';
        span.style.whiteSpace = 'nowrap';
        document.body.append(span);
        const width = span.getBoundingClientRect().width;
        span.remove();
        return Math.round(width * 10) / 10;
      };
      return {
        liberation: measure('"Liberation Sans", monospace'),
        mono: measure('monospace'),
        dejavu: measure('"DejaVu Sans"'),
      };
    });
    expect(widths.liberation, `Liberation Sans missing ${JSON.stringify(widths)}`).not.toBe(widths.mono);
    expect(widths.liberation, `Liberation Sans matched DejaVu ${JSON.stringify(widths)}`).not.toBe(widths.dejavu);
    const fontTag = await page.addStyleTag({
      content: '.bottom-bar, .bottom-bar * { font-family: "Liberation Sans", sans-serif !important; }',
    });
    try {
      const spares: string[] = [];
      for (const [label, width, split] of [
        ['800 split', 800, true],
        ['900 split', 900, true],
        ['1024 split', 1024, true],
        ['800 unsplit', 800, false],
        ['900 unsplit', 900, false],
        ['1024 unsplit', 1024, false],
      ] as const) {
        await setSplit(page, split);
        await setContentSize(app!, width, 900);
        await mountVoiceStandIn(page);
        const edges = await savedVoiceEdges(page);
        expectSavedVoiceInside(edges, `P5 ${label}`);
        const spare = -edges!.voice!.pastRight;
        spares.push(`${label} content ${edges!.content} spare ${spare}px`);
        await removeVoiceStandIn(page);
      }
      console.log(`P5 Liberation Sans ${spares.join('; ')}`);
      test.info().annotations.push({ type: 'liberation-spare', description: spares.join('; ') });
    } finally {
      await fontTag.evaluate((el) => el.remove());
      await removeVoiceStandIn(page);
      await setSplit(page, false);
    }
  });

});
