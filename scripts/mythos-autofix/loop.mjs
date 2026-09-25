#!/usr/bin/env node
/**
 * Audit-driven self-improvement loop (allow-listed ops params only).
 * Creed: cut waste, don't weaken quality.
 *
 * Never touches Critic/Shield/Probe, plan gate, tip-SHA quality locks,
 * auto-close drafts, lookback <7, or Other Models ban.
 *
 * @see docs/MYTHOS_AUTOFIX.md (Loop section)
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** @typedef {{ param: string, from: string|number, to: string|number, reason: string }} Candidate */

export const ALLOW_LIST = {
  MYTHOS_TIP_FIX_WINDOW_MINUTES: {
    values: [10, 15, 20, 30],
    default: 20,
    target: "ci_fix_drip_tips",
    direction: "down",
  },
  MYTHOS_CI_FIX_BATCH_MAX: {
    values: [1, 2, 3],
    default: 1,
    target: "ci_fix_drip_tips",
    direction: "down",
  },
  MYTHOS_CIRCUIT_BREAKER_TIP_STORM_THRESHOLD: {
    values: [2, 3, 4, 5],
    default: 3,
    target: "duplicate_forge_wakes_proxy",
    direction: "down",
  },
  MYTHOS_AUDIT_RETRY_COUNT: {
    values: [1, 2],
    default: 1,
    target: "failed_stub_proxy",
    direction: "down",
  },
  // Hygiene cron hours: only propose when MYTHOS_HYGIENE_REBASE_CRON_READS_VAR=1
  MYTHOS_HYGIENE_REBASE_CRON_HOURS: {
    values: [1, 2, 3],
    default: 1,
    target: "behind_prs_proxy",
    direction: "down",
    optional: true,
  },
};

function num(m, key, fallback = 0) {
  const v = m?.[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function qualityRegression(baseline, current) {
  if (!baseline || !current) return { regress: false, reasons: [] };
  const reasons = [];
  const baseGate = num(baseline, "gate_avg_proxy");
  const curGate = num(current, "gate_avg_proxy");
  if (curGate > baseGate + 0.05) {
    reasons.push(
      `gate_avg_proxy up ${baseGate} → ${curGate} (CSP re-gate tax)`,
    );
  }
  const baseStorm = num(baseline, "draft_e2e_tip_storms");
  const curStorm = num(current, "draft_e2e_tip_storms");
  const baseDrip = num(baseline, "ci_fix_drip_tips");
  const curDrip = num(current, "ci_fix_drip_tips");
  if (curStorm > baseStorm && !(curDrip < baseDrip)) {
    reasons.push(
      `tip-storms up ${baseStorm} → ${curStorm} without drip drop (${baseDrip} → ${curDrip})`,
    );
  }
  return { regress: reasons.length > 0, reasons };
}

function targetImproved(spec, baseline, current) {
  const key = spec.target;
  // Proxies not always in metrics — treat missing as no signal (not improved)
  if (key === "failed_stub_proxy") {
    const b = baseline?.rate_limited || baseline?.failed_stub ? 1 : 0;
    const c = current?.rate_limited || current?.failed_stub ? 1 : 0;
    return c < b;
  }
  if (key === "behind_prs_proxy") {
    // Not measured yet — never auto-APPLY hygiene hours without signal
    return false;
  }
  const b = num(baseline, key);
  const c = num(current, key);
  if (spec.direction === "down") return c < b;
  return c > b;
}

function metricDelta(spec, baseline, current) {
  const key =
    spec.target === "failed_stub_proxy"
      ? "rate_limited"
      : spec.target === "behind_prs_proxy"
        ? "behind_prs_proxy"
        : spec.target;
  if (key === "rate_limited") {
    const b = baseline?.rate_limited || baseline?.failed_stub ? 1 : 0;
    const c = current?.rate_limited || current?.failed_stub ? 1 : 0;
    return `${b} → ${c} (fail/rate-limit proxy)`;
  }
  return `${num(baseline, key)} → ${num(current, key)} (${key})`;
}

function currentParamValue(param, env, loopState) {
  const spec = ALLOW_LIST[param];
  const raw =
    env[param] ||
    env[`VAR_${param}`] ||
    (loopState?.applied && loopState.applied.param === param
      ? String(loopState.applied.to)
      : "");
  if (raw !== "" && raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n) && spec.values.includes(n)) return n;
    if (spec.values.map(String).includes(String(raw))) return raw;
  }
  return spec.default;
}

