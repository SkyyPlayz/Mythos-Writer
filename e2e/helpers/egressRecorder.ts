/**
 * egressRecorder.ts — SKY-10604 (M11c): harness-level network interception.
 *
 * Two independent capture layers, both BLOCKING (nothing ever leaves the
 * machine) and both RECORDING (the spec asserts on what was attempted):
 *
 *  1. `startEgressProxy()` — a local HTTP proxy the Electron app is pointed
 *     at via `--proxy-server` + `--proxy-bypass-list=<-loopback>`. Every
 *     Chromium-network-stack request (renderer fetch/XHR, `electron.net`,
 *     resource loads) from the FIRST millisecond of boot arrives here as a
 *     plain request or a CONNECT tunnel; we record the target and refuse to
 *     forward. `<-loopback>` removes Chromium's implicit localhost bypass, so
 *     even a local model endpoint (Ollama / LM Studio on 127.0.0.1) would be
 *     seen.
 *
 *  2. `patchMainProcessEgress()` — Node-side calls in electron-main bypass
 *     Chromium's proxy, so the harness monkey-patches `globalThis.fetch`,
 *     `http.request/get`, `https.request/get` and `electron.net.request`
 *     inside the LIVE main process (via `electronApp.evaluate`), recording
 *     every attempted URL and throwing instead of dialing out. As a backstop
 *     beneath all of those, `net.Socket.prototype.connect` is patched too:
 *     even a fetch reference captured before the patch (an SDK binding
 *     `globalThis.fetch` at module load) still has to open a TCP socket, and
 *     that connect is recorded and — for any non-loopback target — refused.
 *
 * Neither layer inspects product code — they observe real egress attempts at
 * the process boundary, which is what "Nothing is sent anywhere" promises.
 */

import net from 'net';
import http from 'http';
import type { ElectronApplication } from '@playwright/test';

export interface EgressRecord {
  method: string;
  target: string;
}

export interface EgressProxy {
  port: number;
  records: EgressRecord[];
  close(): Promise<void>;
}

/**
 * Start a local proxy that records every proxied request / CONNECT tunnel and
 * refuses to forward any of them (502 for plain HTTP, socket destroy for
 * CONNECT). Nothing that reaches this proxy ever leaves the machine.
 */
export async function startEgressProxy(): Promise<EgressProxy> {
  const records: EgressRecord[] = [];

  const server = http.createServer((req, res) => {
    records.push({ method: req.method ?? 'GET', target: req.url ?? '' });
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('egress blocked by e2e harness');
  });

  // HTTPS goes through the proxy as CONNECT host:port — record and refuse.
  server.on('connect', (req, socket: net.Socket) => {
    records.push({ method: 'CONNECT', target: req.url ?? '' });
    socket.destroy();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('egress proxy failed to bind');
  }

  return {
    port: address.port,
    records,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Pending sockets keep close() hanging; there is nothing to drain.
        server.closeAllConnections?.();
      }),
  };
}

/** Chromium flags that force ALL Chromium-stack traffic through the proxy. */
export function proxyLaunchArgs(proxy: EgressProxy): string[] {
  return [
    `--proxy-server=127.0.0.1:${proxy.port}`,
    // Chromium implicitly bypasses proxies for loopback — remove that bypass
    // so local AI endpoints (Ollama etc.) are observed too.
    '--proxy-bypass-list=<-loopback>',
    // Suppress the browser ENGINE's own phone-home traffic (component
    // updater, variations, safe-browsing) so the assert isolates APP egress.
    // Anything that still slips through is matched by CHROMIUM_ENGINE_PATTERN
    // below — never silently.
    '--disable-background-networking',
    '--disable-component-update',
  ];
}

/**
 * Chromium engine infrastructure — traffic the BROWSER ENGINE originates on
 * its own (component/CrX updates via gvt1, update.googleapis.com, variations
 * on clients*.google.com, safe-browsing). Not app code and not an AI
 * provider; the silence spec allow-lists exactly this, still blocked.
 */
export const CHROMIUM_ENGINE_PATTERN =
  /(^|\.|\s|\/\/)((redirector\.)?gvt1\.com|update\.googleapis\.com|clients\d*\.google\.com|safebrowsing\.googleapis\.com|accounts\.google\.com|edgedl\.me\.gvt1\.com)(:\d+)?/i;

