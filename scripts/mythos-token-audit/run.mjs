#!/usr/bin/env node
/**
 * Cheap Mythos workflow token audit — Node 20 builtins + `gh` CLI only.
 * Creed: cut waste, don't weaken quality.
 *
 * Single-pass: list merged PRs once, then per-PR fetch comments+reviews (+ draft
 * storms separately). Never re-lists the same PR set.
 *
 * Args:
 *   --out <path>              full TOKEN_AUDIT.md
 *   --summary <path>          short SUMMARY.md
 *   --lookback <days>         default 7
 *   --usage-snapshot <json>   optional; never invent dual-pool numbers
 *   --prior-metrics <path>    optional prior out/metrics.json
 *   --retry-tag <string>      optional
 *
 * Writes out/metrics.json beside --out (gate_cycles, full_tip_gates,
 * gate_avg_proxy, draft_e2e_tip_storms, …).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const TRUSTED = new Set(["SkyyPlayz", "SkyHigh-Mythos-Bot"]);
const CREED = "Creed: cut waste, don't weaken quality.";

function die(msg, code = 1) {
  console.error(`mythos-token-audit: ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    out: null,
    summary: null,
    lookback: 7,
    usageSnapshot: "",
    priorMetrics: "",
    retryTag: "",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--out":
        out.out = next();
        break;
      case "--summary":
        out.summary = next();
        break;
      case "--lookback":
        out.lookback = Number(next());
        break;
      case "--usage-snapshot":
        out.usageSnapshot = next();
        break;
      case "--prior-metrics":
        out.priorMetrics = next();
        break;
      case "--retry-tag":
        out.retryTag = next();
        break;
      default:
        die(`unknown arg: ${a}`);
    }
  }
  if (!out.out || !out.summary) die("required: --out and --summary");
  if (!Number.isFinite(out.lookback) || out.lookback < 1) {
    die("--lookback must be a positive number");
  }
  return out;
}

function ghRaw(args, { soft = false } = {}) {
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim() || `gh exited ${r.status}`;
    if (soft) {
      console.warn(`mythos-token-audit: soft fail gh ${args.join(" ")}: ${err}`);
      return null;
    }
    die(`gh ${args.join(" ")} failed: ${err}`);
  }
  return (r.stdout || "").trim();
}

function ghJson(args, opts = {}) {
  const text = ghRaw(args, opts);
  if (text === null || text === "") return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    if (opts.soft) {
      console.warn(`mythos-token-audit: soft JSON parse fail: ${e.message}`);
      return null;
    }
    die(`failed to parse gh JSON: ${e.message}`);
  }
}

function shaInBody(body, headSha) {
  if (!body || !headSha) return false;
  const lower = String(body).toLowerCase();
  const full = headSha.toLowerCase();
  for (let n = Math.min(40, full.length); n >= 7; n--) {
    const p = full.slice(0, n);
    const re = new RegExp(`(^|[^a-f0-9])${p}([^a-f0-9]|$)`, "i");
    if (re.test(lower)) return true;
  }
  return false;
}

function criticApprove(body) {
  return /(?:##\s*)?critic\s*:?\s*approve|critic[\s\S]{0,120}approve/i.test(body || "");
}

function shieldClear(body) {
  return /\bshield\b/i.test(body || "") && /\bclear\b/i.test(body || "");
}

function probePass(body) {
  return /\bprobe\b[\s\S]{0,120}verify\s+pass|verify\s+pass[\s\S]{0,120}\bprobe\b/i.test(
    body || "",
  );
}

function carveOutApprove(body) {
  return /carve[-_\s]?out\s+approve/i.test(body || "");
}

function isGateSignal(body) {
  if (!body) return false;
  return (
    criticApprove(body) ||
    shieldClear(body) ||
    probePass(body) ||
    carveOutApprove(body)
  );
}

function denverDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseUsageSnapshot(raw) {
  if (!raw || !String(raw).trim()) {
    return { dualPoolLine: "dual-pool: no snapshot — skip", snapshot: null };
  }
  try {
    const j = JSON.parse(raw);
    const c = j.cursor_models_pct;
    const o = j.other_models_pct;
    if (typeof c === "number" && typeof o === "number") {
      return {
        dualPoolLine: `dual-pool: Cursor Models ${c}% / other ${o}% (from snapshot)`,
        snapshot: { cursor_models_pct: c, other_models_pct: o },
      };
    }
    return {
      dualPoolLine:
        "dual-pool: snapshot present but missing cursor_models_pct/other_models_pct — skip",
      snapshot: null,
    };
  } catch {
    return {
      dualPoolLine: "dual-pool: snapshot not valid JSON — skip",
      snapshot: null,
    };
  }
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function loadPriorMetrics(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.warn(`mythos-token-audit: could not parse prior metrics at ${path}`);
    return null;
  }
}

/**
 * Single-pass over merged PRs: for each PR fetch comments + reviews once,
 * accumulate tip-bound gate signals. No second list of the same PRs.
 */