function pickNeighbor(values, current, preferDown) {
  const idx = values.indexOf(Number(current));
  const i = idx >= 0 ? idx : values.indexOf(Number(current)) >= 0 ? values.indexOf(Number(current)) : values.indexOf(current);
  const pos = values.findIndex((v) => String(v) === String(current));
  if (pos < 0) {
    return preferDown ? values[0] : values[values.length - 1];
  }
  if (preferDown && pos > 0) return values[pos - 1];
  if (!preferDown && pos < values.length - 1) return values[pos + 1];
  // try other direction
  if (pos < values.length - 1) return values[pos + 1];
  if (pos > 0) return values[pos - 1];
  return null;
}

/**
 * Heuristic: propose exactly one allow-listed tweak from current metrics.
 * @returns {Candidate|null}
 */
export function proposeCandidate(metrics, env = process.env, loopState = null) {
  const hygieneReads = env.MYTHOS_HYGIENE_REBASE_CRON_READS_VAR === "1";

  // Priority of pain signals
  const drip = num(metrics, "ci_fix_drip_tips");
  const storms = num(metrics, "draft_e2e_tip_storms");
  const wakes = num(metrics, "duplicate_forge_wakes_proxy");
  const rateLimited = !!(metrics?.rate_limited || metrics?.failed_stub);

  if (rateLimited) {
    const param = "MYTHOS_AUDIT_RETRY_COUNT";
    const from = currentParamValue(param, env, loopState);
    const to = pickNeighbor(ALLOW_LIST[param].values, from, false); // try up to 2
    if (to != null && String(to) !== String(from)) {
      return {
        param,
        from,
        to,
        reason: "rate_limited / fail proxy — try more audit retries",
      };
    }
  }

  if (wakes >= 20 || storms >= 2) {
    const param = "MYTHOS_CIRCUIT_BREAKER_TIP_STORM_THRESHOLD";
    const from = currentParamValue(param, env, loopState);
    const to = pickNeighbor(ALLOW_LIST[param].values, from, true); // lower threshold → breaker sooner
    if (to != null && String(to) !== String(from)) {
      return {
        param,
        from,
        to,
        reason: `wake proxy ${wakes} / tip-storms ${storms} — lower breaker threshold`,
      };
    }
  }

  if (drip >= 5) {
    const param = "MYTHOS_TIP_FIX_WINDOW_MINUTES";
    const from = currentParamValue(param, env, loopState);
    // try 15 or 10 from 20 — mid step first
    const to = pickNeighbor(ALLOW_LIST[param].values, from, true);
    if (to != null && String(to) !== String(from)) {
      return {
        param,
        from,
        to,
        reason: `ci_fix_drip_tips ${drip} — tighten tip-fix window`,
      };
    }
    const param2 = "MYTHOS_CI_FIX_BATCH_MAX";
    const from2 = currentParamValue(param2, env, loopState);
    const to2 = pickNeighbor(ALLOW_LIST[param2].values, from2, true);
    if (to2 != null && String(to2) !== String(from2)) {
      return {
        param: param2,
        from: from2,
        to: to2,
        reason: `ci_fix_drip_tips ${drip} — lower CI-fix batch max`,
      };
    }
  }

  if (hygieneReads) {
    const param = "MYTHOS_HYGIENE_REBASE_CRON_HOURS";
    const from = currentParamValue(param, env, loopState);
    const to = pickNeighbor(ALLOW_LIST[param].values, from, false);
    if (to != null && String(to) !== String(from)) {
      return {
        param,
        from,
        to,
        reason: "hygiene reads var — try denser rebase cadence",
      };
    }
  }

  return null;
}

