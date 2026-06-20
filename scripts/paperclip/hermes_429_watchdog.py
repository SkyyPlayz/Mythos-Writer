#!/usr/bin/env python3
"""Hermes 429 watchdog helpers for Paperclip agent auto-failover.

DEPRECATED: Use hermes_cap_manager module instead. This module re-exports for backward compatibility.
"""

from __future__ import annotations

import datetime as _dt
import os

# Re-export all public items from the consolidated manager
from scripts.paperclip.hermes_cap_manager import (
    HERMES_429_PAT,
    PARENT_ISSUE,
    REVERT_DELAY_S,
    SCAN_WINDOW_M,
    TARGET_ADAPTER,
    TARGET_MODEL,
    JsonDict,
    api,
    build_swap_body,
    detect_hermes_429,
    run_watchdog,
    should_swap,
)

__all__ = [
    "HERMES_429_PAT",
    "PARENT_ISSUE",
    "REVERT_DELAY_S",
    "SCAN_WINDOW_M",
    "TARGET_ADAPTER",
    "TARGET_MODEL",
    "JsonDict",
    "api",
    "build_swap_body",
    "detect_hermes_429",
    "run_watchdog",
    "should_swap",
]


def main() -> None:
    now = _dt.datetime.now(_dt.timezone.utc)
    company_id = os.environ["PAPERCLIP_COMPANY_ID"]
    instance_dir = os.environ.get("PAPERCLIP_INSTANCE_DIR", os.path.expanduser("~/.paperclip/instances/default"))
    log_dir = os.path.join(instance_dir, "data", "run-logs", company_id)
    affected = detect_hermes_429(log_dir, now - _dt.timedelta(minutes=SCAN_WINDOW_M))
    result = run_watchdog(api, company_id, affected, now)
    print(f"watchdog: swapped={len(result['swapped'])} skipped={len(result['skipped'])} errors={len(result['errors'])}")


if __name__ == "__main__":
    main()
