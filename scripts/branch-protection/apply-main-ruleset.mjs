#!/usr/bin/env node
/**
 * Idempotent create/update of the Mythos main tip-gate repository ruleset.
 *
 * MANUAL FOLLOW-UP ONLY (Skyy/Ivy after merge). Requires an admin-capable
 * token (gh auth or GH_TOKEN). Never wired into a push/schedule workflow.
 *
 * Usage:
 *   node scripts/branch-protection/apply-main-ruleset.mjs
 *   node scripts/branch-protection/apply-main-ruleset.mjs --dry-run
 *   node scripts/branch-protection/apply-main-ruleset.mjs --repo owner/name
 *
 * Spec: docs/BRANCH_PROTECTION_MAIN.md
 */

import { spawnSync } from "node:child_process";

const RULESET_NAME = "main — Mythos single tip-gate";
const REQUIRED_CHECKS = ["ci", "notes-windows", "screenshot-check"];

function die(msg, code = 1) {
  console.error(`apply-main-ruleset: ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  let dryRun = false;
  let repo = process.env.GITHUB_REPOSITORY || "";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--repo") {
      repo = argv[++i];
      if (!repo) die("missing value for --repo");
    } else {
      die(`unknown arg: ${a}`);
    }
  }
  if (!repo || !repo.includes("/")) {
    die("set GITHUB_REPOSITORY or pass --repo owner/name");
  }
  return { dryRun, repo };
}

function gh(args, { input } = {}) {
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    input,
    env: process.env,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim() || `exit ${r.status}`;
    die(`gh ${args.join(" ")} failed: ${err}`);
  }
  return (r.stdout || "").trim();
}

function ghJson(args) {
  const text = gh(args);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    die(`JSON parse failed: ${e.message}`);
  }
}

function buildPayload() {
  return {
    name: RULESET_NAME,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: ["refs/heads/main"],
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "required_linear_history" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: REQUIRED_CHECKS.map((context) => ({ context })),
        },
      },
    ],
  };
}

function main() {
  const { dryRun, repo } = parseArgs(process.argv);
  const [owner, name] = repo.split("/");
  const payload = buildPayload();

  const list = ghJson([
    "api",
    `repos/${owner}/${name}/rulesets`,
    "--paginate",
  ]);
  const existing = Array.isArray(list)
    ? list.find((r) => r.name === RULESET_NAME)
    : null;

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          action: existing ? "update" : "create",
          ruleset_id: existing?.id ?? null,
          payload,
        },
        null,
        2,
      ),
    );
    return;
  }

  const body = JSON.stringify(payload);
  if (existing?.id) {
    const updated = gh([
      "api",
      "--method",
      "PUT",
      `repos/${owner}/${name}/rulesets/${existing.id}`,
      "--input",
      "-",
    ], { input: body });
    console.log(`updated ruleset id=${existing.id} name="${RULESET_NAME}"`);
    console.log(updated.slice(0, 200));
  } else {
    const created = gh([
      "api",
      "--method",
      "POST",
      `repos/${owner}/${name}/rulesets`,
      "--input",
      "-",
    ], { input: body });
    console.log(`created ruleset name="${RULESET_NAME}"`);
    console.log(created.slice(0, 200));
  }
}

main();
