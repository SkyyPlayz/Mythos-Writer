#!/usr/bin/env python3
"""Hermes swap revert sweeper helpers for Paperclip agents.

DEPRECATED: Use hermes_cap_manager module instead. This module re-exports for backward compatibility.
"""

from __future__ import annotations

import datetime as _dt
import os

# Re-export all public items from the consolidated manager
from scripts.paperclip.hermes_cap_manager import (
    PARENT_ISSUE,
    REVERT_DELAY_S,
    JsonDict,
    api,
    build_revert_body,
    run_sweeper,
    should_revert,
)

__all__ = [
    "PARENT_ISSUE",
    "REVERT_DELAY_S",
    "JsonDict",
    "api",
    "build_revert_body",
    "run_sweeper",
    "should_revert",
]


def main() -> None:
    now = _dt.datetime.now(_dt.timezone.utc)
    company_id = os.environ["PAPERCLIP_COMPANY_ID"]
    result = run_sweeper(api, company_id, now)
    print(f"sweeper: reverted={len(result['reverted'])} deferred={len(result['deferred'])} errors={len(result['errors'])}")


if __name__ == "__main__":
    main()
