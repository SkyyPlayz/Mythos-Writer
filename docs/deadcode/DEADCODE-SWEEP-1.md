# DEADCODE-SWEEP-1

First full-app dead-code sweep of Mythos Writer (`main` @ `a6d6b88`). One small diff: only symbols with a named replacement or a stated proof they are unreferenced. Tests, fixtures, data, IPC registration, preload, `main.ts` / `preload.ts`, NSIS, `build/`, `.github/`, and the five timeline views were not deleted.

Tools: a TypeScript import-graph scan (knip / ts-prune role), `depcheck` 1.x on all four package manifests, `jscpd` (min 12 lines / 70 tokens, tests and `plans/` ignored), `madge --circular` 8.x, and the repo's existing frontend `@typescript-eslint/no-unused-vars` plus `tsc` `noUnusedLocals`. Every removal was confirmed with a repo-wide search for the symbol and its path, including string references.

## Counts

| Check | Found | Removed | Flagged |
| --- | ---: | ---: | ---: |
| 1. Unused functions | 5 | 4 | 1 |
| 2. Unused files | 16 | 10 | 6 |
| 3. Unused exports and imports | 1,397 exports with no cross-file named import (897 plain, 500 on a namespace, star, or dynamic import); 2 now-unused imports in `DesktopShell.tsx` | 2 imports (they only served the removed views). Exports were not stripped | 1,397 |
| 4. Leftover flags and orphaned styles | 0 `ENABLE_` / `FEATURE_` / `FLAG_` constants. 6 stylesheets unreachable from any importer. Orphaned selectors under `.chapter-continuous-*` and `.book-outline-*` in `DesktopShell.css` | 5 stylesheets. Child selectors of the two legacy views. The two container classes stay, because the manuscript wrap still uses them | 1 stylesheet |
| 5. Commented-out code blocks | 2 comment ranges that look like code | 0 | 2 (format examples, not disabled code) |
| 6. Unused dependencies | 2 (`depcheck` on the root manifest; the three workspaces reported none) | 0 | 2 |
| 7. Stale TODOs and duplicate logic | 0 `TODO` / `FIXME` / `HACK` comments in `frontend/src`, `electron-main/src`, and `shared`. 9 `test.fixme` skips. 37 cross-file clone pairs (`jscpd`) | 0 | all of them (list only) |

## Removed

Each item names the replacement, or the proof that nothing references it.

### Files

| Removed | Replacement or proof |
| --- | --- |
| `frontend/src/components/PresetSelector/index.tsx` and `index.css` | Live control is `frontend/src/components/PresetSelector.tsx` (imported by `BrainstormPage.tsx` and `WritingAssistantPanel.tsx`). Node resolution prefers the sibling `.tsx` over this directory. The file's own comment records that no caller renders it. |
| `frontend/src/components/QualityRubric/index.tsx` and `index.css` | Live control is `frontend/src/components/QualityRubric.tsx`. Same shadowing. `QualityRubric.test.tsx` imports `./QualityRubric`, which resolves to the `.tsx` file. |
| `frontend/src/components/GenrePresetPicker/index.tsx` and `index.css` | No importer outside the file. Live preset UI is `PresetSelector.tsx`. |
| `frontend/src/components/RefinementButtonGroup/index.tsx` and `index.css` | No importer outside the file. |
| `frontend/src/PresetLibrary.ts` | Only imported by the four files above. Live preset data is `BUNDLED_PRESETS` in `frontend/src/presets.ts`. |
| `frontend/src/components/BrainstormCard/IdeaContextMenu.css` | Not imported. `IdeaContextMenu.tsx` renders `components/ui/Menu` and does not use `.idea-context-menu`. |

### Functions

| Removed | Replacement or proof |
| --- | --- |
| `scanStory` in `electron-main/src/mythosFormat/v2Manifest.ts` | Only the declaration existed. Vault scans go through `scanMythosStoryVault` in the same file. |
| `ChapterContinuousView`, `BookOutlineView`, and `SceneEditorBand` in `frontend/src/DesktopShell.tsx` | No JSX call site and no import. `DesktopShell` renders `story/ManuscriptView.tsx` for book, part, chapter, and scene depth (SKY-9404). The `scrollBehavior` and `ChapterInterlude` imports that only those views used were removed with them. |

