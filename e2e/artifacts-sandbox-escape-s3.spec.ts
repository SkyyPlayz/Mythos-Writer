// S3.3 — the artifact iframe cannot see window.api, navigate, or open a window.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const HARNESS = path.resolve(__dirname, 'harness/artifacts-harness.html');
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

test('artifact iframe is opaque, has no window.api, and cannot navigate or pop a window', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-s3-sand-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '',
    onboardingComplete: true,
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: userData }));
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
    timeout: 60_000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.goto(`file://${HARNESS}`);
    await page.waitForSelector('#art');
    const sandbox = await page.locator('#art').getAttribute('sandbox');
    const srcdoc = await page.locator('#art').getAttribute('srcdoc');
    expect(sandbox).toBe('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(srcdoc).toContain(CSP);
    expect(srcdoc).not.toContain('connect-src');
    expect(srcdoc).not.toContain('frame-src');

    const frame = page.frames().find((item) => item !== page.mainFrame());
    expect(frame).toBeTruthy();
    const finished: string[] = [];
    const failed: string[] = [];
    page.on('requestfinished', (req) => {
      if (req.frame() === frame) finished.push(req.url());
    });
    page.on('requestfailed', (req) => {
      if (req.frame() === frame) failed.push(`${req.url()} ${req.failure()?.errorText ?? ''}`);
    });
    const probe = await frame?.evaluate(async () => {
      let parentRead = 'denied';
      try {
        parentRead = window.parent.location.href;
      } catch {
        parentRead = 'denied';
      }
      let topSet = 'blocked';
      try {
        window.top!.location.href = 'https://example.invalid/top';
        topSet = 'set';
      } catch {
        topSet = 'blocked';
      }
      let fetched = 'blocked';
      try {
        await fetch('https://example.invalid/fetch');
        fetched = 'allowed';
      } catch {
        fetched = 'blocked';
      }
      let xhr = 'blocked';
      try {
        const request = new XMLHttpRequest();
        request.open('GET', 'https://example.invalid/xhr', false);
        request.send();
        xhr = 'allowed';
      } catch {
        xhr = 'blocked';
      }
      let form = 'blocked';
      try {
        const node = document.createElement('form');
        node.action = 'https://example.invalid/form';
        node.method = 'post';
        document.body.appendChild(node);
        node.submit();
        form = location.href.includes('example.invalid') ? 'navigated' : 'blocked';
      } catch {
        form = 'blocked';
      }
      let parentApi = 'absent';
      try {
        parentApi = (window.parent as unknown as { api?: unknown }).api === undefined ? 'absent' : 'present';
      } catch {
        parentApi = 'absent';
      }
      const api = (window as unknown as { api?: unknown }).api;
      return {
        api: api === undefined ? 'absent' : 'present',
        parentRead,
        topSet,
        fetched,
        xhr,
        form,
        parentApi,
      };
    });
    expect(probe).toEqual({
      api: 'absent',
      parentRead: 'denied',
      topSet: 'blocked',
      fetched: 'blocked',
      xhr: 'blocked',
      form: 'blocked',
      parentApi: 'absent',
    });
    expect(finished.filter((url) => url.includes('example.invalid'))).toEqual([]);
    expect(failed.join('\n')).not.toMatch(/net::ERR_NAME_NOT_RESOLVED|net::ERR_CONNECTION/);

    const before = app.windows().length;
    await frame?.evaluate(() => {
      window.open('file:///etc/passwd');
    });
    expect(app.windows().length).toBe(before);

    await frame?.evaluate(() => {
      window.parent.postMessage({ type: 'theme-ack', vars: { '--ink': 'red;}body{background:url(https://evil.test)}' } }, '*');
    });
    await page.waitForTimeout(200);
    await expect(page.locator('#theme-ack')).toHaveText('');
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});