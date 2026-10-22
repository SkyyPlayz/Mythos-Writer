#!/usr/bin/env bash
# Required ci aggregator. Job results arrive only as environment literals.
# Light (FULL exactly false) prints the light results and exits 1 (DRAFT-LIGHT).
# Full runs only when MODE_RESULT is success and FULL is exactly true.
set -euo pipefail

if [ "${FULL-}" = "false" ]; then
  printf 'mode=%s\n' "${MODE_RESULT-}"
  printf 'lint=%s\n' "${LINT_RESULT-}"
  printf 'typecheck=%s\n' "${TYPECHECK_RESULT-}"
  printf 'unit=%s\n' "${UNIT_RESULT-}"
  printf 'DRAFT-LIGHT\n'
  exit 1
fi

if [ "${MODE_RESULT-}" != "success" ] || [ "${FULL-}" != "true" ]; then
  printf 'ERROR: mode result %s full %s is not a full run. CI aggregator: FAILED.\n' "${MODE_RESULT-}" "${FULL-}"
  exit 1
fi

fail() {
  printf 'ERROR: %s CI aggregator: FAILED.\n' "$1"
  exit 1
}

check_success() {
  printf '%s=%s\n' "$1" "$2"
  if [ "$2" != "success" ]; then
    fail "Required job ${1} outcome '${2}' — expected 'success'."
  fi
}

check_success lint "${LINT_RESULT-}"
check_success typecheck "${TYPECHECK_RESULT-}"
check_success unit "${UNIT_RESULT-}"
check_success oracle-sweeps "${ORACLE_SWEEPS_RESULT-}"
check_success build-electron "${BUILD_ELECTRON_RESULT-}"
check_success notes-windows "${NOTES_WINDOWS_RESULT-}"

skipped=0
for result in "${E2E_SHARD_1_RESULT-}" "${E2E_SHARD_2_RESULT-}" "${E2E_SHARD_3_RESULT-}" "${E2E_SHARD_4_RESULT-}"; do
  printf 'e2e=%s\n' "${result}"
  if [ "${result}" != "success" ] && [ "${result}" != "skipped" ]; then
    fail "E2E shard outcome '${result}' — expected 'success' or 'skipped'."
  fi
  if [ "${result}" = "skipped" ]; then
    skipped=$((skipped + 1))
  fi
done

if [ "${PATHS_FILTER_RUN_E2E-}" = "true" ] && [ "${skipped}" -eq 4 ]; then
  fail "path-filter indicated e2e should run, but all 4 shards were skipped."
fi

printf 'All checks passed — lint, typecheck, unit, oracle-sweeps, build-electron, notes-windows, and applicable E2E shards are green.\n'