`ChapterInterlude.tsx` stays. Its unit tests still render it. It is no longer mounted from the shell; that is flagged below, not deleted.

### Styles kept on purpose

`DesktopShell` still puts `chapter-continuous-view` and `book-outline-view` on the manuscript wrap. Those two rules stay. The child selectors (scene bands, outline rows, headers) were only referenced from the removed components, so they were deleted.

## Flagged (not deleted)

### Main-process import cycles (12)

`madge --circular --extensions ts,tsx --ts-config electron-main/tsconfig.json electron-main/src/main.ts` (188 files):

1. `ipc.ts > mythosFormat/agentSessions.ts > mythosFormat/mythosJson.ts > vault.ts`
2. `ipc.ts > mythosFormat/agentSessions.ts > mythosFormat/mythosJson.ts > vault.ts > manifest.ts`
3. `ipc.ts > mythosFormat/agentSessions.ts > mythosFormat/mythosJson.ts > vault.ts > manifest.ts > sceneBody.ts`
4. `mythosFormat/notesVaultRegistry.ts > mythosFormat/createVaultFromOptions.ts > mythosFormat/adoptObsidianInPlace.ts`
5. `ipc.ts > mythosFormat/agentSessions.ts > mythosFormat/notesVaultRegistry.ts > mythosFormat/createVaultFromOptions.ts > mythosFormat/adoptObsidianInPlace.ts > mythosFormat/storyVaultRegistry.ts > obsidianImporter.ts`
6. `mythosFormat/notesVaultRegistry.ts > mythosFormat/createVaultFromOptions.ts > mythosFormat/adoptObsidianInPlace.ts > mythosFormat/storyVaultRegistry.ts > obsidianImporter.ts`
7. `ipc.ts > mythosFormat/agentSessions.ts > mythosFormat/notesVaultRegistry.ts > mythosFormat/createVaultFromOptions.ts > mythosFormat/adoptObsidianInPlace.ts > mythosFormat/timelinesFile.ts`
8. `mythosFormat/notesVaultRegistry.ts > mythosFormat/createVaultFromOptions.ts > mythosFormat/createVault.ts`
9. `mythosFormat/agentSessions.ts > mythosFormat/notesVaultRegistry.ts > mythosFormat/createVaultFromOptions.ts > mythosFormat/createVault.ts > mythosFormat/veynnSeed.ts`
10. `archiveAgent.ts > entities.ts > entityRelations.ts`
11. `vault/entityIndex.ts > vault/entityMatcher.ts`
12. `versions.ts > mythosFormat/draftFiles.ts`

The same command on `frontend/src/main.tsx` (565 files) reported no cycles. Cycles are flagged, not refactored.

### Storage code importing `ipc.ts`

These production modules import `./ipc.js` or `../ipc.js` (type and value). `ipc.ts` holds channel names, payload types, and handler types, so the storage layer depends on the IPC contract. Left as-is.

- `electron-main/src/vault.ts`
- `electron-main/src/manifest.ts`
- `electron-main/src/sceneBody.ts`
- `electron-main/src/entities.ts`
- `electron-main/src/customFields.ts`
- `electron-main/src/noteBacklinks.ts`
- `electron-main/src/backup.ts`
- `electron-main/src/mythosFormat/timelinesFile.ts`
- `electron-main/src/mythosFormat/v2Manifest.ts`
- `electron-main/src/mythosFormat/v2IdDedupe.ts`

The first eight match the architecture notes. The last two are the same upward import and were not in that list.

### Unused files kept