function scanMergedOnce(owner, repo, mergedPrs) {
  /** @type {Map<string, { pr: number, signals: Set<string> }>} */
  const tips = new Map();

  for (const pr of mergedPrs) {
    const number = pr.number;
    const mergeSha =
      (pr.mergeCommit && pr.mergeCommit.oid) || pr.mergeCommitOid || null;
    const headSha = pr.headRefOid || mergeSha;
    if (!headSha) continue;

    // One comments page + one reviews page per PR (paginate only if needed).
    const comments =
      ghJson(
        ["api", `repos/${owner}/${repo}/issues/${number}/comments`, "--paginate"],
        { soft: true },
      ) || [];
    const reviews =
      ghJson(
        ["api", `repos/${owner}/${repo}/pulls/${number}/reviews`, "--paginate"],
        { soft: true },
      ) || [];

    const bodies = [];
    for (const c of comments) {
      if (!TRUSTED.has(c.user?.login)) continue;
      bodies.push(c.body || "");
    }
    for (const r of reviews) {
      if (!TRUSTED.has(r.user?.login)) continue;
      bodies.push(r.body || "");
    }

    for (const body of bodies) {
      if (!isGateSignal(body)) continue;
      const bound =
        shaInBody(body, headSha) || (mergeSha && shaInBody(body, mergeSha));
      if (!bound) continue;

      const key = headSha.slice(0, 40);
      if (!tips.has(key)) tips.set(key, { pr: number, signals: new Set() });
      const entry = tips.get(key);
      if (criticApprove(body)) entry.signals.add("critic");
      if (shieldClear(body)) entry.signals.add("shield");
      if (probePass(body)) entry.signals.add("probe");
      if (carveOutApprove(body)) entry.signals.add("carve-out");
    }
  }

  return tips;
}

/** Draft storms: list drafts once; per draft fetch pull meta + optional checks. */
function scanDraftsOnce(owner, repo, sinceIso) {
  const drafts =
    ghJson([
      "pr",
      "list",
      "--repo",
      `${owner}/${repo}`,
      "--state",
      "open",
      "--draft",
      "--limit",
      "50",
      "--json",
      "number,updatedAt,headRefOid,url,title",
    ]) || [];

  let tipStorms = 0;
  let syncEventsProxy = 0;
  let ciFixDrip = 0;
  /** @type {Array<{ number: number, pushes: number, reason: string }>} */
  const drainRows = [];

  for (const pr of drafts) {
    if (pr.updatedAt && pr.updatedAt < sinceIso) continue;

    const pull = ghJson(
      [
        "api",
        `repos/${owner}/${repo}/pulls/${pr.number}`,
        "--jq",
        "{commits:.commits,updated_at:.updated_at}",
      ],
      { soft: true },
    );
    const pushCount = Number(pull?.commits) || 0;
    if (pushCount > 1) syncEventsProxy += pushCount - 1;

    let recentPushCount = pushCount;
    if (pushCount >= 3) {
      const commits = ghJson(
        [
          "api",
          `repos/${owner}/${repo}/pulls/${pr.number}/commits?per_page=100`,
          "--jq",
          "[.[] | {date: .commit.committer.date}]",
        ],
        { soft: true },
      );
      if (Array.isArray(commits) && commits.length > 0) {
        const recent = commits.filter((c) => c.date && c.date >= sinceIso);
        if (recent.length > 0) recentPushCount = recent.length;
      }
    }

    let e2eFail = false;
    if (pr.headRefOid) {
      const checks = ghJson(
        [
          "api",
          `repos/${owner}/${repo}/commits/${pr.headRefOid}/check-runs?per_page=100`,
          "--jq",
          '[.check_runs[]? | select(.conclusion=="failure") | {name, title: .output.title}]',
        ],
        { soft: true },
      );
      if (Array.isArray(checks)) {
        e2eFail = checks.some((c) => {
          const blob = `${c.name || ""} ${c.title || ""}`.toLowerCase();
          return /\be2e\b|playwright|end-to-end/.test(blob);
        });
      }
    }

    if (recentPushCount >= 3 && e2eFail) {
      tipStorms += 1;
      const drip = Math.max(0, recentPushCount - 1);
      ciFixDrip += drip;
      drainRows.push({
        number: pr.number,
        pushes: recentPushCount,
        reason: `draft e2e tip-storm (+${drip} drip tips)`,
      });
    } else if (recentPushCount >= 5) {
      drainRows.push({
        number: pr.number,
        pushes: recentPushCount,
        reason: "high draft push volume (no e2e-fail signal)",
      });
    }
  }

  return { tipStorms, syncEventsProxy, ciFixDrip, drainRows };
}

