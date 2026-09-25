# Main branch protection — Mythos single tip-gate

Canonical **repository ruleset** for `main`. GitHub rulesets are not fully
file-native; this doc is the source of truth. Apply with the helper script
(admin PAT) or match these settings in the GitHub UI.

**Do not** auto-apply from Actions on every push — too dangerous. After merge,
Skyy/Ivy apply once manually.

Related: [MERGE_GATE.md](./MERGE_GATE.md) (tip-SHA Critic / Shield / Probe gate).

## Creed

Cut waste, don't weaken quality. Maps the old ~1.3 gate tax to a **≤1.0 tip-gate**:
strict required checks + tip-SHA Mythos signals are the one gate. Do **not**
require 2 GitHub approvals or Critic/Shield/Probe as separate required status
checks (those stay tip-bound comments/reviews, not Actions check names).

## Ruleset

| Field | Value |
| --- | --- |
| **Name** | `main — Mythos single tip-gate` |
| **Target** | Branch `main` (`refs/heads/main`) |
| **Enforcement** | Active |
| **Bypass actors** | Empty (enforce for admins; no admin bypass) |
| **Block force pushes** | Yes (`non_fast_forward`) |
| **Block deletions** | Yes (`deletion`) |
| **Require linear history** | Yes (`required_linear_history`) recommended / true |
| **Require a pull request** | Yes |
| **Required approving reviews** | **0** (no GH approval theater) |
| **Require code owner reviews** | No |
| **Require conversation resolution** | Yes |
| **Dismiss stale reviews on push** | false (tip-SHA gate owns freshness) |
| **Require last push approval** | false |
| **Required status checks (strict / up-to-date)** | `ci`, `notes-windows`, `screenshot-check` |

### Explicitly out of scope for this ruleset

- Critic APPROVE / Shield CLEAR / Probe VERIFY PASS as **required check contexts**
  — those are tip-SHA comment/review signals enforced by
  [`mythos-gate-auto-merge.yml`](../.github/workflows/mythos-gate-auto-merge.yml),
  not branch-protection check names.
- Requiring ≥1 or ≥2 GitHub PR approvals — that was double-gate theater; tip-SHA
  gate remains the quality bar.
- Auto-merge policy — unchanged; see MERGE_GATE.md.

## Apply (manual follow-up)

Requires a token with admin rights on the repo (`admin:repo` / rulesets write).

```bash
# From repo root, with GH_TOKEN / gh auth as an admin:
node scripts/branch-protection/apply-main-ruleset.mjs
# dry-run:
node scripts/branch-protection/apply-main-ruleset.mjs --dry-run
```

The script is **idempotent**: it finds an existing ruleset by name and updates
it, or creates one. It never runs from the token-audit workflow.

## Why this shape

1. **Strict checks** keep CI quality (`ci` + Windows notes + screenshot).
2. **0 GH approvals** removes rubber-stamp approval cycles that burned tokens
   without adding signal beyond Critic/Shield/Probe.
3. **Empty bypass** stops force-push / admin shortcuts around the tip gate.
4. **Linear history** keeps `main` readable for audits and bisects.

Strict “branches must be up to date” pairs with
[`.github/workflows/auto-rebase-main.yml`](../.github/workflows/auto-rebase-main.yml)
(hourly + on `main` push) so open PRs stay current without human rebase tax.
PRs labeled `tip-freeze` or `do-not-rebase` are skipped so rebase cannot fight
mid-gate tip-freeze — see [FORGE_TIP_FREEZE.md](./FORGE_TIP_FREEZE.md).
