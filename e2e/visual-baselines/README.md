# Visual Regression Baselines

Baseline screenshots for the Pixelmatch visual regression suite (`e2e/tests/visual-regression.spec.ts`).

## Directory structure

```
e2e/visual-baselines/
  linux/
    1440x900/
      editor-normal.png          # Editor shell, no scene selected
      editor-scene-open.png      # Editor with scene open (Edit mode)
      editor-focus-mode.png      # Editor with focus/distraction-free mode
      brainstorm-chat.png        # Brainstorm view
      settings-panel.png         # Settings dialog open
      vault-sidebar.png          # Left sidebar / vault browser
  darwin/
    1440x900/
      (same set, captured on macOS)
```

One baseline set per OS (`linux` / `darwin`) at the desktop viewport (1440×900).
Baselines are committed to the repository so CI can compare against them on every PR.

## Running the suite

```bash
# Compare against committed baselines (CI default — fails if diff > 0.5%)
xvfb-run --auto-servernum npm run test:e2e:visual-regression

# Custom threshold (e.g. 1%)
VR_THRESHOLD=0.01 xvfb-run --auto-servernum npm run test:e2e:visual-regression
```

## Refreshing baselines

Run the suite with `VR_UPDATE_BASELINES=1` after intentional UI changes, then commit the updated PNGs.

```bash
# 1. Regenerate all baselines on the current platform
npm run build:electron
VR_UPDATE_BASELINES=1 xvfb-run --auto-servernum npm run test:e2e:visual-regression

# 2. Verify the new baselines look correct (open the PNGs)
open e2e/visual-baselines/linux/1440x900/   # on Linux: xdg-open

# 3. Commit
git add e2e/visual-baselines/
git commit -m "chore: refresh visual-regression baselines"
```

## Adding a new screen

1. Add a new `test('VR-NN ...')` block in `e2e/tests/visual-regression.spec.ts`.
2. Call `assertMatchesBaseline(page, 'my-new-screen')` — this creates the baseline on the first run.
3. Commit the generated PNG file.

## How diffing works

- Screenshots are captured at 1440×900 using headless Electron under Xvfb.
- Pixelmatch compares each pixel with `threshold: 0.1` (per-pixel colour tolerance).
- If the ratio of mismatched pixels exceeds `VR_THRESHOLD` (default **0.5%**), the test fails.
- Diff images are saved to `e2e-visual-artifacts/visual-regression/` and uploaded as CI artifacts.

## CI artifact upload

On failure, diff images are uploaded as the `visual-regression-diffs` artifact in GitHub Actions.
Download the artifact from the failed CI run to inspect which pixels changed.