/**
 * Patch every Node-side egress primitive inside the running main process.
 * Attempts are pushed to `globalThis.__sky10604MainEgress` and then refused.
 */
export async function patchMainProcessEgress(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ net: electronNet }) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const g = globalThis as any;
    if (g.__sky10604MainEgress) return; // already patched
    const attempts: string[] = [];
    g.__sky10604MainEgress = attempts;

    // The evaluate sandbox has no CJS `require` and forbids dynamic import;
    // process.getBuiltinModule (Node 22+, Electron 42) hands us the SHARED
    // CJS exports objects — the same ones the bundled main process uses, so
    // patching them patches the app.
    const require = (name: string) => (process as any).getBuiltinModule(name);

    const refuse = (target: string): never => {
      attempts.push(target);
      throw new Error(`egress blocked by e2e harness: ${target}`);
    };

    // Node's global fetch (undici) ignores Chromium's proxy entirely.
    if (typeof g.fetch === 'function') {
      g.fetch = (input: any) => {
        const target = typeof input === 'string' ? input : String(input?.url ?? input);
        try {
          refuse(`fetch ${target}`);
        } catch (err) {
          return Promise.reject(err);
        }
        return Promise.reject(new Error('unreachable'));
      };
    }

    // http/https request+get — cover both the module default export and
    // destructured call styles (they all funnel through these four).
    for (const mod of ['http', 'https'] as const) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require(mod);
      for (const fn of ['request', 'get'] as const) {
        m[fn] = (...args: any[]) => {
          const first = args[0];
          const target =
            typeof first === 'string'
              ? first
              : first instanceof URL
                ? first.href
                : `${first?.protocol ?? `${mod}:`}//${first?.hostname ?? first?.host ?? '?'}${first?.path ?? ''}`;
          refuse(`${mod}.${fn} ${target}`);
        };
      }
    }

    // electron.net.request uses Chromium's stack (the proxy would see it),
    // but patch it too so the record names the API that was called.
    (electronNet as any).request = (options: any) => {
      const target = typeof options === 'string' ? options : String(options?.url ?? '?');
      refuse(`electron.net.request ${target}`);
    };

    // Socket-level backstop: a fetch reference captured before this patch
    // (e.g. an SDK binding globalThis.fetch at module load) still has to
    // open a TCP socket. Record every connect; refuse non-loopback ones.
    // Loopback connects are recorded but allowed — the ASSERTION decides
    // whether a local target (Ollama et al.) counts as AI egress.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const netModule = require('net');
    const origConnect = netModule.Socket.prototype.connect;
    netModule.Socket.prototype.connect = function connectPatched(this: any, ...args: any[]) {
      const a = Array.isArray(args[0]) ? args[0] : args;
      let host = 'localhost';
      let port: unknown = '?';
      let isPipe = false;
      if (typeof a[0] === 'object' && a[0] !== null) {
        if (a[0].path) isPipe = true;
        host = a[0].host ?? 'localhost';
        port = a[0].port ?? a[0].path ?? '?';
      } else if (typeof a[0] === 'number' || typeof a[0] === 'string') {
        port = a[0];
        if (typeof a[1] === 'string') host = a[1];
        if (typeof a[0] === 'string' && Number.isNaN(Number(a[0]))) isPipe = true;
      }
      const loopback = isPipe || host === 'localhost' || host === '127.0.0.1' || host === '::1';
      attempts.push(`socket ${host}:${String(port)}`);
      if (!loopback) {
        this.destroy(new Error(`egress blocked by e2e harness: ${host}:${String(port)}`));
        return this;
      }
      return origConnect.apply(this, args);
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
}

/**
 * Targets that identify an AI provider — cloud hosts and the default local
 * model endpoints (provider.ts DEFAULT_BASE_URLS: Ollama 11434, LM Studio
 * 1234, llama.cpp 8080).
 */
export const AI_PROVIDER_PATTERN =
  /anthropic|openai|generativelanguage|aiplatform|openrouter|mistral|cohere|:11434|:1234|:8080|lmstudio|llama/i;

/** Read every Node-side egress attempt recorded since the patch. */
export async function readMainProcessEgress(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((globalThis as any).__sky10604MainEgress ?? []) as string[];
  });
}
