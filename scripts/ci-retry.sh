#!/usr/bin/env bash
# SKY-10092: hosted-runner network flakes (electron/electron-builder binary
# downloads intermittently "socket hang up" / "fetch failed") were failing
# whole CI runs on a single transient blip. Wrap the download-triggering
# commands (npm ci, electron-builder) so one failed attempt retries instead
# of red-lining main.
#
# Usage: source scripts/ci-retry.sh && retry <command> [args...]
retry() {
  local max_attempts=3
  local delay_seconds=15
  local attempt=1
  until "$@"; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "::error::Command failed after ${attempt} attempts: $*" >&2
      return 1
    fi
    echo "::warning::Attempt ${attempt}/${max_attempts} failed: $*  — retrying in ${delay_seconds}s" >&2
    attempt=$((attempt + 1))
    sleep "$delay_seconds"
  done
}
