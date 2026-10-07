#!/usr/bin/env python3
"""Fail if a git revision range loosens L8 uninstall test guards (Forge / Shield)."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

FORBIDDEN_IN_ADDED = (
    re.compile(r"\.skip\s*\("),
    re.compile(r"\.only\s*\("),
)

HEAD_NSH_TEST = REPO / "electron-main/src/uninstallVaultsNsh.test.ts"
HEAD_NSH_ORDER = REPO / "electron-main/src/uninstallNshOrder.ts"
HEAD_UNINSTALL_NSH = REPO / "build/uninstall-vaults.nsh"

REQUIRED_AT_HEAD = (
    "assertUninstallerCheckboxSectionTokens",
    "assertKeepElseEndIfInsertsOnlyAppCachesMacro",
    "assertDeleteVaultsSectionOffByDefault",
    "assertTraversalRejectedBeforeSidecarDelete",
    "assertAllowlistDenySkipsSidecarLine",
)

REQUIRED_NSH_LITERALS = (
    "!macro customUnInstallSection",
    "!ifdef BUILD_UNINSTALLER",
    'Section /o "un.Also delete my Mythos vaults / writing data"',
)


def git_diff(rev_range: str) -> str:
    return subprocess.check_output(
        ["git", "diff", rev_range, "--", "electron-main", "frontend", "e2e", "build"],
        cwd=REPO,
        text=True,
    )


def count_it_blocks(path: Path) -> int:
    return len(re.findall(r"\bit\s*\(", path.read_text(encoding="utf-8")))


def main() -> int:
    rev_range = sys.argv[1] if len(sys.argv) > 1 else "HEAD~1..HEAD"
    diff = git_diff(rev_range)
    for line in diff.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        payload = line[1:]
        for pat in FORBIDDEN_IN_ADDED:
            if pat.search(payload):
                print(f"LOOSEN: forbidden addition in {rev_range}: {payload.strip()[:200]}")
                return 2

    if not HEAD_NSH_TEST.is_file():
        print("LOOSEN: missing electron-main/src/uninstallVaultsNsh.test.ts")
        return 2

    test_src = HEAD_NSH_TEST.read_text(encoding="utf-8")
    order_src = HEAD_NSH_ORDER.read_text(encoding="utf-8") if HEAD_NSH_ORDER.is_file() else ""
    n_it = count_it_blocks(HEAD_NSH_TEST)
    if n_it < 10:
        print(f"LOOSEN: uninstallVaultsNsh.test.ts has {n_it} tests (need >= 10)")
        return 2

    for token in REQUIRED_AT_HEAD:
        if token not in test_src and token not in order_src:
            print(f"LOOSEN: required guard missing at HEAD: {token}")
            return 2

    if HEAD_UNINSTALL_NSH.is_file():
        nsh = HEAD_UNINSTALL_NSH.read_text(encoding="utf-8")
        for literal in REQUIRED_NSH_LITERALS:
            if literal not in nsh:
                print(f"LOOSEN: build/uninstall-vaults.nsh missing literal: {literal}")
                return 2

    print(f"test_loosen_guard: CLEAN ({rev_range}; uninstallVaultsNsh tests={n_it})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
