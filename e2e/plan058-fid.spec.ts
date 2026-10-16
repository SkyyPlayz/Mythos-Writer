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
 * stay in DesktopShell). The guards below keep the word count and the
 * "Saved just now" label fully visible, including at 900px with a voice
 * stand-in that uses the real .bottom-voice rules.
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
    const label = document.createElement('span');
    label.className = 'bottom-voice-label';
    label.textContent = 'Listening';
    voice.append(dot, label);
    bar.append(voice);
    return voice.getAttribute('style') === null;
  });
  expect(mounted, 'voice stand-in mounted').toBe(true);
}

async function removeVoiceStandIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('[data-testid="fid-voice-standin"]')?.remove();
  });
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
    let p: HTMLElement | null = el.parentElement;
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
      expect(box!.text, `word count copy @${w}`).toMatch(/^\d[\d,]* words · \d[\d,]* characters$/);
      expect(box!.fullyVisible, `word count truncated @${w} (visible ${box!.visibleWidth} of ${box!.leadWidth})`).toBe(true);
      expect(box!.overlapsGoal, `word count under the daily-goal chip @${w}`).toBe(false);
      expect(box!.voiceInsideBar, `voice indicator outside the bar @${w}`).toBe(true);
      expect(box!.voiceOverflowsWindow, `voice indicator overflows the window @${w}`).toBe(false);
      if (w === 900) {
        const ellipsis = await page.evaluate(() => {
          const read = (sel: string) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el).textOverflow : null;
          };
          return {
            crumb: read('.bottom-breadcrumb'),
            tail: read('.bottom-stats-tail'),
            goal: read('[data-testid="bottom-daily-goal"]'),
            draft: read('.bottom-draft-badge'),
          };
        });
        expect(ellipsis.crumb, 'title ellipsis @900').toBe('ellipsis');
        expect(ellipsis.tail, 'stats tail ellipsis @900').toBe('ellipsis');
        expect(ellipsis.goal, 'daily-goal ellipsis @900').toBe('ellipsis');
        if (ellipsis.draft !== null) {
          expect(ellipsis.draft, 'draft badge ellipsis @900').toBe('ellipsis');
        }
      }
      const shot = path.join(SHOT_DIR, `plan058-fid-b-${w}.png`);
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    }

    // Voice mounts only after voiceStart succeeds. Stand in the same nodes
    // the component renders, with no inline sizes, so the real .bottom-voice
    // rules are what keep the bar inside 900px.
    await setContentSize(app!, 900, 900);
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
      const label = document.createElement('span');
      label.className = 'bottom-voice-label';
      label.textContent = 'Listening';
      voice.append(dot, label);
      bar.append(voice);
      return voice.getAttribute('style') === null;
    });
    expect(mounted, 'voice stand-in mounted').toBe(true);
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
      expect(box!.text, 'word count copy with voice @900').toMatch(/^\d[\d,]* words · \d[\d,]* characters$/);
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
        await mountVoiceStandIn(page);
        const withVoice = await textFullyVisible(page, '[data-testid="bottom-saved"]');
        expect(withVoice, `save status measured with voice @${w}`).not.toBeNull();
        expect(withVoice!.text, `save status copy with voice @${w}`).toContain('Saved just now');
        expect(withVoice!.full, `save status truncated with voice @${w} (visible ${withVoice!.visible} of ${withVoice!.width})`).toBe(true);
        const voice = await textFullyVisible(page, '[data-testid="fid-voice-standin"]');
        expect(voice?.full, `voice stand-in clipped beside save status @${w}`).toBe(true);
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
      expect(lead!.text, 'word count copy with voice after save @900').toMatch(/^\d[\d,]* words · \d[\d,]* characters$/);
      expect(lead!.lines, 'word count wrapped after save @900').toBe(1);
      expect(lead!.full, `word count truncated with voice after save @900 (visible ${lead!.visible} of ${lead!.width})`).toBe(true);
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
});