| File | Reason |
| --- | --- |
| `frontend/src/ThemeContrastSlider.tsx` and `ThemeContrastSlider.css` | No production importer. The live slider is `AppearanceSection.tsx` (`#lg-softness`, `data-testid="theme-contrast-slider"`). The stylesheet is named in `themeTokenCoverage.test.ts` `KNOWN_ORPHANS`. Deleting it would force a baseline edit in a test. Flagged. |
| `frontend/src/components/SettingsPanel/sections/AgentsSection.tsx` | Unmounted (`SettingsPanel.tsx` and `fidelityCShell.test.ts` assert it is not rendered). `keysBackstop.propPins.test.tsx` reads the file from disk and asserts props still exist. Removing it fails those tests. |
| `frontend/src/components/SettingsPanel/AutoApplyCategoryToggles.tsx` | Only imported by `AgentsSection.tsx`. Kept because that file stays. |
| `electron-main/src/mythosFormat/index.ts` | Barrel marked "public surface". Nothing imports the barrel; callers import the modules directly. Uncertain API facade. |
| `electron-main/src/vault/manifest/index.ts` | Same. `vault/manifest/types.ts` says new code should import via the module. |
| `electron-main/src/main.ts` `buildTE` | Declared and never called. Main entry points are flag-only. |
| `frontend/src/ChapterInterlude.tsx` | Production shell no longer renders it. `ChapterInterlude.test.tsx` does. Tests are not removed. |

### IPC, preload, timeline views, installer

Not modified. Flagged as out of scope for deletion:

- `electron-main/src/preload.ts`, `electron-main/src/main.ts` (except the note on `buildTE`), `?nodeWorker` entry `electron-main/src/jobs/jobWorker.ts` (imported from `main.ts` and compiled by tests).
- Five timeline views and their routing: Plot lines, Spreadsheet (`TimelineSpreadsheet.tsx`), Tensions, Relationships (`TimelineRelationships.tsx`), Subway (`TimelineSubway.tsx`), wired from `TimelineRoot.tsx`.
- `build/`, NSIS, `electron-main/src/uninstallVaultsNsh*`, `build/uninstall-vaults.nsh`, `.github/`.
- Half-connected IPC called out in the architecture notes (menu `newStory` / `openVault` with no preload method, `writing-assistant:set-active-scene` with no handler, `stt:*` with no main side, `vault:changed` with no preload listener, archive stream events with no listener, `vault:obsidian:import:progress` with no sender, handlers not exposed by preload). Channel strings and `ipcMain` registration were not edited.

### Commented-out ranges that are documentation

- `frontend/src/iconUtils.ts:22` — examples of icon-id shapes.
- `electron-main/src/templates.ts:542` — examples of `{{key}}` template syntax.

### Dependencies

| Package | Where | Reason left in place |
| --- | --- | --- |
| `@axe-core/playwright` | root `devDependencies` | No import of the package. `e2e/voice-io.spec.ts` loads `node_modules/axe-core/axe.min.js`, which this package installs. `e2e/settings-a11y.spec.ts` still describes the integration as deferred (SKY-815). |
| `electron-updater` | root `devDependencies` | `electron-main` imports it. The root manifest is what `electron-builder` packages. |

### Unused exports

The import graph found 897 exported names with no named import from another file, and 500 more on files that are namespace-imported, star-re-exported, or dynamically imported. Samples (`subscribeAgentActivity`, timeline zoom constants, `AI_ACTIVITY_*` channel names, `resetAiActivityRegistryForTests`) are used in the same file, sit on the IPC surface, or belong to the timeline views. Stripping `export` is not a behavior fix and is easy to get wrong, so none of these exports were removed.

## Duplicate logic (file pairs, not refactored)

`jscpd` cross-file clones after this sweep (cloned lines, then the pair). Within-file repeats are omitted. Threshold: 12 lines and 70 tokens.

