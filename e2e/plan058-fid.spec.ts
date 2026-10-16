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
 * Those four never shrink. Donors leave with display:none from container
 * queries: character count, then the stats tail, then the title, then the
 * goal and the draft badge, so the flex gap leaves with them. Below a 900px
 * window, and in split view, "Listening" keeps its mic and the word is
 * sr-only. Narrower still, "Saved just now" becomes a check and "Saved".
 * Hidden status is a plain sr-only copy.
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
    const label = document.createElement('span');
    label.className = 'bottom-voice-label';
    label.textContent = 'Listening';
    voice.append(dot, icon, label);
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
    const icon = document.querySelector('.bottom-voice-icon');
    const label = document.querySelector('.bottom-voice-label');
    if (!(bar instanceof HTMLElement) || !icon || !label) return null;
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

/** Text range vs overflow clip. Width and height both have to survive. */
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
    const range = document.createRange();
    range.selectNodeContents(el);
    const rect = range.getBoundingClientRect();
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
        clipLeft = Math.max(clipLeft, r.left);
        clipRight = Math.min(clipRight, r.right);
        clipTop = Math.max(clipTop, r.top);
        clipBottom = Math.min(clipBottom, r.bottom);
      }
      p = p.parentElement;
    }
    const visibleW = Math.max(0, Math.min(rect.right, clipRight) - Math.max(rect.left, clipLeft));
    const visibleH = Math.max(0, Math.min(rect.bottom, clipBottom) - Math.max(rect.top, clipTop));
    const tops = new Set<number>();
    for (const r of range.getClientRects()) tops.add(Math.round(r.top));
    return {
      text: el.textContent,
      full: rect.width > 0 && rect.height > 0
        && visibleW >= rect.width - 0.5
        && visibleH >= rect.height - 0.5,
      width: rect.width,
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
      expect(icon!.insideBorder, `Listening icon is clipped in split view @900 ${JSON.stringify(icon)}`).toBe(true);
      expect(icon!.labelPosition, 'Listening word is still visible in split view @900').toBe('absolute');
      expect(icon!.labelText, 'Listening sr-only label missing in split view @900').toBe('Listening');
      const saved = await textFullyVisible(page, '[data-testid="bottom-saved"]');
      expect(saved?.text, 'save status copy in split view @900').toContain('Saved just now');
      expect(saved?.full, `save status clipped in split view @900 (visible ${saved?.visible} of ${saved?.width})`).toBe(true);
      const counts = await textFullyVisible(page, '[data-testid="split-word-counts"]');
      expect(counts?.lines, 'split counts wrapped @900').toBe(1);
      expect(counts?.full, `split counts clipped @900 (visible ${counts?.visible} of ${counts?.width})`).toBe(true);
      const prev = await textFullyVisible(page, 'button[title="Previous scene"]');
      const next = await textFullyVisible(page, 'button[title="Next scene"]');
      expect(prev?.full, 'prev clipped in split view @900').toBe(true);
      expect(next?.full, 'next clipped in split view @900').toBe(true);
      const fit = await fixedSetFit(page);
      expect(fit, 'split fixed set measured @900').not.toBeNull();
      expect(fit!.occupied, `split fixed set overflows @900 (${fit!.occupied} of ${fit!.content})`).toBeLessThanOrEqual(fit!.content + 0.5);
      const shot = path.join(SHOT_DIR, 'plan058-fid-b-900-split.png');
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

});
