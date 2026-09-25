#!/usr/bin/env node
/**
 * Loud weekly digest + zero-intervention side effects after mythos-token-audit.
 * Creed: cut waste, don't weaken quality.
 *
 * Env:
 *   GITHUB_REPOSITORY, GH_TOKEN (required)
 *   MYTHOS_BOT_TOKEN (optional — vars write / stronger pin)
 *   TRACKING_ISSUE_VAR — current vars.MYTHOS_TOKEN_AUDIT_ISSUE (may be empty)
 *   AUDIT_FAILED — "1" if FAILED stub was written
 *   RUN_URL, RUN_ID, DAY (America/Denver date)
 *   GATE_AVG_PREV — vars.MYTHOS_GATE_AVG_PREV
 *   LAST_STATUS — vars.MYTHOS_TOKEN_AUDIT_LAST_STATUS
 *   DRAFT_WAKES — vars.MYTHOS_DRAFT_PUSH_WAKES
 *   DRAFT_WAKES_UNTIL — vars.MYTHOS_DRAFT_PUSH_WAKES_UNTIL
 *   TIP_FREEZE_EMERGENCY_MINUTES — vars.MYTHOS_TIP_FREEZE_EMERGENCY_MINUTES
 *
 * Reads out/SUMMARY.md + out/METRICS.json (optional).
 * Exits 1 when AUDIT_FAILED=1 (after loud notify) so Actions shows a red X.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const CREED = "Creed: cut waste, don't weaken quality.";
const TRACKING_TITLE = "Mythos token audit — weekly";
const TRACKING_LABEL = "mythos-token-audit";
const AUDIT_DOWN_LABEL = "audit-down";
const OWNER_MENTION = "@SkyyPlayz";
const WAKE_PROXY_THRESHOLD = 40; // lookback proxy; see ZERO_INTERVENTION doc
const GATE_AVG_THROTTLE = 1.5;

function die(msg, code = 1) {
  console.error(`loud-digest: ${msg}`);
  process.exit(code);
}

function gh(args, { token, soft = false, input } = {}) {
  const env = { ...process.env };
  if (token) env.GH_TOKEN = token;
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env,
    input,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim() || `exit ${r.status}`;
    if (soft) {
      console.warn(`loud-digest: soft fail gh ${args.join(" ")}: ${err}`);
      return null;
    }
    die(`gh ${args.join(" ")} failed: ${err}`);
  }
  return (r.stdout || "").trim();
}

function ghJson(args, opts = {}) {
  const text = gh(args, opts);
  if (text === null || text === "") return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    if (opts.soft) return null;
    die(`JSON parse: ${e.message}`);
  }
}

function setVar(name, value, botToken) {
  if (!botToken) {
    console.warn(`loud-digest: skip set var ${name} (no MYTHOS_BOT_TOKEN)`);
    return false;
  }
  const ok = gh(
    ["variable", "set", name, "--body", String(value), "--repo", process.env.GITHUB_REPOSITORY],
    { token: botToken, soft: true },
  );
  if (ok === null) {
    console.warn(`loud-digest: could not set ${name}`);
    return false;
  }
  console.log(`set var ${name}=${value}`);
  return true;
}

function ensureLabel(repo, name, color, token) {
  gh(
    ["label", "create", name, "--repo", repo, "--color", color, "--force"],
    { token, soft: true },
  );
}

function ensureTrackingIssue(repo, existingNum, token) {
  if (existingNum && String(existingNum).trim()) {
    const n = String(existingNum).trim().replace(/^#/, "");
    const issue = ghJson(
      ["issue", "view", n, "--repo", repo, "--json", "number,state,title"],
      { token, soft: true },
    );
    if (issue?.number) return issue;
  }

  // Find by title + label
  const found = ghJson(
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "all",
      "--label",
      TRACKING_LABEL,
      "--limit",
      "20",
      "--json",
      "number,title,state",
    ],
    { token, soft: true },
  );
  const hit = Array.isArray(found)
    ? found.find((i) => i.title === TRACKING_TITLE)
    : null;
  if (hit) return hit;

  ensureLabel(repo, TRACKING_LABEL, "0E8A16", token);
  const created = gh(
    [
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      TRACKING_TITLE,
      "--label",
      TRACKING_LABEL,
      "--body",
      [
        "<!-- mythos-token-audit-tracking -->",
        "# Mythos token audit — weekly tracking",
        "",
        "Loud digest home for Wed Actions runs (success **or** fail).",
        "Pinned preferred (UI or GraphQL). See `docs/TOKEN_AUDIT_LOUD_DIGEST.md`.",
        "",
        CREED,
      ].join("\n"),
    ],
    { token },
  );
  // gh issue create prints URL
  const m = /\/issues\/(\d+)/.exec(created || "");
  if (!m) die(`could not parse created issue from: ${created}`);
  console.log(`created tracking issue #${m[1]} — set vars.MYTHOS_TOKEN_AUDIT_ISSUE=${m[1]} (bot may set below)`);
  return { number: Number(m[1]), state: "OPEN", title: TRACKING_TITLE };
}

function tryPinIssue(repoFull, issueNumber, token) {
  const [owner, name] = repoFull.split("/");
  // Resolve node id
  const node = ghJson(
    [
      "api",
      "graphql",
      "-f",
      `query=query { repository(owner:"${owner}", name:"${name}") { issue(number:${issueNumber}) { id } } }`,
    ],
    { token, soft: true },
  );
  const id = node?.data?.repository?.issue?.id;
  if (!id) {
    console.warn("loud-digest: pin skipped (no issue node id) — pin once in UI");
    return false;
  }
  const res = gh(
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { pinIssue(input:{issueId:"${id}"}) { issue { number } } }`,
    ],
    { token, soft: true },
  );
  if (res === null) {
    console.warn("loud-digest: pinIssue failed (token may lack permission) — pin once in UI");
    return false;
  }
  console.log(`pinned issue #${issueNumber}`);
  return true;
}

function alreadyNotifiedToday(repo, issueNumber, day, token) {
  const marker = `<!-- mythos-token-audit-notify:${day} -->`;
  const comments = ghJson(
    [
      "api",
      `repos/${repo}/issues/${issueNumber}/comments?per_page=30`,
      "--jq",
      "[.[].body]",
    ],
    { token, soft: true },
  );
  if (!Array.isArray(comments)) return false;
  return comments.some((b) => typeof b === "string" && b.includes(marker));
}

function reopenIfClosed(repo, issue, token) {
  if (String(issue.state).toUpperCase() === "CLOSED" || issue.state === "closed") {
    gh(["issue", "reopen", String(issue.number), "--repo", repo], { token, soft: true });
    console.log(`reopened #${issue.number}`);
  }
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) die("GITHUB_REPOSITORY required");
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) die("GH_TOKEN required");
  const botToken = process.env.MYTHOS_BOT_TOKEN || "";
  const day = process.env.DAY || new Date().toISOString().slice(0, 10);
  const runUrl = process.env.RUN_URL || "";
  const failed = process.env.AUDIT_FAILED === "1";
  const summaryPath = "out/SUMMARY.md";
  const metricsPath = "out/METRICS.json";

  if (!existsSync(summaryPath)) die("missing out/SUMMARY.md");
  const summary = readFileSync(summaryPath, "utf8").trim();
  let metrics = {};
  if (existsSync(metricsPath)) {
    try {
      metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
    } catch {
      metrics = {};
    }
  }

  const issue = ensureTrackingIssue(
    repo,
    process.env.TRACKING_ISSUE_VAR || "",
    token,
  );
  setVar("MYTHOS_TOKEN_AUDIT_ISSUE", String(issue.number), botToken);
  reopenIfClosed(repo, issue, token);
  tryPinIssue(repo, issue.number, botToken || token);

  // Update issue body with latest summary (loud home surface).
  const body = [
    "<!-- mythos-token-audit-tracking -->",
    `# Mythos token audit — weekly tracking`,
    "",
    `Last run: **${day}** · ${failed ? "**FAILED stub**" : "ok"}`,
    runUrl ? `Actions: ${runUrl}` : "",
    "",
    summary,
    "",
    CREED,
  ]
    .filter(Boolean)
    .join("\n");
  gh(
    ["issue", "edit", String(issue.number), "--repo", repo, "--body", body],
    { token, soft: true },
  );

  // One @SkyyPlayz comment per Denver day (dedupe).
  if (!alreadyNotifiedToday(repo, issue.number, day, token)) {
    const notify = [
      `<!-- mythos-token-audit-notify:${day} -->`,
      `<!-- mythos-token-audit -->`,
      `${OWNER_MENTION} — weekly Mythos token audit (${day}) ${failed ? "**FAILED**" : "complete"}.`,
      "",
      summary,
      runUrl ? `\nRun: ${runUrl}` : "",
      "",
      "_Loud digest: tracking issue reopen + Actions red X on stub. Zero daily reading habit required._",
    ].join("\n");
    gh(
      ["issue", "comment", String(issue.number), "--repo", repo, "--body", notify],
      { token },
    );
    console.log(`notified ${OWNER_MENTION} on #${issue.number}`);
  } else {
    console.log(`notify deduped for ${day}`);
  }

  // --- Self-healing audit-down (two consecutive FAILED) ---
  const lastStatus = (process.env.LAST_STATUS || "").toLowerCase();
  if (failed && (lastStatus === "failed" || lastStatus === "failure")) {
    ensureLabel(repo, AUDIT_DOWN_LABEL, "B60205", token);
    const downBody = [
      "<!-- mythos-audit-down -->",
      `${OWNER_MENTION} — **audit-down**: FAILED stub two consecutive Wednesdays.`,
      "",
      `Latest run: ${runUrl || "(no url)"}`,
      "",
      "Self-healing silence fix — see `docs/ops/ZERO_INTERVENTION_SILENCE_FIXES.md`.",
      CREED,
    ].join("\n");
    // Reuse open audit-down issue if present
    const existing = ghJson(
      [
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--label",
        AUDIT_DOWN_LABEL,
        "--limit",
        "5",
        "--json",
        "number,title",
      ],
      { token, soft: true },
    );
    if (Array.isArray(existing) && existing.length > 0) {
      gh(
        ["issue", "comment", String(existing[0].number), "--repo", repo, "--body", downBody],
        { token, soft: true },
      );
      console.log(`audit-down comment on #${existing[0].number}`);
    } else {
      gh(
        [
          "issue",
          "create",
          "--repo",
          repo,
          "--title",
          "Mythos token audit DOWN (consecutive FAILED stubs)",
          "--label",
          AUDIT_DOWN_LABEL,
          "--body",
          downBody,
        ],
        { token, soft: true },
      );
      console.log("opened audit-down issue");
    }
  }
  setVar("MYTHOS_TOKEN_AUDIT_LAST_STATUS", failed ? "failed" : "ok", botToken);

  // --- Trend throttle tip-freeze soft cap ---
  const gateAvg =
    typeof metrics.gate_avg === "number"
      ? metrics.gate_avg
      : Number(metrics.gate_avg);
  const prevAvg = Number(process.env.GATE_AVG_PREV || "");
  if (Number.isFinite(gateAvg)) {
    writeFileSync(
      "out/GATE_AVG.txt",
      String(gateAvg),
      "utf8",
    );
    if (
      Number.isFinite(prevAvg) &&
      prevAvg > GATE_AVG_THROTTLE &&
      gateAvg > GATE_AVG_THROTTLE
    ) {
      setVar("MYTHOS_TIP_FREEZE_EMERGENCY_MINUTES", "10", botToken);
      console.log(
        `tip-freeze throttle: gate_avg ${gateAvg} (prev ${prevAvg}) > ${GATE_AVG_THROTTLE} → emergency=10m`,
      );
      gh(
        [
          "issue",
          "comment",
          String(issue.number),
          "--repo",
          repo,
          "--body",
          [
            "<!-- mythos-tip-freeze-throttle -->",
            `${OWNER_MENTION} — gate_avg ${gateAvg.toFixed(2)} (prev ${prevAvg.toFixed(2)}) > ${GATE_AVG_THROTTLE} for two audits.`,
            "Set `MYTHOS_TIP_FREEZE_EMERGENCY_MINUTES=10`. Forge/agents must read this var (`docs/FORGE_TIP_FREEZE.md`).",
          ].join("\n"),
        ],
        { token, soft: true },
      );
    } else if (Number.isFinite(gateAvg) && gateAvg <= 1.0) {
      // Heal throttle back toward default when healthy (best-effort).
      const cur = process.env.TIP_FREEZE_EMERGENCY_MINUTES;
      if (cur && cur !== "20") {
        setVar("MYTHOS_TIP_FREEZE_EMERGENCY_MINUTES", "20", botToken);
        console.log("tip-freeze throttle healed → 20m");
      }
    }
    setVar("MYTHOS_GATE_AVG_PREV", String(gateAvg), botToken);
  }

  // --- Duplicate-wake circuit breaker ---
  const wakeProxy = Number(metrics.duplicate_forge_wakes_proxy || 0);
  const until = process.env.DRAFT_WAKES_UNTIL || "";
  const now = Date.now();
  if (until && Number(until) > now && process.env.DRAFT_WAKES === "off") {
    console.log(`wake breaker already off until ${new Date(Number(until)).toISOString()}`);
  } else if (wakeProxy > WAKE_PROXY_THRESHOLD) {
    const expiry = now + 48 * 60 * 60 * 1000;
    setVar("MYTHOS_DRAFT_PUSH_WAKES", "off", botToken);
    setVar("MYTHOS_DRAFT_PUSH_WAKES_UNTIL", String(expiry), botToken);
    gh(
      [
        "issue",
        "comment",
        String(issue.number),
        "--repo",
        repo,
        "--body",
        [
          "<!-- mythos-draft-wake-breaker -->",
          `${OWNER_MENTION} — duplicate-wake proxy **${wakeProxy}** > ${WAKE_PROXY_THRESHOLD}.`,
          `Set \`MYTHOS_DRAFT_PUSH_WAKES=off\` until ${new Date(expiry).toISOString()} (48h).`,
          "Forge / `mythos-pr-ci-watch` MUST stay SILENT on draft pr-pushed while off — `docs/ops/ZERO_INTERVENTION_SILENCE_FIXES.md`.",
        ].join("\n"),
      ],
      { token, soft: true },
    );
  } else if (until && Number(until) <= now && process.env.DRAFT_WAKES === "off") {
    setVar("MYTHOS_DRAFT_PUSH_WAKES", "on", botToken);
    setVar("MYTHOS_DRAFT_PUSH_WAKES_UNTIL", "", botToken);
    console.log("wake breaker expired → on");
  }

  if (failed) {
    console.error("AUDIT FAILED stub — failing workflow for Actions red X");
    process.exit(1);
  }
  console.log("loud-digest complete (ok)");
}

main();