- 99 — `electron-main/src/ipc.ts` <-> `frontend/src/types.ts`
- 69 — `frontend/src/components/SettingsPanel/sections/AgentsSection.tsx` <-> `frontend/src/partner/ProductionRolesSection.tsx`
- 64 — `electron-main/src/timelines/model.ts` <-> `frontend/src/timelinesTypes.ts`
- 60 — `frontend/src/DesktopShell.tsx` <-> `frontend/src/WritingApp.tsx`
- 58 — `electron-main/src/ipc.ts` <-> `frontend/src/global.d.ts`
- 51 — `frontend/src/NoteSplitPane.css` <-> `frontend/src/SplitEditorPane.css`
- 42 — `electron-main/src/main.ts` <-> `electron-main/src/storyImportWriter.ts`
- 29 — `electron-main/src/vault/manifest/types.ts` <-> `frontend/src/types.ts`
- 29 — `frontend/src/components/SettingsPanel/sections/M24Controls.tsx` <-> `frontend/src/components/SettingsPanel/sections/liquidNeonControls.tsx`
- 26 — `electron-main/src/mythosFormat/notesVaultRegistry.ts` <-> `electron-main/src/mythosFormat/storyVaultRegistry.ts`
- 21 — `frontend/src/VaultSidebar.tsx` <-> `frontend/src/components/VaultBrowser/index.tsx`
- 20 — `electron-main/src/db.ts` <-> `electron-main/src/ipc.ts`
- 19 — `electron-main/src/mythosFormat/agentSessions.ts` <-> `electron-main/src/mythosFormat/brainstormBoardFile.ts`
- 19 — `electron-main/src/sceneBody.ts` <-> `frontend/src/sceneBodyLayout.ts`
- 18 — `frontend/src/components/NotesVaultPicker.tsx` <-> `frontend/src/components/SettingsPanel/sections/VaultLinkingColumns.tsx`
- 17 — `electron-main/src/archiveAgent.ts` <-> `electron-main/src/continuityEngine.ts`
- 17 — `electron-main/src/manifest.ts` <-> `frontend/src/manifestIpc.ts`
- 17 — `electron-main/src/writingAssistant.ts` <-> `frontend/src/coach/sceneAnalysis.ts`
- 17 — `frontend/src/GlobalSearchPanel.tsx` <-> `frontend/src/SearchBar.tsx`
- 17 — `frontend/src/ReferencesPanel.css` <-> `frontend/src/ScenesPanel.css`
- 17 — `frontend/src/components/NotesVaultPicker.tsx` <-> `frontend/src/components/StoryVaultPicker.tsx`
- 16 — `electron-main/src/jobs/handlers/manuscriptScanJob.ts` <-> `electron-main/src/jobs/handlers/vaultScanJob.ts`
- 16 — `frontend/src/SettingsPanel.tsx` <-> `frontend/src/components/SettingsPanel/sections/VoiceSection.tsx`
- 15 — `electron-main/src/epub.ts` <-> `electron-main/src/pdfExport.ts`
- 15 — `frontend/src/AgentHubPanel.tsx` <-> `frontend/src/WritingAssistantPanel.tsx`
- 15 — `frontend/src/EntityMentionPickerExtension.ts` <-> `frontend/src/WikiLinkPickerExtension.ts`
- 15 — `frontend/src/SuggestionDetailPane.css` <-> `frontend/src/SuggestionReview.css`
- 14 — `electron-main/src/agents/SUGGESTION_CONTRACT.md` <-> `electron-main/src/ipc.ts`
- 14 — `frontend/src/EntityMention.css` <-> `frontend/src/WikiLinkPicker.css`
- 13 — `electron-main/src/vault.ts` <-> `electron-main/src/vaultIntegrity.ts`
- 13 — `frontend/src/AgentHubPanel.css` <-> `frontend/src/timeline2/panel/TimelineRightPanel.css`
- 13 — `frontend/src/GlobalRightSidebar.css` <-> `frontend/src/LeftRail.css`
- 13 — `frontend/src/SuggestionDetailPane.tsx` <-> `frontend/src/SuggestionReview.tsx`
- 13 — `frontend/src/WritingAssistantPanel.css` <-> `frontend/src/components/BrainstormCard/ProposalCard.css`
- 13 — `frontend/src/components/ManuscriptStructure/ListView.tsx` <-> `frontend/src/components/ManuscriptStructure/SceneGrid.tsx`
- 13 — `frontend/src/components/SettingsPanel/sections/AgentsSection.tsx` <-> `frontend/src/components/SettingsPanel/sections/VoiceSection.tsx`
- 13 — `frontend/src/pages/Boards/BoardsTabPanel.css` <-> `frontend/src/pages/Boards/BrainstormBoardPage.css`

