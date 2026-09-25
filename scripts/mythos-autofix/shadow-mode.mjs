#!/usr/bin/env node
/**
 * Mythos autofix shadow-mode helper.
 * Creed: cut waste, don't weaken quality.
 *
 * Usage (library): import { resolveAutofixMode, appendShadowLog, maybeFlipToLive }
 * CLI:
 *   node scripts/mythos-autofix/shadow-mode.mjs resolve
 *   node scripts/mythos-autofix/shadow-mode.mjs ensure-window
 *   node scripts/mythos-autofix/shadow-mode.mjs flip-if-due
 *
 * Env: GITHUB_REPOSITORY, GH_TOKEN / MYTHOS_BOT_TOKEN,
 *      MYTHOS_AUTOFIX_MODE, MYTHOS_AUTOFIX_SHADOW_UNTIL, MYTHOS_WAKE_CIRCUIT_BREAKER
 */

import { appendFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function gh(args, { soft = false } = {}) {
  const env = { ...process.env };
  if (process.env.MYTHOS_BOT_TOKEN) env.GH_TOKEN = process.env.MYTHOS_BOT_TOKEN;
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    env,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    if (soft) {
      console.warn(`shadow-mode: soft fail: ${err}`);
      return null;
    }
    throw new Error(err || `gh exit ${r.status}`);
  }
  return (r.stdout || "").trim();
}

function setVar(name, value) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return false;
  const ok = gh(
    ["variable", "set", name, "--body", String(value), "--repo", repo],
    { soft: true },
  );
  return ok !== null;
}

export function breakerActive(wakeCircuitIso = process.env.MYTHOS_WAKE_CIRCUIT_BREAKER || process.env.WAKE_CIRCUIT || "") {
  if (!wakeCircuitIso || !String(wakeCircuitIso).trim()) return false;
  const ms = Date.parse(wakeCircuitIso);
  return Number.isFinite(ms) && ms > Date.now();
}

/**
 * @returns {{
 *   mode: 'shadow'|'live'|'disabled',
 *   until: string|null,
 *   execute: boolean,
 *   reason: string,
 *   flipped: boolean,
 * }}
 */
export function resolveAutofixMode(env = process.env) {
  let mode = String(env.MYTHOS_AUTOFIX_MODE || env.AUTOFIX_MODE || "shadow")
    .trim()
    .toLowerCase();
  if (!mode) mode = "shadow";
  if (mode !== "shadow" && mode !== "live" && mode !== "disabled") {
    mode = "shadow";
  }

  const untilRaw = env.MYTHOS_AUTOFIX_SHADOW_UNTIL || env.AUTOFIX_SHADOW_UNTIL || "";
  const untilMs = untilRaw ? Date.parse(untilRaw) : NaN;
  let flipped = false;

  if (mode === "disabled") {
    return {
      mode,
      until: untilRaw || null,
      execute: false,
      reason: "disabled",
      flipped,
    };
  }

  if (mode === "live") {
    return {
      mode,
      until: untilRaw || null,
      execute: true,
      reason: "live",
      flipped,
    };
  }

  // shadow
  if (!untilRaw || !Number.isFinite(untilMs)) {
    return {
      mode: "shadow",
      until: untilRaw || null,
      execute: false,
      reason: "shadow (UNTIL unset — treat as log-only until ensure-window)",
      flipped,
    };
  }

  if (Date.now() < untilMs) {
    return {
      mode: "shadow",
      until: untilRaw,
      execute: false,
      reason: `shadow until ${untilRaw}`,
      flipped,
    };
  }

  // Window elapsed → auto-flip to live unless disabled (already filtered).
  return {
    mode: "shadow",
    until: untilRaw,
    execute: true,
    reason: "shadow window elapsed — caller should flip to live",
    flipped,
    shouldFlip: true,
  };
}

export function ensureShadowWindow({ writeVars = true } = {}) {
  const repo = process.env.GITHUB_REPOSITORY;
  let mode = String(process.env.MYTHOS_AUTOFIX_MODE || "").trim().toLowerCase();
  let until = process.env.MYTHOS_AUTOFIX_SHADOW_UNTIL || "";
  const actions = [];

  if (!mode || mode === "shadow") {
    if (!mode) {
      mode = "shadow";
      if (writeVars && repo) {
        setVar("MYTHOS_AUTOFIX_MODE", "shadow");
        actions.push("set MYTHOS_AUTOFIX_MODE=shadow");
      }
    }
    if (!until || !Number.isFinite(Date.parse(until))) {
      until = new Date(Date.now() + WEEK_MS).toISOString();
      if (writeVars && repo) {
        setVar("MYTHOS_AUTOFIX_SHADOW_UNTIL", until);
        actions.push(`set MYTHOS_AUTOFIX_SHADOW_UNTIL=${until}`);
      }
    }
  }

  return { mode: mode || "shadow", until, actions };
}

export function maybeFlipToLive(resolved) {
  if (!resolved?.shouldFlip) return { flipped: false };
  if (String(process.env.MYTHOS_AUTOFIX_MODE || "").toLowerCase() === "disabled") {
    return { flipped: false };
  }
  const ok = setVar("MYTHOS_AUTOFIX_MODE", "live");
  if (ok) {
    console.log("shadow-mode: flipped MYTHOS_AUTOFIX_MODE → live");
    return { flipped: true };
  }
  console.warn("shadow-mode: could not flip to live (no vars:write?)");
  return { flipped: false };
}

export function appendShadowLog(line, path = "out/shadow-log.md") {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(
      path,
      `# Mythos autofix shadow log\n\nCreed: cut waste, don't weaken quality.\n\n`,
      "utf8",
    );
  }
  const ts = new Date().toISOString();
  appendFileSync(path, `- **${ts}** ${line}\n`, "utf8");
}

function cli() {
  const cmd = process.argv[2] || "resolve";
  if (cmd === "ensure-window") {
    const r = ensureShadowWindow({ writeVars: true });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (cmd === "flip-if-due") {
    const resolved = resolveAutofixMode();
    const flip = maybeFlipToLive(resolved);
    console.log(JSON.stringify({ ...resolved, ...flip }, null, 2));
    return;
  }
  const resolved = resolveAutofixMode();
  console.log(
    JSON.stringify(
      {
        ...resolved,
        breakerActive: breakerActive(),
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("shadow-mode.mjs")) {
  cli();
}
