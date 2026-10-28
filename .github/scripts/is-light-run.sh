#!/usr/bin/env bash
# Print LIGHT-GREEN, READY-LIGHT, or NOT-LIGHT for one run JSON file.
# LIGHT-GREEN requires the light predicate and a draft PR at the same head sha.
# Unreadable draft state (missing, null, empty, or head mismatch) is NOT-LIGHT.
set -euo pipefail

file=${1:-}
dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

if [ -z "${file}" ] || [ ! -f "${file}" ]; then
  printf 'NOT-LIGHT\n'
  exit 0
fi

light=$(jq -Rsc 'split("\n") | map(select(length > 0 and (startswith("#") | not)))' "${dir}/light-jobs.txt")

if ! state=$(jq -er --argjson light "${light}" '
  if .workflow_run.path != ".github/workflows/ci.yml" then "NOT-LIGHT"
  elif (([.jobs[]? | select(.name == "ci-light") | .conclusion] | .[0]) != "success") then "NOT-LIGHT"
  elif (([.jobs[]? | select(.conclusion == "failure") | .name] | sort) != ["ci"]) then "NOT-LIGHT"
  elif (([.jobs[]? | select(.conclusion != "skipped") | .name | select(. as $n | $light | index($n) | not)] | length) != 0) then "NOT-LIGHT"
  else
    (.pull_request.draft) as $d
    | (.workflow_run.head_sha // "") as $run
    | (.pull_request.head_sha // "") as $pr
    | if ($run == "" or $pr == "" or $run != $pr or (($d != true) and ($d != false))) then "NOT-LIGHT"
      elif $d == true then "LIGHT-GREEN"
      else "READY-LIGHT"
      end
  end
' "${file}" 2>/dev/null); then
  printf 'NOT-LIGHT\n'
  exit 0
fi

case "${state}" in
  LIGHT-GREEN|READY-LIGHT|NOT-LIGHT) printf '%s\n' "${state}" ;;
  *) printf 'NOT-LIGHT\n' ;;
esac
