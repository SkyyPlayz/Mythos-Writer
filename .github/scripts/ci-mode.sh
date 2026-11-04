#!/usr/bin/env bash
# Decide full vs light from the Actions event. Writes one line to $GITHUB_OUTPUT:
# full=true or full=false. A missing or unreadable payload exits non-zero so the
# mode job's guard fails closed to full. The ref is never written or executed.
set -euo pipefail

if [ -z "${GITHUB_OUTPUT:-}" ] || [ -z "${GITHUB_EVENT_NAME:-}" ] || [ -z "${GITHUB_EVENT_PATH:-}" ] || [ ! -f "${GITHUB_EVENT_PATH}" ]; then
  exit 1
fi

if ! jq -e . "${GITHUB_EVENT_PATH}" >/dev/null 2>&1; then
  exit 1
fi

full=true
if [ "${GITHUB_EVENT_NAME}" = "pull_request" ]; then
  draft=$(jq -r 'if .pull_request.draft == true then "true" else "false" end' "${GITHUB_EVENT_PATH}")
  ref=$(jq -r '.pull_request.head.ref // ""' "${GITHUB_EVENT_PATH}")
  if [ "${draft}" = "true" ]; then
    full=false
  else
    case "${ref}" in
      research/bakeoff/*) full=false ;;
    esac
  fi
fi

if [ "${full}" = "true" ]; then
  printf 'full=true\n' >> "${GITHUB_OUTPUT}"
else
  printf 'full=false\n' >> "${GITHUB_OUTPUT}"
fi
