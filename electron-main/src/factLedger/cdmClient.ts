// Purpose: the only CDM network module. One pinned OpenRouter route, a frozen
// two-model allowlist, the shared ZDR/no-data-collection policy, the gate
// checked right before every send, and a per-instance (per-job) breaker.
// It logs byte counts only, never text or the key.

import {
  applyOpenRouterRequestPolicy,
  isGoogleModelId,
} from '@mythos-writer/shared/openRouterPolicy';
import { cdmAllowed, cdmFlagOn } from './cdmGate.js';
import { validateClassifyOutput, type ClassifyVerdict } from './extract/validateOutput.js';

export const CDM_ORIGIN = 'https://openrouter.ai/api/v1';
export const CDM_CHAT_URL = `${CDM_ORIGIN}/chat/completions`;
export const CDM_EXTRACT_MODEL = 'scaledown/extract';
export const CDM_CLASSIFY_MODEL = 'scaledown/classify-1';
export const CDM_MODEL_ALLOWLIST: readonly string[] = Object.freeze([CDM_EXTRACT_MODEL, CDM_CLASSIFY_MODEL]);

export const CDM_TIMEOUT_MS = 20_000;
export const CDM_MAX_IN_FLIGHT = 2;
export const CDM_RETRY_DELAY_MS = 2_000;
export const CDM_BREAKER_THRESHOLD = 3;
/** B5: largest request body (UTF-8 bytes) ever sent. Over it, that call is unsure and the scene uses script. */
export const CDM_MAX_REQUEST_BYTES = 64 * 1024;
/** Largest response body read as a reply. Over it, the call is unsure. */
export const CDM_MAX_RESPONSE_BYTES = 1024 * 1024;

const NO_ZDR_REPLY = /zero[ -]data[ -]retention|\bzdr\b|data policy|no endpoints found/i;

export interface CdmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface CdmRequest {
  model: string;
  messages: readonly CdmMessage[];
}

export type CdmUnsureReason =
  | 'no_key'
  | 'gate_closed'
  | 'refused_target'
  | 'over_cap'
  | 'breaker_open'
  | 'aborted'
  | 'timeout'
  | 'network'
  | 'no_zdr'
  | 'model_unavailable'
  | 'rate_limited'
  | 'server_error'
  | 'http_error'
  | 'bad_json'
  | 'bad_contract';

/** Reasons that come from the vendor side. Only these count toward the breaker. */
const VENDOR_REASONS = new Set<CdmUnsureReason>([
  'timeout',
  'network',
  'no_zdr',
  'model_unavailable',
  'rate_limited',
  'server_error',
  'http_error',
  'bad_json',
  'bad_contract',
]);

export type CdmResult<T> = { ok: true; value: T } | { ok: false; reason: CdmUnsureReason };

export interface CdmStats {
  requests: number;
  fetches: number;
  unsure: number;
  overCap: number;
  refused: number;
  largestRequestBytes: number;
  largestResponseBytes: number;
  breakerOpen: boolean;
}

export interface CdmGateState {
  optIn: unknown;
  effectiveMode: unknown;
}

export interface CdmClientOptions {
  /** Passed by the caller; only ever placed in the Authorization header. */
  apiKey: string;
  /** Read right before every send, so a flip to Off, Local or opt-out stops queued calls. */
  gateState: () => CdmGateState;
  fetchImpl?: typeof fetch;
  /** Must equal CDM_CHAT_URL exactly; anything else is refused before fetch. */
  endpoint?: string;
  log?: (line: string) => void;
}

export interface CdmClient {
  /** Send one request. `parse` turns the reply text into a value, or null when it breaks the contract. */
  complete<T>(req: CdmRequest, signal: AbortSignal | undefined, parse: (text: string) => T | null): Promise<CdmResult<T>>;
  stats(): CdmStats;
}

/** True only for the pinned HTTPS route and an allowlisted, non-Google model. */
export function isCdmTargetAllowed(url: unknown, model: unknown): boolean {
  if (typeof url !== 'string' || url !== CDM_CHAT_URL || /scaledown\.xyz/i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'openrouter.ai') return false;
  if (typeof model !== 'string' || isGoogleModelId(model)) return false;
  return CDM_MODEL_ALLOWLIST.includes(model);
}

function buildBody(req: CdmRequest): string | null {
  if (!Array.isArray(req.messages) || req.messages.length === 0) return null;
  const messages: CdmMessage[] = [];
  for (const m of req.messages) {
    if (!m || (m.role !== 'system' && m.role !== 'user') || typeof m.content !== 'string') return null;
    messages.push({ role: m.role, content: m.content });
  }
  // Only these fields are sent: no `models` fallback list, no tools. The
  // policy rebuilds `provider` (zdr:true, data_collection:'deny', Google ignored).
  return JSON.stringify(applyOpenRouterRequestPolicy({ model: req.model, messages, temperature: 0, stream: false }));
}

