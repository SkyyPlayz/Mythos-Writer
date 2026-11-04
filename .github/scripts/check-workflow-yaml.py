#!/usr/bin/env python3
"""Validate workflow YAML and reject auto-ready markers (SKY-11200, DRAFT-CI).

Scans .github/workflows/*.yml for YAML parse errors, then fails if any file
under .github/workflows or .github/scripts contains an auto-ready marker.
Optional argv[1] is the repository root (default: the working directory).
"""

import glob
import os
import sys

import yaml

# Split so this file does not itself contain the forbidden substrings.
BANNED = (
    "gh pr " + "ready",
    "markPullRequest" + "ReadyForReview",
)


def scan_banned(root):
    failed = False
    bases = (
        os.path.join(root, ".github", "workflows"),
        os.path.join(root, ".github", "scripts"),
    )
    for base in bases:
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [name for name in dirnames if name != ".git"]
            for name in sorted(filenames):
                path = os.path.join(dirpath, name)
                try:
                    with open(path, encoding="utf-8") as handle:
                        text = handle.read()
                except (OSError, UnicodeError) as err:
                    print(f"✗ {path}: cannot read ({err})", file=sys.stderr)
                    failed = True
                    continue
                for needle in BANNED:
                    if needle in text:
                        line = text[: text.index(needle)].count("\n") + 1
                        print(f"✗ {path}:{line}: forbidden auto-ready marker", file=sys.stderr)
                        failed = True
    return failed


def main(argv):
    root = argv[1] if len(argv) > 1 else "."
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        print(f"✗ not a directory: {root}", file=sys.stderr)
        return 1

    failed = False
    pattern = os.path.join(root, ".github", "workflows", "*.yml")
    for fpath in sorted(glob.glob(pattern)):
        try:
            with open(fpath, encoding="utf-8") as handle:
                yaml.safe_load(handle)
            print(f"✓ {os.path.relpath(fpath, root)}")
        except yaml.YAMLError as err:
            print(f"✗ {fpath}: YAML parse error", file=sys.stderr)
            print(f"  {err}", file=sys.stderr)
            failed = True

    if scan_banned(root):
        failed = True

    if failed:
        return 1

    print("Guard passed: all .github/workflows/*.yml files are valid YAML.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
