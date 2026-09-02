#!/usr/bin/env python3
"""Validate that all .github/workflows/*.yml files are valid YAML (SKY-11200)."""

import yaml
import glob
import sys

failed = False
for fpath in sorted(glob.glob('.github/workflows/*.yml')):
    try:
        with open(fpath) as f:
            yaml.safe_load(f)
        print(f'✓ {fpath}')
    except yaml.YAMLError as e:
        print(f'✗ {fpath}: YAML parse error', file=sys.stderr)
        print(f'  {e}', file=sys.stderr)
        failed = True

if failed:
    sys.exit(1)

print('Guard passed: all .github/workflows/*.yml files are valid YAML.')