function replyContent(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const choice = (parsed as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0];
  const content = choice?.message?.content;
  return typeof content === 'string' ? content : null;
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type Attempt<T> = { ok: true; value: T } | { ok: false; reason: CdmUnsureReason; retry: boolean };

/** One client per job: the breaker and counters live on the instance, so they reset per job. */
export function createCdmClient(options: CdmClientOptions): CdmClient {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const endpoint = options.endpoint ?? CDM_CHAT_URL;
  const log = options.log ?? ((line: string) => console.info(line));
  const stats: CdmStats = {
    requests: 0,
    fetches: 0,
    unsure: 0,
    overCap: 0,
    refused: 0,
    largestRequestBytes: 0,
    largestResponseBytes: 0,
    breakerOpen: false,
  };
  let vendorStreak = 0;
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = async (): Promise<void> => {
    if (active < CDM_MAX_IN_FLIGHT) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };

  const gateOpen = (): boolean => {
    try {
      const state = options.gateState();
      return cdmAllowed({ flag: cdmFlagOn(), optIn: state?.optIn, effectiveMode: state?.effectiveMode });
    } catch {
      return false;
    }
  };

  const fail = <T>(reason: CdmUnsureReason): CdmResult<T> => {
    stats.unsure += 1;
    if (VENDOR_REASONS.has(reason)) {
      vendorStreak += 1;
      if (vendorStreak >= CDM_BREAKER_THRESHOLD) stats.breakerOpen = true;
    }
    log(`[cdm] unsure: ${reason}`);
    return { ok: false, reason };
  };

  async function attempt<T>(
    body: string,
    signal: AbortSignal | undefined,
    parse: (text: string) => T | null,
  ): Promise<Attempt<T>> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CDM_TIMEOUT_MS);
    try {
      stats.fetches += 1;
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
        body,
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await res.text();
      const bytes = Buffer.byteLength(text, 'utf8');
      stats.largestResponseBytes = Math.max(stats.largestResponseBytes, bytes);
      log(`[cdm] reply ${res.status}, ${bytes} bytes`);
      if (res.status !== 200) {
        if (NO_ZDR_REPLY.test(text)) return { ok: false, reason: 'no_zdr', retry: false };
        if (res.status === 404) return { ok: false, reason: 'model_unavailable', retry: false };
        if (res.status === 429) return { ok: false, reason: 'rate_limited', retry: true };
        if (res.status >= 500) return { ok: false, reason: 'server_error', retry: true };
        return { ok: false, reason: 'http_error', retry: false };
      }
      if (bytes > CDM_MAX_RESPONSE_BYTES) return { ok: false, reason: 'bad_json', retry: false };
      const content = replyContent(text);
      if (content === null) return { ok: false, reason: 'bad_json', retry: false };
      const value = parse(content);
      if (value === null) return { ok: false, reason: 'bad_contract', retry: false };
      return { ok: true, value };
    } catch {
      if (timedOut) return { ok: false, reason: 'timeout', retry: false };
      if (signal?.aborted) return { ok: false, reason: 'aborted', retry: false };
      return { ok: false, reason: 'network', retry: false };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function complete<T>(
    req: CdmRequest,
    signal: AbortSignal | undefined,
    parse: (text: string) => T | null,
  ): Promise<CdmResult<T>> {
    stats.requests += 1;
    if (stats.breakerOpen) return fail('breaker_open');
    if (typeof options.apiKey !== 'string' || options.apiKey === '') return fail('no_key');
    if (!isCdmTargetAllowed(endpoint, req?.model)) {
      stats.refused += 1;
      return fail('refused_target');
    }
    let body: string | null;
    try {
      body = buildBody(req);
    } catch {
      body = null;
    }
    if (body === null) {
      stats.refused += 1;
      return fail('refused_target');
    }
    const bytes = Buffer.byteLength(body, 'utf8');
    stats.largestRequestBytes = Math.max(stats.largestRequestBytes, bytes);
    if (bytes > CDM_MAX_REQUEST_BYTES) {
      stats.overCap += 1;
      log(`[cdm] request ${bytes} bytes is over the ${CDM_MAX_REQUEST_BYTES}-byte cap; not sent`);
      return fail('over_cap');
    }

    await acquire();
    try {
      for (let round = 0; round < 2; round += 1) {
        if (round > 0 && !(await wait(CDM_RETRY_DELAY_MS, signal))) return fail('aborted');
        if (signal?.aborted) return fail('aborted');
        if (stats.breakerOpen) return fail('breaker_open');
        if (!gateOpen()) return fail('gate_closed');
        log(`[cdm] request ${bytes} bytes`);
        const result = await attempt(body, signal, parse);
        if (result.ok) {
          vendorStreak = 0;
          return result;
        }
        if (!result.retry) return fail(result.reason);
        if (round === 1) return fail(result.reason);
      }
      return fail('http_error');
    } finally {
      release();
    }
  }

  return {
    complete,
    stats: () => ({ ...stats }),
  };
}

/** Classify through CDM. Null means unsure (any failure, or a reply off the label set). */
export async function cdmClassify<L extends string>(
  client: CdmClient,
  labels: readonly L[],
  system: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ClassifyVerdict<L> | null> {
  const result = await client.complete(
    {
      model: CDM_CLASSIFY_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    },
    signal,
    (text) => validateClassifyOutput(text, labels),
  );
  return result.ok ? result.value : null;
}