function tipWindowInstruction(currentAvg, priorAvg) {
  const cur = Number(currentAvg);
  const prior = priorAvg == null ? null : Number(priorAvg);
  if (!Number.isFinite(cur)) return "";
  if (Number.isFinite(prior) && prior > 1.5 && cur > 1.5) {
    return [
      "**Soft OK tip window:** CURRENT and PRIOR `gate_avg_proxy` both **> 1.5**.",
      "Set repo var `MYTHOS_TIP_FIX_WINDOW_MINUTES=10` (idempotent if already 10).",
      "Requires vars:write (`MYTHOS_BOT_TOKEN` / admin). If unsettable from Actions, Ivy sets it in UI.",
      "Forge/agents MUST read this var for the tip-freeze emergency single-fix window.",
    ].join(" ");
  }
  if (
    Number.isFinite(cur) &&
    cur <= 1.5 &&
    (prior == null || !Number.isFinite(prior) || prior <= 1.5)
  ) {
    return [
      "**Soft OK tip window:** CURRENT (and PRIOR if present) `gate_avg_proxy` **≤ 1.5**.",
      "Revert/keep repo var `MYTHOS_TIP_FIX_WINDOW_MINUTES=20` (default).",
    ].join(" ");
  }
  if (Number.isFinite(cur) && cur <= 1.5 && Number.isFinite(prior) && prior > 1.5) {
    return [
      "**Soft OK tip window:** CURRENT ≤ 1.5 after PRIOR > 1.5 — instruct revert to",
      "`MYTHOS_TIP_FIX_WINDOW_MINUTES=20`.",
    ].join(" ");
  }
  return `**Soft OK tip window:** CURRENT gate_avg_proxy=${cur}${
    prior != null && Number.isFinite(prior) ? ` PRIOR=${prior}` : " (no prior)"
  } — no two-audit throttle yet.`;
}

