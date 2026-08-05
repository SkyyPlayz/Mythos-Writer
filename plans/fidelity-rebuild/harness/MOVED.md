# Moved

The fidelity harness scripts now live at [`e2e/fidelity/`](../../../e2e/fidelity/)
(SKY-9257, PLAN.md §3 P0.2) with repo-relative imports and output dirs.

Run them via:

    npm run fidelity:proto
    npm run fidelity:app
    npm run fidelity:both
    npm run fidelity:verify-offline

On a headless host, wrap in `xvfb-run --auto-servernum` for the app capture.
