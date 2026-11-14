/**
 * PLAN-058 Fid-a — PLAN-1700 follow-ups: rounding, Listening title, 800px split, step-2 bands, forced colors, Liberation Sans.
 *
 * Split from e2e/plan058-fid.spec.ts (Critic S2, #1700) as a pure move: same
 * describe, same test titles and bodies, same order. Each spec launches its own
 * app from a fresh profile in beforeAll. Shared helpers: e2e/helpers/plan058Fid.ts.
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
import {
  MAIN_JS,
  seedUserData,
  setContentSize,
  mountVoiceStandIn,
  removeVoiceStandIn,
  barContentWidth,
  STEP2_MAX,
  reachBarContent,
  setSplit,
  savedVoiceEdges,
  expectSavedVoiceInside,
  splitForms,
  openAddedScene,
  textFullyVisible,
  openEditor,
  saveScene,
} from './helpers/plan058Fid';

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