function main() {
  const args = parseArgs(process.argv);
  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!repoFull || !repoFull.includes("/")) {
    die("GITHUB_REPOSITORY must be set to owner/repo");
  }
  const [owner, repo] = repoFull.split("/");

  const repoMeta = ghJson([
    "api",
    `repos/${owner}/${repo}`,
    "--jq",
    "{full_name:.full_name,default_branch:.default_branch}",
  ]);
  if (!repoMeta?.full_name) die("gh auth check failed (cannot read repository)");

  const sinceIso = isoDaysAgo(args.lookback);
  const day = denverDay();
  const prior = loadPriorMetrics(args.priorMetrics);

  // --- Single list of merged PRs in lookback ---
  const merged =
    ghJson([
      "pr",
      "list",
      "--repo",
      repoFull,
      "--state",
      "merged",
      "--limit",
      "50",
      "--search",
      `merged:>=${sinceIso.slice(0, 10)}`,
      "--json",
      "number,mergedAt,mergeCommit,headRefOid,title,url",
    ]) || [];

  const gateTips = scanMergedOnce(owner, repo, merged);
  const fullGateTips = [...gateTips.values()].filter(
    (t) =>
      t.signals.has("critic") &&
      t.signals.has("shield") &&
      t.signals.has("probe"),
  ).length;
  const carveTips = [...gateTips.values()].filter((t) =>
    t.signals.has("carve-out"),
  ).length;

  const drafts = scanDraftsOnce(owner, repo, sinceIso);
  const usage = parseUsageSnapshot(args.usageSnapshot);

  const gateCycles = gateTips.size;
  const mergedCount = merged.length;
  // Prefer full tip-gates / merges; fall back to distinct tips / merges.
  const denom = Math.max(mergedCount, 1);
  const gateAvgProxy = Number(
    ((fullGateTips > 0 ? fullGateTips : gateCycles) / denom).toFixed(3),
  );

  const priorAvg =
    prior &&
    (prior.gate_avg_proxy != null
      ? Number(prior.gate_avg_proxy)
      : prior.gate_avg != null
        ? Number(prior.gate_avg)
        : null);

  const metrics = {
    day,
    lookback_days: args.lookback,
    gate_cycles: gateCycles,
    full_tip_gates: fullGateTips,
    carve_out_approves: carveTips,
    merged_prs: mergedCount,
    gate_avg_proxy: gateAvgProxy,
    draft_e2e_tip_storms: drafts.tipStorms,
    duplicate_forge_wakes_proxy: drafts.syncEventsProxy,
    ci_fix_drip_tips: drafts.ciFixDrip,
    prior_gate_avg_proxy:
      priorAvg != null && Number.isFinite(priorAvg) ? priorAvg : null,
  };

  const tipWindow = tipWindowInstruction(gateAvgProxy, priorAvg);
  const topDrains = drafts.drainRows
    .sort((a, b) => b.pushes - a.pushes)
    .slice(0, 8);
  const retryNote = args.retryTag ? `\n_Retry tag: ${args.retryTag}_\n` : "";
  const priorLine =
    priorAvg != null && Number.isFinite(priorAvg)
      ? `Prior gate_avg_proxy (cached): **${priorAvg}**`
      : "Prior gate_avg_proxy: _none_ (first run or no artifact)";

  const full = `# Mythos workflow token audit — ${day}

<!-- mythos-token-audit -->
Lookback: **${args.lookback}** days (since \`${sinceIso.slice(0, 10)}\`) · repo \`${repoFull}\`
${retryNote}
${priorLine}

## Gate table

| Metric | Count |
| --- | ---: |
| Distinct tip SHAs with trusted gate signals | ${metrics.gate_cycles} |
| Tips with full Critic+Shield+Probe | ${metrics.full_tip_gates} |
| Tips with CARVE-OUT APPROVE | ${metrics.carve_out_approves} |
| Merged PRs scanned | ${metrics.merged_prs} |
| gate_avg_proxy | ${metrics.gate_avg_proxy} |

Trusted authors: \`SkyyPlayz\`, \`SkyHigh-Mythos-Bot\`.

## Burn categories

| Category | Count | Notes |
| --- | ---: | --- |
| Gate cycles | ${metrics.gate_cycles} | Distinct tip SHAs with tip-bound trusted signals |
| Draft e2e tip-storms | ${metrics.draft_e2e_tip_storms} | Drafts with ≥3 head pushes + e2e-ish CI fail |
| Duplicate Forge wakes (proxy) | ${metrics.duplicate_forge_wakes_proxy} | Extra draft pushes; agent wakes N/A in Actions |
| CI-fix drip | ${metrics.ci_fix_drip_tips} | Tips beyond first in red e2e streak |

## Soft OK tip window

${tipWindow}

## Dual-pool

${usage.dualPoolLine}

## Top drains

${
  topDrains.length === 0
    ? "_None flagged in lookback._"
    : topDrains
        .map(
          (d) =>
            `- PR #${d.number}: ${d.pushes} recent commits/pushes — ${d.reason}`,
        )
        .join("\n")
}

## Notes

- Single-pass fetch: merged list once, then per-PR comments/reviews; drafts listed once.
- Never invents dual-pool percentages.
- Tip-fix window var: \`MYTHOS_TIP_FIX_WINDOW_MINUTES\` (default 20).
- ${CREED}
`;

  const summary = `## Mythos token audit (${day})
<!-- mythos-token-audit -->
Lookback ${args.lookback}d · gate tips **${metrics.gate_cycles}** (full CSP ${metrics.full_tip_gates}) · gate_avg_proxy **${metrics.gate_avg_proxy}** (prior ${
    priorAvg != null && Number.isFinite(priorAvg) ? priorAvg : "n/a"
  }) · tip-storms **${metrics.draft_e2e_tip_storms}** · wake proxy **${metrics.duplicate_forge_wakes_proxy}** · drip **${metrics.ci_fix_drip_tips}**
${priorLine}
${tipWindow}
${usage.dualPoolLine}
${args.retryTag ? `Retry: ${args.retryTag}` : ""}
${CREED}
`;

  const outDir = dirname(args.out);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dirname(args.summary), { recursive: true });
  writeFileSync(args.out, full, "utf8");
  writeFileSync(args.summary, summary.trim() + "\n", "utf8");
  const metricsPath = join(outDir, "metrics.json");
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 2) + "\n", "utf8");
  // Compat alias for older loud-digest readers
  writeFileSync(join(outDir, "METRICS.json"), JSON.stringify(metrics, null, 2) + "\n", "utf8");
  console.log(`wrote ${args.out}, ${args.summary}, ${metricsPath}`);
}

main();