function assertAllowListed(candidate) {
  if (!candidate?.param || !ALLOW_LIST[candidate.param]) {
    return { ok: false, error: "not allow-listed" };
  }
  const spec = ALLOW_LIST[candidate.param];
  if (spec.optional && process.env.MYTHOS_HYGIENE_REBASE_CRON_READS_VAR !== "1") {
    return { ok: false, error: "optional param not enabled" };
  }
  const allowed = spec.values.map(String);
  if (!allowed.includes(String(candidate.to))) {
    return { ok: false, error: `value ${candidate.to} not in allow-list` };
  }
  return { ok: true };
}

/**
 * Advance loop state machine for one Wed cycle.
 *
 * @returns {{
 *   state: object,
 *   loopSection: string,
 *   liveApply: null|{param:string,value:string|number},
 *   shadowWould: null|{param:string,value:string|number},
 * }}
 */
export function runLoopCycle({
  enabled,
  currentMetrics,
  priorMetrics,
  loopState,
  now = Date.now(),
  env = process.env,
}) {
  const idle = {
    status: "idle",
    candidate: null,
    baseline_metrics: null,
    shadow_until: null,
    last_result: loopState?.last_result || null,
    updated_at: new Date(now).toISOString(),
  };

  if (enabled === false || String(enabled).toLowerCase() === "false") {
    return {
      state: { ...idle, status: "disabled" },
      loopSection:
        "## Loop\n\n`MYTHOS_LOOP_ENABLED=false` — self-improvement loop idle (kill switch).\n",
      liveApply: null,
      shadowWould: null,
    };
  }

  let state = loopState && typeof loopState === "object" ? { ...loopState } : idle;
  let liveApply = null;
  let shadowWould = null;
  let lines = ["## Loop", ""];

  const status = state.status || "idle";
  const untilMs = state.shadow_until ? Date.parse(state.shadow_until) : NaN;
  const shadowElapsed =
    (status === "shadow" || status === "proposed") &&
    Number.isFinite(untilMs) &&
    now >= untilMs;

  if (shadowElapsed && state.candidate) {
    const check = assertAllowListed(state.candidate);
    if (!check.ok) {
      lines.push(`**MISS** — candidate aborted (${check.error}).`);
      state = {
        ...idle,
        last_result: {
          kind: "MISS",
          reason: check.error,
          candidate: state.candidate,
        },
      };
    } else {
      const spec = ALLOW_LIST[state.candidate.param];
      const baseline = state.baseline_metrics || priorMetrics;
      const q = qualityRegression(baseline, currentMetrics);
      const improved = targetImproved(spec, baseline, currentMetrics);
      const delta = metricDelta(spec, baseline, currentMetrics);
      if (improved && !q.regress) {
        liveApply = {
          param: state.candidate.param,
          value: state.candidate.to,
        };
        lines.push(
          `**APPLY** \`${state.candidate.param}\`: ${state.candidate.from} → ${state.candidate.to} (${delta}).`,
        );
        state = {
          status: "applied",
          candidate: null,
          baseline_metrics: null,
          shadow_until: null,
          applied: {
            param: state.candidate.param,
            from: state.candidate.from,
            to: state.candidate.to,
            at: new Date(now).toISOString(),
          },
          last_result: {
            kind: "APPLY",
            param: state.candidate.param,
            from: state.candidate.from,
            to: state.candidate.to,
            delta,
          },
          updated_at: new Date(now).toISOString(),
        };
      } else {
        const why = q.regress
          ? `quality regression: ${q.reasons.join("; ")}`
          : "target metric did not improve";
        lines.push(
          `**MISS** \`${state.candidate.param}\` ${state.candidate.from} → ${state.candidate.to} — ${why} (${delta}). Reverted (never applied / keep prior).`,
        );
        state = {
          ...idle,
          last_result: {
            kind: "MISS",
            param: state.candidate.param,
            from: state.candidate.from,
            to: state.candidate.to,
            reason: why,
            delta,
          },
        };
      }
    }
    // One change per cycle — do not propose a new candidate same Wed after APPLY/MISS
    return {
      state,
      loopSection: lines.join("\n") + "\n",
      liveApply,
      shadowWould: null,
    };
  }

  if (status === "shadow" || status === "proposed") {
    const left =
      Number.isFinite(untilMs) && untilMs > now
        ? Math.ceil((untilMs - now) / (24 * 60 * 60 * 1000))
        : "?";
    lines.push(
      `**Shadowing** \`${state.candidate?.param}\`: ${state.candidate?.from} → ${state.candidate?.to} (${state.candidate?.reason || ""}). Until ${state.shadow_until} (~${left}d). Log-only — not live-applied yet.`,
    );
    shadowWould = state.candidate
      ? { param: state.candidate.param, value: state.candidate.to }
      : null;
    state = { ...state, status: "shadow", updated_at: new Date(now).toISOString() };
    return {
      state,
      loopSection: lines.join("\n") + "\n",
      liveApply: null,
      shadowWould,
    };
  }

  // idle / applied / miss → may propose exactly one new candidate
  const candidate = proposeCandidate(currentMetrics, env, state);
  if (!candidate) {
    lines.push("**Idle** — no allow-listed tweak proposed this cycle.");
    if (state.last_result) {
      lines.push(
        `_Last result: ${state.last_result.kind} ${state.last_result.param || ""} ${state.last_result.reason || state.last_result.delta || ""}_`,
      );
    }
    state = {
      ...idle,
      last_result: state.last_result || null,
      applied: state.applied || null,
    };
    return {
      state,
      loopSection: lines.join("\n") + "\n",
      liveApply: null,
      shadowWould: null,
    };
  }

  const check = assertAllowListed(candidate);
  if (!check.ok) {
    lines.push(`**Idle** — proposal aborted (${check.error}).`);
    return {
      state: idle,
      loopSection: lines.join("\n") + "\n",
      liveApply: null,
      shadowWould: null,
    };
  }

  const shadowUntil = new Date(now + WEEK_MS).toISOString();
  state = {
    status: "shadow",
    candidate,
    baseline_metrics: {
      gate_avg_proxy: num(currentMetrics, "gate_avg_proxy"),
      ci_fix_drip_tips: num(currentMetrics, "ci_fix_drip_tips"),
      draft_e2e_tip_storms: num(currentMetrics, "draft_e2e_tip_storms"),
      duplicate_forge_wakes_proxy: num(
        currentMetrics,
        "duplicate_forge_wakes_proxy",
      ),
      rate_limited: !!currentMetrics?.rate_limited,
      failed_stub: !!currentMetrics?.failed_stub,
      full_tip_gates: num(currentMetrics, "full_tip_gates"),
      merged_prs: num(currentMetrics, "merged_prs"),
    },
    shadow_until: shadowUntil,
    last_result: state.last_result || null,
    updated_at: new Date(now).toISOString(),
  };
  shadowWould = { param: candidate.param, value: candidate.to };
  lines.push(
    `**Proposed** (shadow 1w) \`${candidate.param}\`: ${candidate.from} → ${candidate.to} — ${candidate.reason}.`,
  );
  lines.push(`Shadow until ${shadowUntil}. Will APPLY or MISS next cycle(s) after window.`);

  return {
    state,
    loopSection: lines.join("\n") + "\n",
    liveApply: null,
    shadowWould,
  };
}

export function parseLoopState(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}
