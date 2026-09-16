# SKY-11874 — QA visual sign-off for PR #1576 (SKY-11749 token remap)

Branch: `fix/sky-11749-text-tier-weight-md-orphans` @ `733873e3`.
Captured with a real Electron build under Xvfb (`playwright-core` `_electron`), 1200×800 window,
synthetic vault content, per SKY-11749 acceptance.

Four conditions per reached surface: default, accent-colour swap (Aurora preset,
`settings-after-accent-swap.png`), glow-intensity swap (`lnas-glowr` pushed 8→150px,
`settings-after-glow-swap.png`), Reduce Glow toggled on (`settings-after-reduceglow-toggle.png`).

## Reached and verified — no regressions in any of the 4 conditions

| File | Surface | Screenshots |
| --- | --- | --- |
| `AccountModal.css` | Account modal, app-name label | `01/02/03/04-*-accountmodal.png` |
| `TemplatePicker.css` | New-note template picker title | `01/02/03/04-*-templatepicker.png` |
| `VaultGraphView.css` | Vault Graph labels/toolbar/filters | `01/02/03/04-*-vaultgraphview.png` |
| `components/SettingsPanel/sections/AddVaultDialog.css` | Add Notes Vault dialog section labels | `01/02/03/04-*-addvaultdialog.png` |
| `components/BrainstormCard/IdeaDetailDrawer.css` | Idea detail drawer header/labels/pills/badges | `01/02/03/04-*-ideadetaildrawer.png` |

All touched text stayed readable (correct color/contrast), correct weight, no clipping, no layout
breaks across all four conditions.

## Not reached — confirmed dead/unmounted code, independent of this PR

- `AeonLaneView.css` / `AeonLaneView.tsx` — not imported/rendered anywhere in the live app; only
  referenced from its own test file. Not reachable via any nav path.
- `DraftHistoryPanel.css` / `DraftHistoryPanel.tsx` — only ever mounted via a `'scene-properties'`
  docked-tab panel slot that `GlobalRightSidebar.tsx` documents as removed in M6 ("panel system
  removed in M6"). No live UI path creates that panel. The app's actual "History" entry point
  (`.msv-title-menu-history`) opens a different component, `SceneHistory`, not `DraftHistoryPanel`.

Recommend a follow-up ticket to either re-wire or delete these two components; the token remap
itself is harmless there since the code never renders.

## Light theme — not applicable

`tokens.css` has a `[data-theme="light"]` block explicitly commented as unimplemented scaffolding
("not active in the current dark-only build"); it only overrides `--page-bg-*` tokens, none of the
8 remapped in this PR, and no Settings control ever sets `data-theme="light"`. Not reachable in the
running app — not a regression surface for this PR.

## Fixture note

The default/populated vault fixture hit a pre-existing, PR-unrelated boot-migration bug
(`electron-main/src/migration/mythosVaultMigrator.ts`: `Migration failed: The "paths[1]" argument
must be of type string. Received undefined.`) that leaves `notesVaults` unresolved and hides the
"+ Add Notes Vault" button. Worked around with a dedicated minimal-vault fixture for the
AddVaultDialog captures only. Root-caused but not fixed here — out of scope for this PR; worth its
own ticket if not already tracked.
