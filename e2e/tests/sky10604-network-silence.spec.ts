/**
 * sky10604-network-silence.spec.ts — SKY-10604 (M11c), item 1.
 *
 * The Settings copy promises, in writing: "Nothing is sent anywhere."
 * This spec proves it with REAL network interception at the harness — not
 * code inspection, not IPC seams, not fetch spies:
 *
 *   TC-NS-01  With the master AI toggle OFF (and, adversarially, every
 *             per-agent enable ON), a full E2E session that touches all six
 *             workspaces (Story Writer incl. the scene editor, Scene
 *             Crafter, Notes Editor, Brainstorm, Timeline, Vault Graph) plus
 *             the Settings dialog produces ZERO egress:
 *               - zero requests through the Chromium network stack, observed
 *                 by a local blocking proxy the app is forced through from
 *                 its first millisecond (`--proxy-server` +
 *                 `--proxy-bypass-list=<-loopback>` so even loopback AI
 *                 endpoints like Ollama would be seen), and
 *               - zero Node-side attempts in electron-main (where ALL LLM
 *                 traffic originates — provider.ts and the main.ts:7841
 *                 bypass), observed by harness patches over fetch /
 *                 http(s).request / electron.net.request and, beneath them
 *                 all, net.Socket.prototype.connect.
 *
 *   TC-NS-02  The interception is LIVE, not vacuously green: deliberate
 *             egress attempts from both layers (a Chromium-stack load and
 *             Node-side fetch / https.get / raw socket connects in main)
 *             are each recorded — and blocked — by the same recorders
 *             TC-NS-01 asserted were empty.
 *
 * Run: npx playwright test e2e/tests/sky10604-network-silence.spec.ts --reporter=list
 */

import { test, expect, type ElectronApplication } from '@playwright/test';
import {
  startEgressProxy,
  proxyLaunchArgs,
  patchMainProcessEgress,
  readMainProcessEgress,
  AI_PROVIDER_PATTERN,
  CHROMIUM_ENGINE_PATTERN,
  type EgressProxy,
} from '../helpers/egressRecorder';
import { closeElectronApp } from '../helpers/electronTeardown';
import {
  createSuiteFixture,
  cleanupSuiteFixture,
  launchSuiteApp,
  firstSuiteWindow,
  walkEveryWorkspace,
  type SuiteFixture,
} from '../helpers/aiOffSuite';

test.describe.serial('SKY-10604 network silence (AI off)', () => {
  let fixture: SuiteFixture;
  let proxy: EgressProxy;
  let app: ElectronApplication | undefined;

  test.beforeAll(async () => {
    fixture = createSuiteFixture(false); // master OFF, every per-agent ON
    proxy = await startEgressProxy();
    app = await launchSuiteApp(fixture.userData, proxyLaunchArgs(proxy));
    await patchMainProcessEgress(app);
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    await proxy.close();
    cleanupSuiteFixture(fixture);
  });

  test('TC-NS-01: full six-workspace session with AI off — zero egress on both network layers', async () => {
    if (!app) throw new Error('app failed to launch');
    const page = await firstSuiteWindow(app);

    await walkEveryWorkspace(page);

    // Give any debounced/deferred work a beat to fire before reading.
    await page.waitForTimeout(1_500);

    // Chromium layer: the proxy saw the entire session from boot. First and
    // non-negotiable: nothing may name an AI provider. Then: nothing else
    // either, once the browser ENGINE's own documented phone-home targets
    // (CHROMIUM_ENGINE_PATTERN — all blocked anyway) are set aside.
    const chromiumAttempts = proxy.records.map((r) => `${r.method} ${r.target}`);
    expect(chromiumAttempts.filter((a) => AI_PROVIDER_PATTERN.test(a))).toEqual([]);
    expect(chromiumAttempts.filter((a) => !CHROMIUM_ENGINE_PATTERN.test(a))).toEqual([]);

    // Node layer (electron-main — where every LLM call site lives).
    const mainAttempts = await readMainProcessEgress(app);

    // No attempt anywhere may name an AI provider — cloud host or local
    // model port — regardless of layer or loopback-ness.
    expect(mainAttempts.filter((a) => AI_PROVIDER_PATTERN.test(a))).toEqual([]);

    // No API-level attempt at all (fetch / http / https / electron.net):
    // the app has no legitimate Node-side traffic in this build.
    expect(mainAttempts.filter((a) => !a.startsWith('socket '))).toEqual([]);

    // No socket connect to anything beyond loopback/pipes.
    expect(
      mainAttempts.filter(
        (a) => a.startsWith('socket ') && !/^socket (localhost|127\.0\.0\.1|::1):/.test(a),
      ),
    ).toEqual([]);
  });

  test('TC-NS-02: the interception is live — deliberate egress from both layers is recorded and blocked', async () => {
    if (!app) throw new Error('app failed to launch');

    // Chromium layer control: load an external URL through the Chromium
    // network stack in a hidden window. The proxy must see it and refuse it.
    const proxyCountBefore = proxy.records.length;
    await app.evaluate(({ BrowserWindow }) => {
      const win = new BrowserWindow({ show: false });
      return win
        .loadURL('http://sky10604-control.invalid/chromium-layer-ping')
        .catch(() => undefined)
        .then(() => win.destroy());
    });
    await expect
      .poll(() => proxy.records.slice(proxyCountBefore).map((r) => r.target).join(' '), {
        timeout: 10_000,
      })
      .toContain('sky10604-control.invalid');

    // Node layer controls: fetch, https.get, and a raw socket connect must
    // each be recorded (and refused) by the main-process patches.
    await app.evaluate(async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const g = globalThis as any;
      const require = (name: string) => (process as any).getBuiltinModule(name);
      await g.fetch('https://sky10604-control.invalid/fetch-ping').catch(() => undefined);
      try {
        require('https').get('https://sky10604-control.invalid/https-ping');
      } catch { /* refused by harness — expected */ }
      try {
        const netMod = require('net');
        const sock = new netMod.Socket();
        sock.on('error', () => undefined);
        sock.connect(443, 'sky10604-control.invalid');
      } catch { /* refused by harness — expected */ }
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });

    const attempts = await readMainProcessEgress(app);
    expect(attempts.join('\n')).toContain('fetch https://sky10604-control.invalid/fetch-ping');
    expect(attempts.join('\n')).toContain('https.get https://sky10604-control.invalid/https-ping');
    expect(attempts.join('\n')).toContain('socket sky10604-control.invalid:443');
  });
});
