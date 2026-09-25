#!/usr/bin/env node
/**
 * Shared gh wrapper with rate-limit detection + exponential backoff.
 * Creed: cut waste, don't weaken quality.
 *
 * Used by token-audit (and optionally health). Never invents data.
 */

import { spawnSync } from "node:child_process";

const BACKOFFS_MS = [2000, 8000, 32000];

/** @type {{ rateLimited: boolean, retries: number, lastError: string|null }} */
export const ghState = {
  rateLimited: false,
  retries: 0,
  lastError: null,
};

function sleepSync(ms) {
  spawnSync("sleep", [String(ms / 1000)], { stdio: "ignore" });
}

export function isRateLimitError(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return (
    /secondary rate limit|rate limit|api rate limit|httperror.*403.*rate|x-ratelimit-remaining:\s*0|retry-after/i.test(
      t,
    ) || /HTTP\s*403/.test(text) && /rate/i.test(t)
  );
}

/**
 * @param {string[]} args
 * @param {{ soft?: boolean, maxRetries?: number }} [opts]
 * @returns {string|null}
 */
export function ghRaw(args, opts = {}) {
  const soft = !!opts.soft;
  const maxRetries = opts.maxRetries ?? BACKOFFS_MS.length;
  let lastErr = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = spawnSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: process.env,
    });
    if (r.status === 0) {
      return (r.stdout || "").trim();
    }
    lastErr = (r.stderr || r.stdout || "").trim() || `gh exited ${r.status}`;
    ghState.lastError = lastErr;

    if (isRateLimitError(lastErr) && attempt < maxRetries) {
      ghState.rateLimited = true;
      ghState.retries += 1;
      const wait = BACKOFFS_MS[Math.min(attempt, BACKOFFS_MS.length - 1)];
      console.warn(
        `mythos-ops/gh: rate-limit on attempt ${attempt + 1}/${maxRetries + 1}; backoff ${wait}ms`,
      );
      sleepSync(wait);
      continue;
    }

    if (isRateLimitError(lastErr)) {
      ghState.rateLimited = true;
      console.warn(`mythos-ops/gh: rate-limit exhausted: ${lastErr.slice(0, 200)}`);
      if (soft) return null;
      const err = new Error(`RATE_LIMITED: ${lastErr}`);
      err.code = "RATE_LIMITED";
      throw err;
    }

    if (soft) {
      console.warn(`mythos-ops/gh: soft fail gh ${args.join(" ")}: ${lastErr}`);
      return null;
    }
    const err = new Error(`gh ${args.join(" ")} failed: ${lastErr}`);
    err.code = "GH_FAIL";
    throw err;
  }
  return null;
}

export function ghJson(args, opts = {}) {
  const text = ghRaw(args, opts);
  if (text === null || text === "") return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    if (opts.soft) {
      console.warn(`mythos-ops/gh: soft JSON parse fail: ${e.message}`);
      return null;
    }
    throw e;
  }
}
