/**
 * PLAN-058 Fid-a — FD-9 #15 status bar under load: layout work while typing, long, 6-digit, 999-word and 100,000-word scenes.
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
  listeningIcon,
  fixedSetFit,
  barContentWidth,
  setBarContent,
  savedLabel,
  contentPlacement,
  expectInsideContent,
  expectSpare,
  openAddedScene,
  ensureSixDigitScene,
  ensureLongScene,
  textFullyVisible,
  openEditor,
  renameSceneLong,
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
      const shot = test.info().outputPath('plan058-fid-b-900-long.png');
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
      const shot = test.info().outputPath('plan058-fid-b-832-long.png');
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
      const shot = test.info().outputPath('plan058-fid-b-1024-long.png');
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
      const shot = test.info().outputPath('plan058-fid-b-narrow-saved.png');
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
      const shot = test.info().outputPath('plan058-fid-b-1024-six.png');
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
      const shot = test.info().outputPath('plan058-fid-b-1024-999.png');
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
      const shot = test.info().outputPath('plan058-fid-b-546-999.png');
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
      const shot = test.info().outputPath('plan058-fid-b-790-100k.png');
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
      const shot = test.info().outputPath('plan058-fid-b-1024-split-100k.png');
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
      const shot = test.info().outputPath('plan058-fid-b-1024-full-saved.png');
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    } finally {
      await removeVoiceStandIn(page);
    }
  });

});