Same-name modules that are both still imported (not clones large enough for the threshold, not merged):

- `frontend/src/ContinuityPanel.tsx` and `frontend/src/components/ContinuityPanel/ContinuityPanel.tsx` (the latter is imported as `ContinuityPeekPanel`).
- `frontend/src/SettingsPanel.tsx` and `frontend/src/components/SettingsPanel/index.tsx` (the index re-exports the flat module).
- `shared/types/suggestion.ts` and `electron-main/src/shared/types/suggestion.ts` (both imported: the root package from `ipc.ts`, the main-process copy from `db.ts`, `budget.ts`, and `suggestionApply.ts`).

One clone pair disappeared with this sweep: `GenrePresetPicker/index.tsx` <-> `PresetSelector/index.tsx`.

## Stale TODOs

No `TODO`, `FIXME`, or `HACK` comments in production source. These `test.fixme` skips are listed and were not deleted or rewritten:

- `e2e/tests/sky-11151-creation-primitive.spec.ts:110` — AC-CP-02: blank vault has ZERO visible folders/files (pending SKY-11151)
- `e2e/tests/sky-11151-creation-primitive.spec.ts:136` — AC-CP-03: the empty choice is PERSISTED (pending SKY-11151)
- `e2e/tests/sky-11151-creation-primitive.spec.ts:171` — AC-CP-04: the first-run card set has exactly 3 options (pending SKY-11151)
- `e2e/tests/sky-11151-creation-primitive.spec.ts:193` — AC-CP-05: Settings "New vault…" offers the same option set (pending SKY-11151)
- `e2e/tests/sky-11154-vault-settings-page.spec.ts:253` — AC-VS-07: dot-linking control between Notes and Story columns (pending SKY-11154)
- `e2e/tests/m12-scale-architecture-acceptance.spec.ts:125` — killing the app mid-scan and relaunching resumes the job from its last checkpoint
- `e2e/tests/m12-scale-architecture-acceptance.spec.ts:130` — the UI surfaces live progress/ETA for an in-flight background scan
- `e2e/folder-ops-sky7995.spec.ts:445` — SKY-9347: row absent after relaunch on Windows, cause TBD
- `e2e/continuity-panel.spec.ts:336` — Flaky on self-hosted CI — SQLite WAL race after SIGKILL in closeApp(). Track SKY-2594.
- `e2e/continuity-panel.spec.ts:380` — Flaky on self-hosted CI — SQLite lock contention and WAL race on SIGKILL path. Track SKY-2594.

## Tests and typecheck

Commands (repo root). Unit tests need Node with SQLite FTS5. This VM's default Node v22.14.0 is built without `ENABLE_FTS5` (`no such module: fts5`, 558 electron-main failures before any edit). The counts below use Node v22.23.3, which has FTS5. GitHub `ci` uses `node-version: '22'`, which is current 22.x and includes FTS5.

```bash
export PATH="/tmp/node-v22.23.3-linux-x64/bin:$PATH"   # local only; CI uses actions/setup-node 22
npm run typecheck
npm run test
```

### Before (clean `main` @ `a6d6b88`, before this diff)

| Suite | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `electron-main` `vitest run` | Test Files 204 passed (204). Tests 4645 passed, 10 skipped (4655). |
| `frontend` `vitest run` | Test Files 350 passed (350). Tests 5668 passed, 57 skipped (5725). |
| Combined | 10313 passed, 67 skipped, 0 failed (10380). |

### After

Filled in after the re-run on this branch. See the proof comment for the tip SHA.
