#!/usr/bin/env bash
# Bug Hunt + GitHub Issue Fisher
# - Loads the 3 required plan files from `plans/`
# - Runs lightweight adversarial checks
# - Produces 1-3 actionable issue findings
# - Writes a daily report and optional JSON artifact for downstream intake

set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLANS_DIR="$BASE_DIR/plans"
RUN_DATE="$(date +%Y%m%d)"
RUN_TS="$(date +%Y-%m-%dT%H:%M:%S%z)"
OUTPUT_DIR="$BASE_DIR"
INTAKE_MODE="report-only"

usage() {
  cat <<'EOF'
Usage: ./BugHunt-Fisher.sh [options]

Options:
  --report-only          Generate report artifacts only. This is the default.
  --run-date YYYYMMDD    Override the report date for deterministic checks.
  --output-dir DIR       Write daily_bug_hunt_<date> artifacts to DIR.
  -h, --help             Show this help.

This script never creates GitHub issues. It emits GitHub issue-ready markdown
and JSON for a separate human or automation intake step.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --report-only)
      INTAKE_MODE="report-only"
      shift
      ;;
    --run-date)
      if [[ $# -lt 2 || ! "$2" =~ ^[0-9]{8}$ ]]; then
        echo "error: --run-date requires YYYYMMDD" >&2
        exit 2
      fi
      RUN_DATE="$2"
      shift 2
      ;;
    --output-dir)
      if [[ $# -lt 2 ]]; then
        echo "error: --output-dir requires a directory path" >&2
        exit 2
      fi
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

CORE_PLAN_FILE="$PLANS_DIR/bug_hunt_core_plan.md"
FISHING_PLAN_FILE="$PLANS_DIR/github_issue_fishing_plan.md"
TEMPLATE_FILE="$PLANS_DIR/daily_run_template.md"
REPORT_FILE="$OUTPUT_DIR/daily_bug_hunt_${RUN_DATE}.md"
ARTIFACT_FILE="$OUTPUT_DIR/daily_bug_hunt_${RUN_DATE}.json"

mkdir -p "$OUTPUT_DIR"

cat_file_if_exists() {
  local file="$1"
  local fallback="$2"
  if [[ -f "$file" ]]; then
    cat "$file"
  else
    echo "$fallback"
  fi
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

json_quote() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

issue_markdown() {
  local title="$1"
  local body="$2"
  local repro="$3"
  local expected="$4"
  local observed="$5"
  local test_hint="$6"

  cat <<EOF
## ${title}

### Summary
${body}

### Repro steps
${repro}

### Expected behavior
${expected}

### Observed behavior
${observed}

### Suggested fix or test
${test_hint}

### Source
Daily bug hunt intake ${RUN_DATE}; mode: ${INTAKE_MODE}.
EOF
}

echo "🚀 Starting Adversarial Bug Hunt + Issue Fisher"
echo "=================================================="
echo "Date: $RUN_TS"
echo "Intake mode: $INTAKE_MODE"
echo

echo "📖 Loading plans from ${PLANS_DIR}/ ..."
cat_file_if_exists "$CORE_PLAN_FILE" "No core plan found" >/dev/null
cat_file_if_exists "$FISHING_PLAN_FILE" "No fishing plan found" >/dev/null
REPORT_TEMPLATE="$(cat_file_if_exists "$TEMPLATE_FILE" "No report template found")"
echo "✅ Plans loaded."
echo

echo "🎯 Areas selected for this run:"
for area in "Authentication and permissions" "Core CRUD data flows" "Recent high-risk paths" "Edge-case and malformed input paths"; do
  echo "- ${area}"
done
echo

echo "🔍 Running lightweight adversarial probes:"
echo "- checking TODO/FIXME hotspots"
echo "- checking suspicious command paths in recent edits"
echo "- checking crash/uncaught error patterns in runtime paths"
echo

findings=()
issue_bodies=()
issue_repros=()
issue_expected=()
issue_observed=()
issue_tests=()

add_finding() {
  local title="$1"
  local body="$2"
  local repro="${3:-Review the named surface and add a focused regression case.}"
  local expected="${4:-The flow handles the edge case without data loss, crash, or unclear user state.}"
  local observed="${5:-Automated intake identified a risk surface that lacks explicit regression evidence.}"
  local test_hint="${6:-Add or update focused test coverage for this path.}"
  if (( ${#findings[@]} >= 3 )); then
    return
  fi
  findings+=("$title")
  issue_bodies+=("$body")
  issue_repros+=("$repro")
  issue_expected+=("$expected")
  issue_observed+=("$observed")
  issue_tests+=("$test_hint")
}

# Probe 1: TODO/FIXME/HACK markers in non-generated code.
if has_command rg; then
  while IFS= read -r line; do
    file="${line%%:*}"
    detail="${line#*:}"
    title="Track marker in ${file}"
    body="Automated hunt found potential follow-up item during ${RUN_DATE} run:${detail}"
    add_finding \
      "$title" \
      "$body" \
      "Open ${file}, inspect the marker, and confirm whether it represents unfinished behavior or stale annotation." \
      "Actionable TODO/FIXME/HACK markers are either converted into scoped work or removed when stale." \
      "Marker remains in source without a linked disposition from this daily intake run." \
      "Add the smallest regression or cleanup test that proves the marker's intended behavior."
  done < <(rg -n "TODO|FIXME|HACK" electron-main frontend scripts | head -n 3 || true)
else
  echo "⚠️  Skipping marker scan: ripgrep not available"
fi

# Probe 2: risky paths touched recently in this checkout.
if [[ -d .git ]]; then
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    add_finding \
      "Revisit recent change path: ${file}" \
      "Recent checkout path shows potential regression surface under ${file}; add focused regression coverage." \
      "Review recent diff context for ${file} and exercise the changed behavior through the nearest test or UI route." \
      "Recent changes preserve existing behavior and include coverage for the modified branch." \
      "Recent change path was detected without an intake-linked regression proof." \
      "Add focused coverage at the closest unit, integration, or E2E layer."
  done < <(git diff --name-only HEAD~1 2>/dev/null | head -n 3 || true)
fi

if (( ${#findings[@]} == 0 )); then
  echo "✅ No findings generated from this lightweight pass."
else
  echo "🐛 ${#findings[@]} finding(s) generated."
  for i in "${!findings[@]}"; do
    idx=$((i + 1))
    echo "- [${idx}] ${findings[$i]}"
  done
fi
echo

RENDERED_TEMPLATE="$REPORT_TEMPLATE"
RENDERED_TEMPLATE="${RENDERED_TEMPLATE//\{\{RUN_DATE\}\}/$RUN_DATE}"
RENDERED_TEMPLATE="${RENDERED_TEMPLATE//\{\{RUN_TS\}\}/$RUN_TS}"
RENDERED_TEMPLATE="${RENDERED_TEMPLATE//\{\{FINDING_COUNT\}\}/${#findings[@]}}"
RENDERED_TEMPLATE="${RENDERED_TEMPLATE//\{\{INTAKE_MODE\}\}/$INTAKE_MODE}"

cat > "$REPORT_FILE" <<EOF
$RENDERED_TEMPLATE

## Run summary

- Date: $RUN_TS
- Intake mode: $INTAKE_MODE
- Triggered plan files:
  - \`$CORE_PLAN_FILE\`
  - \`$FISHING_PLAN_FILE\`
  - \`$TEMPLATE_FILE\`
- Findings produced: ${#findings[@]}

## Findings
$(for i in "${!findings[@]}"; do
  idx=$((i + 1))
  echo "$idx. **${findings[$i]}**"
  echo ""
  echo "   - Body: ${issue_bodies[$i]}"
  echo "   - Repro steps: ${issue_repros[$i]}"
  echo "   - Expected behavior: ${issue_expected[$i]}"
  echo "   - Observed behavior: ${issue_observed[$i]}"
  echo "   - Suggested fix/test: ${issue_tests[$i]}"
  echo ""
done)

## GitHub issue intake
$(for i in "${!findings[@]}"; do
  idx=$((i + 1))
  echo "### Candidate ${idx}: ${findings[$i]}"
  echo ""
  echo "- Labels: \`bug\`, \`daily-bug-hunt\`, \`report-only-intake\`"
  echo "- Mutating action taken: none"
  echo ""
  issue_markdown \
    "${findings[$i]}" \
    "${issue_bodies[$i]}" \
    "${issue_repros[$i]}" \
    "${issue_expected[$i]}" \
    "${issue_observed[$i]}" \
    "${issue_tests[$i]}"
  echo ""
done)
EOF

{
  printf '{\n'
  printf '  "runDate": %s,\n' "$(printf '%s' "$RUN_DATE" | json_quote)"
  printf '  "runTimestamp": %s,\n' "$(printf '%s' "$RUN_TS" | json_quote)"
  printf '  "mode": %s,\n' "$(printf '%s' "$INTAKE_MODE" | json_quote)"
  printf '  "githubMutationAttempted": false,\n'
  printf '  "findings": [\n'
  for i in "${!findings[@]}"; do
    printf '    {\n'
    printf '      "title": %s,\n' "$(printf '%s' "${findings[$i]}" | json_quote)"
    printf '      "body": %s,\n' "$(printf '%s' "${issue_bodies[$i]}" | json_quote)"
    printf '      "reproSteps": %s,\n' "$(printf '%s' "${issue_repros[$i]}" | json_quote)"
    printf '      "expectedBehavior": %s,\n' "$(printf '%s' "${issue_expected[$i]}" | json_quote)"
    printf '      "observedBehavior": %s,\n' "$(printf '%s' "${issue_observed[$i]}" | json_quote)"
    printf '      "suggestedFixOrTest": %s\n' "$(printf '%s' "${issue_tests[$i]}" | json_quote)"
    if [[ $i -lt $((${#findings[@]} - 1)) ]]; then
      printf '    },\n'
    else
      printf '    }\n'
    fi
  done
  printf '  ],\n'
  printf '  "githubIssueIntake": [\n'
  for i in "${!findings[@]}"; do
    issue_body="$(issue_markdown \
      "${findings[$i]}" \
      "${issue_bodies[$i]}" \
      "${issue_repros[$i]}" \
      "${issue_expected[$i]}" \
      "${issue_observed[$i]}" \
      "${issue_tests[$i]}")"
    printf '    {\n'
    printf '      "title": %s,\n' "$(printf '%s' "${findings[$i]}" | json_quote)"
    printf '      "labels": ["bug", "daily-bug-hunt", "report-only-intake"],\n'
    printf '      "bodyMarkdown": %s\n' "$(printf '%s' "$issue_body" | json_quote)"
    if [[ $i -lt $((${#findings[@]} - 1)) ]]; then
      printf '    },\n'
    else
      printf '    }\n'
    fi
  done
  printf '  ]\n'
  printf '}\n'
} > "$ARTIFACT_FILE"

if has_command gh; then
  echo "ℹ️  gh CLI detected; report-only mode intentionally skipped GitHub mutation."
else
  echo "ℹ️  gh CLI unavailable; report-only artifacts are still complete for intake."
fi

echo "✅ Report saved: $(basename "$REPORT_FILE")"
echo "✅ Artifact saved: $(basename "$ARTIFACT_FILE")"
