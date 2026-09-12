# SKY-11190 — PR #1495 rebase verification

Base: `cf67e93b24db2b55076c79e6c4816292c464dcb4` (includes #1494).
Captured on Linux with real Electron under Xvfb, at 1440 × 900.
All screenshots are unedited app captures with synthetic vault content.

## Visual evidence

| Capture | State |
| --- | --- |
| [Current main](00-main-cf67e93b.png) | Built separately from the exact base above; Characters/Alice.md fixture. |
| [Before assignment](01-before-icon.png) | Rebased PR, default folder glyph. |
| [Picker](02-picker.png) | Real right-click; 24 glyphs and eight colours. |
| [Board tile](03-board-tile.png) | Blue sword selected through the UI and persisted to icons.json. |
| [Block LOD](04-lod-block.png) | 40% zoom; glyph and text hidden, accessible name retained. |
| [Vault tree](05-vault-tree.png) | Same blue sword in the Notes vault tree. |
| [Board breadcrumb](06-board-breadcrumb.png) | Same assignment after entering Characters. |

The main/PR board content comparison is recorded in [board-comparison.json](board-comparison.json).
The measured region changes by 327 pixels (0.0474%), covering the icon/header change.
The full screenshots also contain asynchronously initialized sidebar labels; that region is outside this board comparison.

The screenshot-check workflow checks for image evidence in the PR body/comments.
It does not compare pixel baselines. This PR supplies actual captures and removes the exemption.

## Integration

- Kept #1494's viewport culling, memoised BoardCard, three LOD tiers, thumbnails, and stale-load guard.
- Moved the icon glyph and context-menu wiring into BoardCard; tier 3 remains a textless/glyphless block.
- Added tests for nested icon keys, colour updates, cull/remount persistence, and picker access at block LOD.
- Added the existing board-icon acceptance spec to the CI-selected `test:e2e:icons` command.
- Corrected the new LOD E2E selector to use the retained accessible name after visible text disappears.

## Local pre-flight

| Command | Result |
| --- | --- |
| `npm ci` | Pass |
| `npm run lint` | Pass, including dead-wiring guard |
| `npm run typecheck` | Both workspaces pass |
| `npm run test` | Backend: 184 files, 4,309 passed / 10 existing skipped; frontend: 289 files, 5,073 passed |
| `npm run build:electron` | Pass |
| `xvfb-run --auto-servernum npm run test:e2e:icons` | 4 passed |
| `xvfb-run --auto-servernum npm run test:e2e:notes-board-canvas` | 19 passed, including #1494 LOD/thumbnail/performance and board fidelity |
| `xvfb-run --auto-servernum npm run test:e2e:folder-ops` | 17 passed |
| `xvfb-run --auto-servernum npm run test:e2e:crud` | 25 passed / 4 existing skipped |
| `xvfb-run --auto-servernum npm run test:e2e:brainstorm` | 12 passed |
| `xvfb-run --auto-servernum npm run test:e2e:visual-regression` | 7 passed against fresh current-main references |

Visual regression initially bootstrapped local images: `git ls-files e2e/visual-baselines` contains only the README.
To obtain an actual comparison, built the exact base in a separate worktree, generated its six references,
and compared the PR against those images. No update flag or threshold override was used.
Pixel differences: editor normal 0.093%, scene open 0.094%, focus 0.100%, brainstorm 0.166%,
settings 0.000%, vault sidebar 0.003%; existing limit 1.2%.
No tracked snapshot, baseline, test, or threshold was weakened/deleted.
No inherited board/screenshot failure was reproduced.

The 2,000-card board mounted 12/27/102 cards at 100/40/10% zoom (budgets 24/42/132).
Scroll p95: 33.3 ms; mean: 17.8 ms; 59 frames; final mounted count: 11.

Platform limits: native Linux packaging and macOS packaging were not run locally.
The production Electron build passed; this delta adds no dependency/native/platform-specific changes.
Hosted CI and team review still gate merge. This verification does not authorize a merge.

To recapture PR evidence:

```bash
SKY11190_SCREENSHOTS="$PWD/pr-screenshots/sky-11190" \
  xvfb-run --auto-servernum npm run test:e2e:icons
```
